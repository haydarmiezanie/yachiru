import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';

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
      executiveSummary: generateDeterministicExecutiveSummary(scanResult),
      enhancedFindings: scanResult.findings,
      aiStatus: 'disabled',
      provider: 'openai',
    };
  }

  const apiKey = (customApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
    console.warn('[Yachiru OpenAI] OPENAI_API_KEY not configured. Falling back to deterministic analysis.');
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'OPENAI_API_KEY not configured. Running in offline deterministic mode.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: 'OPENAI_API_KEY environment variable is not configured.',
    };
  }

  // Compact payload
  const structuredPayload = {
    database: databaseName,
    cluster: clusterName,
    overallScore: scanResult.overallScore,
    overallGrade: scanResult.overallGrade,
    stats: scanResult.stats,
    dimensionScores: Object.fromEntries(
      Object.entries(scanResult.dimensionScores).map(([k, v]) => [k, { score: v.score, summary: v.summary }])
    ),
    findings: scanResult.findings.map((f) => ({
      id: f.id,
      dimension: f.dimension,
      severity: f.severity,
      title: f.title,
      tableName: f.tableName,
      what: f.what,
      whyTechnical: f.whyTechnical,
      impact: f.estimatedImpact,
    })),
  };

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

  let requestedModel = modelName || 'gpt-4o';
  // Normalize model name
  if (requestedModel.includes('gpt-4o-mini')) {
    requestedModel = 'gpt-4o-mini';
  } else if (requestedModel.includes('o3-mini')) {
    requestedModel = 'o3-mini';
  } else if (requestedModel.includes('gpt-4o')) {
    requestedModel = 'gpt-4o';
  } else if (requestedModel.includes('gpt-4-turbo')) {
    requestedModel = 'gpt-4-turbo';
  }

  const candidateModels = Array.from(new Set([requestedModel, 'gpt-4o-mini', 'gpt-4o']));

  let lastError: any = null;
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

      const requestBody: any = {
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
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response content received from OpenAI API.');
      }

      rawJsonText = content;
      successfulModel = modelToTry;
      break;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Yachiru OpenAI] Error with model ${modelToTry}:`, err.message || err);
      // Try next model
    }
  }

  if (!rawJsonText) {
    const errorMsg = lastError?.message || 'Failed to synthesize analysis with OpenAI.';
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        `OpenAI ChatGPT synthesis fallback active (${errorMsg.slice(0, 120)}). Running in deterministic rule-based mode.`
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: errorMsg,
    };
  }

  try {
    const parsed = JSON.parse(rawJsonText);

    // Merge AI enrichments into findings
    const enrichmentMap = new Map<string, any>();
    if (Array.isArray(parsed.findingEnrichments)) {
      for (const e of parsed.findingEnrichments) {
        enrichmentMap.set(e.id, e);
      }
    }

    const enhancedFindings = scanResult.findings.map((f) => {
      const aiE = enrichmentMap.get(f.id);
      return {
        ...f,
        aiInsight: aiE?.aiInsight || undefined,
        aiSqlFix: aiE?.aiSqlFix || undefined,
        aiRiskLevel: aiE?.riskLevel || undefined,
        relativePriority: aiE
          ? {
              rank: aiE.rank || 1,
              effort: aiE.effort || 'Medium',
              impact: aiE.impact || 'High',
              justification: aiE.justification || 'Prioritized based on OpenAI architectural scan.',
            }
          : f.relativePriority,
      };
    });

    const executiveSummary: ExecutiveSummary = {
      overview: parsed.executiveOverview || generateDeterministicExecutiveSummary(scanResult).overview,
      overallHealthGrade: scanResult.overallGrade,
      topRisk: parsed.topRisk || 'Multiple partition fragmentation and query scan inefficiencies.',
      quickWins: parsed.quickWins?.length ? parsed.quickWins : generateDeterministicExecutiveSummary(scanResult).quickWins,
      strategicFixes: parsed.strategicFixes?.length ? parsed.strategicFixes : generateDeterministicExecutiveSummary(scanResult).strategicFixes,
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
  } catch (parseErr: any) {
    console.error('[Yachiru OpenAI] Failed to parse OpenAI JSON output:', parseErr);
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'OpenAI response formatting error. Using rule-based fallback.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'openai',
      error: 'Failed to parse JSON response from OpenAI API',
    };
  }
}

function generateDeterministicExecutiveSummary(scanResult: DeterministicScanResult, aiNote?: string): ExecutiveSummary {
  const criticalCount = scanResult.findings.filter((f) => f.severity === 'critical').length;
  const warningCount = scanResult.findings.filter((f) => f.severity === 'warning').length;

  let overview = `[Rule-Based Heuristic Evaluation] Yachiru completed an automated deterministic scan across 9 ClickHouse architectural dimensions. The database achieved an overall health score of ${scanResult.overallScore}/100 (Grade ${scanResult.overallGrade}). `;
  if (criticalCount > 0) {
    overview += `There are ${criticalCount} critical bottlenecks and ${warningCount} optimization warnings flagged by static threshold analysis.`;
  } else if (warningCount > 0) {
    overview += `The cluster is operating within normal boundaries with ${warningCount} identified opportunities for storage and compression tuning.`;
  } else {
    overview += `All tested system table parameters and partition health metrics meet optimal ClickHouse production standards.`;
  }

  const quickWins: string[] = [];
  for (const f of scanResult.findings) {
    if (quickWins.length >= 3) break;
    if (f.tableName) {
      quickWins.push(`[${f.dimensionName}] ${f.recommendationSummary}`);
    }
  }
  if (quickWins.length === 0) {
    quickWins.push('Ensure async_insert = 1 is configured for batch insert buffering.');
    quickWins.push('Verify background_pool_size is aligned with server CPU core count.');
  }

  const strategicFixes = [
    'Align primary sorting keys (ORDER BY) with high-frequency WHERE clause filters to avoid full scans.',
    'Implement automated TTL policies on older timeseries data to prevent unbounded storage growth.',
    'Evaluate Materialized Views for recurring aggregation queries to reduce repeat CPU overhead.',
  ];

  return {
    overview,
    overallHealthGrade: scanResult.overallGrade,
    topRisk: criticalCount > 0
      ? scanResult.findings.find((f) => f.severity === 'critical')?.title || 'Critical bottlenecks detected by rule-based scanner.'
      : 'No critical threshold violations detected.',
    quickWins,
    strategicFixes,
    aiGenerated: false,
    aiNote,
    provider: 'openai',
  };
}
