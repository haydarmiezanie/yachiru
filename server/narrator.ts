import { GoogleGenAI, Type } from '@google/genai';
import { AINarrative, AnalysisReport } from '../src/types.js';

// Default TTL for system Gemini key depletion status (10 minutes)
const SYSTEM_KEY_DEPLETION_TTL_MS = 10 * 60 * 1000;

export interface SystemKeyState {
  depleted: boolean;
  depletedAt: string | null;
  expiresAt: string | null;
  remainingSeconds: number;
  reason: string | null;
}

/**
 * Manages the default system Gemini API key depletion state with TTL and structured logging.
 * Prevents locking all users permanently into deterministic mode while avoiding spamming
 * depleted endpoints.
 */
export class SystemKeyStateManager {
  private _depleted = false;
  private _depletedAt: number | null = null;
  private _expiresAt: number | null = null;
  private _reason: string | null = null;
  private _defaultTtlMs: number;

  constructor(defaultTtlMs: number = SYSTEM_KEY_DEPLETION_TTL_MS) {
    this._defaultTtlMs = defaultTtlMs;
  }

  public isDepleted(): boolean {
    if (!this._depleted) {
      return false;
    }
    const now = Date.now();
    if (this._expiresAt && now >= this._expiresAt) {
      const expiredTimeStr = new Date(this._expiresAt).toISOString();
      console.log(
        `[Yachiru] [STATE CHANGE] Default system Gemini API key depletion TTL expired (expired at ${expiredTimeStr}). Resetting status to active.`
      );
      this.reset('TTL expired automatically');
      return false;
    }
    return true;
  }

  public markDepleted(reason: string, ttlMs: number = this._defaultTtlMs): void {
    const now = Date.now();
    this._depleted = true;
    this._depletedAt = now;
    this._expiresAt = now + ttlMs;
    this._reason = reason;

    const expiresDateStr = new Date(this._expiresAt).toISOString();
    console.warn(
      `[Yachiru] [STATE CHANGE] Default system Gemini API key marked as DEPLETED.\n` +
      `  - Reason: "${reason}"\n` +
      `  - Marked at: ${new Date(now).toISOString()}\n` +
      `  - Auto-reset scheduled at: ${expiresDateStr} (in ${ttlMs / 1000}s)`
    );
  }

  public reset(reason: string = 'Manual reset'): void {
    const wasDepleted = this._depleted;
    this._depleted = false;
    this._depletedAt = null;
    this._expiresAt = null;
    this._reason = null;

    if (wasDepleted) {
      console.log(`[Yachiru] [STATE CHANGE] Default system Gemini API key status RESET to active. Reason: "${reason}".`);
    }
  }

  public getStatus(): SystemKeyState {
    const isCurrentlyDepleted = this.isDepleted();
    const now = Date.now();
    return {
      depleted: isCurrentlyDepleted,
      depletedAt: this._depletedAt ? new Date(this._depletedAt).toISOString() : null,
      expiresAt: this._expiresAt ? new Date(this._expiresAt).toISOString() : null,
      remainingSeconds: this._expiresAt ? Math.max(0, Math.round((this._expiresAt - now) / 1000)) : 0,
      reason: this._reason,
    };
  }
}

export const systemKeyState = new SystemKeyStateManager();

export interface GetGenAiResult {
  client: GoogleGenAI | null;
  source: 'user' | 'system' | 'none';
}

/**
 * Instantiates the GoogleGenAI SDK client.
 * ONLY falls back to process.env.GEMINI_API_KEY if allowSystemKeyFallback is explicitly true.
 */
export function getGenAI(
  customApiKey?: string,
  allowSystemKeyFallback: boolean = false
): GetGenAiResult {
  const userKey = customApiKey?.trim();
  if (userKey) {
    return {
      client: new GoogleGenAI({
        apiKey: userKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      }),
      source: 'user',
    };
  }

  if (allowSystemKeyFallback && process.env.GEMINI_API_KEY) {
    return {
      client: new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      }),
      source: 'system',
    };
  }

  return { client: null, source: 'none' };
}

export type AiErrorCategory =
  | 'quota_exhausted'
  | 'invalid_key'
  | 'model_not_found'
  | 'service_unavailable'
  | 'schema_error'
  | 'network_error'
  | 'unknown';

