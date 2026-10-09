export type CheckSeverity = 'good' | 'warning' | 'critical';

export type CheckCategory =
  | 'part_health'
  | 'primary_key'
  | 'partitioning'
  | 'compression'
  | 'table_engine'
  | 'skip_indices'
  | 'query_performance'
  | 'replication_distributed'
  | 'server_settings'
  | 'mutations'
  | 'disk_space'
  | 'system_errors'
  | 'replication_queue';

export interface AIDiagnosis {
  id: string;
  category: CheckCategory;
  category_name: string;
  title: string;
  status: CheckSeverity;
  table?: string;
  deep_assessment: string;
  root_cause: string;
  risk_vector: string;
  remediation_plan: string[];
  remediation_sql?: string;
  is_sql_recommendation?: boolean;
}

export interface FindingMetrics {
  /** Measured compressed storage footprint of the column or target */
  columnCompressedBytes?: number;
  /** Measured uncompressed storage footprint of the column or target */
  columnUncompressedBytes?: number;
  /** Measured compressed size of the whole table */
  tableCompressedBytes?: number;
  /** Measured uncompressed size of the whole table */
  tableUncompressedBytes?: number;
  /** Observed compression ratio from metadata (uncompressed / compressed) */
  compressionRatio?: number;
  /** Target column name */
  columnName?: string;
  /** Current column data type from system.columns */
  columnType?: string;
  /** Target suggested data type (e.g. LowCardinality(String), UInt32, Date) */
  suggestedType?: string;
  /** True if finding was triggered solely by column name heuristics without value inspection */
  isNameOnlyCandidate?: boolean;
  /** Distinct value count if known/observed from metadata (not user table read) */
  distinctValues?: number;
  /** Minimum observed value if known from metadata */
  minValue?: number | string;
  /** Maximum observed value if known from metadata */
  maxValue?: number | string;
  /** Scanned bytes per query execution from system.query_log */
  queryReadBytes?: number;
  /** Scanned rows per query execution from system.query_log */
  queryReadRows?: number;
  /** Scanned / returned rows amplification ratio */
  queryAmplificationRatio?: number;
  /** Query duration in milliseconds */
  queryDurationMs?: number;
  /** Frequency / daily execution count if known from workload metrics */
  dailyExecutions?: number;
  /** Daily scanned bytes if known */
  dailyScannedBytes?: number;
  /** Time window in hours if executions/counts are in a specific window */
  windowHours?: number;
  /** Memory / RAM consumption in bytes (e.g. for Memory engine) */
  ramBytes?: number;
  /** Fraction of server CPU time consumed (e.g. 0.18 for 18%) */
  cpuFraction?: number;
}

export interface CheckFinding {
  id: string;
  category: CheckCategory;
  category_name: string;
  title: string;
  table?: string;
  status: CheckSeverity;
  metric_value: string | number;
  threshold: string;
  evidence: string;
  impact: string;
  recommendation_sql_or_text: string;
  is_sql_recommendation: boolean;
  is_ai_diagnosed?: boolean;
  ai_root_cause?: string;
  ai_remediation_steps?: string[];
  ai_risk_vector?: string;
  cost_impact?: import('./utils/costModel.js').CostImpact | null;
  metrics?: FindingMetrics;
}

export interface CategoryScore {
  category: CheckCategory;
  name: string;
  score: number; // 0 - 100
  status: CheckSeverity;
  critical_count: number;
  warning_count: number;
  good_count: number;
  total_checks: number;
  description: string;
}

export interface TableMetadata {
  database: string;
  name: string;
  engine: string;
  total_rows: number;
  total_bytes_uncompressed: number;
  total_bytes_compressed: number;
  compression_ratio: number;
  active_parts: number;
  partition_count: number;
  order_by_key: string;
  partition_key: string;
  skip_indices_count: number;
  findings_count: {
    critical: number;
    warning: number;
    good: number;
  };
}

export interface AINarrative {
  model: string;
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
  ai_diagnoses?: AIDiagnosis[];
  isAiGenerated?: boolean;
  aiError?: string;
  aiErrorCategory?: string;
  rawError?: string;
}

export interface AnalysisReport {
  scan_id: string;
  timestamp: string;
  database_name: string;
  clickhouse_version: string;
  cluster_mode: string;
  overall_score: number; // 0 - 100
  overall_verdict: 'Optimized' | 'Needs Tuning' | 'Critical Optimization Required';
  is_demo: boolean;
  summary: {
    total_tables: number;
    total_rows: number;
    total_size_compressed: string;
    total_size_uncompressed: string;
    avg_compression_ratio: string;
    total_parts: number;
    total_queries_analyzed: number;
    critical_count: number;
    warning_count: number;
    good_count: number;
  };
  categories: CategoryScore[];
  findings: CheckFinding[];
  tables: TableMetadata[];
  ai_narrative?: AINarrative | null;
  ai_diagnoses?: AIDiagnosis[];
  cost_summary?: import('./utils/costModel.js').ReportCostSummary | null;
  historyWriteStatus?: {
    success: boolean;
    error?: string;
  };
}

