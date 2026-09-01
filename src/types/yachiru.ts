export type DimensionId =
  | 'table_engines_partitioning'
  | 'parts_and_merges'
  | 'primary_key_and_query_patterns'
  | 'skip_indexes'
  | 'data_types_and_storage'
  | 'ttl_and_tiering'
  | 'materialized_views_redundant_compute'
  | 'resource_and_config'
  | 'general_query_performance';

export type FindingSeverity = 'critical' | 'warning' | 'info' | 'optimal';

export interface ScanTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  protocol?: 'http' | 'https';
  isDemoCluster?: boolean;
  demoClusterId?: string;
  lookbackDays?: number;
}

export interface Finding {
  id: string;
  dimension: DimensionId;
  dimensionName: string;
  severity: FindingSeverity;
  title: string;
  tableName?: string;
  what: string; // Factual evidence with numbers from system tables
  whyTechnical: string; // Technical reason from deterministic scanner
  whyNarrative?: string; // Narrative context (Gemini synthesis or structured template)
  recommendationSql?: string; // Exact SQL/DDL for manual review
  recommendationSummary: string;
  estimatedImpact: {
    metric: string;
    magnitude: string;
    description: string;
  };
  metrics: Record<string, any>;
  aiInsight?: string; // Deep AI reasoning specific to this table/query
  aiSqlFix?: string; // AI generated custom SQL optimization
  aiRiskLevel?: 'Low' | 'Medium' | 'High' | 'Critical';
  relativePriority?: {
    rank: number;
    effort: 'Low' | 'Medium' | 'High';
    impact: 'Low' | 'Medium' | 'High' | 'Critical';
    justification: string;
  };
}

export interface DimensionScore {
  dimension: DimensionId;
  name: string;
  description: string;
  score: number; // 0 - 100
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  optimalCount: number;
  summary: string;
}

export interface ExecutiveSummary {
  overview: string;
  overallHealthGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  topRisk: string;
  quickWins: string[];
  strategicFixes: string[];
  aiGenerated: boolean;
  modelUsed?: string;
  aiNote?: string;
}

export interface ClusterMetadata {
  version: string;
  clusterName: string;
  totalDatabases: number;
  totalTables: number;
  totalParts: number;
  totalRows: number;
  totalDiskSizeBytes: number;
  totalDiskSizeFormatted: string;
  queriesAnalyzed: number;
  timeWindow: string;
  uptimeSeconds: number;
}

export interface ScanReport {
  id: string;
  timestamp: string;
  target: {
    host: string;
    port: number;
    database: string;
    isDemoCluster: boolean;
    clusterName: string;
  };
  overallScore: number;
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  dimensionScores: Record<DimensionId, DimensionScore>;
  findings: Finding[];
  executiveSummary: ExecutiveSummary;
  clusterMetadata: ClusterMetadata;
  rawStats: {
    tables: any[];
    partsSummary: any;
    mergesSummary: any;
    slowQueries: any[];
    expensivePatterns: any[];
    columnsWithIssues: any[];
    configSettings: any[];
  };
  migrationScript: string;
  scanDurationMs: number;
  aiStatus: 'success' | 'fallback' | 'disabled';
  aiErrorMessage?: string;
}

export interface DemoClusterOption {
  id: string;
  name: string;
  tagline: string;
  database: string;
  tableCount: number;
  rowCount: string;
  typicalIssues: string[];
  industry: string;
}