export function categorizeAiError(err: unknown): { category: AiErrorCategory; rawMessage: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  // 1. Quota / Credits / Rate Limit (HTTP 429)
  if (
    lower.includes('credits are depleted') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    return { category: 'quota_exhausted', rawMessage };
  }

  // 2. Service Unavailable / Transient High Demand / Overloaded (HTTP 503 / 500 / 504)
  if (
    lower.includes('503') ||
    lower.includes('high demand') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('internal server error') ||
    lower.includes('500') ||
    lower.includes('504')
  ) {
    return { category: 'service_unavailable', rawMessage };
  }

  // 3. Invalid Key / Auth (401 / 403 / API_KEY_INVALID)
  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return { category: 'invalid_key', rawMessage };
  }

  // 4. Model not found / unavailable (HTTP 404)
  if (
    lower.includes('404') ||
    lower.includes('not found') ||
    lower.includes('no longer available') ||
    lower.includes('unsupported model') ||
    lower.includes('model not available')
  ) {
    return { category: 'model_not_found', rawMessage };
  }

  // 5. Schema / JSON / Parsing error
  if (
    lower.includes('json') ||
    lower.includes('syntaxerror') ||
    lower.includes('empty text returned') ||
    lower.includes('schema') ||
    lower.includes('unexpected token')
  ) {
    return { category: 'schema_error', rawMessage };
  }

  // 6. Network / Connectivity error
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('network connection') ||
    lower.includes('socket hang up') ||
    lower.includes('connection timeout') ||
    lower.includes('gateway timeout')
  ) {
    return { category: 'network_error', rawMessage };
  }

  return { category: 'unknown', rawMessage };
}

export function extractCleanErrorMessage(raw: string): string {
  if (!raw) return 'Unknown error';
  const trimmed = raw.trim();

  // Try extracting inner message if JSON format
  try {
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed.error && typeof parsed.error.message === 'string') {
        return parsed.error.message.trim();
      }
      if (typeof parsed.message === 'string') {
        return parsed.message.trim();
      }
    }
  } catch {
    // Non-JSON or partial
  }

  // Check for nested JSON substring like [Error: {"error":...}]
  const jsonMatch = trimmed.match(/\{"error":\{.*"message":"([^"]+)".*\}\}/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }

  return trimmed;
}

export function getAiErrorInfo(
  category: AiErrorCategory,
  rawError: string,
  hasUserKey: boolean
): {
  fallbackTitle: string;
  friendlyMessage: string;
} {
  const cleanDetail = extractCleanErrorMessage(rawError);

  switch (category) {
    case 'service_unavailable':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Gemini Service High Demand)',
        friendlyMessage: `The requested Gemini model is currently experiencing high demand upstream (HTTP 503). Retrying shortly or switching models (e.g. Gemini 3.8 Flash or Gemini 3.1 Pro) is recommended. [Detail: ${cleanDetail}]`,
      };

    case 'quota_exhausted':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Quota Notice)',
        friendlyMessage: hasUserKey
          ? `Prepayment credits or rate limit are depleted for your Gemini API project (HTTP 429). Check your balance or project rate limits at https://aistudio.google.com/app/apikey. [Detail: ${cleanDetail}]`
          : `System AI quota is currently depleted (HTTP 429). Please provide your own Gemini API Key in the config above to run live AI synthesis. [Detail: ${cleanDetail}]`,
      };

    case 'invalid_key':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Invalid API Key)',
        friendlyMessage: `The provided Gemini API Key is invalid or unrecognized. Please verify your key at https://aistudio.google.com/app/apikey. [Detail: ${cleanDetail}]`,
      };

    case 'model_not_found':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Model Unavailable)',
        friendlyMessage: `The requested Gemini model endpoint was not found or is currently unsupported on your API key tier. [Detail: ${cleanDetail}]`,
      };

    case 'schema_error':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Schema Parse Notice)',
        friendlyMessage: `Gemini returned a response that could not be parsed into the expected structured audit schema. [Detail: ${cleanDetail}]`,
      };

    case 'network_error':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Network Connectivity Notice)',
        friendlyMessage: `Unable to establish connection to Google Gemini API servers. [Detail: ${cleanDetail}]`,
      };

    case 'unknown':
    default:
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (AI Service Notice)',
        friendlyMessage: `AI synthesis encountered an unexpected issue. [Detail: ${cleanDetail}]`,
      };
  }
}

