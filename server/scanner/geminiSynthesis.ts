import { GoogleGenAI, Type } from '@google/genai';
import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';
import {
  createStructuredScanPayload,
  enrichFindingsWithAi,
  generateDeterministicExecutiveSummary,
  AiFindingEnrichment,
} from './synthesisShared.js';

export interface GeminiSynthesisResult {
  executiveSummary: ExecutiveSummary;
  enhancedFindings: Finding[];
  aiStatus: 'success' | 'fallback' | 'disabled';
  modelUsed?: string;
  provider: 'gemini';
  error?: string;
}

export async function synthesizeWithGemini(
  scanResult: DeterministicScanResult,
  options: {
    aiEnabled?: boolean;
    modelName?: string;
    databaseName?: string;
    clusterName?: string;
    apiKey?: string;
  }
): Promise<GeminiSynthesisResult> {
  const {
    aiEnabled = true,
    modelName = 'gemini-3.7-flash',
    databaseName = 'analytics_db',
    clusterName = 'ClickHouse Production',
    apiKey: customApiKey,
  } = options;

  // If AI is disabled by user flag
  if (!aiEnabled) {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(scanResult, 'gemini'),
      enhancedFindings: scanResult.findings,
      aiStatus: 'disabled',
      provider: 'gemini',
    };
  }

  const apiKey = (customApiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'gemini',
        'GEMINI_API_KEY not configured. Running in offline deterministic mode.'
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'gemini',
      error: 'GEMINI_API_KEY environment variable is not configured.',
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

    const structuredPayload = createStructuredScanPayload(scanResult, databaseName, clusterName);

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

    // Normalize model candidates
    let requestedModel = modelName || 'gemini-3.7-flash';
    if (requestedModel === 'gemini-3.1-pro' || requestedModel === 'gemini-pro' || requestedModel.includes('3.1-pro')) {
      requestedModel = 'gemini-3.1-pro-preview';
    } else if (requestedModel.includes('2.5-flash-lite') || requestedModel === 'gemini-flash-lite') {
      requestedModel = 'gemini-3.1-flash-lite';
    }

    const candidateModels = Array.from(
      new Set([requestedModel, 'gemini-3.7-flash', 'gemini-3.1-flash-lite'])
    );

    let response: any = null;
    let successfulModel = requestedModel;
    let lastError: unknown = null;

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
        } catch (err: unknown) {
          lastError = err;
          const errMsg = err instanceof Error ? err.message : String(err);
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
          break;
        }
      }

      if (response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('Unable to generate AI synthesis across candidate models.');
    }

    const text = response.text.trim();
    const parsed = JSON.parse(text);

    const enhancedFindings = enrichFindingsWithAi(
      scanResult.findings,
      parsed.findingEnrichments as AiFindingEnrichment[],
      'Prioritized based on Gemini architectural scan.'
    );

    const executiveSummary: ExecutiveSummary = {
      overview: parsed.executiveOverview || generateDeterministicExecutiveSummary(scanResult, 'gemini').overview,
      overallHealthGrade: scanResult.overallGrade,
      topRisk: parsed.topRisk || 'Multiple partition fragmentation and query scan inefficiencies.',
      quickWins: parsed.quickWins?.length ? parsed.quickWins : generateDeterministicExecutiveSummary(scanResult, 'gemini').quickWins,
      strategicFixes: parsed.strategicFixes?.length ? parsed.strategicFixes : generateDeterministicExecutiveSummary(scanResult, 'gemini').strategicFixes,
      aiGenerated: true,
      modelUsed: successfulModel,
      provider: 'gemini',
    };

    return {
      executiveSummary,
      enhancedFindings,
      aiStatus: 'success',
      modelUsed: successfulModel,
      provider: 'gemini',
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    let friendlyError = rawMsg;
    try {
      if (rawMsg.startsWith('{') && rawMsg.endsWith('}')) {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error?.message) {
          friendlyError = parsed.error.message;
        }
      }
    } catch {
      // keep rawMsg
    }

    return {
      executiveSummary: generateDeterministicExecutiveSummary(
        scanResult,
        'gemini',
        `Gemini AI synthesis fallback active (${friendlyError.slice(0, 120)}). Running in deterministic rule-based mode.`
      ),
      enhancedFindings: scanResult.findings,
      aiStatus: 'fallback',
      provider: 'gemini',
      error: friendlyError,
    };
  }
}
