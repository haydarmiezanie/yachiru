import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { AINarrative, AnalysisReport, AiProvider } from '../src/types.js';

// Default TTL for system API key depletion status (10 minutes)
const SYSTEM_KEY_DEPLETION_TTL_MS = 10 * 60 * 1000;

export interface SystemKeyState {
  depleted: boolean;
  depletedAt: string | null;
  expiresAt: string | null;
  remainingSeconds: number;
  reason: string | null;
}

/**
 * Manages the default system API key depletion state with TTL and structured logging.
 * Prevents locking all users permanently into deterministic mode while avoiding spamming
 * depleted endpoints.
 */
export class SystemKeyStateManager {
  private _providerName: string;
  private _depleted = false;
  private _depletedAt: number | null = null;
  private _expiresAt: number | null = null;
  private _reason: string | null = null;
  private _defaultTtlMs: number;

  constructor(providerName: string = 'Gemini', defaultTtlMs: number = SYSTEM_KEY_DEPLETION_TTL_MS) {
    this._providerName = providerName;
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
        `[Yachiru] [STATE CHANGE] Default system ${this._providerName} API key depletion TTL expired (expired at ${expiredTimeStr}). Resetting status to active.`
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
      `[Yachiru] [STATE CHANGE] Default system ${this._providerName} API key marked as DEPLETED.\n` +
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
      console.log(`[Yachiru] [STATE CHANGE] Default system ${this._providerName} API key status RESET to active. Reason: "${reason}".`);
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

// Provider-specific system key state managers
export const geminiSystemKeyState = new SystemKeyStateManager('Gemini');
export const openaiSystemKeyState = new SystemKeyStateManager('OpenAI');

// Backward compatibility alias for existing code
export const systemKeyState = geminiSystemKeyState;

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

export interface GetOpenAiResult {
  client: OpenAI | null;
  source: 'user' | 'system' | 'none';
}

/**
 * Instantiates the OpenAI SDK client.
 * ONLY falls back to process.env.OPENAI_API_KEY if allowSystemKeyFallback is explicitly true.
 */
export function getOpenAiClient(
  customApiKey?: string,
  allowSystemKeyFallback: boolean = false
): GetOpenAiResult {
  const userKey = customApiKey?.trim();
  if (userKey) {
    return {
      client: new OpenAI({
        apiKey: userKey,
      }),
      source: 'user',
    };
  }

  if (allowSystemKeyFallback && process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
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

/**
 * Categorizes errors thrown by the OpenAI SDK into the shared AiErrorCategory union.
 */
export function categorizeOpenAiError(err: unknown): { category: AiErrorCategory; rawMessage: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  const status = (err as any)?.status || (err as any)?.statusCode;

  // Check HTTP status code first
  if (status === 429 || lower.includes('insufficient_quota') || lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('quota')) {
    return { category: 'quota_exhausted', rawMessage };
  }

  if (status === 401 || lower.includes('invalid_api_key') || lower.includes('incorrect api key') || lower.includes('authentication') || lower.includes('unauthorized')) {
    return { category: 'invalid_key', rawMessage };
  }

  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist') || lower.includes('no such model')) {
    return { category: 'model_not_found', rawMessage };
  }

  if ((typeof status === 'number' && status >= 500) || lower.includes('server_error') || lower.includes('service unavailable') || lower.includes('overloaded')) {
    return { category: 'service_unavailable', rawMessage };
  }

  // Parsing / schema errors
  if (
    err instanceof SyntaxError ||
    lower.includes('json') ||
    lower.includes('syntaxerror') ||
    lower.includes('schema') ||
    lower.includes('unexpected token') ||
    lower.includes('empty text returned')
  ) {
    return { category: 'schema_error', rawMessage };
  }

  // Network / socket errors
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('socket hang up') ||
    lower.includes('connection timeout')
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
        fallbackTitle: 'Deterministic Synthesis Engine (AI Service High Demand)',
        friendlyMessage: `The requested AI model is currently experiencing high demand upstream (HTTP 503). Retrying shortly or switching models is recommended. [Detail: ${cleanDetail}]`,
      };

    case 'quota_exhausted':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Quota Notice)',
        friendlyMessage: hasUserKey
          ? `Prepayment credits or rate limit are depleted for your AI project (HTTP 429). Check your balance or project rate limits. [Detail: ${cleanDetail}]`
          : `System AI quota is currently depleted (HTTP 429). Please provide your own API Key in the config above to run live AI synthesis. [Detail: ${cleanDetail}]`,
      };

