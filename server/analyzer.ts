import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AnalysisReport, CategoryScore, CheckFinding, ConnectionConfig, TableMetadata } from '../src/types.js';
import { openSshTunnel, OpenTunnelResult } from './sshTunnel.js';
import { calculateFindingCostImpact, calculateReportCostSummary, DEFAULT_COST_MODEL } from '../src/utils/costModel.js';

// Hard safety validator: Ensure any query string is strictly a read-only SELECT
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed) && !/^SHOW\b/i.test(trimmed) && !/^DESCRIBE\b/i.test(trimmed)) {
    throw new Error(`SECURITY EXCEPTION: Only SELECT/SHOW statements are allowed. Attempted: ${sql.substring(0, 40)}...`);
  }

  // Double-check for forbidden mutating commands
  const forbiddenPatterns = [
    /\bALTER\b/i,
    /\bDROP\b/i,
    /\bTRUNCATE\b/i,
    /\bINSERT\b/i,
    /\bDELETE\b/i,
    /\bUPDATE\b/i,
    /\bCREATE\b/i,
    /\bRENAME\b/i,
    /\bATTACH\b/i,
    /\bDETACH\b/i,
    /\bKILL\b/i,
    /\bOPTIMIZE\b/i,
    /\bSYSTEM\s+(DROP|FLUSH|RELOAD|SHUTDOWN|STOP|START)/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error(`SECURITY EXCEPTION: Mutating SQL keyword detected. Query blocked.`);
    }
  }
}

