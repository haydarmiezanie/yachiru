import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  AnalysisReport,
  CategoryScore,
  CheckFinding,
  ConnectionConfig,
  TableMetadata,
  ClusterVerdict,
  AnalysisCoverage,
} from '../src/types.js';
import { openSshTunnel, OpenTunnelResult } from './sshTunnel.js';
import { calculateFindingCostImpact, calculateReportCostSummary, DEFAULT_COST_MODEL } from '../src/utils/costModel.js';
import {
  CheckEvaluationContext,
  evaluatePartHealthChecks,
  evaluateSchemaChecks,
  evaluateQueryChecks,
  evaluateReplicationChecks,
  evaluateSystemChecks,
} from './checks/index.js';
import {
  collectAllSystemTelemetry,
  type ClickHouseQueryExecutor,
  type ClickHouseQueryResultSet,
  type TableRow,
} from './collectors/systemCollectors.js';
import { runSimulationScan } from './demo/simulation.js';

import {
  stripLiteralsAndComments,
  escapeSqlString,
  escapeSqlIdentifier,
  assertReadOnlySql,
  formatBytes,
  tokenizeColumnName,
  matchesColumnTokens,
} from './sqlUtils.js';

export {
  stripLiteralsAndComments,
  escapeSqlString,
  escapeSqlIdentifier,
  assertReadOnlySql,
  formatBytes,
  tokenizeColumnName,
  matchesColumnTokens,
  runSimulationScan,
  type ClickHouseQueryExecutor,
  type ClickHouseQueryResultSet,
};

/**
 * Privacy & PII Sanitizer: Single-scan tokenizer that scrubs raw query literals,
 * filter parameters, negative numbers, heredocs, array elements, and sensitive constants.
 *
 * Literals and heredocs are parsed before comments so closing quotes/delimiters are not eaten.
 * Numeric literals (including negatives and function/array arguments) are redacted unless
 * accompanied by diagnostic metric units (e.g. 'rows', 'GB', 'seconds').
 */
