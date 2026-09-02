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

  return findings.map((f) => {
    const aiE = enrichmentMap.get(f.id);
    return {
      ...f,
      aiInsight: aiE?.aiInsight || undefined,
      aiSqlFix: aiE?.aiSqlFix || undefined,
      aiRiskLevel: aiE?.riskLevel || undefined,
      relativePriority: aiE
        ? {
            rank: aiE.rank || f.relativePriority?.rank || 1,
            effort: aiE.effort || f.relativePriority?.effort || 'Medium',
            impact: aiE.impact || f.relativePriority?.impact || 'High',
            justification: aiE.justification || defaultJustification,
          }
        : f.relativePriority,
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