export type AiProvider = 'gemini' | 'openai' | 'claude';

export interface ConnectionConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  password?: string;
  database: string;
  queryDurationThresholdMs?: number;
  queryMemoryThresholdBytes?: number;
  mutationWarningAgeHours?: number;
  mutationCriticalAgeHours?: number;
  diskWarningFreePct?: number;
  diskCriticalFreePct?: number;
  errorRecentWindowHours?: number;
  errorWarningCount?: number;
  errorCriticalCount?: number;
  replicationQueueWarningSize?: number;
  replicationQueueMaxRetries?: number;
  enableAiNarrative?: boolean;
  aiProvider?: AiProvider;
  geminiModel?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
  yachiruApiKey?: string;
  isDemo?: boolean;
  useSshTunnel?: boolean;
  sshHost?: string;
  sshPort?: number; // default 22
  sshUsername?: string;
  sshAuthMethod?: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPrivateKeyPassphrase?: string;
  // Scan History & Trend Tracking (Stored in user's ClickHouse instance)
  enableHistoryTracking?: boolean;
  historyDatabase?: string; // defaults to same as database
  historyTableName?: string; // defaults to 'yachiru_scan_history'
  historyWriteUsername?: string; // separate write user
  historyWritePassword?: string; // SECRET — sessionStorage only, NEVER in localStorage
}

export interface SavedConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  database: string;
  username: string;
  useSshTunnel?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: 'password' | 'privateKey';
  // Optional non-secret history tracking parameters
  enableHistoryTracking?: boolean;
  historyDatabase?: string;
  historyTableName?: string;
  historyWriteUsername?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface FindingSummaryItem {
  category: string;
  title: string;
  severity: string;
}

export interface ScanHistoryRecord {
  scan_id: string;
  scanned_at: string;
  target_host: string;
  target_database: string;
  overall_score: number;
  overall_verdict: string;
  category_scores: Record<string, number>;
  finding_summary: FindingSummaryItem[];
  clickhouse_version: string;
}

export interface ScanComparison {
  hasComparison: boolean;
  previousScanAt?: string;
  currentScanAt?: string;
  scoreDelta?: number;
  newFindings: FindingSummaryItem[];
  resolvedFindings: FindingSummaryItem[];
  persistentFindings: FindingSummaryItem[];
}

export interface ScanHistoryResponse {
  success: boolean;
  history: ScanHistoryRecord[];
  comparison?: ScanComparison;
  error?: string;
  hint?: string;
  errorType?: 'TABLE_NOT_FOUND' | 'PERMISSION_DENIED' | 'CONNECTION_ERROR' | 'UNKNOWN';
}

export interface ModelOption {
  id: string;
  name: string;
  badge?: string;
  provider: AiProvider;
}

export const AVAILABLE_AI_MODELS: ModelOption[] = [
  // Google Gemini models
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', badge: 'Fast & Hybrid', provider: 'gemini' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Balanced', provider: 'gemini' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', badge: 'High Reasoning', provider: 'gemini' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', badge: 'High Throughput', provider: 'gemini' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', badge: 'Ultra-Fast', provider: 'gemini' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', badge: 'Low Latency', provider: 'gemini' },

  // OpenAI models
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', badge: 'Flagship (1.05M ctx)', provider: 'openai' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', badge: 'Flagship (Ultra Reasoning)', provider: 'openai' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', badge: 'Balanced (272K ctx)', provider: 'openai' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', badge: 'Fast & Efficient', provider: 'openai' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', badge: 'Fastest & Default', provider: 'openai' },

  // Anthropic Claude models
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', badge: 'Fastest & Default (200K ctx)', provider: 'claude' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', badge: 'Balanced (1M ctx)', provider: 'claude' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', badge: 'High-Capability (1M ctx)', provider: 'claude' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', badge: 'Mythos Class (1M ctx)', provider: 'claude' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', badge: 'Previous Gen Sonnet (1M ctx)', provider: 'claude' },
];

/**
 * Returns a human-friendly display name for an AI model ID, resolving official endpoint aliases.
 */
export function getModelDisplayName(modelId?: string): string {
  if (!modelId) return 'AI Model';
  const clean = modelId.trim().toLowerCase();

  // Known specific mappings
  if (clean === 'gemini-3.1-pro' || clean === 'gemini-3.1-pro-preview') {
    return 'Gemini 3.1 Pro';
  }

  const matched = AVAILABLE_AI_MODELS.find(
    (m) => m.id.toLowerCase() === clean
  );
  if (matched) return matched.name;

  return modelId;
}

export type {
  CostModel,
  CostConfidence,
  CostCategory,
  CalculationStep,
  CostImpact,
  RankedOpportunity,
  ReportCostSummary,
} from './utils/costModel.js';

export { formatCurrency, formatBytes } from './utils/costModel.js';

