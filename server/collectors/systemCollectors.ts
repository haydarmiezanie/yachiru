import type {
  AnalysisCoverage,
  CategoryCoverageItem,
  CategoryUnavailableReason,
} from '../../src/types.js';
import { assertReadOnlySql, escapeSqlString } from '../sqlUtils.js';

export interface ClickHouseQueryResultSet {
  json<T = unknown>(): Promise<T[]>;
}

export interface ClickHouseQueryExecutor {
  ping(): Promise<{ success: boolean; error?: { message?: string } }>;
  query(params: {
    query: string;
    format?: 'JSONEachRow';
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<ClickHouseQueryResultSet>;
  close?(): Promise<void>;
}

export interface TableRow {
  database: string;
  name: string;
  engine: string;
  total_rows: number | string;
  total_bytes: number | string;
  sorting_key: string;
  partition_key: string;
}

export interface PartRow {
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
}

export interface ColumnRow {
  table: string;
  name: string;
  type: string;
  data_compressed_bytes: number | string;
  data_uncompressed_bytes: number | string;
  compression_codec: string;
}

export interface SkipIndexRow {
  table: string;
  name: string;
  type: string;
  expr: string;
  granularity: number;
}

export interface QueryStatRow {
  normalized_query?: string;
  normalized_query_hash?: string;
  tables?: string[];
  query_duration_ms: number;
  memory_usage: number;
  read_rows: number;
  read_bytes: number;
  result_rows: number;
  ratio: number;
}

export interface ReplicaRow {
  table: string;
  is_readonly: number;
  absolute_delay: number;
  queue_size: number;
}

export interface DistQueueRow {
  table: string;
  bytes_to_send: number;
  files_to_send: number;
  error_count: number;
  is_blocked: number;
}

export interface SettingRow {
  name: string;
  value: string;
  changed: number;
  description: string;
}

export interface MutationRow {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  is_done: number;
  parts_to_do: number;
  latest_fail_reason: string;
}

export interface DiskRow {
  name: string;
  path: string;
  free_space: number;
  total_space: number;
}

export interface ErrorRow {
  name: string;
  code: number;
  error_count: number;
  last_error_message: string;
  last_error_time: string;
}

export interface RepQueueRow {
  database: string;
  table: string;
  node_name: string;
  type: string;
  create_time: string;
  num_tries: number;
  last_exception: string;
}

export interface CollectedSystemTelemetry {
  partsData: PartRow[];
  colData: ColumnRow[];
  columns_truncated: boolean;
  skipData: SkipIndexRow[];
  skipIndicesAvailable: boolean;
  queryStats: QueryStatRow[];
  queryLogAvailable: boolean;
  replicasData: ReplicaRow[];
  replicasAvailable: boolean;
  distQueueData: DistQueueRow[];
  settingsData: SettingRow[];
  settingsAvailable: boolean;
  mutationsData: MutationRow[] | null;
  mutationsAvailable: boolean;
  disksData: DiskRow[] | null;
  disksAvailable: boolean;
  errorsData: ErrorRow[] | null;
  errorsAvailable: boolean;
  repQueueData: RepQueueRow[] | null;
  repQueueAvailable: boolean;
  coverage: AnalysisCoverage;
}

export async function collectParts(executor: ClickHouseQueryExecutor, database: string): Promise<PartRow[]> {
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
    WHERE database = '${escapeSqlString(database)}'
      AND active = 1
    GROUP BY table
  `;
  assertReadOnlySql(partsQuery);
  const partsRes = await executor.query({
    query: partsQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 12 },
  });
  return (await partsRes.json()) as PartRow[];
}

export async function collectColumns(
  executor: ClickHouseQueryExecutor,
  database: string,
  tablesData: TableRow[]
): Promise<ColumnRow[]> {
  if (tablesData.length === 0) {
    return [];
  }
  const tableInList = tablesData.map((t) => `'${escapeSqlString(t.name)}'`).join(', ');
  const colQuery = `
    SELECT
      table,
      name,
      type,
      data_compressed_bytes,
      data_uncompressed_bytes,
      compression_codec
    FROM system.columns
    WHERE database = '${escapeSqlString(database)}'
      AND table IN (${tableInList})
    ORDER BY data_uncompressed_bytes DESC
    LIMIT 10001
  `;
  assertReadOnlySql(colQuery);
  const colRes = await executor.query({
    query: colQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 10 },
  });
  return (await colRes.json()) as ColumnRow[];
}

export async function collectSkippingIndices(
  executor: ClickHouseQueryExecutor,
  database: string
): Promise<SkipIndexRow[]> {
  const skipIdxQuery = `
    SELECT
      table,
      name,
      type,
      expr,
      granularity
    FROM system.data_skipping_indices
    WHERE database = '${escapeSqlString(database)}'
  `;
  assertReadOnlySql(skipIdxQuery);
  const skipRes = await executor.query({
    query: skipIdxQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 8 },
  });
  return (await skipRes.json()) as SkipIndexRow[];
}

export async function collectQueryLog(
  executor: ClickHouseQueryExecutor,
  database: string
): Promise<QueryStatRow[]> {
  const qlogQueryWithNormalize = `
    SELECT
      normalizeQuery(query) AS normalized_query,
      normalized_query_hash,
      tables,
      query_duration_ms,
      memory_usage,
      read_rows,
      read_bytes,
      result_rows,
      round(read_rows / greatest(result_rows, 1), 1) AS ratio
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_date >= today() - 1
      AND arrayExists(tbl -> startsWith(tbl, '${escapeSqlString(database)}.'), tables)
      AND query_kind = 'Select'
      AND NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)
    ORDER BY query_duration_ms DESC
    LIMIT 40
  `;
  assertReadOnlySql(qlogQueryWithNormalize);
  try {
    const qRes = await executor.query({
      query: qlogQueryWithNormalize,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 6 },
    });
    return (await qRes.json()) as QueryStatRow[];
  } catch {
    const qlogQueryFallback = `
      SELECT
        tables,
        query_duration_ms,
        memory_usage,
        read_rows,
        read_bytes,
        result_rows,
        round(read_rows / greatest(result_rows, 1), 1) AS ratio
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND event_date >= today() - 1
        AND arrayExists(tbl -> startsWith(tbl, '${escapeSqlString(database)}.'), tables)
        AND NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)
      ORDER BY query_duration_ms DESC
      LIMIT 40
    `;
    assertReadOnlySql(qlogQueryFallback);
    const qFallbackRes = await executor.query({
      query: qlogQueryFallback,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 6 },
    });
    return (await qFallbackRes.json()) as QueryStatRow[];
  }
}

export async function collectReplicas(executor: ClickHouseQueryExecutor, database: string): Promise<ReplicaRow[]> {
  const repQuery = `
    SELECT
      table,
      is_readonly,
      absolute_delay,
      queue_size
    FROM system.replicas
    WHERE database = '${escapeSqlString(database)}'
  `;
  assertReadOnlySql(repQuery);
  const rRes = await executor.query({
    query: repQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 6 },
  });
  return (await rRes.json()) as ReplicaRow[];
}

export async function collectDistributionQueue(
  executor: ClickHouseQueryExecutor,
  database: string
): Promise<DistQueueRow[]> {
  const distQuery = `
    SELECT *
    FROM system.distribution_queue
    WHERE database = '${escapeSqlString(database)}'
    LIMIT 100
  `;
  assertReadOnlySql(distQuery);
  const dRes = await executor.query({
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
}

export async function collectSettings(executor: ClickHouseQueryExecutor): Promise<SettingRow[]> {
  const setQuery = `
    SELECT name, value, changed, description
    FROM system.settings
    WHERE name IN ('max_memory_usage', 'max_threads', 'max_execution_time', 'parts_to_delay_insert', 'parts_to_throw_insert')
  `;
  assertReadOnlySql(setQuery);
  const sRes = await executor.query({
    query: setQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 6 },
  });
  return (await sRes.json()) as SettingRow[];
}

export async function collectMutations(executor: ClickHouseQueryExecutor, database: string): Promise<MutationRow[]> {
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
    WHERE database = '${escapeSqlString(database)}' AND is_done = 0
  `;
  assertReadOnlySql(mutationsQuery);
  const mRes = await executor.query({
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
}

export async function collectDisks(executor: ClickHouseQueryExecutor): Promise<DiskRow[]> {
  const disksQuery = `
    SELECT name, path, free_space, total_space
    FROM system.disks
  `;
  assertReadOnlySql(disksQuery);
  const dRes = await executor.query({
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
}

export async function collectErrors(executor: ClickHouseQueryExecutor): Promise<ErrorRow[]> {
  const errorsQuery = `
    SELECT name, code, value AS error_count, last_error_message, last_error_time
    FROM system.errors
    WHERE value > 0
    ORDER BY value DESC
    LIMIT 20
  `;
  assertReadOnlySql(errorsQuery);
  const eRes = await executor.query({
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
}

export async function collectReplicationQueue(
  executor: ClickHouseQueryExecutor,
  database: string
): Promise<RepQueueRow[]> {
  const repQueueQuery = `
    SELECT database, table, node_name, type, create_time, num_tries, last_exception
    FROM system.replication_queue
    WHERE database = '${escapeSqlString(database)}'
  `;
  assertReadOnlySql(repQueueQuery);
  const rqRes = await executor.query({
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
}

export function classifySettledError(err: unknown): { reason: CategoryUnavailableReason; detail: string } {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (/ACCESS_DENIED|Not enough privileges|Code: 497|permission denied/i.test(msg)) {
    return { reason: 'permission_denied', detail: 'Missing required SELECT privilege in ClickHouse.' };
  }
  if (/TIMEOUT|timed out|Code: 159|max_execution_time/i.test(msg)) {
    return { reason: 'timeout', detail: 'Query exceeded maximum execution time.' };
  }
  return { reason: 'error', detail: msg };
}

export async function collectAllSystemTelemetry(
  executor: ClickHouseQueryExecutor,
  database: string,
  tablesData: TableRow[]
): Promise<CollectedSystemTelemetry> {
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
    collectParts(executor, database),
    collectColumns(executor, database, tablesData),
    collectSkippingIndices(executor, database),
    collectQueryLog(executor, database),
    collectReplicas(executor, database),
    collectDistributionQueue(executor, database),
    collectSettings(executor),
    collectMutations(executor, database),
    collectDisks(executor),
    collectErrors(executor),
    collectReplicationQueue(executor, database),
  ]);

  const partsData = partsSettled.status === 'fulfilled' ? partsSettled.value : [];

  let columns_truncated = false;
  let colData: ColumnRow[] = [];
  if (columnsSettled.status === 'fulfilled') {
    const rawCols = columnsSettled.value;
    if (rawCols.length > 10000) {
      columns_truncated = true;
      colData = rawCols.slice(0, 10000);
    } else {
      columns_truncated = false;
      colData = rawCols;
    }
  }

  const skipData = skippingIndicesSettled.status === 'fulfilled' ? skippingIndicesSettled.value : [];
  const queryLogAvailable = queryLogSettled.status === 'fulfilled';
  const queryStats = queryLogSettled.status === 'fulfilled' ? queryLogSettled.value : [];
  const replicasData = replicasSettled.status === 'fulfilled' ? replicasSettled.value : [];
  const distQueueData = distQueueSettled.status === 'fulfilled' ? distQueueSettled.value : [];
  const settingsData = settingsSettled.status === 'fulfilled' ? settingsSettled.value : [];
  const mutationsData = mutationsSettled.status === 'fulfilled' ? mutationsSettled.value : null;
  const disksData = disksSettled.status === 'fulfilled' ? disksSettled.value : null;
  const errorsData = errorsSettled.status === 'fulfilled' ? errorsSettled.value : null;
  const repQueueData = replicationQueueSettled.status === 'fulfilled' ? replicationQueueSettled.value : null;

  const hasReplicatedTables = tablesData.some((t) => t.engine.toLowerCase().includes('replicated'));
  const hasDistributedTables = tablesData.some((t) => t.engine.toLowerCase().includes('distributed'));

  const coverageCategories: CategoryCoverageItem[] = [
    partsSettled.status === 'fulfilled'
      ? { id: 'part_health', name: 'Part Health & Compaction', state: 'evaluated' }
      : {
          id: 'part_health',
          name: 'Part Health & Compaction',
          state: 'unavailable',
          ...classifySettledError(partsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.parts TO <username>;',
        },
    partsSettled.status === 'fulfilled'
      ? { id: 'primary_key', name: 'Primary Key & Sorting', state: 'evaluated' }
      : {
          id: 'primary_key',
          name: 'Primary Key & Sorting',
          state: 'unavailable',
          ...classifySettledError(partsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.parts TO <username>;',
        },
    partsSettled.status === 'fulfilled'
      ? { id: 'partitioning', name: 'Partitioning Strategy', state: 'evaluated' }
      : {
          id: 'partitioning',
          name: 'Partitioning Strategy',
          state: 'unavailable',
          ...classifySettledError(partsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.parts TO <username>;',
        },
    columnsSettled.status === 'fulfilled'
      ? { id: 'compression', name: 'Compression & Codecs', state: 'evaluated' }
      : {
          id: 'compression',
          name: 'Compression & Codecs',
          state: 'unavailable',
          ...classifySettledError(columnsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.columns TO <username>;',
        },
    { id: 'table_engine', name: 'Table Engine Sanity', state: 'evaluated' },
    skippingIndicesSettled.status === 'fulfilled'
      ? { id: 'skip_indices', name: 'Data Skipping Indices', state: 'evaluated' }
      : {
          id: 'skip_indices',
          name: 'Data Skipping Indices',
          state: 'unavailable',
          ...classifySettledError(skippingIndicesSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.data_skipping_indices TO <username>;',
        },
    queryLogSettled.status === 'fulfilled'
      ? { id: 'query_performance', name: 'Query Performance & Pruning', state: 'evaluated' }
      : {
          id: 'query_performance',
          name: 'Query Performance & Pruning',
          state: 'unavailable',
          ...classifySettledError(queryLogSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.query_log TO <username>;',
        },
    replicasSettled.status === 'rejected'
      ? {
          id: 'replication_distributed',
          name: 'Replication & Distributed Backlog',
          state: 'unavailable',
          ...classifySettledError(replicasSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.replicas TO <username>;',
        }
      : !hasReplicatedTables && !hasDistributedTables && replicasData.length === 0 && distQueueData.length === 0
      ? {
          id: 'replication_distributed',
          name: 'Replication & Distributed Backlog',
          state: 'not_applicable',
          reason: 'no_replicated_tables',
          detail: 'No ReplicatedMergeTree or Distributed tables present in target database.',
        }
      : { id: 'replication_distributed', name: 'Replication & Distributed Backlog', state: 'evaluated' },
    settingsSettled.status === 'fulfilled'
      ? { id: 'server_settings', name: 'Server & MergeTree Settings', state: 'evaluated' }
      : {
          id: 'server_settings',
          name: 'Server & MergeTree Settings',
          state: 'unavailable',
          ...classifySettledError(settingsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.settings TO <username>;',
        },
    mutationsSettled.status === 'fulfilled'
      ? { id: 'mutations', name: 'Table Mutations', state: 'evaluated' }
      : {
          id: 'mutations',
          name: 'Table Mutations',
          state: 'unavailable',
          ...classifySettledError(mutationsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.mutations TO <username>;',
        },
    disksSettled.status === 'fulfilled'
      ? { id: 'disk_space', name: 'Disk Space & Storage', state: 'evaluated' }
      : {
          id: 'disk_space',
          name: 'Disk Space & Storage',
          state: 'unavailable',
          ...classifySettledError(disksSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.disks TO <username>;',
        },
    errorsSettled.status === 'fulfilled'
      ? { id: 'system_errors', name: 'System Errors & Stability', state: 'evaluated' }
      : {
          id: 'system_errors',
          name: 'System Errors & Stability',
          state: 'unavailable',
          ...classifySettledError(errorsSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.errors TO <username>;',
        },
    replicationQueueSettled.status === 'rejected'
      ? {
          id: 'replication_queue',
          name: 'Replication Queue & Retries',
          state: 'unavailable',
          ...classifySettledError(replicationQueueSettled.reason),
          requiredGrant: 'GRANT SELECT ON system.replication_queue TO <username>;',
        }
      : !hasReplicatedTables && replicasData.length === 0 && (repQueueData === null || repQueueData.length === 0)
      ? {
          id: 'replication_queue',
          name: 'Replication Queue & Retries',
          state: 'not_applicable',
          reason: 'no_replicated_tables',
          detail: 'No ReplicatedMergeTree tables configured in cluster.',
        }
      : { id: 'replication_queue', name: 'Replication Queue & Retries', state: 'evaluated' },
  ];

  const evaluatedCount = coverageCategories.filter((c) => c.state === 'evaluated').length;
  const unavailableCount = coverageCategories.filter((c) => c.state === 'unavailable').length;
  const notApplicableCount = coverageCategories.filter((c) => c.state === 'not_applicable').length;
  const totalCount = coverageCategories.length;
  const applicableCount = totalCount - notApplicableCount;
  const isComplete = unavailableCount === 0 && evaluatedCount === applicableCount;

  const coverage: AnalysisCoverage = {
    categories: coverageCategories,
    evaluatedCount,
    totalCount,
    applicableCount,
    unavailableCount,
    notApplicableCount,
    isComplete,
  };

  return {
    partsData,
    colData,
    columns_truncated,
    skipData,
    skipIndicesAvailable: skippingIndicesSettled.status === 'fulfilled',
    queryStats,
    queryLogAvailable,
    replicasData,
    replicasAvailable: replicasSettled.status === 'fulfilled',
    distQueueData,
    settingsData,
    settingsAvailable: settingsSettled.status === 'fulfilled',
    mutationsData,
    mutationsAvailable: mutationsSettled.status === 'fulfilled',
    disksData,
    disksAvailable: disksSettled.status === 'fulfilled',
    errorsData,
    errorsAvailable: errorsSettled.status === 'fulfilled',
    repQueueData,
    repQueueAvailable: replicationQueueSettled.status === 'fulfilled',
    coverage,
  };
}
