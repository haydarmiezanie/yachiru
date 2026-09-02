import { RawClusterData } from '../clickhouseClient.js';
import { Finding, FindingSeverity } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatBytes, formatRows } from './analyzerUtils.js';

export function analyzeQueryPerformance(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'general_query_performance';
  const dimName = DIMENSION_METADATA[dim].name;

  // 9.1 Exception Analysis in Query Log
  const failedQueries = data.queryLog.filter((q) => q.exception_code && q.exception_code !== 0);
  if (failedQueries.length > 0) {
    const topException = failedQueries[0];
    findings.push({
      id: nextId('QRY'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'critical',
      title: `Frequent Query Failures Detected: ${topException.exception?.slice(0, 70) || 'ClickHouse Server Exceptions'}`,
      what: `Identified ${failedQueries.length} aborted/failed query executions in the query log. Example code ${topException.exception_code}: "${topException.exception?.slice(0, 150)}".`,
      whyTechnical: `Exceptions in query_log typically indicate client-side timeouts, memory limit exhaustion (code 241), syntax errors, or ZooKeeper session drops during distributed queries.`,
      whyNarrative: `Multiple client queries are failing with server exceptions. Resolving these errors is critical for user-facing dashboard stability.`,
      recommendationSummary: `Investigate root causes for exception code ${topException.exception_code} in system.query_log.`,
      recommendationSql: `-- Inspect recent failed queries and stack traces
SELECT event_time, query_duration_ms, user, exception_code, exception, query
FROM system.query_log
WHERE type = 'ExceptionWhileProcessing'
ORDER BY event_time DESC
LIMIT 50;`,
      estimatedImpact: {
        metric: 'Query Success Rate',
        magnitude: '100% execution reliability',
        description: 'Eliminates user-facing query errors and unexpected dashboard crashes.',
      },
      metrics: {
        failedCount: failedQueries.length,
        topExceptionCode: topException.exception_code,
        sampleException: topException.exception,
      },
      relativePriority: {
        rank: 1,
        effort: 'Medium',
        impact: 'Critical',
        justification: 'Failing queries directly impact application reliability and SLAs.',
      },
    });
  }

  // 9.2 Extreme Latency Queries (> 10s)
  const slowQueries = data.queryLog.filter((q) => q.query_duration_ms > 10_000);
  if (slowQueries.length > 0) {
    const slowest = slowQueries[0];
    const severity: FindingSeverity = slowest.query_duration_ms > 30_000 ? 'critical' : 'warning';
    const targetTable = slowest.tables && slowest.tables.length > 0 ? slowest.tables[0] : undefined;

    findings.push({
      id: nextId('QRY'),
      dimension: dim,
      dimensionName: dimName,
      severity,
      title: `Severe Query Latency Bottleneck (${(slowest.query_duration_ms / 1000).toFixed(1)}s execution time)`,
      tableName: targetTable,
      what: `Query '${slowest.query_id}' took ${(slowest.query_duration_ms / 1000).toFixed(1)}s to complete, scanning ${formatRows(slowest.read_rows)} rows (${formatBytes(slowest.read_bytes)}) and consuming ${formatBytes(slowest.memory_usage)} of RAM.`,
      whyTechnical: `Long query durations are caused by full table scans without primary key pruning, high-cardinality non-materialized JOINs, uncompressed memory-heavy GROUP BY states, or thread starvation.`,
      whyNarrative: `This query is locking CPU and disk resources for ${(slowest.query_duration_ms / 1000).toFixed(1)} seconds. Optimizing its filter conditions or creating a projection will significantly speed it up.`,
      recommendationSummary: `Optimize query filter clauses, align with primary sorting key, or add an index projection.`,
      recommendationSql: `-- Trace query execution pipeline using EXPLAIN
EXPLAIN indexes = 1, actions = 1
${slowest.query};`,
      estimatedImpact: {
        metric: 'P99 Latency & User Wait Time',
        magnitude: '5x - 20x latency acceleration',
        description: `Reduces ${(slowest.query_duration_ms / 1000).toFixed(1)}s query latency down to sub-second range.`,
      },
      metrics: {
        queryId: slowest.query_id,
        durationMs: slowest.query_duration_ms,
        readRows: slowest.read_rows,
        readBytes: slowest.read_bytes,
        memoryUsage: slowest.memory_usage,
      },
      relativePriority: {
        rank: 2,
        effort: 'Medium',
        impact: 'High',
        justification: 'Slowest queries consume the lion\'s share of cluster CPU cycles.',
      },
    });
  }

  return findings;
}
