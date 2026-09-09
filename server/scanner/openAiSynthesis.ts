import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';
import {
  createStructuredScanPayload,
  enrichFindingsWithAi,
  generateDeterministicExecutiveSummary,
  AiFindingEnrichment,
} from './synthesisShared.js';

export interface OpenAiSynthesisResult {
  executiveSummary: ExecutiveSummary;
  enhancedFindings: Finding[];
  aiStatus: 'success' | 'fallback' | 'disabled';
  modelUsed?: string;
  provider: 'openai';
  error?: string;
}

export async function synthesizeWithOpenAi(
  scanResult: DeterministicScanResult,
  options: {
    aiEnabled?: boolean;
    modelName?: string;
    databaseName?: string;
    clusterName?: string;
    apiKey?: string;
  }
): Promise<OpenAiSynthesisResult> {
  const {
    aiEnabled = true,
    modelName = 'gpt-4o',
    databaseName = 'analytics_db',
    clusterName = 'ClickHouse Production',
    apiKey: customApiKey,
  } = options;

  if (!aiEnabled) {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(scanResult, 'openai'),
      enhancedFindings: scanResult.findings,
      aiStatus: 'disabled',
      provider: 'openai',
    };
  }

  const apiKey = (customApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'openai',
        'OpenAI API key is not configured. Running in offline deterministic mode.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: 'OpenAI API key is not configured. Provide a custom API key in the scan bar or set OPENAI_API_KEY.',
    };
  }

  const structuredPayload = createStructuredScanPayload(scanResult, databaseName, clusterName);

  const systemInstruction = `You are an elite ClickHouse Database Architect & Performance Optimization Specialist.
Your job is to provide actionable, concrete, and deep technical ClickHouse optimization advice based on factual scan data.
Always reference specific table names, column types, settings, and safe SQL statements from the provided scan data.
You MUST output valid JSON conforming strictly to the requested schema.`;

  const findingIdsList = structuredPayload.findings.map((f) => f.id).join(', ');
  const totalFindingsCount = structuredPayload.findings.length;

  const userPrompt = `Analyze the following deterministic ClickHouse health scan results for database "${databaseName}" on cluster "${clusterName}".

Provide a comprehensive, high-value AI synthesis in valid JSON format.
CRITICAL REQUIREMENT: The "findingEnrichments" array MUST include an entry for EVERY SINGLE finding from the scan payload (exactly ${totalFindingsCount} items for IDs: ${findingIdsList}). DO NOT truncate, summarize, or omit any finding!

{
  "executiveOverview": "2-3 structured paragraphs evaluating cluster health, calling out specific table names, partition health, and query patterns.",
  "topRisk": "The single most critical architectural or stability risk.",
  "quickWins": ["3-5 concrete, actionable low-effort remediation steps referencing specific tables/settings"],
  "strategicFixes": ["2-4 major structural upgrades like partition redesign, skip indexes, materialized views, or TTL tiering"],
  "findingEnrichments": [
    {
      "id": "finding ID matching the payload (e.g. ${structuredPayload.findings[0]?.id || 'FND-001'})",
      "rank": 1,
      "effort": "Low" | "Medium" | "High",
      "impact": "Low" | "Medium" | "High" | "Critical",
      "riskLevel": "Low" | "Medium" | "High" | "Critical",
      "justification": "Brief priority rationale",
      "aiInsight": "In-depth architectural explanation of why this finding matters specifically for their schema and query patterns",
      "aiSqlFix": "Custom tailored, safe executable SQL/DDL fix for this finding"
    }
  ]
}

Scan Payload:
${JSON.stringify(structuredPayload, null, 2)}`;

  let targetModel = (modelName || 'gpt-4o').trim();
  // Map any legacy or custom strings to valid official OpenAI models
  if (targetModel.includes('gpt-5') || targetModel === 'gpt-4o-latest') {
    targetModel = 'gpt-4o';
  } else if (targetModel === 'gpt-4') {
    targetModel = 'gpt-4-turbo';
  }

  let rawJsonText = '';

  try {
    const isO1orO3 = targetModel.startsWith('o1') || targetModel.startsWith('o3');
    const messages = isO1orO3
      ? [{ role: 'user', content: `${systemInstruction}\n\n${userPrompt}` }]
      : [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ];

    const requestBody: Record<string, unknown> = {
      model: targetModel,
      messages,
      response_format: { type: 'json_object' },
    };

    if (!isO1orO3) {
      requestBody.temperature = 0.2;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errBody = await response.text();
      let errMsg = `OpenAI API returned status ${response.status}`;
      try {
        const parsedErr = JSON.parse(errBody);
        if (parsedErr?.error?.message) {
          errMsg = parsedErr.error.message;
        }
      } catch {
        // keep status msg
      }
      if (response.status === 401) {
        errMsg = 'OpenAI API key is invalid or deactivated. Please check your API key.';
      } else if (response.status === 429) {
        errMsg = 'OpenAI rate limit or usage quota exceeded. Please check your billing plan.';
      } else if (response.status === 404) {
        errMsg = `Requested model "${targetModel}" is not available with your OpenAI account.`;
      }
      throw new Error(errMsg);
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (content && typeof content === 'string') {
      rawJsonText = content.trim();
    } else {
      throw new Error('Empty response from OpenAI');
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'OpenAI API request failed';
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'openai',
        `OpenAI synthesis unavailable: ${errorMsg}. Running in deterministic rule-based mode.`
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      modelUsed: targetModel,
      provider: 'openai',
      error: errorMsg,
    };
  }

  try {
    const parsed = JSON.parse(rawJsonText);

    const enhancedFindings = enrichFindingsWithAi(
      scanResult.findings,
      parsed.findingEnrichments as AiFindingEnrichment[],
      'Prioritized based on OpenAI architectural scan.'
    );

    const executiveSummary: ExecutiveSummary = {
      overview: parsed.executiveOverview || generateDeterministicExecutiveSummary(scanResult, 'openai').overview,
      overallHealthGrade: scanResult.overallGrade,
      topRisk: parsed.topRisk || 'Multiple partition fragmentation and query scan inefficiencies.',
      quickWins: parsed.quickWins?.length ? parsed.quickWins : generateDeterministicExecutiveSummary(scanResult, 'openai').quickWins,
      strategicFixes: parsed.strategicFixes?.length ? parsed.strategicFixes : generateDeterministicExecutiveSummary(scanResult, 'openai').strategicFixes,
      aiGenerated: true,
      modelUsed: targetModel,
      provider: 'openai',
    };

    return {
      executiveSummary,
      enhancedFindings,
      aiStatus: 'success',
      modelUsed: targetModel,
      provider: 'openai',
    };
  } catch (parseErr: unknown) {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'openai',
        'OpenAI response formatting error. Using rule-based fallback.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: 'Failed to parse JSON response from OpenAI API',
    };
  }
}
