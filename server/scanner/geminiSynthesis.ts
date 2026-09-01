import { GoogleGenAI, Type } from '@google/genai';
import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';

export interface GeminiSynthesisResult {
  executiveSummary: ExecutiveSummary;
  enhancedFindings: Finding[];
  aiStatus: 'success' | 'fallback' | 'disabled';
  modelUsed?: string;
  error?: string;
}

export async function synthesizeWithGemini(
  scanResult: DeterministicScanResult,
  options: {
    aiEnabled?: boolean;
    modelName?: string;
    databaseName?: string;
    clusterName?: string;
  }
): Promise<GeminiSynthesisResult> {
  const { aiEnabled = true, modelName = 'gemini-3.7-flash', databaseName = 'analytics_db', clusterName = 'ClickHouse Production' } = options;

  // If AI is turned off by user flag
  if (!aiEnabled) {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(scanResult),
      enhancedFindings: scanResult.findings,
      aiStatus: 'disabled',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    console.warn('[Yachiru AI] GEMINI_API_KEY not configured. Using deterministic synthesis fallback.');
    return {
      executiveSummary: generateDeterministicExecutiveSummary(scanResult, 'GEMINI_API_KEY not configured. Running in offline deterministic mode.'),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // Prepare compact, structured findings payload (tokens minimization)
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

    const prompt = `You are Yachiru's senior ClickHouse Database Architect & Optimization Specialist.
Analyze the following deterministic ClickHouse health scan results for database "${databaseName}" on cluster "${clusterName}".

Provide a comprehensive, high-value AI synthesis:
1. executiveOverview: 2-3 structured paragraphs evaluating the cluster state, calling out specific table names, specific query log patterns, and compression/partition health.
2. topRisk: The single most critical architectural or stability risk.
3. quickWins: 3-5 concrete, actionable low-effort remediation steps referencing specific tables/settings from the payload.
4. strategicFixes: 2-4 major structural upgrades (e.g., partition redesign, secondary skip index, materialized view pipeline, or TTL tiering).
5. findingEnrichments: For each finding ID in the payload, provide:
   - aiInsight: In-depth architectural explanation of why this finding matters specifically for their schema and query patterns.
   - aiSqlFix: Custom tailored, safe executable SQL/DDL fix for this finding.
   - effort: Low, Medium, or High
   - impact: Low, Medium, High, or Critical
   - riskLevel: Low, Medium, High, or Critical
   - rank: Priority order number

Scan Payload:
${JSON.stringify(structuredPayload, null, 2)}`;

    // Model candidates: chosen model first, then fallback models on transient 503/429 errors
    let requestedModel = modelName || 'gemini-3.7-flash';
    if (requestedModel.includes('2.5-flash-lite')) {
      requestedModel = 'gemini-3.1-flash-lite';
    }

    const candidateModels = Array.from(
      new Set([requestedModel, 'gemini-3.1-flash-lite', 'gemini-3.7-flash', 'gemini-2.5-flash'])
    );

    let response: any = null;
    let successfulModel = requestedModel;
    let lastError: any = null;

    for (const modelToTry of candidateModels) {
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: prompt,
            config: {
              systemInstruction: `You are an elite ClickHouse Database Architect. Your job is to provide actionable, concrete, and deep technical ClickHouse optimization advice. Avoid vague generalities—always reference specific table names, column types, settings, and SQL statements from the provided scan data.`,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  executiveOverview: {
                    type: Type.STRING,
                    description: '2-3 paragraph executive summary in clear natural language explaining the health state, key risks, and primary optimization opportunities.',
                  },
                  topRisk: {
                    type: Type.STRING,
                    description: 'The single most urgent cluster bottleneck or stability risk identified.',
                  },
                  quickWins: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'List of 3-5 immediate low-effort / high-reward fixes referencing specific tables/settings.',
                  },
                  strategicFixes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'List of 2-4 larger architectural changes.',
                  },
                  findingEnrichments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        rank: { type: Type.INTEGER },
                        effort: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                        impact: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] },
                        riskLevel: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] },
                        justification: { type: Type.STRING },
                        aiInsight: { type: Type.STRING },
                        aiSqlFix: { type: Type.STRING },
                      },
                      required: ['id', 'rank', 'effort', 'impact', 'aiInsight', 'aiSqlFix'],
                    },
                    description: 'Deep AI architectural insight and custom SQL remediation for each finding.',
                  },
                },
                required: ['executiveOverview', 'topRisk', 'quickWins', 'strategicFixes', 'findingEnrichments'],
              },
            },
          });

          if (response && response.text) {
            successfulModel = modelToTry;
            break;
          }
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isTransient =
            errMsg.includes('503') ||
            errMsg.includes('high demand') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('429') ||
            errMsg.includes('RESOURCE_EXHAUSTED');

          if (isTransient && attempts < maxAttempts) {
            await new Promise((res) => setTimeout(res, 750));
            continue;
          }
          if (isTransient) {
            break;
          } else {
            break;
          }
        }
      }

      if (response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('Unable to generate AI synthesis across candidate models.');
    }

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);

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
              justification: aiE.justification || 'Prioritized based on Gemini architectural scan.',
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
    };

    return {
      executiveSummary,
      enhancedFindings,
      aiStatus: 'success',
      modelUsed: successfulModel,
    };
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    let friendlyError = rawMsg;
    try {
      if (rawMsg.startsWith('{') && rawMsg.endsWith('}')) {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error?.message) {
          friendlyError = parsed.error.message;
        }
      }
    } catch (_) {
      // keep rawMsg
    }

    console.warn('[Yachiru AI Synthesis] Gemini API call failed, gracefully falling back:', friendlyError);
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        `AI synthesis fallback active (${friendlyError.slice(0, 120)}). Running in deterministic rule-based mode.`
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      error: friendlyError,
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

  // Derive quick wins dynamically from actual findings
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
  };
}