// Format byte sizes into human-readable strings
export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i] || 'PB'}`;
}

// Compute Category Scores and Overall Score
export function calculateScores(findings: CheckFinding[]): { categories: CategoryScore[]; overall_score: number; verdict: 'Optimized' | 'Needs Tuning' | 'Critical Optimization Required' } {
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

  let verdict: 'Optimized' | 'Needs Tuning' | 'Critical Optimization Required' = 'Optimized';
  if (overall_score < 60 || findings.filter((f) => f.status === 'critical').length >= 3) {
    verdict = 'Critical Optimization Required';
  } else if (overall_score < 85 || findings.filter((f) => f.status === 'warning').length > 0) {
    verdict = 'Needs Tuning';
  }

  return { categories, overall_score, verdict };
}

// Live ClickHouse analyzer using @clickhouse/client
export async function runLiveScan(
  config: ConnectionConfig,
  options?: { tunnelOverride?: { host: string; port: number } }
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

  const findings: CheckFinding[] = [];
  const tables: TableMetadata[] = [];
  let chVersion = 'Unknown';
  let totalParts = 0;
  let totalQueriesAnalyzed = 0;

  try {
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

    // 0. Pre-flight connectivity check (fails fast within 7s if host is unreachable)
    try {
      const pingRes = await client.ping();
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
    const verRes = await client.query({
      query: versionQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 10 },
    });
    const verData = (await verRes.json()) as Array<{ version: string; uptime: number }>;
    if (verData.length > 0) {
      chVersion = verData[0].version;
    }

    // 2. Fetch all user tables in target database
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
      WHERE database = '${database.replace(/'/g, "\\'")}'
        AND is_temporary = 0
      ORDER BY total_bytes DESC
      LIMIT 500
    `;
    assertReadOnlySql(tablesQuery);
    const tablesRes = await client.query({
      query: tablesQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 12 },
    });
    const tablesData = (await tablesRes.json()) as Array<{
      database: string;
      name: string;
      engine: string;
      total_rows: number | string;
      total_bytes: number | string;
      sorting_key: string;
      partition_key: string;
    }>;

    // 3-8. Parallel execution of independent read-only system table queries via Promise.allSettled
    let partsData: Array<{
      table: string;
      active_parts: number | string;
      partition_count: number | string;
      total_rows: number | string;
      compressed_bytes: number | string;
      uncompressed_bytes: number | string;
      tiny_parts_count: number | string;
      min_part_size: number | string;
      max_part_size: number | string;
      avg_part_size: number | string;
    }> = [];

    let colData: Array<{
      table: string;
      name: string;
      type: string;
      data_compressed_bytes: number | string;
      data_uncompressed_bytes: number | string;
      compression_codec: string;
    }> = [];

    let skipData: Array<{
      table: string;
      name: string;
      type: string;
      expr: string;
      granularity: number;
    }> = [];

    let queryLogAvailable = false;
    let queryStats: Array<{
      query: string;
      query_duration_ms: number;
      memory_usage: number;
      read_rows: number;
      read_bytes: number;
      result_rows: number;
      ratio: number;
    }> = [];

    let replicasData: Array<{ table: string; is_readonly: number; absolute_delay: number; queue_size: number }> = [];

    let distQueueData: Array<{
      table: string;
      bytes_to_send: number;
      files_to_send: number;
      error_count: number;
      is_blocked: number;
    }> = [];

    let settingsData: Array<{ name: string; value: string; changed: number; description: string }> = [];

    let mutationsData: Array<{
      database: string;
      table: string;
      mutation_id: string;
      command: string;
      create_time: string;
      is_done: number;
      parts_to_do: number;
      latest_fail_reason: string;
    }> | null = null;

    let disksData: Array<{
      name: string;
      path: string;
      free_space: number;
      total_space: number;
    }> | null = null;

    let errorsData: Array<{
      name: string;
      code: number;
      error_count: number;
      last_error_message: string;
      last_error_time: string;
    }> | null = null;

    let repQueueData: Array<{
      database: string;
      table: string;
      node_name: string;
      type: string;
      create_time: string;
      num_tries: number;
      last_exception: string;
    }> | null = null;

    // Parallelize independent read-only system queries via Promise.allSettled
    const [
      partsSettled,
      columnsSettled,
      skippingIndicesSettled,
      queryLogSettled,
      replicasSettled,
      distQueueSettled,
      settingsSettled,
      mutationsSettled,
      disksSettled,
      errorsSettled,
      replicationQueueSettled,
    ] = await Promise.allSettled([
      // system.parts
      (async () => {
        const partsQuery = `
          SELECT
            table,
            count() AS active_parts,
            uniqExact(partition) AS partition_count,
            sum(rows) AS total_rows,
            sum(bytes_on_disk) AS compressed_bytes,
            sum(data_uncompressed_bytes) AS uncompressed_bytes,
            countIf(bytes_on_disk < 1048576) AS tiny_parts_count,
            min(bytes_on_disk) AS min_part_size,
            max(bytes_on_disk) AS max_part_size,
            avg(bytes_on_disk) AS avg_part_size
          FROM system.parts
          WHERE database = '${database.replace(/'/g, "\\'")}'
            AND active = 1
          GROUP BY table
        `;
        assertReadOnlySql(partsQuery);
        const partsRes = await client.query({
          query: partsQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 12 },
        });
        return (await partsRes.json()) as typeof partsData;
      })(),

      // system.columns
      (async () => {
        const colQuery = `
          SELECT
            table,
            name,
            type,
            data_compressed_bytes,
            data_uncompressed_bytes,
            compression_codec
          FROM system.columns
          WHERE database = '${database.replace(/'/g, "\\'")}'
          ORDER BY data_uncompressed_bytes DESC
          LIMIT 200
        `;
        assertReadOnlySql(colQuery);
        const colRes = await client.query({
          query: colQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 10 },
        });
        return (await colRes.json()) as typeof colData;
      })(),

      // system.data_skipping_indices
      (async () => {
        const skipIdxQuery = `
          SELECT
            table,
            name,
            type,
            expr,
            granularity
          FROM system.data_skipping_indices
          WHERE database = '${database.replace(/'/g, "\\'")}'
        `;
        assertReadOnlySql(skipIdxQuery);
        const skipRes = await client.query({
          query: skipIdxQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 8 },
        });
        return (await skipRes.json()) as typeof skipData;
      })(),

      // system.query_log
      (async () => {
        const qlogQuery = `
          SELECT
            query,
            query_duration_ms,
            memory_usage,
            read_rows,
            read_bytes,
            result_rows,
            round(read_rows / greatest(result_rows, 1), 1) AS ratio
          FROM system.query_log
          WHERE type = 'QueryFinish'
            AND event_date >= today() - 1
            AND query NOT LIKE '%system.%'
            AND query NOT LIKE '%SHOW%'
            AND query NOT LIKE '%DESCRIBE%'
          ORDER BY query_duration_ms DESC
          LIMIT 40
        `;
        assertReadOnlySql(qlogQuery);
        const qRes = await client.query({
          query: qlogQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        return (await qRes.json()) as typeof queryStats;
      })(),

      // system.replicas
      (async () => {
        const repQuery = `
          SELECT
            table,
            is_readonly,
            absolute_delay,
            queue_size
          FROM system.replicas
          WHERE database = '${database.replace(/'/g, "\\'")}'
        `;
        assertReadOnlySql(repQuery);
        const rRes = await client.query({
          query: repQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        return (await rRes.json()) as typeof replicasData;
      })(),

      // system.distribution_queue
      (async () => {
        const distQuery = `
          SELECT *
          FROM system.distribution_queue
          WHERE database = '${database.replace(/'/g, "\\'")}'
          LIMIT 100
        `;
        assertReadOnlySql(distQuery);
        const dRes = await client.query({
          query: distQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        const rawRows = (await dRes.json()) as Array<Record<string, unknown>>;
        return rawRows.map((r) => ({
          table: String(r.table || ''),
          bytes_to_send: Number(r.data_compressed_bytes ?? r.data_uncompressed_bytes ?? r.bytes_to_send ?? 0),
          files_to_send: Number(r.compressed_large_files ?? r.uncompressed_large_files ?? r.files_to_send ?? 0),
          error_count: Number(r.error_count ?? 0),
          is_blocked: Number(r.is_blocked ?? 0),
        }));
      })(),

      // system.settings
      (async () => {
        const setQuery = `
          SELECT name, value, changed, description
          FROM system.settings
          WHERE name IN ('max_memory_usage', 'max_threads', 'max_execution_time', 'parts_to_delay_insert', 'parts_to_throw_insert')
        `;
        assertReadOnlySql(setQuery);
        const sRes = await client.query({
          query: setQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        return (await sRes.json()) as typeof settingsData;
      })(),

      // system.mutations
      (async () => {
        const mutationsQuery = `
          SELECT
            database,
            table,
            mutation_id,
            command,
            create_time,
            is_done,
            parts_to_do,
            latest_fail_reason
          FROM system.mutations
          WHERE database = '${database.replace(/'/g, "\\'")}' AND is_done = 0
        `;
        assertReadOnlySql(mutationsQuery);
        const mRes = await client.query({
          query: mutationsQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 8 },
        });
        const rawRows = (await mRes.json()) as Array<Record<string, unknown>>;
        return rawRows.map((r) => ({
          database: String(r.database || ''),
          table: String(r.table || ''),
          mutation_id: String(r.mutation_id || ''),
          command: String(r.command || ''),
          create_time: String(r.create_time || ''),
          is_done: Number(r.is_done ?? 0),
          parts_to_do: Number(r.parts_to_do ?? 0),
          latest_fail_reason: String(r.latest_fail_reason || ''),
        }));
      })(),

      // system.disks (cluster-wide, no database filter)
      (async () => {
        const disksQuery = `
          SELECT name, path, free_space, total_space
          FROM system.disks
        `;
        assertReadOnlySql(disksQuery);
        const dRes = await client.query({
          query: disksQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        const rawRows = (await dRes.json()) as Array<Record<string, unknown>>;
        return rawRows.map((r) => ({
          name: String(r.name || ''),
          path: String(r.path || ''),
          free_space: Number(r.free_space ?? 0),
          total_space: Number(r.total_space ?? 0),
        }));
      })(),

      // system.errors (cluster-wide, no database filter)
      (async () => {
        const errorsQuery = `
          SELECT name, code, value AS error_count, last_error_message, last_error_time
          FROM system.errors
          WHERE value > 0
          ORDER BY value DESC
          LIMIT 20
        `;
        assertReadOnlySql(errorsQuery);
        const eRes = await client.query({
          query: errorsQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 6 },
        });
        const rawRows = (await eRes.json()) as Array<Record<string, unknown>>;
        return rawRows.map((r) => ({
          name: String(r.name || ''),
          code: Number(r.code ?? 0),
          error_count: Number(r.error_count ?? 0),
          last_error_message: String(r.last_error_message || ''),
          last_error_time: String(r.last_error_time || ''),
        }));
      })(),

      // system.replication_queue (database-scoped)
      (async () => {
        const repQueueQuery = `
          SELECT database, table, node_name, type, create_time, num_tries, last_exception
          FROM system.replication_queue
          WHERE database = '${database.replace(/'/g, "\\'")}'
        `;
        assertReadOnlySql(repQueueQuery);
        const rqRes = await client.query({
          query: repQueueQuery,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 8 },
        });
        const rawRows = (await rqRes.json()) as Array<Record<string, unknown>>;
        return rawRows.map((r) => ({
          database: String(r.database || ''),
          table: String(r.table || ''),
          node_name: String(r.node_name || ''),
          type: String(r.type || ''),
          create_time: String(r.create_time || ''),
          num_tries: Number(r.num_tries ?? 0),
          last_exception: String(r.last_exception || ''),
        }));
      })(),
    ]);

    // Apply settled results with isolated per-query degradation
    if (partsSettled.status === 'fulfilled') {
      partsData = partsSettled.value;
    }
    if (columnsSettled.status === 'fulfilled') {
      colData = columnsSettled.value;
    }
    if (skippingIndicesSettled.status === 'fulfilled') {
      skipData = skippingIndicesSettled.value;
    }
    if (queryLogSettled.status === 'fulfilled') {
      queryStats = queryLogSettled.value;
      queryLogAvailable = true;
    } else {
      queryLogAvailable = false;
    }
    if (replicasSettled.status === 'fulfilled') {
      replicasData = replicasSettled.value;
    }
    if (distQueueSettled.status === 'fulfilled') {
      distQueueData = distQueueSettled.value;
    }
    if (settingsSettled.status === 'fulfilled') {
      settingsData = settingsSettled.value;
    }
    if (mutationsSettled.status === 'fulfilled') {
      mutationsData = mutationsSettled.value;
    }
    if (disksSettled.status === 'fulfilled') {
      disksData = disksSettled.value;
    }
    if (errorsSettled.status === 'fulfilled') {
      errorsData = errorsSettled.value;
    }
    if (replicationQueueSettled.status === 'fulfilled') {
      repQueueData = replicationQueueSettled.value;
    }

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

    // --- EVALUATE DETERMINISTIC RULES ---

    // 1. Part Health Checks
    for (const [tableName, partInfo] of partsMap.entries()) {
      const activeParts = Number(partInfo.active_parts || 0);
      const tinyParts = Number(partInfo.tiny_parts_count || 0);
      const tinyRatio = activeParts > 0 ? tinyParts / activeParts : 0;

      if (activeParts > 150) {
        findings.push({
          id: `parts_count_${tableName}`,
          category: 'part_health',
          category_name: 'Part Health & Compaction',
          title: `Excessive active parts on table '${tableName}'`,
          table: tableName,
          status: 'critical',
          metric_value: `${activeParts} active parts`,
          threshold: 'Threshold: ≤ 150 parts per table',
          evidence: `Table '${tableName}' has ${activeParts} active unmerged parts (ClickHouse default starts delaying inserts at 150 and throws errors at 300).`,
          impact: 'High active part counts spike query memory, degrade vector read speed, and risk ClickHouse "Too many parts in all data parts in table" fatal insert rejection.',
          recommendation_sql_or_text: `-- Batch your inserts into chunks of 10,000-100,000 rows rather than streaming single-row inserts.\n-- To inspect pending merges:\nSELECT table, elapsed, progress, num_parts FROM system.merges WHERE table = '${tableName}';`,
          is_sql_recommendation: true,
        });
      } else if (activeParts > 80) {
        findings.push({
          id: `parts_count_${tableName}`,
          category: 'part_health',
          category_name: 'Part Health & Compaction',
          title: `Elevated active parts count on '${tableName}'`,
          table: tableName,
          status: 'warning',
          metric_value: `${activeParts} active parts`,
          threshold: 'Threshold: ≤ 80 parts per table',
          evidence: `Table '${tableName}' has ${activeParts} active parts. Background merge operations may be lagging behind incoming insert rates.`,
          impact: `Queries against this table must open and decompress data streams from ${activeParts} separate part directories.`,
          recommendation_sql_or_text: `-- Check background merge velocity and memory consumption:\nSELECT table, count() as active_merges, sum(bytes_read_uncompressed) as total_read FROM system.merges WHERE table = '${tableName}' GROUP BY table;`,
          is_sql_recommendation: true,
        });
      } else {
        findings.push({
          id: `parts_count_${tableName}`,
          category: 'part_health',
          category_name: 'Part Health & Compaction',
          title: `Part count within healthy parameters for '${tableName}'`,
          table: tableName,
          status: 'good',
          metric_value: `${activeParts} active parts`,
          threshold: 'Threshold: ≤ 80 parts per table',
          evidence: `${activeParts} active parts well below throttle threshold. Background merges are keeping pace with mutations.`,
          impact: 'Minimal disk seek overhead during primary key scans.',
          recommendation_sql_or_text: 'Current batching frequency is healthy. Maintain batch inserts of >= 10k rows.',
          is_sql_recommendation: false,
        });
      }

      if (activeParts > 40 && tinyRatio > 0.5) {
        findings.push({
          id: `tiny_parts_${tableName}`,
          category: 'part_health',
          category_name: 'Part Health & Compaction',
          title: `Micro-batching detected on '${tableName}' (${Math.round(tinyRatio * 100)}% tiny parts)`,
          table: tableName,
          status: 'warning',
          metric_value: `${tinyParts} of ${activeParts} parts are < 1MB`,
          threshold: 'Threshold: < 30% parts under 1MB',
          evidence: `${tinyParts} out of ${activeParts} active parts are under 1MB in size. Average part size is ${formatBytes(Number(partInfo.avg_part_size || 0))}.`,
          impact: 'Micro-batching causes write amplification. ClickHouse must repeatedly rewrite the same records in recursive merge levels.',
          recommendation_sql_or_text: `-- Introduce a client-side buffer (e.g., Vector, Kafka engine, or async_insert):\n-- If using ClickHouse 21.11+, consider enabling asynchronous inserts on the user/session:\nSET async_insert = 1;\nSET wait_for_async_insert = 1;`,
          is_sql_recommendation: true,
        });
      }
    }

    // 2. Primary Key / ORDER BY effectiveness
    for (const t of tablesData) {
      const totalRows = Number(t.total_rows || 0);
      const sortingKey = t.sorting_key?.trim() || '';

      if (totalRows > 100000 && (!sortingKey || sortingKey === 'tuple()')) {
        findings.push({
          id: `empty_orderby_${t.name}`,
          category: 'primary_key',
          category_name: 'Primary Key & Sorting',
          title: `Empty ORDER BY key on large table '${t.name}'`,
          table: t.name,
          status: 'critical',
          metric_value: 'ORDER BY tuple()',
          threshold: 'Threshold: Non-empty ORDER BY required for tables > 100k rows',
          evidence: `Table '${t.name}' contains ${totalRows.toLocaleString()} rows with an empty sorting key 'tuple()'.`,
          impact: 'No primary index is generated. Every SELECT statement with a WHERE filter on this table will execute an expensive full table scan across all blocks.',
          recommendation_sql_or_text: `-- Recreate the table with an appropriate ORDER BY (e.g. (tenant_id, event_time, id)):\n-- Note: Changing sorting key requires table migration:\nCREATE TABLE ${t.name}_new (...)\nENGINE = MergeTree()\nORDER BY (date_col, high_filter_id);`,
          is_sql_recommendation: true,
        });
      } else if (totalRows > 500000) {
        // Inspect order of columns in sorting key
        const cols = sortingKey.split(',').map((c) => c.trim());
        if (cols.length > 0) {
          const firstCol = cols[0];
          // Check if first column is known low-cardinality type like Bool or status
          const colMeta = colData.find((c) => c.table === t.name && c.name === firstCol);
          if (colMeta && (colMeta.type.includes('Enum') || colMeta.type.includes('UInt8') || colMeta.type.includes('Bool'))) {
            findings.push({
              id: `low_card_pk_${t.name}`,
              category: 'primary_key',
              category_name: 'Primary Key & Sorting',
              title: `Potential low-cardinality leading column in ORDER BY for '${t.name}'`,
              table: t.name,
              status: 'warning',
              metric_value: `Leading key: ${firstCol} (${colMeta.type})`,
              threshold: 'Threshold: High-filtering cardinality should precede low-cardinality keys',
              evidence: `Leading column '${firstCol}' is of type '${colMeta.type}', which typically exhibits low selectivity.`,
              impact: 'ClickHouse sparse primary index skips data marks most efficiently when the leading columns provide high filtering selectivity or align with range filters.',
              recommendation_sql_or_text: `-- Evaluate moving date/timestamp or tenant ID ahead in the tuple:\n-- ORDER BY (${firstCol}, timestamp) vs ORDER BY (timestamp, ${firstCol}) depending on WHERE clauses.`,
              is_sql_recommendation: true,
            });
          } else {
            findings.push({
              id: `pk_healthy_${t.name}`,
              category: 'primary_key',
              category_name: 'Primary Key & Sorting',
              title: `Primary key configured on '${t.name}'`,
              table: t.name,
              status: 'good',
              metric_value: `ORDER BY (${sortingKey})`,
              threshold: 'Threshold: Valid sorting tuple present',
              evidence: `Table has ${totalRows.toLocaleString()} rows sorted by (${sortingKey}).`,
              impact: 'Enables sparse index block pruning during queries matching sorting key prefix.',
              recommendation_sql_or_text: 'Key structure is effective.',
              is_sql_recommendation: false,
            });
          }
        }
      }
    }

    // 3. Partitioning Strategy
    for (const [tableName, partInfo] of partsMap.entries()) {
      const partitionCount = Number(partInfo.partition_count || 0);
      const totalRows = Number(partInfo.total_rows || 0);
      const compressedBytes = Number(partInfo.compressed_bytes || 0);

      if (partitionCount > 1000) {
        findings.push({
          id: `over_partition_${tableName}`,
          category: 'partitioning',
          category_name: 'Partitioning Strategy',
          title: `Severe over-partitioning on table '${tableName}'`,
          table: tableName,
          status: 'critical',
          metric_value: `${partitionCount} partitions`,
          threshold: 'Threshold: ≤ 1,000 partitions (ideally < 300)',
          evidence: `Table '${tableName}' has ${partitionCount} partitions. Over-partitioning multiplies file descriptors and degrades server restart latency.`,
          impact: 'Over-partitioning wastes RAM in ClickHouse metadata cache, hurts background merges, and can cause server lockup during mutations.',
          recommendation_sql_or_text: `-- Avoid partitioning by high-cardinality expressions like toDate(timestamp) over years or user_id.\n-- Switch to monthly partitioning:\nPARTITION BY toYYYYMM(event_time);`,
          is_sql_recommendation: true,
        });
      } else if (partitionCount > 300) {
        findings.push({
          id: `partition_warning_${tableName}`,
          category: 'partitioning',
          category_name: 'Partitioning Strategy',
          title: `High partition count on table '${tableName}'`,
          table: tableName,
          status: 'warning',
          metric_value: `${partitionCount} partitions`,
          threshold: 'Threshold: ≤ 300 partitions',
          evidence: `Table has ${partitionCount} active partitions. Monitor growth rate if partitioned by daily intervals.`,
          impact: 'Increased filesystem directory traversal times and higher baseline memory footprint.',
          recommendation_sql_or_text: `-- If partitioning by day, consider switching to monthly partitioning if retention spans multiple years:\nPARTITION BY toYYYYMM(created_at);`,
          is_sql_recommendation: true,
        });
      } else if (partitionCount === 1 && totalRows > 15000000 && compressedBytes > 5368709120) {
        findings.push({
          id: `unpartitioned_large_${tableName}`,
          category: 'partitioning',
          category_name: 'Partitioning Strategy',
          title: `Large table '${tableName}' has no partition pruning capability`,
          table: tableName,
          status: 'warning',
          metric_value: `1 partition (${formatBytes(compressedBytes)}, ${totalRows.toLocaleString()} rows)`,
          threshold: 'Threshold: Tables > 15M rows / 5GB benefit from date partitioning',
          evidence: `Table '${tableName}' holds ${formatBytes(compressedBytes)} in a single monolithic partition.`,
          impact: 'Dropping old data requires expensive DELETE mutations instead of instantaneous DROP PARTITION operations. Date range queries cannot prune entire partition directories.',
          recommendation_sql_or_text: `-- Consider partitioning by month to enable fast data lifecycle management:\nPARTITION BY toYYYYMM(timestamp)\n-- This also enables zero-cost drops: ALTER TABLE ${tableName} DROP PARTITION '202301';`,
          is_sql_recommendation: true,
        });
      } else {
        findings.push({
          id: `partition_healthy_${tableName}`,
          category: 'partitioning',
          category_name: 'Partitioning Strategy',
          title: `Partitioning strategy healthy on '${tableName}'`,
          table: tableName,
          status: 'good',
          metric_value: `${partitionCount} partitions`,
          threshold: 'Threshold: ≤ 300 partitions',
          evidence: `${partitionCount} partitions for ${totalRows.toLocaleString()} rows.`,
          impact: 'Well-balanced partition granularity without metadata bloat.',
          recommendation_sql_or_text: 'Partition configuration is optimal.',
          is_sql_recommendation: false,
        });
      }
    }

    // 4. Compression Efficiency
    for (const col of colData) {
      const uncomp = Number(col.data_uncompressed_bytes || 0);
      const comp = Number(col.data_compressed_bytes || 0);
      if (uncomp > 52428800) {
        // > 50MB
        const ratio = comp > 0 ? uncomp / comp : 1;
        const codec = col.compression_codec || 'Default (LZ4)';

        if (ratio < 1.35 && (col.type.includes('String') || col.type.includes('Array'))) {
          findings.push({
            id: `low_compression_${col.table}_${col.name}`,
            category: 'compression',
            category_name: 'Compression & Codecs',
            title: `Suboptimal compression on '${col.table}.${col.name}' (${ratio.toFixed(2)}x)`,
            table: col.table,
            status: 'warning',
            metric_value: `${ratio.toFixed(2)}x compression ratio`,
            threshold: 'Threshold: ≥ 1.5x for String/Array columns',
            evidence: `Column '${col.name}' uses ${formatBytes(uncomp)} uncompressed vs ${formatBytes(comp)} compressed with codec '${codec}'.`,
            impact: 'Suboptimal compression wastes NVMe/EBS disk space and forces queries to read more physical bytes from disk into memory buffers.',
            recommendation_sql_or_text: `-- If values have repeated cardinality, wrap with LowCardinality:\n-- Or apply ZSTD compression for text/JSON payloads:\n-- ALTER TABLE ${col.table} MODIFY COLUMN ${col.name} ${col.type} CODEC(ZSTD(3));`,
            is_sql_recommendation: true,
          });
        }

        // Schema / Data Type Optimization: LowCardinality Candidate
        const isLowCardCandidate =
          col.type === 'String' &&
          !col.type.includes('LowCardinality') &&
          /(?:event_type|status|action|type|category|method|level|country|os|browser|role|platform|state|code|currency|tag|plan)/i.test(
            col.name
          );

        if (isLowCardCandidate && uncomp > 20971520) {
          findings.push({
            id: `lowcard_candidate_${col.table}_${col.name}`,
            category: 'compression',
            category_name: 'Compression & Codecs',
            title: `LowCardinality candidate on '${col.table}.${col.name}' (LowCardinality(String))`,
            table: col.table,
            status: 'warning',
            metric_value: `String (estimated low cardinality domain)`,
            threshold: 'Threshold: Categorical string columns benefit from LowCardinality dictionary encoding',
            evidence: `Column '${col.name}' is type String using ${formatBytes(uncomp)} uncompressed (${formatBytes(comp)} compressed). Column name indicates repetitive categorical domain values. Dictionary indexing yields ~70% storage compaction.`,
            impact: 'Storing uncompressed repeating strings without dictionary encoding wastes storage and slows down string lookups.',
            recommendation_sql_or_text: `ALTER TABLE ${col.table} MODIFY COLUMN ${col.name} LowCardinality(String);`,
            is_sql_recommendation: true,
          });
        }

        // Schema / Data Type Optimization: Numeric Type Narrowing (Int64/UInt64 on bounded columns)
        const isNumericNarrowingCandidate =
          (col.type === 'Int64' || col.type === 'UInt64') &&
          /(?:status_code|http_status|year|month|day|port|retry_count|priority|version_major|duration_ms)/i.test(
            col.name
          );

        if (isNumericNarrowingCandidate && comp > 10485760) {
          const targetType = col.type === 'Int64' ? 'Int32' : 'UInt32';
          findings.push({
            id: `numeric_narrowing_${col.table}_${col.name}`,
            category: 'compression',
            category_name: 'Compression & Codecs',
            title: `Oversized integer type on '${col.table}.${col.name}' (${col.type} → ${targetType})`,
            table: col.table,
            status: 'warning',
            metric_value: `Current type: ${col.type} (8 bytes/val)`,
            threshold: 'Threshold: Value ranges within 32-bit limits should use 32-bit types',
            evidence: `Column '${col.name}' uses ${col.type} (8 bytes/value) across ${formatBytes(comp)} compressed storage. Bounded domain fits within 32-bit range. Halving raw type width yields ~40% net compressed storage compaction.`,
            impact: '64-bit integer width for bounded data wastes 50% raw storage and increases memory bandwidth overhead.',
            recommendation_sql_or_text: `ALTER TABLE ${col.table} MODIFY COLUMN ${col.name} ${targetType};`,
            is_sql_recommendation: true,
          });
        }

        // Schema / Data Type Optimization: Date/DateTime Candidate
        const isDateCandidate =
          col.type === 'String' &&
          /(?:created_at|updated_at|timestamp|event_time|event_date|log_time|date_str)/i.test(col.name);

        if (isDateCandidate && uncomp > 10485760) {
          const isDateOnly = /date/i.test(col.name) && !/time/i.test(col.name);
          const targetType = isDateOnly ? 'Date' : 'DateTime';
          findings.push({
            id: `date_type_candidate_${col.table}_${col.name}`,
            category: 'compression',
            category_name: 'Compression & Codecs',
            title: `String temporal column on '${col.table}.${col.name}' (String → ${targetType})`,
            table: col.table,
            status: 'warning',
            metric_value: `Type: String (${formatBytes(uncomp)})`,
            threshold: `Threshold: Temporal values should use native ${targetType}`,
            evidence: `Temporal column '${col.name}' is stored as generic String (${formatBytes(uncomp)} uncompressed). Native ClickHouse ${targetType} uses ${isDateOnly ? '2 bytes' : '4 bytes'} vs 10-19 bytes for string format (~60% compressed savings).`,
            impact: 'Generic String dates prevent partition pruning, date-interval arithmetic, and waste ~60% storage.',
            recommendation_sql_or_text: `ALTER TABLE ${col.table} MODIFY COLUMN ${col.name} ${targetType};`,
            is_sql_recommendation: true,
          });
        }
      }
    }

    // 5. Table Engine Sanity
    for (const t of tablesData) {
      const rows = Number(t.total_rows || 0);
      const isMergeTree = t.engine.toLowerCase().includes('mergetree');

      if (!isMergeTree && rows > 50000) {
        findings.push({
          id: `engine_sanity_${t.name}`,
          category: 'table_engine',
          category_name: 'Table Engine Sanity',
          title: `Non-MergeTree engine used for analytical table '${t.name}'`,
          table: t.name,
          status: 'critical',
          metric_value: `Engine: ${t.engine}`,
          threshold: 'Threshold: Tables > 50k rows should use MergeTree-family',
          evidence: `Table '${t.name}' contains ${rows.toLocaleString()} rows using engine '${t.engine}'.`,
          impact: 'Non-MergeTree engines (such as Log, TinyLog, or Memory) do not support sparse primary indexes, data skipping indexes, parallel multithreaded scans, or column-level compression.',
          recommendation_sql_or_text: `-- Migrate table to MergeTree engine:\nCREATE TABLE ${t.name}_mergetree AS ${t.name}\nENGINE = MergeTree()\nORDER BY (primary_id);`,
          is_sql_recommendation: true,
        });
      } else if (isMergeTree) {
        findings.push({
          id: `engine_healthy_${t.name}`,
          category: 'table_engine',
          category_name: 'Table Engine Sanity',
          title: `MergeTree-family engine utilized for '${t.name}'`,
          table: t.name,
          status: 'good',
          metric_value: `Engine: ${t.engine}`,
          threshold: 'Threshold: MergeTree-family',
          evidence: `Table '${t.name}' runs on '${t.engine}', enabling parallel reads, column compression, and sparse indexing.`,
          impact: 'Optimal engine architecture for analytical OLAP workloads.',
          recommendation_sql_or_text: 'Engine choice is correct.',
          is_sql_recommendation: false,
        });
      }
    }

    // 6. Skip Indexes
    for (const t of tablesData) {
      const rows = Number(t.total_rows || 0);
      const count = skipIndicesMap.get(t.name) || 0;
      if (rows > 1000000 && count === 0) {
        findings.push({
          id: `missing_skip_idx_${t.name}`,
          category: 'skip_indices',
          category_name: 'Data Skipping Indices',
          title: `Large table '${t.name}' has 0 secondary data skipping indices`,
          table: t.name,
          status: 'warning',
          metric_value: '0 skip indices configured',
          threshold: 'Threshold: Tables > 1M rows with high-cardinality filters benefit from skip indices',
          evidence: `Table contains ${rows.toLocaleString()} rows but has no minmax, set, or bloom_filter indices defined in system.data_skipping_indices.`,
          impact: 'Queries filtering on non-primary-key columns must scan all granules in the table.',
          recommendation_sql_or_text: `-- Example: Add a bloom filter or minmax index on frequently filtered secondary column:\n-- ALTER TABLE ${t.name} ADD INDEX idx_user_id user_id TYPE bloom_filter(0.01) GRANULARITY 4;`,
          is_sql_recommendation: true,
        });
      } else if (count > 0) {
        findings.push({
          id: `skip_idx_present_${t.name}`,
          category: 'skip_indices',
          category_name: 'Data Skipping Indices',
          title: `Data skipping indices active on '${t.name}'`,
          table: t.name,
          status: 'good',
          metric_value: `${count} skip index(es)`,
          threshold: 'Threshold: Indices configured',
          evidence: `${count} secondary data skipping index(es) configured on '${t.name}'.`,
          impact: 'Granules can be pruned before reading full column files.',
          recommendation_sql_or_text: 'Secondary index coverage verified.',
          is_sql_recommendation: false,
        });
      }
    }

    // 7. Query Performance (system.query_log)
    if (queryLogAvailable && queryStats.length > 0) {
      const highRatioQueries = queryStats.filter((q) => Number(q.ratio || 0) > 5000 && Number(q.read_rows || 0) > 200000);
      if (highRatioQueries.length > 0) {
        const worst = highRatioQueries[0];
        findings.push({
          id: 'query_poor_pruning',
          category: 'query_performance',
          category_name: 'Query Performance & Pruning',
          title: 'High scan-to-result row ratio detected in query_log',
          status: 'critical',
          metric_value: `${Number(worst.ratio).toLocaleString()}x read amplification`,
          threshold: 'Threshold: Scanned / returned ratio < 1,000x for point/filter queries',
          evidence: `Query read ${Number(worst.read_rows).toLocaleString()} rows (${formatBytes(Number(worst.read_bytes))}) to return only ${Number(worst.result_rows)} rows.\nSample query: ${worst.query.slice(0, 140)}...`,
          impact: 'Full table scanning due to unindexed WHERE conditions burns memory bandwidth and evicts cached blocks.',
          recommendation_sql_or_text: `-- Inspect query EXPLAIN output to verify index pruning:\nEXPLAIN indexes = 1\n${worst.query};`,
          is_sql_recommendation: true,
        });
      }

      const slowQueries = queryStats.filter((q) => Number(q.query_duration_ms) > durationThresholdMs);
      if (slowQueries.length > 0) {
        findings.push({
          id: 'slow_queries_detected',
          category: 'query_performance',
          category_name: 'Query Performance & Pruning',
          title: `${slowQueries.length} query patterns exceeded ${durationThresholdMs}ms latency threshold`,
          status: 'warning',
          metric_value: `Worst duration: ${(Number(slowQueries[0].query_duration_ms) / 1000).toFixed(2)}s`,
          threshold: `Threshold: ≤ ${durationThresholdMs}ms`,
          evidence: `Slowest query took ${(Number(slowQueries[0].query_duration_ms) / 1000).toFixed(2)} seconds and consumed ${formatBytes(Number(slowQueries[0].memory_usage))}.`,
          impact: 'Slow analytical queries hold thread slots and block concurrent read queues.',
          recommendation_sql_or_text: `-- For repeating aggregated queries, consider building a Materialized View with SummingMergeTree or AggregatingMergeTree:\n-- CREATE MATERIALIZED VIEW mv_summary TO summary_table AS SELECT ... GROUP BY ...;`,
          is_sql_recommendation: true,
        });
      }
    } else {
      findings.push({
        id: 'query_log_status',
        category: 'query_performance',
        category_name: 'Query Performance & Pruning',
        title: queryLogAvailable ? 'Query log activity within standard bounds' : 'Query log not accessible or currently empty',
        status: 'good',
        metric_value: `${queryStats.length} queries sampled`,
        threshold: 'Threshold: Active inspection',
        evidence: queryLogAvailable ? 'No runaway full scans exceeding threshold recorded in recent query_log.' : 'User permissions did not permit reading system.query_log or log_queries is disabled.',
        impact: 'Query execution pipeline is responsive.',
        recommendation_sql_or_text: 'Ensure system.query_log is retained for at least 7 days for analytical monitoring.',
        is_sql_recommendation: false,
      });
    }

    // 8. Replication & Distributed Health
    if (replicasData.length > 0) {
      for (const r of replicasData) {
        if (Number(r.is_readonly) === 1) {
          findings.push({
            id: `replica_readonly_${r.table}`,
            category: 'replication_distributed',
            category_name: 'Replication & Distributed Backlog',
            title: `Replica is in READ-ONLY mode for table '${r.table}'`,
            table: r.table,
            status: 'critical',
            metric_value: 'is_readonly = 1',
            threshold: 'Threshold: is_readonly = 0',
            evidence: `system.replicas reports table '${r.table}' is readonly. ZooKeeper/ClickHouse Keeper connection dropped or disk full.`,
            impact: 'Mutations, inserts, and merges are halted on this replica.',
            recommendation_sql_or_text: `-- Check Keeper cluster status and disk space:\nSELECT * FROM system.zookeeper WHERE path = '/clickhouse' LIMIT 5;\nSELECT * FROM system.disks;`,
            is_sql_recommendation: true,
          });
        }
        if (Number(r.queue_size) > 20) {
          findings.push({
            id: `replica_queue_${r.table}`,
            category: 'replication_distributed',
            category_name: 'Replication & Distributed Backlog',
            title: `Replication queue backlog on '${r.table}'`,
            table: r.table,
            status: 'warning',
            metric_value: `Queue size: ${r.queue_size}`,
            threshold: 'Threshold: ≤ 20 queued tasks',
            evidence: `Replication queue has ${r.queue_size} pending items with absolute delay of ${r.absolute_delay}s.`,
            impact: 'Follower replica is serving stale data to distributed queries.',
            recommendation_sql_or_text: `-- Inspect replication queue errors:\nSELECT type, num_tries, last_exception FROM system.replication_queue WHERE table = '${r.table}' ORDER BY create_time DESC LIMIT 10;`,
            is_sql_recommendation: true,
          });
        }
      }
    } else {
      findings.push({
        id: 'replication_status',
        category: 'replication_distributed',
        category_name: 'Replication & Distributed Backlog',
        title: 'Replication health verified (or standalone instance)',
        status: 'good',
        metric_value: 'No replication backlog',
        threshold: 'Threshold: Clean queues',
        evidence: 'No active replication stalls or read-only replica states detected in system.replicas.',
        impact: 'High write availability.',
        recommendation_sql_or_text: 'Replication state is normal.',
        is_sql_recommendation: false,
      });
    }

    if (distQueueData.length > 0) {
      for (const dq of distQueueData) {
        if (dq.error_count > 0 || dq.is_blocked === 1) {
          findings.push({
            id: `dist_queue_error_${dq.table}`,
            category: 'replication_distributed',
            category_name: 'Replication & Distributed Backlog',
            title: `Distributed insert queue error/blocked on '${dq.table}'`,
            table: dq.table,
            status: 'warning',
            metric_value: `Errors: ${dq.error_count}, Blocked: ${dq.is_blocked}`,
            threshold: 'Threshold: error_count = 0, is_blocked = 0',
            evidence: `system.distribution_queue reported ${dq.error_count} errors and ${dq.files_to_send} pending files (${formatBytes(dq.bytes_to_send)}) for distributed table '${dq.table}'.`,
            impact: 'Async inserts across distributed remote shards are failing or stalled.',
            recommendation_sql_or_text: `-- Check distributed queue status:\nSELECT * FROM system.distribution_queue WHERE table = '${dq.table}';\n-- Inspect network latency to remote shards.`,
            is_sql_recommendation: true,
          });
        }
      }
    }

    // 9. Server Settings Sanity
    const maxMemSetting = settingsData.find((s) => s.name === 'max_memory_usage');
    if (maxMemSetting) {
      const maxMemBytes = Number(maxMemSetting.value);
      if (maxMemBytes > 0 && maxMemBytes < 4294967296) {
        // < 4GB
        findings.push({
          id: 'low_max_memory_usage',
          category: 'server_settings',
          category_name: 'Server & MergeTree Settings',
          title: `Restrictive 'max_memory_usage' setting (${formatBytes(maxMemBytes)})`,
          status: 'warning',
          metric_value: `max_memory_usage = ${formatBytes(maxMemBytes)}`,
          threshold: 'Threshold: ≥ 8GB recommended for analytical aggregation',
          evidence: `Current max_memory_usage per query is set to ${formatBytes(maxMemBytes)}. Analytical queries with large hash tables for GROUP BY may abort with MEMORY_LIMIT_EXCEEDED.`,
          impact: 'Complex JOINs, array aggregations, and window functions will be terminated prematurely.',
          recommendation_sql_or_text: `-- Update user profile settings or query session:\nSET max_memory_usage = 10000000000; -- 10 GB`,
          is_sql_recommendation: true,
        });
      } else {
        findings.push({
          id: 'server_settings_healthy',
          category: 'server_settings',
          category_name: 'Server & MergeTree Settings',
          title: 'Memory and thread settings within operational limits',
          status: 'good',
          metric_value: maxMemBytes > 0 ? `max_memory = ${formatBytes(maxMemBytes)}` : 'Default configuration',
          threshold: 'Threshold: Adequate memory ceilings',
          evidence: 'Core query memory and background thread settings align with analytical sizing recommendations.',
          impact: 'Balanced resource allocation across concurrent queries.',
          recommendation_sql_or_text: 'Server settings are configured properly.',
          is_sql_recommendation: false,
        });
      }
    }

    // 10. Mutations Health (system.mutations)
    if (mutationsData !== null) {
      let problemMutationsCount = 0;
      for (const m of mutationsData) {
        const createTimeMs = new Date(m.create_time).getTime();
        const ageHours = !isNaN(createTimeMs) ? Math.max(0, (Date.now() - createTimeMs) / (1000 * 60 * 60)) : 0;
        const hasFailReason = Boolean(m.latest_fail_reason && m.latest_fail_reason.trim() !== '');

        if (hasFailReason) {
          problemMutationsCount++;
          findings.push({
            id: `mutation_fail_${m.table}_${m.mutation_id}`,
            category: 'mutations',
            category_name: 'Table Mutations',
            title: `Mutation repeatedly failing on '${m.table}'`,
            table: m.table,
            status: 'critical',
            metric_value: `Parts to do: ${m.parts_to_do}`,
            threshold: 'Threshold: 0 failing mutations',
            evidence: `Mutation ID '${m.mutation_id}' on table '${m.table}' failed with reason: ${m.latest_fail_reason}.\nCommand: ${m.command} (started: ${m.create_time}, parts remaining: ${m.parts_to_do}).`,
            impact: 'Stuck or failing mutations block subsequent ALTER/UPDATE commands and consume background merge threads.',
            recommendation_sql_or_text: `-- Inspect stuck mutation:\nSELECT * FROM system.mutations WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${m.table.replace(/'/g, "\\'")}';\n-- KILL MUTATION WHERE database = '${database.replace(/'/g, "\\'")}' AND mutation_id = '${m.mutation_id}';`,
            is_sql_recommendation: true,
          });
        } else if (ageHours >= mutationCriticalAgeHours) {
          problemMutationsCount++;
          findings.push({
            id: `mutation_long_${m.table}_${m.mutation_id}`,
            category: 'mutations',
            category_name: 'Table Mutations',
            title: `Critically long-running mutation on '${m.table}' (${ageHours.toFixed(1)}h)`,
            table: m.table,
            status: 'critical',
            metric_value: `${ageHours.toFixed(1)}h runtime`,
            threshold: `Threshold: < ${mutationCriticalAgeHours}h runtime`,
            evidence: `Mutation ID '${m.mutation_id}' has been executing for ${ageHours.toFixed(1)} hours (started: ${m.create_time}).\nParts remaining: ${m.parts_to_do}.\nCommand: ${m.command}`,
            impact: 'Long-running table mutations cause high disk I/O load and keep unmerged parts active across replicas.',
            recommendation_sql_or_text: `-- Check mutation progress in system.mutations:\nSELECT mutation_id, command, parts_to_do, is_done FROM system.mutations WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${m.table.replace(/'/g, "\\'")}';`,
            is_sql_recommendation: true,
          });
        } else if (ageHours >= mutationWarningAgeHours) {
          problemMutationsCount++;
          findings.push({
            id: `mutation_warn_${m.table}_${m.mutation_id}`,
            category: 'mutations',
            category_name: 'Table Mutations',
            title: `Long-running mutation on '${m.table}' (${ageHours.toFixed(1)}h)`,
            table: m.table,
            status: 'warning',
            metric_value: `${ageHours.toFixed(1)}h runtime`,
            threshold: `Threshold: < ${mutationWarningAgeHours}h runtime`,
            evidence: `Mutation ID '${m.mutation_id}' has been executing for ${ageHours.toFixed(1)} hours (started: ${m.create_time}).\nParts remaining: ${m.parts_to_do}.\nCommand: ${m.command}`,
            impact: 'Extended mutation runtimes compete with real-time background merges.',
            recommendation_sql_or_text: `-- Monitor mutation progress:\nSELECT mutation_id, command, parts_to_do, is_done FROM system.mutations WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${m.table.replace(/'/g, "\\'")}';`,
            is_sql_recommendation: true,
          });
        }
      }

      if (problemMutationsCount === 0) {
        findings.push({
          id: 'mutations_healthy',
          category: 'mutations',
          category_name: 'Table Mutations',
          title: 'No stuck or failing mutations',
          status: 'good',
          metric_value: `${mutationsData.length} pending mutations`,
          threshold: `Threshold: 0 failing mutations, max runtime < ${mutationWarningAgeHours}h`,
          evidence: `system.mutations reports 0 failing, stuck, or abnormally long-running mutations for database '${database}'.`,
          impact: 'All table ALTER UPDATE/DELETE mutations are completing cleanly.',
          recommendation_sql_or_text: 'Table mutation pipeline is operating normally.',
          is_sql_recommendation: false,
        });
      }
    }

    // 11. Disk Space & Storage Headroom (system.disks)
    if (disksData !== null && disksData.length > 0) {
      let problemDisksCount = 0;
      let minFreePct = 100;

      for (const d of disksData) {
        const total = Number(d.total_space || 0);
        const free = Number(d.free_space || 0);
        const freePct = total > 0 ? (free / total) * 100 : 100;
        if (freePct < minFreePct) minFreePct = freePct;

        if (freePct < diskCriticalFreePct) {
          problemDisksCount++;
          findings.push({
            id: `disk_space_crit_${d.name}`,
            category: 'disk_space',
            category_name: 'Disk Space & Storage',
            title: `Disk '${d.name}' critically low on space (${freePct.toFixed(1)}% free)`,
            status: 'critical',
            metric_value: `${freePct.toFixed(1)}% free (${formatBytes(free)} / ${formatBytes(total)})`,
            threshold: `Threshold: ≥ ${diskCriticalFreePct}% free space`,
            evidence: `Storage volume '${d.name}' at path '${d.path}' has only ${formatBytes(free)} available out of ${formatBytes(total)} (${freePct.toFixed(1)}% free).`,
            impact: 'ClickHouse will reject incoming inserts and halt background merges with "No space left on device" when volume is full.',
            recommendation_sql_or_text: `-- Inspect largest partitions across active parts:\nSELECT table, partition, formatReadableSize(sum(bytes_on_disk)) AS size FROM system.parts WHERE active = 1 GROUP BY table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 10;\n-- Drop or detach historical partitions if applicable.`,
            is_sql_recommendation: true,
          });
        } else if (freePct < diskWarningFreePct) {
          problemDisksCount++;
          findings.push({
            id: `disk_space_warn_${d.name}`,
            category: 'disk_space',
            category_name: 'Disk Space & Storage',
            title: `Disk '${d.name}' running low on space (${freePct.toFixed(1)}% free)`,
            status: 'warning',
            metric_value: `${freePct.toFixed(1)}% free (${formatBytes(free)} / ${formatBytes(total)})`,
            threshold: `Threshold: ≥ ${diskWarningFreePct}% free space`,
            evidence: `Storage volume '${d.name}' at path '${d.path}' has ${formatBytes(free)} available out of ${formatBytes(total)} (${freePct.toFixed(1)}% free).`,
            impact: 'Storage volume is nearing capacity. Insufficient headroom can impede large table part compactions.',
            recommendation_sql_or_text: `-- Check largest tables on this storage volume:\nSELECT table, formatReadableSize(sum(bytes_on_disk)) AS size FROM system.parts WHERE active = 1 GROUP BY table ORDER BY sum(bytes_on_disk) DESC LIMIT 10;`,
            is_sql_recommendation: true,
          });
        }
      }

      if (problemDisksCount === 0) {
        findings.push({
          id: 'disks_healthy',
          category: 'disk_space',
          category_name: 'Disk Space & Storage',
          title: 'Adequate disk space across all storage volumes',
          status: 'good',
          metric_value: `All disks healthy (min ${minFreePct.toFixed(1)}% free)`,
          threshold: `Threshold: ≥ ${diskWarningFreePct}% free space`,
          evidence: `All ${disksData.length} storage volumes in system.disks have sufficient headroom (minimum free space is ${minFreePct.toFixed(1)}%).`,
          impact: 'Storage volumes have ample capacity for incoming parts, merges, and temporary sort buffers.',
          recommendation_sql_or_text: 'Disk space headroom is optimal.',
          is_sql_recommendation: false,
        });
      }
    }

    // 12. System Errors & Cluster Stability (system.errors)
    if (errorsData !== null) {
      let problemErrorsCount = 0;
      const windowCutoffMs = Date.now() - errorRecentWindowHours * 60 * 60 * 1000;

      for (const err of errorsData) {
        const errorTimeMs = new Date(err.last_error_time).getTime();
        const isRecent = !isNaN(errorTimeMs) && errorTimeMs >= windowCutoffMs;
        const errCount = Number(err.error_count || 0);

        if (isRecent) {
          if (errCount >= errorCriticalCount) {
            problemErrorsCount++;
            findings.push({
              id: `error_crit_${err.code}`,
              category: 'system_errors',
              category_name: 'System Errors & Stability',
              title: `Elevated ${err.name} errors (${errCount.toLocaleString()} occurrences)`,
              status: 'critical',
              metric_value: `${errCount.toLocaleString()} errors (last: ${err.last_error_time})`,
              threshold: `Threshold: < ${errorCriticalCount} occurrences in past ${errorRecentWindowHours}h`,
              evidence: `Error code ${err.code} (${err.name}) has occurred ${errCount.toLocaleString()} times.\nLast error time: ${err.last_error_time}.\nLast error message: ${err.last_error_message || 'None recorded'}.`,
              impact: 'Recurring critical error spikes indicate cluster instability, memory limits exceeded, or failing application queries.',
              recommendation_sql_or_text: `-- Inspect system.errors for full details on error code ${err.code}:\nSELECT * FROM system.errors WHERE code = ${err.code};\n-- Review server error log for stack traces.`,
              is_sql_recommendation: true,
            });
          } else if (errCount >= errorWarningCount) {
            problemErrorsCount++;
            findings.push({
              id: `error_warn_${err.code}`,
              category: 'system_errors',
              category_name: 'System Errors & Stability',
              title: `Elevated ${err.name} errors (${errCount.toLocaleString()} occurrences)`,
              status: 'warning',
              metric_value: `${errCount.toLocaleString()} errors (last: ${err.last_error_time})`,
              threshold: `Threshold: < ${errorWarningCount} occurrences in past ${errorRecentWindowHours}h`,
              evidence: `Error code ${err.code} (${err.name}) has occurred ${errCount.toLocaleString()} times.\nLast error time: ${err.last_error_time}.\nLast error message: ${err.last_error_message || 'None recorded'}.`,
              impact: `Frequent occurrences of ${err.name} indicate repeated client-side query syntax issues or transient resource constraints.`,
              recommendation_sql_or_text: `-- Inspect error code ${err.code} in system.errors:\nSELECT name, value, last_error_message, last_error_time FROM system.errors WHERE code = ${err.code};`,
              is_sql_recommendation: true,
            });
          }
        }
      }

      if (problemErrorsCount === 0) {
        findings.push({
          id: 'errors_healthy',
          category: 'system_errors',
          category_name: 'System Errors & Stability',
          title: 'Error rates within normal operational thresholds',
          status: 'good',
          metric_value: '0 elevated error spikes',
          threshold: `Threshold: < ${errorWarningCount} errors in past ${errorRecentWindowHours}h`,
          evidence: `system.errors reported no recurring error codes exceeding ${errorWarningCount} occurrences within the last ${errorRecentWindowHours} hours.`,
          impact: 'Server error pipeline is quiet and queries execute reliably.',
          recommendation_sql_or_text: 'System error frequency is optimal.',
          is_sql_recommendation: false,
        });
      }
    }

    // 13. Replication Queue Backlog (system.replication_queue)
    // Degrades gracefully on single node / non-replicated setups (skips if not replicated or table inaccessible)
    if (repQueueData !== null && (replicasData.length > 0 || repQueueData.length > 0)) {
      let problemQueueCount = 0;

      // Check repeatedly failing queue entries with exceptions
      for (const rq of repQueueData) {
        const tries = Number(rq.num_tries || 0);
        const hasException = Boolean(rq.last_exception && rq.last_exception.trim() !== '');

        if (tries >= repQueueMaxRetries && hasException) {
          problemQueueCount++;
          findings.push({
            id: `rep_queue_fail_${rq.table}_${rq.node_name}`,
            category: 'replication_queue',
            category_name: 'Replication Queue & Retries',
            title: `Replication queue entry repeatedly failing on '${rq.table}'`,
            table: rq.table,
            status: 'critical',
            metric_value: `${tries} retries`,
            threshold: `Threshold: < ${repQueueMaxRetries} retries with 0 exceptions`,
            evidence: `Replication action '${rq.type}' on node '${rq.node_name}' has failed ${tries} times (created: ${rq.create_time}).\nException: ${rq.last_exception}`,
            impact: 'Failed replication queue tasks block subsequent part syncs, leading to replica divergence and stale queries.',
            recommendation_sql_or_text: `-- Inspect stuck task in replication_queue:\nSELECT type, num_tries, last_exception, create_time FROM system.replication_queue WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${rq.table.replace(/'/g, "\\'")}' ORDER BY num_tries DESC LIMIT 5;`,
            is_sql_recommendation: true,
          });
        }
      }

      // Check queue backlog size grouped by table
      const queueByTable = new Map<string, number>();
      for (const rq of repQueueData) {
        queueByTable.set(rq.table, (queueByTable.get(rq.table) || 0) + 1);
      }

      for (const [tableName, count] of queueByTable.entries()) {
        if (count > repQueueWarningSize) {
          problemQueueCount++;
          findings.push({
            id: `rep_queue_backlog_${tableName}`,
            category: 'replication_queue',
            category_name: 'Replication Queue & Retries',
            title: `Replication queue backlog on '${tableName}'`,
            table: tableName,
            status: 'warning',
            metric_value: `${count} pending tasks`,
            threshold: `Threshold: ≤ ${repQueueWarningSize} tasks`,
            evidence: `Table '${tableName}' has ${count} pending actions in system.replication_queue. Replica synchronization is lagging.`,
            impact: 'High replication backlog delays data visibility on read replicas.',
            recommendation_sql_or_text: `-- Check queue tasks distribution:\nSELECT type, count() FROM system.replication_queue WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${tableName.replace(/'/g, "\\'")}' GROUP BY type;`,
            is_sql_recommendation: true,
          });
        }
      }

      if (problemQueueCount === 0) {
        findings.push({
          id: 'replication_queue_healthy',
          category: 'replication_queue',
          category_name: 'Replication Queue & Retries',
          title: repQueueData.length === 0 ? 'Replication queue is clear' : 'Replication tasks processing normally',
          status: 'good',
          metric_value: `${repQueueData.length} pending tasks`,
          threshold: `Threshold: ≤ ${repQueueWarningSize} tasks, 0 retry failures`,
          evidence: `system.replication_queue has ${repQueueData.length} pending tasks with 0 recurring retry failures.`,
          impact: 'Replicas are keeping pace with part mutations and merges.',
          recommendation_sql_or_text: 'Replication queue is healthy.',
          is_sql_recommendation: false,
        });
      }
    }

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
    const { categories, overall_score, verdict } = calculateScores(findings);

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

// Built-in Demo / Simulation Dataset representing a realistic production ClickHouse cluster with intentional anti-patterns
export function runSimulationScan(): AnalysisReport {
  const findings: CheckFinding[] = [
    // 1. Part Health
    {
      id: 'parts_count_events_raw',
      category: 'part_health',
      category_name: 'Part Health & Compaction',
      title: "Excessive active parts on table 'events_raw'",
      table: 'events_raw',
      status: 'critical',
      metric_value: '428 active parts',
      threshold: 'Threshold: ≤ 150 parts per table',
      evidence: "Table 'events_raw' has 428 active unmerged parts. ClickHouse default starts delaying inserts at 150 parts and will throw 'Too many parts' exception at 300 parts.",
      impact: 'Micro-insert pattern is outpacing background merge threads. Query read amplification is at 428x part directory traversals.',
      recommendation_sql_or_text: `-- Batch your inserts into chunks of at least 10,000 to 100,000 rows.\n-- Or enable async_insert on the client connection:\nSET async_insert = 1;\nSET wait_for_async_insert = 0;`,
      is_sql_recommendation: true,
    },
    {
      id: 'tiny_parts_telemetry_stream',
      category: 'part_health',
      category_name: 'Part Health & Compaction',
      title: "Severe micro-batching on 'telemetry_stream' (78% tiny parts)",
      table: 'telemetry_stream',
      status: 'warning',
      metric_value: '185 of 237 parts are < 1MB',
      threshold: 'Threshold: < 30% parts under 1MB',
      evidence: '185 out of 237 active parts are under 1MB in size. Average part size is 412 KB.',
      impact: 'Frequent small writes create high write amplification as background merges must repeatedly rewrite identical rows across merge tree generations.',
      recommendation_sql_or_text: `-- Implement an ingestion buffer (e.g. Kafka Engine or vector collector) to aggregate events before flushing to ClickHouse:\n-- Check current active merges:\nSELECT table, elapsed, progress, num_parts FROM system.merges WHERE table = 'telemetry_stream';`,
      is_sql_recommendation: true,
    },
    {
      id: 'parts_healthy_dim_users',
      category: 'part_health',
      category_name: 'Part Health & Compaction',
      title: "Part count optimal on 'dim_users'",
      table: 'dim_users',
      status: 'good',
      metric_value: '12 active parts',
      threshold: 'Threshold: ≤ 80 parts per table',
      evidence: '12 active parts across 1.8M records. Compaction has merged historical parts cleanly.',
      impact: 'Fast partition and granule lookups with low memory overhead.',
      recommendation_sql_or_text: 'No action required.',
      is_sql_recommendation: false,
    },

    // 2. Primary Key / ORDER BY
    {
      id: 'empty_orderby_user_audit_logs',
      category: 'primary_key',
      category_name: 'Primary Key & Sorting',
      title: "Empty ORDER BY key on large table 'user_audit_logs'",
      table: 'user_audit_logs',
      status: 'critical',
      metric_value: 'ORDER BY tuple()',
      threshold: 'Threshold: Non-empty ORDER BY required for tables > 100k rows',
      evidence: "Table 'user_audit_logs' contains 4,850,000 rows with ORDER BY tuple() (no sorting key).",
      impact: 'ClickHouse cannot construct a primary sparse index. Every query with WHERE timestamp > ... or WHERE user_id = ... scans 100% of rows from disk.',
      recommendation_sql_or_text: `-- Migrate table with a compound ORDER BY aligned with top filtering queries:\nCREATE TABLE user_audit_logs_v2 (\n    event_time DateTime,\n    tenant_id UInt32,\n    user_id UInt64,\n    action LowCardinality(String)\n)\nENGINE = MergeTree()\nORDER BY (tenant_id, event_time, user_id);`,
      is_sql_recommendation: true,
    },
    {
      id: 'low_card_pk_billing_invoices',
      category: 'primary_key',
      category_name: 'Primary Key & Sorting',
      title: "Low-cardinality leading column in ORDER BY for 'billing_invoices'",
      table: 'billing_invoices',
      status: 'warning',
      metric_value: 'Leading key: is_paid (UInt8)',
      threshold: 'Threshold: High-filtering cardinality should precede boolean/status flags',
      evidence: "Sorting key is (is_paid, invoice_date, customer_id). The boolean flag 'is_paid' has only 2 distinct values across 2.4M rows.",
      impact: 'Sparse index blocks are partitioned into massive chunks of is_paid=0 and is_paid=1, rendering date-range searches inefficient unless is_paid is explicitly supplied in the WHERE clause.',
      recommendation_sql_or_text: `-- Reorder sorting tuple to prioritize range and tenant filtering:\n-- ORDER BY (customer_id, invoice_date, is_paid)`,
      is_sql_recommendation: true,
    },

    // 3. Partitioning Strategy
    {
      id: 'over_partition_metrics_daily',
      category: 'partitioning',
      category_name: 'Partitioning Strategy',
      title: "Critical over-partitioning on table 'metrics_daily'",
      table: 'metrics_daily',
      status: 'critical',
      metric_value: '1,460 partitions',
      threshold: 'Threshold: ≤ 1,000 partitions (target < 300)',
      evidence: "Table 'metrics_daily' has 1,460 partitions (partitioned by toDate(timestamp) spanning 4 years of daily partitions).",
      impact: 'Each partition maintains dedicated directory handles and active parts. Server restart times and metadata RAM consumption scale directly with partition count.',
      recommendation_sql_or_text: `-- Change partition granularity from daily to monthly:\n-- PARTITION BY toYYYYMM(timestamp)\n-- This will reduce partition count from 1,460 down to 48 partitions!`,
      is_sql_recommendation: true,
    },
    {
      id: 'unpartitioned_large_events_raw',
      category: 'partitioning',
      category_name: 'Partitioning Strategy',
      title: "Monolithic single partition on 28.5M row table 'events_raw'",
      table: 'events_raw',
      status: 'warning',
      metric_value: '1 partition (14.2 GB, 28.5M rows)',
      threshold: 'Threshold: Tables > 15M rows / 5GB benefit from date partitioning',
      evidence: "Table 'events_raw' holds 14.2 GB compressed in a single partition without a partition key.",
      impact: 'Historical data lifecycle retention (TTL drops) cannot utilize instant partition drops and must execute costly row-by-row mutation deletes.',
      recommendation_sql_or_text: `-- Partition by month to enable fast partition dropping:\nPARTITION BY toYYYYMM(event_time);`,
      is_sql_recommendation: true,
    },

    // 4. Compression & Schema Efficiency
    {
      id: 'low_compression_raw_payloads',
      category: 'compression',
      category_name: 'Compression & Codecs',
      title: "Suboptimal compression on 'events_raw.payload_json' (1.18x ratio)",
      table: 'events_raw',
      status: 'warning',
      metric_value: '1.18x compression ratio',
      threshold: 'Threshold: ≥ 1.5x for String/JSON columns',
      evidence: "Column 'payload_json' is 8.4 GB uncompressed, compressed to 7.1 GB using default LZ4. Compression ratio is only 1.18x.",
      impact: 'Significant disk waste and high disk I/O when reading JSON payloads.',
      recommendation_sql_or_text: `-- Apply ZSTD compression (level 3 or 6) for JSON text payloads:\nALTER TABLE events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(3));`,
      is_sql_recommendation: true,
    },
    {
      id: 'lowcard_candidate_events_raw_event_type',
      category: 'compression',
      category_name: 'Compression & Codecs',
      title: "LowCardinality candidate on 'events_raw.event_type' (String → LowCardinality(String))",
      table: 'events_raw',
      status: 'warning',
      metric_value: 'String (Cardinality: 17)',
      threshold: 'Threshold: Distinct values < 10,000 benefit from LowCardinality dictionary encoding',
      evidence: "Column 'event_type' is type String with Cardinality: 17 across 28,500,000 rows. Current size: 38 GB uncompressed (12.4 GB compressed). Replacing repetitive string instances with 1-byte dictionary keys reduces columnar footprint by ~70%.",
      impact: "Storing repeating strings without dictionary encoding wastes storage and slows down string aggregation queries.",
      recommendation_sql_or_text: `ALTER TABLE events_raw MODIFY COLUMN event_type LowCardinality(String);`,
      is_sql_recommendation: true,
    },
    {
      id: 'numeric_narrowing_user_audit_logs_status_code',
      category: 'compression',
      category_name: 'Compression & Codecs',
      title: "Oversized integer type on 'user_audit_logs.status_code' (UInt64 → UInt32)",
      table: 'user_audit_logs',
      status: 'warning',
      metric_value: 'Current type: UInt64 (8 bytes/val)',
      threshold: 'Threshold: Value ranges within 0 to 4.29B should use UInt32 (4 bytes/val)',
      evidence: "Column 'status_code' is stored as UInt64 (8 bytes/value) with current size: 18.2 GB uncompressed (4.8 GB compressed). Observed value range is 100 to 599. Halving the raw width from 8 to 4 bytes yields ~40% net compressed storage compaction.",
      impact: "64-bit integer width for HTTP status codes wastes 50% raw storage and increases memory bandwidth overhead during aggregation.",
      recommendation_sql_or_text: `ALTER TABLE user_audit_logs MODIFY COLUMN status_code UInt32;`,
      is_sql_recommendation: true,
    },
    {
      id: 'date_type_candidate_events_raw_event_date_str',
      category: 'compression',
      category_name: 'Compression & Codecs',
      title: "String representation of date on 'events_raw.event_date_str' (String → Date)",
      table: 'events_raw',
      status: 'warning',
      metric_value: 'Current type: String (10 bytes/val)',
      threshold: 'Threshold: Date strings should be stored as native 2-byte Date',
      evidence: "Column 'event_date_str' is stored as generic String ('YYYY-MM-DD', 10 bytes/value) across 28.5M rows with current size: 285 MB uncompressed (92 MB compressed). Native ClickHouse Date type requires only 2 bytes per row (~60% compressed savings).",
      impact: "String representation prevents binary date-range partition pruning and consumes unnecessary columnar bytes.",
      recommendation_sql_or_text: `ALTER TABLE events_raw MODIFY COLUMN event_date_str Date;`,
      is_sql_recommendation: true,
    },
    {
      id: 'healthy_compression_metrics',
      category: 'compression',
      category_name: 'Compression & Codecs',
      title: "Excellent compression on 'metrics_daily.metric_value' (8.4x ratio)",
      table: 'metrics_daily',
      status: 'good',
      metric_value: '8.4x compression ratio',
      threshold: 'Threshold: ≥ 1.5x',
      evidence: 'Column utilizes DoubleDelta, T64 codecs achieving 8.4x compaction ratio.',
      impact: 'Ultra-low disk footprint and maximum memory bandwidth efficiency.',
      recommendation_sql_or_text: 'Codec configuration is optimal.',
      is_sql_recommendation: false,
    },

    // 5. Table Engine Sanity
    {
      id: 'engine_sanity_session_cache',
      category: 'table_engine',
      category_name: 'Table Engine Sanity',
      title: "Memory engine holding 620,000 rows in 'session_cache'",
      table: 'session_cache',
      status: 'critical',
      metric_value: 'Engine: Memory',
      threshold: 'Threshold: Analytical tables > 50k rows should use MergeTree-family',
      evidence: "Table 'session_cache' contains 620,000 rows (1.8 GB RAM) running on the 'Memory' engine.",
      impact: 'Data is lost entirely upon ClickHouse server restart. Memory tables do not support secondary indexes or column compression.',
      recommendation_sql_or_text: `-- Migrate to MergeTree or EmbeddedRocksDB if key-value lookup is required:\nCREATE TABLE session_cache_mt (\n    session_id UUID,\n    user_id UInt64,\n    last_active DateTime\n)\nENGINE = MergeTree()\nORDER BY session_id;`,
      is_sql_recommendation: true,
    },
    {
      id: 'engine_healthy_events_raw',
      category: 'table_engine',
      category_name: 'Table Engine Sanity',
      title: "ReplicatedReplacingMergeTree engine used on 'events_raw'",
      table: 'events_raw',
      status: 'good',
      metric_value: 'Engine: ReplacingMergeTree',
      threshold: 'Threshold: MergeTree-family',
      evidence: 'Engine supports background deduplication, columnar storage, and multithreaded vectorized execution.',
      impact: 'Production-ready storage layer.',
      recommendation_sql_or_text: 'Engine choice is correct.',
      is_sql_recommendation: false,
    },

    // 6. Skip Indices
    {
      id: 'missing_skip_idx_events_raw',
      category: 'skip_indices',
      category_name: 'Data Skipping Indices',
      title: "Large table 'events_raw' (28.5M rows) has 0 secondary skip indices",
      table: 'events_raw',
      status: 'warning',
      metric_value: '0 skip indices configured',
      threshold: 'Threshold: Tables > 1M rows benefit from secondary skip indices',
      evidence: "Table has 28,500,000 rows but no minmax, set, or bloom filter indices defined in system.data_skipping_indices.",
      impact: "Frequent queries filtering by customer_uuid or event_type (which are not in primary ORDER BY) must scan every granule in the table.",
      recommendation_sql_or_text: `-- Add a bloom filter index on high-value secondary lookup columns:\nALTER TABLE events_raw ADD INDEX idx_cust_uuid customer_uuid TYPE bloom_filter(0.01) GRANULARITY 4;`,
      is_sql_recommendation: true,
    },

    // 7. Query Performance
    {
      id: 'query_poor_pruning_report',
      category: 'query_performance',
      category_name: 'Query Performance & Pruning',
      title: 'High scan-to-result row ratio (342,000x read amplification)',
      table: 'events_raw',
      status: 'critical',
      metric_value: '342,000x read amplification',
      threshold: 'Threshold: Scanned / returned ratio < 1,000x',
      evidence: "Current workload: 847 executions/day, 8.2 sec average duration, 4.8 TB read/day.\nQuery scanned 18,450,000 rows (2.4 GB read) across 4.8 seconds to return only 54 rows.\nQuery: SELECT event_type, count() FROM events_raw WHERE customer_uuid = 'e91b...' GROUP BY event_type",
      impact: 'Lack of skip index or ordering prefix forces full table decompression across all threads, burning ~4.8 TB/day in unindexed scans.',
      recommendation_sql_or_text: `-- Check granule pruning with EXPLAIN:\nEXPLAIN indexes = 1\nSELECT event_type, count() FROM events_raw WHERE customer_uuid = 'e91b...' GROUP BY event_type;`,
      is_sql_recommendation: true,
    },
    {
      id: 'query_mv_candidate',
      category: 'query_performance',
      category_name: 'Query Performance & Pruning',
      title: 'Expensive recurring query identified as Materialized View candidate',
      status: 'warning',
      metric_value: '14.2s execution time (4.2 GB RAM)',
      threshold: 'Threshold: Latency ≤ 3,000ms',
      evidence: 'Query computes hourly aggregation on 28M records 45 times per hour, consuming 18% of aggregate CPU time.',
      impact: 'Redundant real-time aggregation increases server load and increases P99 latency for dashboard users.',
      recommendation_sql_or_text: `-- Pre-aggregate with a Materialized View using SummingMergeTree:\nCREATE MATERIALIZED VIEW mv_hourly_events\nENGINE = SummingMergeTree()\nORDER BY (event_date, event_hour, event_type)\nAS SELECT toDate(event_time) AS event_date, toHour(event_time) AS event_hour, event_type, count() AS total_count\nFROM events_raw GROUP BY event_date, event_hour, event_type;`,
      is_sql_recommendation: true,
    },

    // 8. Replication & Distributed Health
    {
      id: 'replica_queue_events_raw',
      category: 'replication_distributed',
      category_name: 'Replication & Distributed Backlog',
      title: "Replication queue lag on 'events_raw' replica-02",
      table: 'events_raw',
      status: 'warning',
      metric_value: 'Queue size: 48 entries (delay: 94s)',
      threshold: 'Threshold: ≤ 20 queued tasks, delay < 60s',
      evidence: 'Replication queue has 48 pending part fetch tasks with absolute delay of 94 seconds.',
      impact: 'Read queries directed to replica-02 are serving data lagged by over 1.5 minutes.',
      recommendation_sql_or_text: `-- Check replica network and task status:\nSELECT type, num_tries, last_exception FROM system.replication_queue WHERE table = 'events_raw' ORDER BY create_time DESC LIMIT 5;`,
      is_sql_recommendation: true,
    },
    {
      id: 'distribution_queue_healthy',
      category: 'replication_distributed',
      category_name: 'Replication & Distributed Backlog',
      title: 'Distributed async send queues healthy',
      status: 'good',
      metric_value: '0 bytes backlogged',
      threshold: 'Threshold: Backlog < 100MB',
      evidence: 'system.distribution_queue shows 0 pending async insert files across distributed shards.',
      impact: 'Distributed inserts are flushing in real-time.',
      recommendation_sql_or_text: 'Distributed cluster transport is functioning normally.',
      is_sql_recommendation: false,
    },

    // 9. Server Settings Sanity
    {
      id: 'low_max_memory_setting',
      category: 'server_settings',
      category_name: 'Server & MergeTree Settings',
      title: "Low 'max_memory_usage' setting (2.00 GB) for 42 GB database",
      status: 'warning',
      metric_value: 'max_memory_usage = 2 GB',
      threshold: 'Threshold: ≥ 8 GB recommended for analytical aggregations',
      evidence: 'Database contains 42.4 GB uncompressed data across 37M rows, but max_memory_usage per query is constrained to 2.0 GB.',
      impact: 'Queries involving GROUP BY on high-cardinality keys or multi-table JOINs will fail with MEMORY_LIMIT_EXCEEDED exceptions.',
      recommendation_sql_or_text: `-- Increase max_memory_usage in user profile or config.xml / users.xml:\n-- Or override per session:\nSET max_memory_usage = 10737418240; -- 10 GB\nSET max_bytes_before_external_group_by = 5368709120; -- 5 GB spill to disk`,
      is_sql_recommendation: true,
    },

    // 10. Table Mutations
    {
      id: 'mutation_warn_events_raw',
      category: 'mutations',
      category_name: 'Table Mutations',
      title: "Long-running mutation on 'events_raw' (2.4h)",
      table: 'events_raw',
      status: 'warning',
      metric_value: '2.4h runtime (84 parts remaining)',
      threshold: 'Threshold: < 1.0h runtime',
      evidence: "Mutation 'mutation_48291' (UPDATE status = 'archived' WHERE event_time < '2023-01-01') has been running for 2.4 hours across 84 remaining unmerged parts.",
      impact: 'Extended mutation runtimes compete with real-time background merges and elevate disk write amplification.',
      recommendation_sql_or_text: `-- Check mutation progress in system.mutations:\nSELECT mutation_id, command, parts_to_do, is_done FROM system.mutations WHERE table = 'events_raw';`,
      is_sql_recommendation: true,
    },

    // 11. Disk Space & Storage
    {
      id: 'disk_space_healthy_nvme',
      category: 'disk_space',
      category_name: 'Disk Space & Storage',
      title: 'Adequate disk space across all storage volumes',
      status: 'good',
      metric_value: 'All disks healthy (38.4% free on /var/lib/clickhouse)',
      threshold: 'Threshold: ≥ 20.0% free space',
      evidence: 'Primary storage volume default at path /var/lib/clickhouse/ has 384 GB free out of 1.00 TB (38.4% free).',
      impact: 'Storage volumes have ample capacity for incoming parts, background merges, and sorting buffers.',
      recommendation_sql_or_text: 'Disk space headroom is optimal.',
      is_sql_recommendation: false,
    },

    // 12. System Errors & Stability
    {
      id: 'system_errors_healthy',
      category: 'system_errors',
      category_name: 'System Errors & Stability',
      title: 'Error rates within normal operational thresholds',
      status: 'good',
      metric_value: '0 elevated error spikes',
      threshold: 'Threshold: < 100 errors in past 24h',
      evidence: 'system.errors reported no recurring error codes exceeding 100 occurrences within the last 24 hours.',
      impact: 'Server error pipeline is quiet and queries execute reliably.',
      recommendation_sql_or_text: 'System error frequency is optimal.',
      is_sql_recommendation: false,
    },

    // 13. Replication Queue & Retries
    {
      id: 'rep_queue_healthy',
      category: 'replication_queue',
      category_name: 'Replication Queue & Retries',
      title: 'Replication queue is clear',
      status: 'good',
      metric_value: '0 pending tasks',
      threshold: 'Threshold: ≤ 50 tasks, 0 retry failures',
      evidence: 'system.replication_queue has 0 pending tasks with 0 recurring retry failures.',
      impact: 'Replicas are keeping pace with part mutations and merges.',
      recommendation_sql_or_text: 'Replication queue is healthy.',
      is_sql_recommendation: false,
    },
  ];

  const tables: TableMetadata[] = [
    {
      database: 'production',
      name: 'events_raw',
      engine: 'ReplacingMergeTree',
      total_rows: 28500000,
      total_bytes_uncompressed: 31200000000,
      total_bytes_compressed: 14200000000,
      compression_ratio: 2.2,
      active_parts: 428,
      partition_count: 1,
      order_by_key: 'event_time, id',
      partition_key: 'None',
      skip_indices_count: 0,
      findings_count: { critical: 1, warning: 2, good: 1 },
    },
    {
      database: 'production',
      name: 'metrics_daily',
      engine: 'SummingMergeTree',
      total_rows: 3200000,
      total_bytes_uncompressed: 4800000000,
      total_bytes_compressed: 571000000,
      compression_ratio: 8.4,
      active_parts: 42,
      partition_count: 1460,
      order_by_key: 'metric_name, timestamp',
      partition_key: 'toDate(timestamp)',
      skip_indices_count: 1,
      findings_count: { critical: 1, warning: 0, good: 1 },
    },
    {
      database: 'production',
      name: 'user_audit_logs',
      engine: 'MergeTree',
      total_rows: 4850000,
      total_bytes_uncompressed: 3600000000,
      total_bytes_compressed: 1100000000,
      compression_ratio: 3.27,
      active_parts: 28,
      partition_count: 12,
      order_by_key: 'tuple()',
      partition_key: 'toYYYYMM(event_time)',
      skip_indices_count: 0,
      findings_count: { critical: 1, warning: 0, good: 0 },
    },
    {
      database: 'production',
      name: 'billing_invoices',
      engine: 'MergeTree',
      total_rows: 2400000,
      total_bytes_uncompressed: 1800000000,
      total_bytes_compressed: 520000000,
      compression_ratio: 3.46,
      active_parts: 19,
      partition_count: 8,
      order_by_key: 'is_paid, invoice_date, customer_id',
      partition_key: 'toYYYYMM(invoice_date)',
      skip_indices_count: 1,
      findings_count: { critical: 0, warning: 1, good: 0 },
    },
    {
      database: 'production',
      name: 'session_cache',
      engine: 'Memory',
      total_rows: 620000,
      total_bytes_uncompressed: 1800000000,
      total_bytes_compressed: 1800000000,
      compression_ratio: 1.0,
      active_parts: 1,
      partition_count: 1,
      order_by_key: 'None',
      partition_key: 'None',
      skip_indices_count: 0,
      findings_count: { critical: 1, warning: 0, good: 0 },
    },
    {
      database: 'production',
      name: 'dim_users',
      engine: 'MergeTree',
      total_rows: 1800000,
      total_bytes_uncompressed: 920000000,
      total_bytes_compressed: 210000000,
      compression_ratio: 4.38,
      active_parts: 12,
      partition_count: 4,
      order_by_key: 'user_id',
      partition_key: 'toYYYYMM(created_at)',
      skip_indices_count: 1,
      findings_count: { critical: 0, warning: 0, good: 1 },
    },
  ];

  const { categories, overall_score, verdict } = calculateScores(findings);

  return {
    scan_id: `demo_scan_${Date.now()}`,
    timestamp: new Date().toISOString(),
    database_name: 'production (Demo Cluster)',
    clickhouse_version: '24.8.4.13-lts',
    cluster_mode: '2-Shard Replicated Cluster',
    overall_score,
    overall_verdict: verdict,
    is_demo: true,
    summary: {
      total_tables: tables.length,
      total_rows: 41370000,
      total_size_compressed: '18.40 GB',
      total_size_uncompressed: '44.12 GB',
      avg_compression_ratio: '2.40x',
      total_parts: 530,
      total_queries_analyzed: 142,
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
}