export function sanitizeQueryForPrivacy(sql: string): string {
  if (!sql || typeof sql !== 'string') return '';

  const output: string[] = [];
  const len = sql.length;
  let i = 0;

  const isIdentifierChar = (c: string) => /[a-zA-Z0-9_]/.test(c);

  while (i < len) {
    const ch = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';

    // 1. Dollar-quoted heredoc ($$...$$ or $tag$...$tag$)
    if (ch === '$') {
      const matchTag = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
      if (matchTag) {
        const fullTag = matchTag[0];
        const endTagIndex = sql.indexOf(fullTag, i + fullTag.length);
        if (endTagIndex !== -1) {
          output.push(`${fullTag}[REDACTED]${fullTag}`);
          i = endTagIndex + fullTag.length;
          continue;
        } else {
          output.push(`${fullTag}[REDACTED]${fullTag}`);
          break;
        }
      }
    }

    // 2. Single-quoted string literal ('...') - Handles escapes (\' and '') and unterminated literals
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (j + 1 < len && sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      output.push("'[REDACTED]'");
      i = j;
      continue;
    }

    // 3. Double-quoted string literal ("...") - Handles escapes and unterminated literals
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          if (j + 1 < len && sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      output.push('"[REDACTED]"');
      i = j;
      continue;
    }

    // 4. Single-line comment (-- or #)
    if ((ch === '-' && next === '-') || ch === '#') {
      const newlineIndex = sql.indexOf('\n', i);
      if (newlineIndex === -1) {
        break;
      }
      i = newlineIndex;
      continue;
    }

    // 5. Multi-line comment (/* ... */)
    if (ch === '/' && next === '*') {
      const endComment = sql.indexOf('*/', i + 2);
      if (endComment === -1) {
        break;
      }
      i = endComment + 2;
      continue;
    }

    // 6. Email address check
    const emailMatch = sql.slice(i).match(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    if (emailMatch && (i === 0 || !isIdentifierChar(sql[i - 1]))) {
      output.push('[REDACTED_EMAIL]');
      i += emailMatch[0].length;
      continue;
    }

    // 7. UUID check (e.g. e91b1234-abcd-5678-ef01-23456789abcd)
    const uuidSlice = sql.slice(i, i + 36);
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/.test(uuidSlice) && (i === 0 || !isIdentifierChar(sql[i - 1]))) {
      output.push('[REDACTED_UUID]');
      i += 36;
      continue;
    }

    // 8. IPv4 address check (e.g. 10.20.30.40)
    const ipMatch = sql.slice(i).match(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/);
    if (ipMatch && (i === 0 || !isIdentifierChar(sql[i - 1]))) {
      output.push('[REDACTED_IP]');
      i += ipMatch[0].length;
      continue;
    }

    // 9. Hex literal (0x123abc or 32+ hex characters)
    if (ch === '0' && (next === 'x' || next === 'X') && (i === 0 || !isIdentifierChar(sql[i - 1]))) {
      const hexMatch = sql.slice(i).match(/^0[xX][0-9a-fA-F]+/);
      if (hexMatch) {
        output.push('[REDACTED_HEX]');
        i += hexMatch[0].length;
        continue;
      }
    }
    const longHexMatch = sql.slice(i).match(/^[0-9a-fA-F]{32,64}\b/);
    if (longHexMatch && (i === 0 || !isIdentifierChar(sql[i - 1]))) {
      output.push('[REDACTED_HASH]');
      i += longHexMatch[0].length;
      continue;
    }

    // 10. Numeric literals (positive, negative, decimal, in arrays [1, 2], function args (123), etc.)
    const prevChar = i > 0 ? sql[i - 1] : ' ';
    const isNegativeSign = ch === '-' && /[0-9]/.test(next);
    const isDigitStart = /[0-9]/.test(ch);

    if ((isDigitStart || isNegativeSign) && !isIdentifierChar(prevChar)) {
      const numMatch = sql.slice(i).match(/^-?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/);
      if (numMatch) {
        const afterNum = sql.slice(i + numMatch[0].length).trimStart();
        const isMetricUnit = /^(?:rows?|bytes?|b|kb|mb|gb|tb|pb|s|sec|seconds?|ms|mins?|minutes?|hours?|hrs?|h|days?|executions?(?:\/day)?|x|%|parts?)\b/i.test(afterNum);
        if (isMetricUnit) {
          output.push(numMatch[0]);
        } else {
          output.push('[NUM]');
        }
        i += numMatch[0].length;
        continue;
      }
    }

    // Default: copy verbatim
    output.push(ch);
    i++;
  }

  return output.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}



/**
 * Builds the exact, non-wildcard query_log filter targeting only queries that actually touched the target database.
 * Eliminates false positive substring matches on LIKE and ignores unread session databases.
 */
export function buildQueryLogFilter(database: string): { mainFilter: string; fallbackFilter: string } {
  const dbEsc = escapeSqlString(database);
  return {
    mainFilter: `arrayExists(tbl -> startsWith(tbl, '${dbEsc}.'), tables) AND query_kind = 'Select' AND NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)`,
    fallbackFilter: `arrayExists(tbl -> startsWith(tbl, '${dbEsc}.'), tables) AND NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)`,
  };
}

