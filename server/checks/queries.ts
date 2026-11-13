import { CheckFinding } from '../../src/types.js';
import { CheckEvaluationContext } from './types.js';
import { escapeSqlIdentifier, formatBytes } from './helpers.js';

export function evaluateQueryChecks(
  ctx: CheckEvaluationContext,
  sanitizeQueryForPrivacy: (query: string) => string
): CheckFinding[] {
  const findings: CheckFinding[] = [];

  if (ctx.queryLogAvailable) {
    const highRatioQueries = ctx.queryStats.filter(
      (q) => Number(q.ratio || 0) > 5000 && Number(q.read_rows || 0) > 200000
    );

    if (highRatioQueries.length > 0) {
      const worst = highRatioQueries[0];
      const targetTables =
        Array.isArray(worst.tables) && worst.tables.length > 0
          ? worst.tables.map((t) => escapeSqlIdentifier(t)).join(', ')
          : 'unspecified';
      const hasNormalized =
        typeof worst.normalized_query === 'string' && worst.normalized_query.trim() !== '';
      const sanitizedPattern = hasNormalized ? sanitizeQueryForPrivacy(worst.normalized_query!) : '';
      const querySnippet =
        sanitizedPattern.length > 160 ? `${sanitizedPattern.slice(0, 160)}...` : sanitizedPattern;

      findings.push({
        id: 'query_poor_pruning',
        category: 'query_performance',
        category_name: 'Query Performance & Pruning',
        title: 'High scan-to-result row ratio detected in query_log',
        status: 'critical',
        metric_value: `${Number(worst.ratio).toLocaleString()}x read amplification`,
        threshold: 'Threshold: Scanned / returned ratio < 1,000x for point/filter queries',
        evidence: hasNormalized
          ? `Query read ${Number(worst.read_rows).toLocaleString()} rows (${formatBytes(Number(worst.read_bytes))}) to return only ${Number(worst.result_rows)} rows (${Number(worst.ratio).toLocaleString()}x amplification).\nSanitized query pattern: ${querySnippet}`
          : `Query read ${Number(worst.read_rows).toLocaleString()} rows (${formatBytes(Number(worst.read_bytes))}) to return only ${Number(worst.result_rows)} rows (${Number(worst.ratio).toLocaleString()}x amplification) scanning tables: ${targetTables}. Query text omitted (server normalization unavailable).`,
        impact: 'Full table scanning due to unindexed WHERE conditions burns memory bandwidth and evicts cached blocks.',
        recommendation_sql_or_text: hasNormalized
          ? `-- Inspect query EXPLAIN output to verify index pruning on target table (parameters redacted for privacy):\nEXPLAIN indexes = 1\n${sanitizedPattern};`
          : `-- Inspect query EXPLAIN output to verify index pruning on target table:\nEXPLAIN indexes = 1 SELECT ... FROM ${targetTables} WHERE ...;`,
        is_sql_recommendation: true,
      });
    }

    const slowQueries = ctx.queryStats.filter(
      (q) => Number(q.query_duration_ms) > ctx.durationThresholdMs
    );

    if (slowQueries.length > 0) {
      findings.push({
        id: 'slow_queries_detected',
        category: 'query_performance',
        category_name: 'Query Performance & Pruning',
        title: `${slowQueries.length} query patterns exceeded ${ctx.durationThresholdMs}ms latency threshold`,
        status: 'warning',
        metric_value: `Worst duration: ${(Number(slowQueries[0].query_duration_ms) / 1000).toFixed(2)}s`,
        threshold: `Threshold: ≤ ${ctx.durationThresholdMs}ms`,
        evidence: `Slowest query took ${(Number(slowQueries[0].query_duration_ms) / 1000).toFixed(2)} seconds and consumed ${formatBytes(Number(slowQueries[0].memory_usage))}.`,
        impact: 'Slow analytical queries hold thread slots and block concurrent read queues.',
        recommendation_sql_or_text: `-- For repeating aggregated queries, consider building a Materialized View with SummingMergeTree or AggregatingMergeTree:\n-- CREATE MATERIALIZED VIEW mv_summary TO summary_table AS SELECT ... GROUP BY ...;`,
        is_sql_recommendation: true,
      });
    }

    if (highRatioQueries.length === 0 && slowQueries.length === 0) {
      findings.push({
        id: 'query_log_status',
        category: 'query_performance',
        category_name: 'Query Performance & Pruning',
        title: 'Query log activity within standard bounds',
        status: 'good',
        metric_value: `${ctx.queryStats.length} queries sampled`,
        threshold: 'Threshold: Active inspection',
        evidence: 'No runaway full scans exceeding threshold recorded in recent query_log.',
        impact: 'Query execution pipeline is responsive.',
        recommendation_sql_or_text: 'Ensure system.query_log is retained for at least 7 days for analytical monitoring.',
        is_sql_recommendation: false,
      });
    }
  }

  return findings;
}