function resolveGeminiModelId(inputModel?: string): string {
  if (!inputModel) return 'gemini-3.8-flash';
  const clean = inputModel.trim().toLowerCase();

  if (clean === 'gemini-3.1-pro' || clean === 'gemini-3.1-pro-preview' || clean.includes('3.1-pro')) {
    return 'gemini-3.1-pro-preview';
  }
  if (clean === 'gemini-3.8-flash' || clean.includes('3.8-flash')) {
    return 'gemini-3.8-flash';
  }
  if (clean === 'gemini-3.7-flash' || clean.includes('3.7-flash')) {
    return 'gemini-3.7-flash';
  }
  if (clean === 'gemini-3.6-flash' || clean.includes('3.6-flash')) {
    return 'gemini-3.6-flash';
  }
  if (clean === 'gemini-2.5-flash' || clean.includes('2.5-flash')) {
    return 'gemini-2.5-flash';
  }
  if (clean === 'gemini-3.1-flash-lite' || clean.includes('flash-lite')) {
    return 'gemini-3.1-flash-lite';
  }

  return inputModel;
}

function getModelFallbackChain(primaryModel: string): string[] {
  const chain: string[] = [primaryModel];
  // Known active models to fallback to in case of transient 503 or 404
  const standardFallbacks = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
  ];

  for (const model of standardFallbacks) {
    if (!chain.includes(model)) {
      chain.push(model);
    }
  }
  return chain;
}

function parseJsonSafe(rawText: string) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Deterministic synthesis engine that generates an executive narrative and prioritized
 * remediation plan strictly from the computed metrics without requiring external LLM API calls.
 */
export function generateDeterministicNarrative(
  report: AnalysisReport,
  reason: string = 'Deterministic Engine'
): AINarrative {
  const critCount = report.summary.critical_count;
  const warnCount = report.summary.warning_count;
  const score = report.overall_score;

  let healthClassification = 'Architecturally Sound with Minor Tuning Opportunities';
  if (score < 50) {
    healthClassification = 'Severe Operational Degradation & Ingestion Bottlenecks';
  } else if (score < 75) {
    healthClassification = 'Moderate Inefficiencies Requiring Structural Schema Adjustments';
  }

  const executiveSummary = `
Audit of ClickHouse cluster (version ${report.clickhouse_version}) across database "${report.database_name}" concluded with an overall optimization score of ${score}/100 (${report.overall_verdict.toUpperCase()}). The system currently hosts ${report.summary.total_tables} tables comprising ${report.summary.total_rows.toLocaleString()} total rows and ${report.summary.total_size_compressed} of compressed columnar storage (compression ratio: ${report.summary.avg_compression_ratio}x).

Diagnostic evaluation registered ${critCount} critical anomalies and ${warnCount} operational warnings. Database operational posture is evaluated as "${healthClassification}". Observed findings are primarily driven by part lifecycle management, sparse primary key boundary selection, and query memory consumption patterns. Immediate remediation should prioritize high-cardinality merges and part count containment to prevent ingestion backpressure.
`.trim();

  // Sort findings by severity
  const prioritizedFindings = [...report.findings].sort((a, b) => {
    const scoreMap = { critical: 3, warning: 2, good: 1 };
    return scoreMap[b.status] - scoreMap[a.status];
  });

  const topPriorities = prioritizedFindings.slice(0, 4).map((finding, idx) => ({
    priority: idx + 1,
    title: finding.title,
    target_table: finding.table,
    why: finding.impact,
    action: finding.recommendation_sql_or_text || 'Inspect table schema and query execution patterns.',
  }));

  const workloadRiskAnalysis = critCount > 0
    ? `Elevated risk under sustained high-throughput ingestion spikes. Tables exhibiting active part saturation (>300 parts) or unconstrained ORDER BY definitions will trigger ClickHouse part merge throttles ("Too many parts in all data parts in table"), resulting in HTTP 500 rejection codes for upstream ingest pipelines.`
    : `Stable baseline performance profile. The current MergeTree partition layouts and memory bounds present minimal immediate hazard under anticipated concurrent analytical query workloads, provided existing batch sizes (>10,000 rows/block) are maintained.`;

  return {
    model: reason,
    executive_summary: executiveSummary,
    cluster_health_verdict: healthClassification,
    top_priorities: topPriorities,
    workload_risk_analysis: workloadRiskAnalysis,
    ai_diagnoses: [],
    isAiGenerated: false,
  };
}

