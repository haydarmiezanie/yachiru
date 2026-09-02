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
        'OPENAI_API_KEY not configured. Running in offline deterministic mode.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: 'OPENAI_API_KEY environment variable is not configured.',
    };
  }

  const structuredPayload = createStructuredScanPayload(scanResult, databaseName, clusterName);

  const systemInstruction = `You are an elite ClickHouse Database Architect & Performance Optimization Specialist.
Your job is to provide actionable, concrete, and deep technical ClickHouse optimization advice based on factual scan data.
Always reference specific table names, column types, settings, and safe SQL statements from the provided scan data.
You MUST output valid JSON conforming strictly to the requested schema.`;

  const userPrompt = `Analyze the following deterministic ClickHouse health scan results for database "${databaseName}" on cluster "${clusterName}".

Provide a comprehensive, high-value AI synthesis in valid JSON format:
{
  "executiveOverview": "2-3 structured paragraphs evaluating cluster health, calling out specific table names, partition health, and query patterns.",
  "topRisk": "The single most critical architectural or stability risk.",
  "quickWins": ["3-5 concrete, actionable low-effort remediation steps referencing specific tables/settings"],
  "strategicFixes": ["2-4 major structural upgrades like partition redesign, skip indexes, materialized views, or TTL tiering"],
  "findingEnrichments": [
    {
      "id": "finding ID matching the payload",
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

  let requestedModel = (modelName || 'gpt-5.6-sol').trim();
  if (requestedModel.includes('gpt-5.6-sol')) {
    requestedModel = 'gpt-5.6-sol';
  } else if (requestedModel.includes('gpt-5.6-terra')) {
    requestedModel = 'gpt-5.6-terra';
  } else if (requestedModel.includes('gpt-5.6-luna')) {
    requestedModel = 'gpt-5.6-luna';
  } else if (requestedModel.includes('gpt-5.5')) {
    requestedModel = 'gpt-5.5';
  } else if (requestedModel.includes('gpt-5.4')) {
    requestedModel = 'gpt-5.4';
  }

  const candidateModels = Array.from(new Set([requestedModel, 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4', 'gpt-5.6-luna', 'gpt-4o']));

  let lastError: unknown = null;
  let rawJsonText = '';
  let successfulModel = requestedModel;

  for (const modelToTry of candidateModels) {
    try {
      const isO3 = modelToTry.startsWith('o1') || modelToTry.startsWith('o3');
      const messages = isO3
        ? [{ role: 'user', content: `${systemInstruction}\n\n${userPrompt}` }]
        : [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ];

      const requestBody: Record<string, unknown> = {
        model: modelToTry,
        messages,
        response_format: { type: 'json_object' },
      };

      if (!isO3) {
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
        throw new Error(errMsg);
      }

      const data: any = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content && typeof content === 'string') {
        rawJsonText = content.trim();
        successfulModel = modelToTry;
        break;
      }
    } catch (err: unknown) {
      lastError = err;
    }
  }

  if (!rawJsonText) {
    const errorMsg = lastError instanceof Error ? lastError.message : 'OpenAI API request failed';
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'openai',
        `OpenAI synthesis unavailable (${errorMsg.slice(0, 100)}). Running in deterministic rule-based mode.`
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
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
      modelUsed: successfulModel,
      provider: 'openai',
    };

    return {
      executiveSummary,
      enhancedFindings,
      aiStatus: 'success',
      modelUsed: successfulModel,
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
