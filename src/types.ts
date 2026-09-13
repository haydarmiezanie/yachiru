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
  | 'server_settings';

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
}

export interface ConnectionConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  username: string;
  password?: string;
  database: string;
  queryDurationThresholdMs?: number;
  queryMemoryThresholdBytes?: number;
  enableAiNarrative?: boolean;
  geminiModel?: string;
  geminiApiKey?: string;
  isDemo?: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  badge?: string;
}

export const AVAILABLE_GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', badge: 'Fast & Hybrid' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Balanced' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', badge: 'High Reasoning' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', badge: 'High Throughput' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', badge: 'Ultra-Fast' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', badge: 'Low Latency' },
];