// Compute Category Scores and Overall Score
export function calculateScores(
  findings: CheckFinding[],
  coverage?: AnalysisCoverage,
  truncation?: { tables_truncated?: boolean; tables_total?: number; columns_truncated?: boolean }
): { categories: CategoryScore[]; overall_score: number; verdict: ClusterVerdict; isPartial?: boolean } {
  const categoryDefs: Array<{ id: CheckFinding['category']; name: string; description: string }> = [
    { id: 'part_health', name: 'Part Health & Compaction', description: 'Active parts count, size distribution, and merge health' },
    { id: 'primary_key', name: 'Primary Key & Sorting', description: 'ORDER BY effectiveness, cardinality order, and sparse index utility' },
    { id: 'partitioning', name: 'Partitioning Strategy', description: 'Partition cardinality, volume per partition, and pruning efficiency' },
    { id: 'compression', name: 'Compression & Codecs', description: 'Column-level compression ratios, ZSTD/DoubleDelta opportunities' },
    { id: 'table_engine', name: 'Table Engine Sanity', description: 'MergeTree-family usage vs low-performance analytical engines' },
    { id: 'skip_indices', name: 'Data Skipping Indices', description: 'MinMax, Set, and Bloom Filter secondary indexing coverage' },
    { id: 'query_performance', name: 'Query Performance & Pruning', description: 'Scanned vs returned ratios, execution latency, and memory spikes' },
    { id: 'replication_distributed', name: 'Replication & Distributed Backlog', description: 'Replication queue delays, read-only states, and send queues' },
    { id: 'server_settings', name: 'Server & MergeTree Settings', description: 'Memory limits, background thread pools, and delay triggers' },
    { id: 'mutations', name: 'Table Mutations', description: 'Stuck, failing, or long-running table ALTER UPDATE/DELETE mutations' },
    { id: 'disk_space', name: 'Disk Space & Storage', description: 'Disk capacity, free percentage, and storage volume headroom' },
    { id: 'system_errors', name: 'System Errors & Stability', description: 'Recent error counts, recurring exception codes, and cluster stability' },
    { id: 'replication_queue', name: 'Replication Queue & Retries', description: 'Pending replication tasks, recurring sync failures, and retry backlogs' },
  ];

  const categories: CategoryScore[] = categoryDefs
    .map((def) => {
      const catFindings = findings.filter((f) => f.category === def.id);
      const critical = catFindings.filter((f) => f.status === 'critical').length;
      const warning = catFindings.filter((f) => f.status === 'warning').length;
      const good = catFindings.filter((f) => f.status === 'good').length;
      const total = catFindings.length;

      // Gracefully skip categories with zero evaluated checks (e.g. optional table ungranted or not applicable)
      if (total === 0) {
        return null;
      }

      // Score deduction algorithm: Start at 100
      // Each critical finding docks 30 pts, warning docks 12 pts, min 0
      const score = Math.max(0, 100 - (critical * 30 + warning * 12));
      const status = critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'good';

      return {
        category: def.id,
        name: def.name,
        score,
        status,
        critical_count: critical,
        warning_count: warning,
        good_count: good,
        total_checks: total,
        description: def.description,
      };
    })
    .filter((c): c is CategoryScore => c !== null);

  // Calculate weighted overall score
  const totalScoreSum = categories.reduce((sum, c) => sum + c.score, 0);
  const overall_score = categories.length > 0 ? Math.round(totalScoreSum / categories.length) : 100;

  let verdict: ClusterVerdict = 'Optimized';

  const isTruncated = Boolean(truncation?.tables_truncated || truncation?.columns_truncated);
  const unavailableCount =
    coverage?.unavailableCount ??
    coverage?.categories.filter((c) => c.state === 'unavailable').length ??
    0;
  const hasUnavailable = Boolean(coverage && (unavailableCount > 0 || coverage.hasUnavailable));
  const applicableCount =
    coverage?.applicableCount ??
    coverage?.categories.filter((c) => c.state !== 'not_applicable').length ??
    categories.length;
  const evaluatedCount =
    coverage?.evaluatedCount ??
    coverage?.categories.filter((c) => c.state === 'evaluated').length ??
    categories.length;
  const totalCount = coverage?.totalCount ?? coverage?.categories.length ?? categories.length;

  const coverageRatio = applicableCount > 0 ? evaluatedCount / applicableCount : 1;
  const isCoverageInsufficient = Boolean(coverage && coverageRatio < 0.60);
  const isPartial = Boolean(
    hasUnavailable ||
    isCoverageInsufficient ||
    isTruncated ||
    (coverage ? evaluatedCount < applicableCount : false)
  );

  if (hasUnavailable || isCoverageInsufficient || isTruncated) {
    verdict = 'Incomplete';
  } else if (overall_score < 60 || findings.filter((f) => f.status === 'critical').length >= 3) {
    verdict = 'Critical Optimization Required';
  } else if (overall_score < 85 || findings.filter((f) => f.status === 'warning').length > 0) {
    verdict = 'Needs Tuning';
  } else {
    verdict = 'Optimized';
  }

  return { categories, overall_score, verdict, isPartial };
}

