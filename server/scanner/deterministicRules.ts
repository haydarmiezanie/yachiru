import { RawClusterData } from './clickhouseClient.js';
import { DimensionId, DimensionScore, Finding, FindingSeverity } from '../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatBytes } from './analyzers/analyzerUtils.js';
import { analyzeTableEngines } from './analyzers/tableEnginesAnalyzer.js';
import { analyzePartsAndMerges } from './analyzers/partsAndMergesAnalyzer.js';
import { analyzePrimaryKeyAndQueries } from './analyzers/primaryKeyAndQueriesAnalyzer.js';
import { analyzeSkipIndexes } from './analyzers/skipIndexesAnalyzer.js';
import { analyzeDataTypesAndStorage } from './analyzers/dataTypesAndStorageAnalyzer.js';
import { analyzeTtlAndTiering } from './analyzers/ttlAndTieringAnalyzer.js';
import { analyzeMaterializedViews } from './analyzers/materializedViewsAnalyzer.js';
import { analyzeResourceAndConfig } from './analyzers/resourceAndConfigAnalyzer.js';
import { analyzeQueryPerformance } from './analyzers/queryPerformanceAnalyzer.js';

export { DIMENSION_METADATA };

export interface DeterministicScanResult {
  findings: Finding[];
  dimensionScores: Record<DimensionId, DimensionScore>;
  overallScore: number;
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  migrationScript: string;
  stats: {
    totalTables: number;
    totalParts: number;
    totalRows: number;
    totalDiskSizeBytes: number;
    totalDiskSizeFormatted: string;
    queriesAnalyzed: number;
  };
}

export function runDeterministicScan(data: RawClusterData): DeterministicScanResult {
  let findingCounter = 1;
  const createId = (dim: string) => `FND-${dim.toUpperCase().slice(0, 4)}-${String(findingCounter++).padStart(3, '0')}`;

  // Execute all 9 dimension analyzers
  const findings: Finding[] = [
    ...analyzeTableEngines(data, createId),
    ...analyzePartsAndMerges(data, createId),
    ...analyzePrimaryKeyAndQueries(data, createId),
    ...analyzeSkipIndexes(data, createId),
    ...analyzeDataTypesAndStorage(data, createId),
    ...analyzeTtlAndTiering(data, createId),
    ...analyzeMaterializedViews(data, createId),
    ...analyzeResourceAndConfig(data, createId),
    ...analyzeQueryPerformance(data, createId),
  ];

  // -------------------------------------------------------------
  // Dimension Scoring & Rollup
  // -------------------------------------------------------------
  const dimensionScores: Record<DimensionId, DimensionScore> = {} as any;
  const allDimensions: DimensionId[] = [
    'table_engines_partitioning',
    'parts_and_merges',
    'primary_key_and_query_patterns',
    'skip_indexes',
    'data_types_and_storage',
    'ttl_and_tiering',
    'materialized_views_redundant_compute',
    'resource_and_config',
    'general_query_performance',
  ];

  for (const dim of allDimensions) {
    const dimFindings = findings.filter((f) => f.dimension === dim);
    const criticalCount = dimFindings.filter((f) => f.severity === 'critical').length;
    const warningCount = dimFindings.filter((f) => f.severity === 'warning').length;
    const infoCount = dimFindings.filter((f) => f.severity === 'info').length;
    const optimalCount = dimFindings.filter((f) => f.severity === 'optimal').length;

    // Scoring formula: Base 100 - (critical * 35) - (warning * 15) - (info * 5)
    const score = Math.max(0, Math.min(100, 100 - criticalCount * 35 - warningCount * 15 - infoCount * 5));

    let summary = 'Optimal configuration. No issues detected.';
    if (criticalCount > 0) {
      summary = `${criticalCount} critical bottleneck(s) requiring immediate attention.`;
    } else if (warningCount > 0) {
      summary = `${warningCount} optimization opportunity(ies) identified.`;
    } else if (infoCount > 0) {
      summary = `${infoCount} informational recommendation(s).`;
    }

    dimensionScores[dim] = {
      dimension: dim,
      name: DIMENSION_METADATA[dim].name,
      description: DIMENSION_METADATA[dim].description,
      score,
      criticalCount,
      warningCount,
      infoCount,
      optimalCount,
      summary,
    };
  }

  // Calculate Overall Score
  const scoresArray = Object.values(dimensionScores).map((d) => d.score);
  const overallScore = Math.round(scoresArray.reduce((a, b) => a + b, 0) / scoresArray.length);

  let overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
  if (overallScore >= 95) overallGrade = 'A+';
  else if (overallScore >= 85) overallGrade = 'A';
  else if (overallScore >= 70) overallGrade = 'B';
  else if (overallScore >= 55) overallGrade = 'C';
  else if (overallScore >= 40) overallGrade = 'D';
  else overallGrade = 'F';

  // Generate Consolidated Migration Script
  const ddlSnippets = findings
    .filter((f) => f.recommendationSql)
    .map((f, idx) => {
      return `-- =========================================================================
-- Phase ${idx + 1}: ${f.title} (${f.severity.toUpperCase()})
-- Impact: ${f.estimatedImpact.magnitude}
-- =========================================================================
${f.recommendationSql}
`;
    })
    .join('\n');

  const migrationScript = `-- =========================================================================
-- Yachiru ClickHouse Optimization Script (DRY-RUN / MANUAL REVIEW ONLY)
-- Generated on: ${new Date().toISOString()}
-- Target Database: ${data.targetDatabase || data.database || data.tables[0]?.database || 'default'}
-- Total Recommendations: ${findings.length}
-- SAFETY NOTICE: Review all DDL statements in staging before executing on production!
-- =========================================================================

${ddlSnippets || '-- No DDL modifications required. Your database configuration is optimal!'}
`;

  // Sort findings by severity (critical first, then warning, then info)
  const severityWeight: Record<FindingSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    optimal: 3,
  };
  findings.sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity]);

  const totalRows = data.tables.reduce((acc, t) => acc + (t.total_rows || 0), 0);
  const totalBytes = data.tables.reduce((acc, t) => acc + (t.total_bytes || 0), 0);

  return {
    findings,
    dimensionScores,
    overallScore,
    overallGrade,
    migrationScript,
    stats: {
      totalTables: data.tables.length,
      totalParts: data.parts.length,
      totalRows,
      totalDiskSizeBytes: totalBytes,
      totalDiskSizeFormatted: formatBytes(totalBytes),
      queriesAnalyzed: data.queryLog.length,
    },
  };
}