export interface NarrativeOptions {
  enableAiNarrative?: boolean;
  allowSystemKeyFallback?: boolean;
}

export async function generateNarrative(
  report: AnalysisReport,
  userModelPreference?: string,
  userApiKey?: string,
  options: NarrativeOptions = { enableAiNarrative: true, allowSystemKeyFallback: true }
): Promise<AINarrative> {
  const isAiRequested = options.enableAiNarrative !== false;
  const allowSystemFallback = options.allowSystemKeyFallback ?? isAiRequested;
  const hasUserKey = Boolean(userApiKey && userApiKey.trim());
  const targetModel = resolveGeminiModelId(userModelPreference);

  // If user explicitly selected "Without AI", return deterministic narrative immediately
  // without instantiating GoogleGenAI client or making any network calls.
  if (!isAiRequested) {
    console.log('[Yachiru] Deterministic mode selected ("Without AI"). Generating deterministic evidence report.');
    return generateDeterministicNarrative(report, 'Deterministic Rule Engine (Without AI)');
  }

  // If AI was requested but system key is marked depleted and user provided no key:
  if (!hasUserKey && systemKeyState.isDepleted()) {
    const status = systemKeyState.getStatus();
    console.log(
      `[Yachiru] Skipping system Gemini API call: default key is marked depleted until ${status.expiresAt}.`
    );
    return {
      model: targetModel,
      executive_summary: '',
      top_priorities: [],
      workload_risk_analysis: '',
      ai_diagnoses: [],
      isAiGenerated: false,
      aiError: `System AI quota is temporarily depleted (HTTP 429). Automatic retry resets at ${status.expiresAt} (~${status.remainingSeconds}s remaining). Please provide your own Gemini API Key or generate without AI.`,
      aiErrorCategory: 'quota_exhausted',
    };
  }

  // Instantiate client with strict fallback control
  const { client: ai, source } = getGenAI(userApiKey, allowSystemFallback);
  if (!ai) {
    console.log('[Yachiru] No valid Gemini API key available (custom key absent and system fallback disabled/unset).');
    return {
      model: targetModel,
      executive_summary: '',
      top_priorities: [],
      workload_risk_analysis: '',
      ai_diagnoses: [],
      isAiGenerated: false,
      aiError: 'A Gemini API Key is required for live AI synthesis. Please provide an API key in the configuration or select "Generate Without AI (Deterministic)".',
      aiErrorCategory: 'invalid_key',
    };
  }

  const systemInstruction = `
You are the Principal ClickHouse Systems Architect and Performance Intelligence Engine for "Yachiru".
Your mission is to perform a comprehensive, end-to-end diagnosis of the ClickHouse database using all provided cluster statistics, schema definitions, compression metrics, part counts, and deterministic rule checks.

CORE RESPONSIBILITIES:
1. FULL-CLUSTER ASSESSMENT: Assess overall database health, identify hidden architectural flaws, cross-table correlations, and systemic bottlenecks (e.g., compaction starvation, partition key granularity mismatch, sub-optimal sparse index column order, improper column codecs, mutation backlogs, or memory spilling in distributed aggregations).
2. SYNTHESIZE EXECUTIVE NARRATIVE: Write an authoritative, high-level summary and workload risk evaluation.
3. PRODUCE ACTIONABLE AI DIAGNOSES & REMEDIATIONS: Generate a list of concrete diagnostic findings with root cause analysis, risk vectors, multi-step remediation plans, and precise, non-destructive ClickHouse DDL / SQL / system parameter adjustments.

STRICT OPERATIONAL DIRECTIVES:
- Base all evaluations on ClickHouse columnar storage and vectorized execution mechanics.
- Do NOT fabricate table names or metrics not present in the payload.
- Provide production-ready, safe remediation SQL statements (e.g., ALTER TABLE ADD/MODIFY COLUMN CODEC, ADD INDEX ... TYPE minmax/set/bloom_filter, OPTIMIZE TABLE ... FINAL DEDUPLICATE, SET max_threads/max_execution_time).
`.trim();

  const prompt = `
Perform a full architectural diagnosis and remediation synthesis for this ClickHouse database:

=== CLUSTER METADATA & SUMMARY ===
Database Name: ${report.database_name}
ClickHouse Version: ${report.clickhouse_version}
Cluster Topology: ${report.cluster_mode}
Overall Deterministic Score: ${report.overall_score}/100 (${report.overall_verdict})
Total Tables: ${report.summary.total_tables}
Total Rows: ${report.summary.total_rows.toLocaleString()}
Total Storage (Compressed): ${report.summary.total_size_compressed}
Total Storage (Uncompressed): ${report.summary.total_size_uncompressed}
Average Compression Ratio: ${report.summary.avg_compression_ratio}x
Active MergeTree Parts: ${report.summary.total_parts}
Queries Evaluated: ${report.summary.total_queries_analyzed}
Critical Issues: ${report.summary.critical_count} | Warnings: ${report.summary.warning_count} | Healthy Checks: ${report.summary.good_count}

=== TABLE SCHEMAS & METRICS ===
${JSON.stringify(
  report.tables.map((t) => ({
    table_name: t.name,
    engine: t.engine,
    rows: t.total_rows,
    size_compressed: t.total_bytes_compressed,
    size_uncompressed: t.total_bytes_uncompressed,
    compression_ratio: `${t.compression_ratio}x`,
    active_parts: t.active_parts,
    partition_count: t.partition_count,
    order_by_key: t.order_by_key,
    partition_key: t.partition_key,
    skip_indices_count: t.skip_indices_count,
  })),
  null,
  2
)}

=== DETERMINISTIC RULE FINDINGS ===
${JSON.stringify(
  report.findings.map((f) => ({
    id: f.id,
    category: f.category_name,
    title: f.title,
    table: f.table,
    status: f.status,
    metric_value: f.metric_value,
    threshold: f.threshold,
    evidence: f.evidence,
    impact: f.impact,
  })),
  null,
  2
)}
`.trim();

  const candidateModels = getModelFallbackChain(targetModel);
  let lastError: unknown = null;
  let finalModelUsed = targetModel;

  for (const currentModel of candidateModels) {
    const isPrimary = currentModel === targetModel;
    const maxAttemptsForModel = isPrimary ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttemptsForModel; attempt++) {
      try {
        console.log(
          `[Yachiru] Requesting full Gemini AI diagnosis via ${source} key with model: "${currentModel}" (attempt ${attempt}/${maxAttemptsForModel})`
        );

        const response = await ai.models.generateContent({
          model: currentModel,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executive_summary: {
                  type: Type.STRING,
                  description:
                    'A 2-3 paragraph plain-language summary of the database health, highlighting primary bottlenecks and architectural condition based strictly on the findings.',
                },
                cluster_health_verdict: {
                  type: Type.STRING,
                  description: 'Short authoritative health verdict sentence.',
                },
                top_priorities: {
                  type: Type.ARRAY,
                  description:
                    'Ordered list of top actionable optimization priorities from highest operational urgency down.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      priority: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      target_table: { type: Type.STRING },
                      why: {
                        type: Type.STRING,
                        description: 'Direct mechanical reason in ClickHouse why this matters',
                      },
                      action: {
                        type: Type.STRING,
                        description: 'Concrete recommendation or configuration adjustment',
                      },
                    },
                    required: ['priority', 'title', 'why', 'action'],
                  },
                },
                workload_risk_analysis: {
                  type: Type.STRING,
                  description:
                    'Assessment of risks under sustained ingestion volume or high concurrent query spikes.',
                },
                ai_diagnoses: {
                  type: Type.ARRAY,
                  description:
                    'Detailed AI-diagnosed architectural findings with root cause and remediation SQL for table and system optimization.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        description:
                          'One of: part_health, primary_key, partitioning, compression, table_engine, skip_indices, query_performance, replication_distributed, server_settings',
                      },
                      category_name: { type: Type.STRING },
                      title: { type: Type.STRING },
                      status: {
                        type: Type.STRING,
                        description: 'critical, warning, or good',
                      },
                      table: { type: Type.STRING },
                      deep_assessment: {
                        type: Type.STRING,
                        description: 'Technical evaluation of the problem and how ClickHouse internal mechanics behave.',
                      },
                      root_cause: {
                        type: Type.STRING,
                        description: 'Underlying structural or operational root cause.',
                      },
                      risk_vector: {
                        type: Type.STRING,
                        description: 'Impact vector on memory, disk I/O, merge tree parts, or query latency.',
                      },
                      remediation_plan: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Step-by-step resolution roadmap.',
                      },
                      remediation_sql: {
                        type: Type.STRING,
                        description: 'Recommended DDL, query, or configuration tuning command.',
                      },
                      is_sql_recommendation: { type: Type.BOOLEAN },
                    },
                    required: [
                      'id',
                      'category',
                      'category_name',
                      'title',
                      'status',
                      'deep_assessment',
                      'root_cause',
                      'risk_vector',
                      'remediation_plan',
                    ],
                  },
                },
              },
              required: [
                'executive_summary',
                'cluster_health_verdict',
                'top_priorities',
                'workload_risk_analysis',
                'ai_diagnoses',
              ],
            },
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error('Empty text returned by model');
        }

        const parsed = parseJsonSafe(text) as {
          executive_summary: string;
          cluster_health_verdict?: string;
          top_priorities: Array<{
            priority: number;
            title: string;
            target_table?: string;
            why: string;
            action: string;
          }>;
          workload_risk_analysis: string;
          ai_diagnoses?: Array<{
            id: string;
            category: any;
            category_name: string;
            title: string;
            status: any;
            table?: string;
            deep_assessment: string;
            root_cause: string;
            risk_vector: string;
            remediation_plan: string[];
            remediation_sql?: string;
            is_sql_recommendation?: boolean;
          }>;
        };

        console.log(`[Yachiru] Gemini AI full diagnosis succeeded using model "${currentModel}"`);
        return {
          model: currentModel,
          executive_summary: parsed.executive_summary,
          cluster_health_verdict: parsed.cluster_health_verdict,
          top_priorities: parsed.top_priorities,
          workload_risk_analysis: parsed.workload_risk_analysis,
          ai_diagnoses: parsed.ai_diagnoses || [],
          isAiGenerated: true,
        };
      } catch (err: unknown) {
        lastError = err;
        finalModelUsed = currentModel;
        const { category, rawMessage } = categorizeAiError(err);

        // If quota exhausted or invalid key, breaking early is appropriate because all models share credentials
        if (category === 'quota_exhausted' || category === 'invalid_key') {
          break;
        }

        // If transient 503 / network error and we have a retry attempt on this model, wait briefly
        if ((category === 'service_unavailable' || category === 'network_error') && attempt < maxAttemptsForModel) {
          console.warn(
            `[Yachiru] Transient ${category} on "${currentModel}" (attempt ${attempt}). Retrying in 1000ms... [${rawMessage}]`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        // Otherwise log and try next model in fallback chain
        console.warn(
          `[Yachiru] Model "${currentModel}" encountered ${category}. Attempting fallback candidates... [${rawMessage}]`
        );
        break;
      }
    }

    const { category: checkCategory } = categorizeAiError(lastError);
    if (checkCategory === 'quota_exhausted' || checkCategory === 'invalid_key') {
      break;
    }
  }

  // Handle terminal error if all models exhausted
  const { category, rawMessage } = categorizeAiError(lastError);

  if (category === 'quota_exhausted' && !hasUserKey) {
    systemKeyState.markDepleted(rawMessage);
  }

  const { friendlyMessage } = getAiErrorInfo(
    category,
    rawMessage || 'AI synthesis service unavailable',
    hasUserKey
  );

  console.info(`[Yachiru] Gemini AI diagnosis failed across models [${category}]: ${rawMessage}`);

  return {
    model: finalModelUsed,
    executive_summary: '',
    top_priorities: [],
    workload_risk_analysis: '',
    ai_diagnoses: [],
    isAiGenerated: false,
    aiError: friendlyMessage,
    aiErrorCategory: category,
    rawError: rawMessage || undefined,
  };
}