// Live ClickHouse analyzer using @clickhouse/client
export async function runLiveScan(
  config: ConnectionConfig,
  options?: {
    tunnelOverride?: { host: string; port: number };
    executor?: ClickHouseQueryExecutor;
  }
): Promise<AnalysisReport> {
  const protocol = config.protocol || 'http';
  let host = config.host?.trim() || 'localhost';
  // Strip any accidental protocol or paths from host
  host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  const port = config.port || (protocol === 'https' ? 8443 : 8123);
  const username = config.username || 'default';
  const password = config.password || '';
  const database = config.database || 'default';
  const durationThresholdMs = config.queryDurationThresholdMs || 3000;
  const memoryThresholdBytes = config.queryMemoryThresholdBytes || 1073741824; // 1GB
  const mutationWarningAgeHours = config.mutationWarningAgeHours ?? 1;
  const mutationCriticalAgeHours = config.mutationCriticalAgeHours ?? 6;
  const diskWarningFreePct = config.diskWarningFreePct ?? 20;
  const diskCriticalFreePct = config.diskCriticalFreePct ?? 10;
  const errorRecentWindowHours = config.errorRecentWindowHours ?? 24;
  const errorWarningCount = config.errorWarningCount ?? 100;
  const errorCriticalCount = config.errorCriticalCount ?? 1000;
  const repQueueWarningSize = config.replicationQueueWarningSize ?? 50;
  const repQueueMaxRetries = config.replicationQueueMaxRetries ?? 10;

  let tunnel: OpenTunnelResult | undefined;
  let client: ClickHouseClient | undefined;
  let executor: ClickHouseQueryExecutor;

  const findings: CheckFinding[] = [];
  const tables: TableMetadata[] = [];
  let chVersion = 'Unknown';
  let totalParts = 0;
  let totalQueriesAnalyzed = 0;

  try {
    if (options?.executor) {
      executor = options.executor;
    } else {
      if (options?.tunnelOverride) {
        // Use caller-provided shared tunnel (e.g. established once in /api/analyze)
      } else if (config.useSshTunnel) {
        tunnel = await openSshTunnel({
          sshHost: config.sshHost!.trim(),
          sshPort: Number(config.sshPort) || 22,
          sshUsername: config.sshUsername!.trim(),
          sshAuthMethod: config.sshAuthMethod || 'password',
          sshPassword: config.sshPassword,
          sshPrivateKey: config.sshPrivateKey,
          sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
          sshHostKeyFingerprint: config.sshHostKeyFingerprint?.trim(),
          strictHostKeyChecking: config.strictHostKeyChecking,
          targetHost: host,
          targetPort: port,
        });
      }

      const clientHost = options?.tunnelOverride ? options.tunnelOverride.host : (tunnel ? tunnel.localHost : host);
      const clientPort = options?.tunnelOverride ? options.tunnelOverride.port : (tunnel ? tunnel.localPort : port);

      client = createClient({
        url: `${protocol}://${clientHost}:${clientPort}`,
        username,
        password,
        database,
        request_timeout: 20000,
        clickhouse_settings: {
          max_execution_time: 15,
        },
      });
      executor = client as unknown as ClickHouseQueryExecutor;
    }

    // 0. Pre-flight connectivity check (fails fast within 7s if host is unreachable)
    try {
      const pingRes = await executor.ping();
      if (!pingRes.success) {
        const pingError = 'error' in pingRes ? pingRes.error : undefined;
        throw new Error(pingError?.message || 'Server ping check failed');
      }
    } catch (pingErr) {
      const rawPingMsg = pingErr instanceof Error ? pingErr.message : String(pingErr);
      if (/timeout|etimedout/i.test(rawPingMsg)) {
        throw new Error(
          `Connection timed out to ${protocol}://${host}:${port}. If you entered "localhost", note that the cloud runtime cannot reach your local machine's loopback interface without a tunnel or public IP. Consider using ClickHouse Cloud, exposing via a tunnel, or exploring the Realistic Demo Cluster.`
        );
      } else if (/econnrefused/i.test(rawPingMsg)) {
        throw new Error(
          `Connection refused by ${host}:${port}. Verify ClickHouse is active and listening on HTTP port ${port} (default 8123 HTTP / 8443 HTTPS). Note that native port 9000 is not supported.`
        );
      }
      throw new Error(`Unable to establish initial connection to ClickHouse at ${host}:${port} (${rawPingMsg})`);
    }

    // 1. Get ClickHouse version & uptime
    const versionQuery = `SELECT version() AS version, uptime() AS uptime`;
    assertReadOnlySql(versionQuery);
    const verRes = await executor.query({
      query: versionQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 10 },
    });
    const verData = (await verRes.json()) as Array<{ version: string; uptime: number }>;
    if (verData.length > 0) {
      chVersion = verData[0].version;
    }

    // 2. Fetch all user tables in target database and check for truncation
    const countTablesQuery = `
      SELECT count() AS total_tables
      FROM system.tables
      WHERE database = '${escapeSqlString(database)}'
        AND is_temporary = 0
    `;
    assertReadOnlySql(countTablesQuery);
    let totalTablesCount = 0;
    try {
      const countRes = await executor.query({
        query: countTablesQuery,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 8 },
      });
      const countData = (await countRes.json()) as Array<{ total_tables: number | string }>;
      totalTablesCount = Number(countData[0]?.total_tables || 0);
    } catch {
      totalTablesCount = 0;
    }

    const tablesQuery = `
      SELECT
        database,
        name,
        engine,
        total_rows,
        total_bytes,
        sorting_key,
        partition_key
      FROM system.tables
      WHERE database = '${escapeSqlString(database)}'
        AND is_temporary = 0
      ORDER BY total_bytes DESC
      LIMIT 500
    `;
    assertReadOnlySql(tablesQuery);
    const tablesRes = await executor.query({
      query: tablesQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 12 },
    });
    const tablesData = (await tablesRes.json()) as TableRow[];

    const tables_total = Math.max(totalTablesCount, tablesData.length);
    const tables_truncated = tables_total > tablesData.length;

    // 3-8. Parallel execution of independent read-only system table queries
    const {
      partsData,
      colData,
      columns_truncated,
      skipData,
      skipIndicesAvailable,
      queryStats,
      queryLogAvailable,
      replicasData,
      replicasAvailable,
      distQueueData,
      settingsData,
      settingsAvailable,
      mutationsData,
      mutationsAvailable,
      disksData,
      disksAvailable,
      errorsData,
      errorsAvailable,
      repQueueData,
      repQueueAvailable,
      coverage,
    } = await collectAllSystemTelemetry(executor, database, tablesData);

    // Populate post-query aggregates
    const partsMap = new Map<string, (typeof partsData)[0]>();
    for (const p of partsData) {
      partsMap.set(p.table, p);
      totalParts += Number(p.active_parts || 0);
    }

    const skipIndicesMap = new Map<string, number>();
    for (const s of skipData) {
      skipIndicesMap.set(s.table, (skipIndicesMap.get(s.table) || 0) + 1);
    }

    if (queryLogAvailable) {
      totalQueriesAnalyzed = queryStats.length;
    }

    // --- EVALUATE DETERMINISTIC RULES VIA DOMAIN MODULES ---
    const checkContext: CheckEvaluationContext = {
      database,
      tablesData,
      partsMap,
      colData,
      skipData,
      skipIndicesMap,
      skipIndicesAvailable,
      queryStats,
      queryLogAvailable,
      durationThresholdMs,
      memoryThresholdBytes,
      replicasData,
      distributionData: distQueueData.map((d) => ({
        database,
        table: d.table,
        data_files: d.files_to_send,
        data_compressed_bytes: d.bytes_to_send,
        is_blocked: d.is_blocked,
      })),
      replicationAvailable: replicasAvailable,
      settingsData,
      settingsAvailable,
      mutationsData: mutationsData || [],
      mutationsAvailable,
      mutationWarningAgeHours,
      mutationCriticalAgeHours,
      disksData: disksData || [],
      disksAvailable,
      diskWarningFreePct,
      diskCriticalFreePct,
      errorsData: errorsData
        ? errorsData.map((e) => ({
            name: e.name,
            code: e.code,
            value: e.error_count,
            last_error_time: e.last_error_time,
            last_error_message: e.last_error_message,
          }))
        : [],
      errorsAvailable,
      errorRecentWindowHours,
      errorWarningCount,
      errorCriticalCount,
      replicationQueueData: repQueueData || [],
      replicationQueueAvailable: repQueueAvailable,
      replicationQueueWarningSize: repQueueWarningSize,
      replicationQueueMaxRetries: repQueueMaxRetries,
    };

    findings.push(...evaluatePartHealthChecks(checkContext));
    findings.push(...evaluateSchemaChecks(checkContext));
    findings.push(...evaluateQueryChecks(checkContext, sanitizeQueryForPrivacy));
    findings.push(...evaluateReplicationChecks(checkContext));
    findings.push(...evaluateSystemChecks(checkContext));

    // Build Table Metadata list
    for (const t of tablesData) {
      const partInfo = partsMap.get(t.name);
      const rows = Number(t.total_rows || 0);
      const comp = Number(partInfo?.compressed_bytes || t.total_bytes || 0);
      const uncomp = Number(partInfo?.uncompressed_bytes || comp * 2.5);
      const ratio = comp > 0 ? uncomp / comp : 1;
      const tFindings = findings.filter((f) => f.table === t.name);

      tables.push({
        database: t.database,
        name: t.name,
        engine: t.engine,
        total_rows: rows,
        total_bytes_uncompressed: uncomp,
        total_bytes_compressed: comp,
        compression_ratio: Number(ratio.toFixed(2)),
        active_parts: Number(partInfo?.active_parts || 0),
        partition_count: Number(partInfo?.partition_count || 1),
        order_by_key: t.sorting_key || 'None',
        partition_key: t.partition_key || 'None',
        skip_indices_count: skipIndicesMap.get(t.name) || 0,
        findings_count: {
          critical: tFindings.filter((f) => f.status === 'critical').length,
          warning: tFindings.filter((f) => f.status === 'warning').length,
          good: tFindings.filter((f) => f.status === 'good').length,
        },
      });
    }

    // Scoring
    const { categories, overall_score, verdict } = calculateScores(
      findings,
      coverage,
      { tables_truncated, columns_truncated }
    );

    // Summary calculations
    const totalRowsAll = tables.reduce((s, t) => s + t.total_rows, 0);
    const totalCompAll = tables.reduce((s, t) => s + t.total_bytes_compressed, 0);
    const totalUncompAll = tables.reduce((s, t) => s + t.total_bytes_uncompressed, 0);
    const avgRatio = totalCompAll > 0 ? (totalUncompAll / totalCompAll).toFixed(2) : '1.00';

    return {
      scan_id: `scan_${Date.now()}`,
      timestamp: new Date().toISOString(),
      database_name: database,
      clickhouse_version: chVersion,
      cluster_mode: replicasData.length > 0 ? 'Replicated Cluster' : 'Single Node',
      overall_score,
      overall_verdict: verdict,
      coverage,
      tables_truncated,
      tables_total,
      columns_truncated,
      is_demo: false,
      summary: {
        total_tables: tables.length,
        total_rows: totalRowsAll,
        total_size_compressed: formatBytes(totalCompAll),
        total_size_uncompressed: formatBytes(totalUncompAll),
        avg_compression_ratio: `${avgRatio}x`,
        total_parts: totalParts,
        total_queries_analyzed: totalQueriesAnalyzed,
        critical_count: findings.filter((f) => f.status === 'critical').length,
        warning_count: findings.filter((f) => f.status === 'warning').length,
        good_count: findings.filter((f) => f.status === 'good').length,
      },
      categories,
      findings: findings.map((f) => {
        f.cost_impact = calculateFindingCostImpact(f, tables, DEFAULT_COST_MODEL);
        return f;
      }),
      tables,
      cost_summary: calculateReportCostSummary(findings, tables, DEFAULT_COST_MODEL),
    };
  } finally {
    await client?.close();
    await tunnel?.close();
  }
}

