import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';

export interface AiFindingEnrichment {
  id: string;
  rank?: number;
  effort?: 'Low' | 'Medium' | 'High';
  impact?: 'Low' | 'Medium' | 'High' | 'Critical';
  riskLevel?: 'Low' | 'Medium' | 'High' | 'Critical';
  justification?: string;
  aiInsight?: string;
  aiSqlFix?: string;
}

export interface StructuredScanPayload {
  database: string;
  cluster: string;
  overallScore: number;
  overallGrade: string;
  stats: DeterministicScanResult['stats'];
  dimensionScores: Record<string, { score: number; summary: string }>;
  findings: Array<{
    id: string;
    dimension: string;
    severity: string;
    title: string;
    tableName?: string;
    what: string;
    whyTechnical: string;
    impact: any;
  }>;
}

/**
 * Builds a compact, token-minimized structured representation of the deterministic scan result for LLM consumption.
 */
export function createStructuredScanPayload(
  scanResult: DeterministicScanResult,
  databaseName: string,
  clusterName: string
): StructuredScanPayload {
  return {
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
}

/**
 * Merges raw deterministic findings with AI enrichment insights and custom SQL fixes.
 */
export function enrichFindingsWithAi(
  findings: Finding[],
  enrichments: AiFindingEnrichment[] | undefined,
  defaultJustification = 'Prioritized based on AI architectural scan.'
): Finding[] {
  const enrichmentMap = new Map<string, AiFindingEnrichment>();
  if (Array.isArray(enrichments)) {
    for (const e of enrichments) {
      if (e && e.id) {
        enrichmentMap.set(e.id, e);
      }
    }
  }

  let rankCounter = 1;
  return findings.map((f) => {
    const aiE = enrichmentMap.get(f.id);
    const fallbackInsight = f.whyNarrative
      ? `${f.whyNarrative} ClickHouse storage efficiency and query execution will benefit directly from applying the recommended changes to ${f.tableName || 'the cluster'}.`
      : f.whyTechnical;

    return {
      ...f,
      aiInsight: aiE?.aiInsight || fallbackInsight || undefined,
      aiSqlFix: aiE?.aiSqlFix || f.recommendationSql || undefined,
      aiRiskLevel:
        aiE?.riskLevel ||
        (f.severity === 'critical' ? 'Critical' : f.severity === 'warning' ? 'Medium' : 'Low'),
      relativePriority: {
        rank: aiE?.rank || rankCounter++,
        effort: aiE?.effort || f.relativePriority?.effort || 'Medium',
        impact: aiE?.impact || f.relativePriority?.impact || (f.severity === 'critical' ? 'Critical' : 'High'),
        justification: aiE?.justification || defaultJustification,
      },
    };
  });
}

/**
 * Generates an offline deterministic executive summary when AI synthesis is disabled or unavailable.
 */
export function generateDeterministicExecutiveSummary(
  scanResult: DeterministicScanResult,
  provider: 'gemini' | 'openai' = 'gemini',
  aiNote?: string
): ExecutiveSummary {
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
    provider,
  };
}

/**
 * Synthesizes an intelligent, phased ClickHouse DDL migration script leveraging AI-enhanced SQL and reasoning.
 */