    case 'invalid_key':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Invalid API Key)',
        friendlyMessage: `The provided AI API Key is invalid or unrecognized. Please verify your credentials. [Detail: ${cleanDetail}]`,
      };

    case 'model_not_found':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Model Unavailable)',
        friendlyMessage: `The requested AI model endpoint was not found or is currently unsupported on your API key tier. [Detail: ${cleanDetail}]`,
      };

    case 'schema_error':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Schema Parse Notice)',
        friendlyMessage: `The AI provider returned a response that could not be parsed into the expected structured audit schema. [Detail: ${cleanDetail}]`,
      };

    case 'network_error':
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (Network Connectivity Notice)',
        friendlyMessage: `Unable to establish connection to AI provider servers. [Detail: ${cleanDetail}]`,
      };

    case 'unknown':
    default:
      return {
        fallbackTitle: 'Deterministic Synthesis Engine (AI Service Notice)',
        friendlyMessage: `AI synthesis encountered an unexpected issue. [Detail: ${cleanDetail}]`,
      };
  }
}

export function resolveGeminiModelId(inputModel?: string): string {
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

export function resolveOpenAiModelId(inputModel?: string): string {
  if (!inputModel) return 'gpt-5.4-mini';
  const clean = inputModel.trim().toLowerCase();

  const VALID_OPENAI_MODELS = [
    'gpt-6-astra',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.4-mini',
  ];

  if (VALID_OPENAI_MODELS.includes(clean)) {
    return clean;
  }

  // Prefix/partial matching
  if (clean.includes('astra')) return 'gpt-6-astra';
  if (clean.includes('sol')) return 'gpt-5.6-sol';
  if (clean.includes('terra')) return 'gpt-5.6-terra';
  if (clean.includes('luna')) return 'gpt-5.6-luna';
  if (clean.includes('5.4-mini') || clean.includes('mini')) return 'gpt-5.4-mini';

  return 'gpt-5.4-mini';
}

export function getModelFallbackChain(primaryModel: string): string[] {
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

export function getOpenAiModelFallbackChain(primaryModel: string): string[] {
  const chain: string[] = [primaryModel];
  const standardFallbacks = [
    'gpt-5.4-mini',
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol',
    'gpt-6-astra',
  ];

  for (const model of standardFallbacks) {
    if (!chain.includes(model)) {
      chain.push(model);
    }
  }
  return chain;
}

/**
 * Validates and clamps reasoning effort for OpenAI models according to specifications:
 * - gpt-6-astra: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
 * - gpt-5.6-sol: 'none' | 'low' | 'medium' | 'high' | 'max'
 * - gpt-5.6-terra: 'none' | 'low' | 'medium' | 'high' (no max)
 * - gpt-5.6-luna: 'none' | 'low' | 'medium' | 'high' (no max)
 * - gpt-5.4-mini: 'low' | 'medium' | 'high' | 'xhigh'
 * Default universal choice is 'medium'.
 */
export function getSupportedReasoningEffort(modelId: string, requestedEffort?: string): string {
  const defaultEffort = 'medium';
  if (!requestedEffort) return defaultEffort;

  const req = requestedEffort.toLowerCase();

  switch (modelId) {
    case 'gpt-6-astra': {
      const allowed = ['low', 'medium', 'high', 'xhigh', 'max'];
      return allowed.includes(req) ? req : defaultEffort;
    }
    case 'gpt-5.6-sol': {
      const allowed = ['none', 'low', 'medium', 'high', 'max'];
      return allowed.includes(req) ? req : defaultEffort;
    }
    case 'gpt-5.6-terra':
    case 'gpt-5.6-luna': {
      // Do not send 'max' or 'xhigh'
      const allowed = ['none', 'low', 'medium', 'high'];
      if (req === 'max' || req === 'xhigh') return 'high';
      return allowed.includes(req) ? req : defaultEffort;
    }
    case 'gpt-5.4-mini': {
      const allowed = ['low', 'medium', 'high', 'xhigh'];
      if (req === 'max') return 'xhigh';
      if (req === 'none') return 'low';
      return allowed.includes(req) ? req : defaultEffort;
    }
    default:
      return defaultEffort;
  }
}

/**
 * Single source of truth for prompt building, shared across all AI providers.
 */
export function buildAuditPrompt(report: AnalysisReport): {
  systemInstruction: string;
  userPrompt: string;
} {
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

  const userPrompt = `
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

  return { systemInstruction, userPrompt };
}

/**
 * Standard JSON Schema definition adhering to OpenAI Structured Outputs strict-mode constraints:
 * - additionalProperties: false on every object level
 * - every property is included in required array
 * - optional fields are represented as nullable (e.g. type: ['string', 'null'])
 */
export const OPENAI_AUDIT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    executive_summary: {
      type: 'string',
      description:
        'A 2-3 paragraph plain-language summary of the database health, highlighting primary bottlenecks and architectural condition based strictly on the findings.',
    },
    cluster_health_verdict: {
      type: ['string', 'null'],
      description: 'Short authoritative health verdict sentence.',
    },
    top_priorities: {
      type: 'array',
      description:
        'Ordered list of top actionable optimization priorities from highest operational urgency down.',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'integer' },
          title: { type: 'string' },
          target_table: {
            type: ['string', 'null'],
            description: 'Target table name if applicable, or null.',
          },
          why: {
            type: 'string',
            description: 'Direct mechanical reason in ClickHouse why this matters',
          },
          action: {
            type: 'string',
            description: 'Concrete recommendation or configuration adjustment',
          },
        },
        required: ['priority', 'title', 'target_table', 'why', 'action'],
        additionalProperties: false,
      },
    },
    workload_risk_analysis: {
      type: 'string',
      description:
        'Assessment of risks under sustained ingestion volume or high concurrent query spikes.',
    },
    ai_diagnoses: {
      type: 'array',
      description:
        'Detailed AI-diagnosed architectural findings with root cause and remediation SQL for table and system optimization.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: {
            type: 'string',
            description:
              'One of: part_health, primary_key, partitioning, compression, table_engine, skip_indices, query_performance, replication_distributed, server_settings',
          },
          category_name: { type: 'string' },
          title: { type: 'string' },
          status: {
            type: 'string',
            description: 'critical, warning, or good',
          },
          table: {
            type: ['string', 'null'],
            description: 'Table name if applicable, or null.',
          },
          deep_assessment: {
            type: 'string',
            description: 'Technical evaluation of the problem and how ClickHouse internal mechanics behave.',
          },
          root_cause: {
            type: 'string',
            description: 'Underlying structural or operational root cause.',
          },
          risk_vector: {
            type: 'string',
            description: 'Impact vector on memory, disk I/O, merge tree parts, or query latency.',
          },
          remediation_plan: {
            type: 'array',
            items: { type: 'string' },
            description: 'Step-by-step resolution roadmap.',
          },
          remediation_sql: {
            type: ['string', 'null'],
            description: 'Recommended DDL, query, or configuration tuning command, or null.',
          },
          is_sql_recommendation: {
            type: ['boolean', 'null'],
            description: 'Whether remediation_sql is provided and executable.',
          },
        },
        required: [
          'id',
          'category',
          'category_name',
          'title',
          'status',
          'table',
          'deep_assessment',
          'root_cause',
          'risk_vector',
          'remediation_plan',
          'remediation_sql',
          'is_sql_recommendation',
        ],
        additionalProperties: false,
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
  additionalProperties: false,
};

/**
 * Gemini-specific Type.OBJECT responseSchema derived to guarantee zero schema drift.
 */
export const GEMINI_AUDIT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    executive_summary: {
      type: Type.STRING,
      description: OPENAI_AUDIT_JSON_SCHEMA.properties.executive_summary.description,
    },
    cluster_health_verdict: {
      type: Type.STRING,
      description: OPENAI_AUDIT_JSON_SCHEMA.properties.cluster_health_verdict.description,
    },
    top_priorities: {
      type: Type.ARRAY,
      description: OPENAI_AUDIT_JSON_SCHEMA.properties.top_priorities.description,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.INTEGER },
          title: { type: Type.STRING },
          target_table: { type: Type.STRING },
          why: { type: Type.STRING },
          action: { type: Type.STRING },
        },
        required: ['priority', 'title', 'why', 'action'],
      },
    },
    workload_risk_analysis: {
      type: Type.STRING,
      description: OPENAI_AUDIT_JSON_SCHEMA.properties.workload_risk_analysis.description,
    },
    ai_diagnoses: {
      type: Type.ARRAY,
      description: OPENAI_AUDIT_JSON_SCHEMA.properties.ai_diagnoses.description,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          category: { type: Type.STRING },
          category_name: { type: Type.STRING },
          title: { type: Type.STRING },
          status: { type: Type.STRING },
          table: { type: Type.STRING },
          deep_assessment: { type: Type.STRING },
          root_cause: { type: Type.STRING },
          risk_vector: { type: Type.STRING },
          remediation_plan: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          remediation_sql: { type: Type.STRING },
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
};

/**
 * Validates that OPENAI_AUDIT_JSON_SCHEMA and GEMINI_AUDIT_RESPONSE_SCHEMA maintain identical
 * property sets across all structural levels to eliminate schema drift risk.
 */
export function assertSchemasInSync(): void {
  const openAiTop = Object.keys(OPENAI_AUDIT_JSON_SCHEMA.properties).sort();
  const geminiTop = Object.keys(GEMINI_AUDIT_RESPONSE_SCHEMA.properties).sort();

  const diffTop = [
    ...openAiTop.filter((k) => !geminiTop.includes(k)),
    ...geminiTop.filter((k) => !openAiTop.includes(k)),
  ];
  if (diffTop.length > 0) {
    throw new Error(`[Schema Drift] Top-level properties mismatch between OpenAI and Gemini schemas: ${diffTop.join(', ')}`);
  }

  const openAiTpProps = Object.keys((OPENAI_AUDIT_JSON_SCHEMA.properties.top_priorities.items as any).properties).sort();
  const geminiTpProps = Object.keys((GEMINI_AUDIT_RESPONSE_SCHEMA.properties.top_priorities.items as any).properties).sort();
  const diffTp = [
    ...openAiTpProps.filter((k) => !geminiTpProps.includes(k)),
    ...geminiTpProps.filter((k) => !openAiTpProps.includes(k)),
  ];
  if (diffTp.length > 0) {
    throw new Error(`[Schema Drift] top_priorities item properties mismatch: ${diffTp.join(', ')}`);
  }

  const openAiDiagProps = Object.keys((OPENAI_AUDIT_JSON_SCHEMA.properties.ai_diagnoses.items as any).properties).sort();
  const geminiDiagProps = Object.keys((GEMINI_AUDIT_RESPONSE_SCHEMA.properties.ai_diagnoses.items as any).properties).sort();
  const diffDiag = [
    ...openAiDiagProps.filter((k) => !geminiDiagProps.includes(k)),
    ...geminiDiagProps.filter((k) => !openAiDiagProps.includes(k)),
  ];
  if (diffDiag.length > 0) {
    throw new Error(`[Schema Drift] ai_diagnoses item properties mismatch: ${diffDiag.join(', ')}`);
  }
}
// Validate schema synchronization at module initialization
assertSchemasInSync();

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
  if (!hasUserKey && geminiSystemKeyState.isDepleted()) {
    const status = geminiSystemKeyState.getStatus();
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
      aiError: `System Gemini AI quota is temporarily depleted (HTTP 429). Automatic retry resets at ${status.expiresAt} (~${status.remainingSeconds}s remaining). Please provide your own Gemini API Key or generate without AI.`,
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

  const { systemInstruction, userPrompt } = buildAuditPrompt(report);
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
          contents: userPrompt,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_AUDIT_RESPONSE_SCHEMA,
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
    geminiSystemKeyState.markDepleted(rawMessage);
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

export async function generateNarrativeOpenAI(
  report: AnalysisReport,
  userModelPreference?: string,
  userApiKey?: string,
  options: NarrativeOptions = { enableAiNarrative: true, allowSystemKeyFallback: true }
): Promise<AINarrative> {
  const isAiRequested = options.enableAiNarrative !== false;
  const allowSystemFallback = options.allowSystemKeyFallback ?? isAiRequested;
  const hasUserKey = Boolean(userApiKey && userApiKey.trim());
  const targetModel = resolveOpenAiModelId(userModelPreference);

  // If user explicitly selected "Without AI", return deterministic narrative immediately
  if (!isAiRequested) {
    console.log('[Yachiru] Deterministic mode selected ("Without AI"). Generating deterministic evidence report.');
    return generateDeterministicNarrative(report, 'Deterministic Rule Engine (Without AI)');
  }

  // If AI was requested but system key is marked depleted and user provided no key:
  if (!hasUserKey && openaiSystemKeyState.isDepleted()) {
    const status = openaiSystemKeyState.getStatus();
    console.log(
      `[Yachiru] Skipping system OpenAI API call: default key is marked depleted until ${status.expiresAt}.`
    );
    return {
      model: targetModel,
      executive_summary: '',
      top_priorities: [],
      workload_risk_analysis: '',
      ai_diagnoses: [],
      isAiGenerated: false,
      aiError: `System OpenAI quota is temporarily depleted (HTTP 429). Automatic retry resets at ${status.expiresAt} (~${status.remainingSeconds}s remaining). Please provide your own OpenAI API Key or generate without AI.`,
      aiErrorCategory: 'quota_exhausted',
    };
  }

  // Instantiate client with strict fallback control
  const { client: openaiClient, source } = getOpenAiClient(userApiKey, allowSystemFallback);
  if (!openaiClient) {
    console.log('[Yachiru] No valid OpenAI API key available (custom key absent and system fallback disabled/unset).');
    return {
      model: targetModel,
      executive_summary: '',
      top_priorities: [],
      workload_risk_analysis: '',
      ai_diagnoses: [],
      isAiGenerated: false,
      aiError: 'An OpenAI API Key is required for live AI synthesis. Please provide an API key in the configuration or select "Generate Without AI (Deterministic)".',
      aiErrorCategory: 'invalid_key',
    };
  }

  const { systemInstruction, userPrompt } = buildAuditPrompt(report);
  const candidateModels = getOpenAiModelFallbackChain(targetModel);
  let lastError: unknown = null;
  let finalModelUsed = targetModel;

  for (const currentModel of candidateModels) {
    const isPrimary = currentModel === targetModel;
    const maxAttemptsForModel = isPrimary ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttemptsForModel; attempt++) {
      try {
        console.log(
          `[Yachiru] Requesting full OpenAI diagnosis via ${source} key with model: "${currentModel}" (attempt ${attempt}/${maxAttemptsForModel})`
        );

        const reasoningEffort = getSupportedReasoningEffort(currentModel, 'medium');

        const response = await openaiClient.responses.create({
          model: currentModel,
          input: [
            {
              role: 'developer',
              content: systemInstruction,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          reasoning: {
            effort: reasoningEffort as any,
          },
          text: {
            format: {
              type: 'json_schema',
              name: 'clickhouse_audit',
              strict: true,
              schema: OPENAI_AUDIT_JSON_SCHEMA,
            },
          },
        });

        // Extract output text from responses create
        let text = '';
        if (response.output_text) {
          text = response.output_text;
        } else if (Array.isArray(response.output)) {
          for (const item of response.output) {
            if ((item as any).type === 'message' && Array.isArray((item as any).content)) {
              for (const c of (item as any).content) {
                if (c.type === 'text' && c.text) {
                  text += c.text;
                }
              }
            } else if ((item as any).text) {
              text += (item as any).text;
            }
          }
        }

        if (!text) {
          throw new Error('Empty text returned by OpenAI model');
        }

        const parsed = parseJsonSafe(text);

        // Normalize nullable fields from OpenAI strict mode into standard AINarrative shape
        const normalizedTopPriorities = Array.isArray(parsed.top_priorities)
          ? parsed.top_priorities.map((tp: any) => ({
              priority: tp.priority,
              title: tp.title,
              target_table: tp.target_table === null ? undefined : tp.target_table,
              why: tp.why,
              action: tp.action,
            }))
          : [];

        const normalizedAiDiagnoses = Array.isArray(parsed.ai_diagnoses)
          ? parsed.ai_diagnoses.map((diag: any) => ({
              id: diag.id,
              category: diag.category,
              category_name: diag.category_name,
              title: diag.title,
              status: diag.status,
              table: diag.table === null ? undefined : diag.table,
              deep_assessment: diag.deep_assessment,
              root_cause: diag.root_cause,
              risk_vector: diag.risk_vector,
              remediation_plan: Array.isArray(diag.remediation_plan) ? diag.remediation_plan : [],
              remediation_sql: diag.remediation_sql === null ? undefined : diag.remediation_sql,
              is_sql_recommendation:
                diag.is_sql_recommendation === null
                  ? Boolean(diag.remediation_sql && diag.remediation_sql.trim().length > 0)
                  : Boolean(diag.is_sql_recommendation),
            }))
          : [];

        console.log(`[Yachiru] OpenAI full diagnosis succeeded using model "${currentModel}"`);
        return {
          model: currentModel,
          executive_summary: parsed.executive_summary || '',
          cluster_health_verdict:
            parsed.cluster_health_verdict === null ? undefined : parsed.cluster_health_verdict,
          top_priorities: normalizedTopPriorities,
          workload_risk_analysis: parsed.workload_risk_analysis || '',
          ai_diagnoses: normalizedAiDiagnoses,
          isAiGenerated: true,
        };
      } catch (err: unknown) {
        lastError = err;
        finalModelUsed = currentModel;
        const { category, rawMessage } = categorizeOpenAiError(err);

        // If quota exhausted or invalid key, break early
        if (category === 'quota_exhausted' || category === 'invalid_key') {
          break;
        }

        // If transient 503 / network error and attempt < maxAttempts, retry briefly
        if ((category === 'service_unavailable' || category === 'network_error') && attempt < maxAttemptsForModel) {
          console.warn(
            `[Yachiru] Transient ${category} on OpenAI model "${currentModel}" (attempt ${attempt}). Retrying in 1000ms... [${rawMessage}]`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        console.warn(
          `[Yachiru] OpenAI model "${currentModel}" encountered ${category}. Attempting fallback candidates... [${rawMessage}]`
        );
        break;
      }
    }

    const { category: checkCategory } = categorizeOpenAiError(lastError);
    if (checkCategory === 'quota_exhausted' || checkCategory === 'invalid_key') {
      break;
    }
  }

  // Handle terminal error if all models exhausted
  const { category, rawMessage } = categorizeOpenAiError(lastError);

  if (category === 'quota_exhausted' && !hasUserKey) {
    openaiSystemKeyState.markDepleted(rawMessage);
  }

  const { friendlyMessage } = getAiErrorInfo(
    category,
    rawMessage || 'OpenAI synthesis service unavailable',
    hasUserKey
  );

  console.info(`[Yachiru] OpenAI diagnosis failed across models [${category}]: ${rawMessage}`);

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

/**
 * Top-level provider dispatcher called by /api/analyze and /api/narrate in server.ts.
 * Dispatches cleanly between Gemini and OpenAI, defaulting to Gemini if provider is omitted.
 */
export async function generateNarrativeForProvider(
  report: AnalysisReport,
  provider: AiProvider | undefined,
  userModelPreference?: string,
  userApiKey?: string,
  options?: NarrativeOptions
): Promise<AINarrative> {
  if (provider === 'openai') {
    return generateNarrativeOpenAI(report, userModelPreference, userApiKey, options);
  }
  return generateNarrative(report, userModelPreference, userApiKey, options);
}