/**
 * Executes a targeted, read-only query against system.columns for a single column
 * to measure post-remediation storage and type changes without reading user table data.
 */
export async function queryTargetColumnTelemetry(
  config: ConnectionConfig,
  database: string,
  table: string,
  column: string
): Promise<{
  name: string;
  type: string;
  data_compressed_bytes: number;
  data_uncompressed_bytes: number;
  compression_codec?: string;
} | null> {
  if (config.isDemo) {
    if (table.toLowerCase() === 'events_raw' && column.toLowerCase() === 'payload_json') {
      return {
        name: 'payload_json',
        type: 'String',
        data_compressed_bytes: 307 * 1024 * 1024 * 1024,
        data_uncompressed_bytes: 505 * 1024 * 1024 * 1024,
        compression_codec: 'CODEC(ZSTD(6))',
      };
    }
    return null;
  }

  let tunnel: OpenTunnelResult | undefined;
  let client: ClickHouseClient | undefined;

  try {
    const protocol = config.protocol || 'http';
    let host = config.host?.trim() || 'localhost';
    host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    const port = config.port || (protocol === 'https' ? 8443 : 8123);
    const username = config.username || 'default';
    const password = config.password || '';

    if (config.useSshTunnel) {
      tunnel = await openSshTunnel({
        sshHost: config.sshHost!.trim(),
        sshPort: Number(config.sshPort) || 22,
        sshUsername: config.sshUsername!.trim(),
        sshAuthMethod: config.sshAuthMethod || 'password',
        sshPassword: config.sshPassword,
        sshPrivateKey: config.sshPrivateKey,
        sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
        sshHostKeyFingerprint: config.sshHostKeyFingerprint?.trim(),
        strictHostKeyChecking: config.strictHostKeyChecking,
        targetHost: host,
        targetPort: port,
      });
    }

    const clientHost = tunnel ? tunnel.localHost : host;
    const clientPort = tunnel ? tunnel.localPort : port;

    client = createClient({
      url: `${protocol}://${clientHost}:${clientPort}`,
      username,
      password,
      database,
      clickhouse_settings: {
        max_execution_time: 10,
        readonly: '2',
      },
    });

    const colQuery = `
      SELECT
        name,
        type,
        data_compressed_bytes,
        data_uncompressed_bytes,
        compression_codec
      FROM system.columns
      WHERE database = '${escapeSqlString(database)}'
        AND table = '${escapeSqlString(table)}'
        AND name = '${escapeSqlString(column)}'
      LIMIT 1
    `;
    assertReadOnlySql(colQuery);

    const colRes = await client.query({
      query: colQuery,
      format: 'JSONEachRow',
    });
    const rows = (await colRes.json()) as Array<{
      name: string;
      type: string;
      data_compressed_bytes: string | number;
      data_uncompressed_bytes: string | number;
      compression_codec?: string;
    }>;

    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        name: row.name,
        type: row.type,
        data_compressed_bytes: Number(row.data_compressed_bytes) || 0,
        data_uncompressed_bytes: Number(row.data_uncompressed_bytes) || 0,
        compression_codec: row.compression_codec,
      };
    }
    return null;
  } finally {
    await client?.close();
    await tunnel?.close();
  }
}