export function buildAiMigrationScript(params: {
  database: string;
  clusterName: string;
  findings: Finding[];
  executiveSummary?: ExecutiveSummary;
  provider?: string;
  modelUsed?: string;
}): string {
  // Sort findings by relativePriority.rank or severity
  const sortedFindings = [...params.findings].sort((a, b) => {
    const rankA = a.relativePriority?.rank ?? 999;
    const rankB = b.relativePriority?.rank ?? 999;
    return rankA - rankB;
  });

  const ddlFindings = sortedFindings.filter((f) => Boolean(f.aiSqlFix || f.recommendationSql));

  const modelInfo = params.modelUsed || (params.provider === 'openai' ? 'OpenAI GPT-4o' : 'Google Gemini');
  const timestamp = new Date().toISOString();

  // Categorize into safe execution phases:
  // Phase 1: Online Non-Blocking (LowCardinality, Codecs, Skip Indexes)
  // Phase 2: Materialized Views & Pre-aggregations
  // Phase 3: Structural Engine & Partition Conversions (Shadow tables)
  // Phase 4: Retention (TTL) & System Configurations
  const phase1Findings: Finding[] = [];
  const phase2Findings: Finding[] = [];
  const phase3Findings: Finding[] = [];
  const phase4Findings: Finding[] = [];

  for (const f of ddlFindings) {
    const dim = (f.dimension || '').toLowerCase();
    const title = (f.title || '').toLowerCase();
    if (dim.includes('materialized') || title.includes('materialized view') || title.includes('redundant heavy aggregation')) {
      phase2Findings.push(f);
    } else if (
      dim.includes('engine') ||
      dim.includes('partition') ||
      title.includes('engine') ||
      title.includes('primary key') ||
      title.includes('order by') ||
      title.includes('fragmentation')
    ) {
      phase3Findings.push(f);
    } else if (dim.includes('ttl') || dim.includes('config') || dim.includes('setting') || title.includes('ttl') || title.includes('spill-to-disk') || title.includes('background_pool_size')) {
      phase4Findings.push(f);
    } else {
      phase1Findings.push(f);
    }
  }

  const formatFindingSql = (f: Finding, phaseNumber: string, stepIndex: number) => {
    const sql = (f.aiSqlFix || f.recommendationSql || '').trim();
    const insight = f.aiInsight ? `-- AI Architectural Rationale: ${f.aiInsight.replace(/\n/g, '\n-- ')}\n` : '';
    const effort = f.relativePriority?.effort || 'Medium';
    const impact = f.relativePriority?.impact || (f.severity === 'critical' ? 'Critical' : 'High');
    const risk = f.aiRiskLevel || (f.severity === 'critical' ? 'Medium' : 'Low');

    return `-- -------------------------------------------------------------------------
-- Step ${phaseNumber}.${stepIndex}: ${f.title}
-- Severity: ${f.severity.toUpperCase()} | Impact: ${f.estimatedImpact?.magnitude || impact}
-- Implementation Effort: ${effort} | Risk Level: ${risk}
${insight}-- -------------------------------------------------------------------------
${sql}
`;
  };

  const sections: string[] = [];

  if (phase1Findings.length > 0) {
    sections.push(`-- =========================================================================
-- PHASE 1: ONLINE NON-BLOCKING SCHEMA OPTIMIZATIONS
-- Characteristics: Minimal locking, zero table rebuilds, safe for runtime traffic.
-- =========================================================================
${phase1Findings.map((f, i) => formatFindingSql(f, '1', i + 1)).join('\n')}`);
  }

  if (phase2Findings.length > 0) {
    sections.push(`-- =========================================================================
-- PHASE 2: MATERIALIZED VIEWS & PRE-AGGREGATION PIPELINES
-- Characteristics: Eliminates repeated large scans by computing incremental state.
-- =========================================================================
${phase2Findings.map((f, i) => formatFindingSql(f, '2', i + 1)).join('\n')}`);
  }

  if (phase3Findings.length > 0) {
    sections.push(`-- =========================================================================
-- PHASE 3: STRUCTURAL ENGINE & PARTITIONING CONVERSIONS
-- Characteristics: Uses shadow table swap pattern (CREATE _v2 -> INSERT SELECT -> RENAME).
-- IMPORTANT: Schedule during off-peak maintenance window; monitor replication lag.
-- =========================================================================
${phase3Findings.map((f, i) => formatFindingSql(f, '3', i + 1)).join('\n')}`);
  }

  if (phase4Findings.length > 0) {
    sections.push(`-- =========================================================================
-- PHASE 4: RETENTION POLICIES (TTL) & SERVER CONFIGURATION SAFEGUARDS
-- Characteristics: Manages historical lifecycle and memory spill-to-disk controls.
-- =========================================================================
${phase4Findings.map((f, i) => formatFindingSql(f, '4', i + 1)).join('\n')}`);
  }

  const scriptBody = sections.join('\n\n') || '-- No remediation SQL required for current findings.';

  return `-- =========================================================================
-- YACHIRU AI-SYNTHESIZED CLICKHOUSE MIGRATION PLAN
-- Generated: ${timestamp}
-- Target Database: ${params.database} (Cluster: ${params.clusterName})
-- AI Synthesis Engine: ${modelInfo}
-- Total Optimization Findings: ${params.findings.length} (${ddlFindings.length} with executable DDL)
-- 
-- PROTOCOL SAFETY DIRECTIVES:
-- 1. Yachiru operates strictly read-only. This script is synthesized for dry-run inspection.
-- 2. Always execute statements in an isolated staging or replica environment first.
-- 3. Verify data row counts and query plans before dropping deprecated tables.
-- =========================================================================

${scriptBody}

-- =========================================================================
-- POST-MIGRATION VERIFICATION COMMANDS
-- Run these queries after applying changes to confirm optimization success:
-- =========================================================================
-- Check part counts and compression ratio:
SELECT table, count() as parts_count, formatReadableSize(sum(data_compressed_bytes)) as compressed_size,
       formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed_size,
       round(sum(data_uncompressed_bytes) / nullIf(sum(data_compressed_bytes), 0), 2) as compression_ratio
FROM system.parts
WHERE database = '${params.database}' AND active = 1
GROUP BY table
ORDER BY parts_count DESC;

-- Check system mutations progress:
SELECT database, table, mutation_id, command, is_done, parts_to_do
FROM system.mutations
WHERE database = '${params.database}' AND is_done = 0;
`;
}
