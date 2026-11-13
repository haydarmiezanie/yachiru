import { CheckFinding } from '../../src/types.js';

export interface TableMetaRow {
  database: string;
  name: string;
  engine: string;
  total_rows: number | string;
  total_bytes: number | string;
  sorting_key: string;
  partition_key: string;
}

export interface PartInfoRow {
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

export interface ColumnMetaRow {
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

export interface QueryStatsRow {
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
  database?: string;
}

export interface DistributionQueueRow {
  database: string;
  table: string;
  data_files: number | string;
  data_compressed_bytes: number | string;
  is_blocked: number | string;
}

export interface SettingRow {
  name: string;
  value: string;
  changed: number | string;
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
  latest_failed_part?: string;
}

export interface DiskRow {
  name: string;
  path: string;
  free_space: number;
  total_space: number;
  type?: string;
}

export interface ErrorRow {
  name: string;
  code: number | string;
  value: number | string;
  last_error_time: string;
  last_error_message: string;
}

export interface ReplicationQueueRow {
  database: string;
  table: string;
  node_name?: string;
  type: string;
  create_time: string;
  num_tries: number;
  last_exception: string;
  is_currently_executing?: number;
}

export interface CheckEvaluationContext {
  database: string;
  tablesData: TableMetaRow[];
  partsMap: Map<string, PartInfoRow>;
  colData: ColumnMetaRow[];
  skipData: SkipIndexRow[];
  skipIndicesMap: Map<string, number>;
  skipIndicesAvailable: boolean;
  queryStats: QueryStatsRow[];
  queryLogAvailable: boolean;
  durationThresholdMs: number;
  memoryThresholdBytes: number;
  replicasData: ReplicaRow[];
  distributionData: DistributionQueueRow[];
  replicationAvailable: boolean;
  settingsData: SettingRow[];
  settingsAvailable: boolean;
  mutationsData: MutationRow[];
  mutationsAvailable: boolean;
  mutationWarningAgeHours: number;
  mutationCriticalAgeHours: number;
  disksData: DiskRow[];
  disksAvailable: boolean;
  diskWarningFreePct: number;
  diskCriticalFreePct: number;
  errorsData: ErrorRow[];
  errorsAvailable: boolean;
  errorRecentWindowHours: number;
  errorWarningCount: number;
  errorCriticalCount: number;
  replicationQueueData: ReplicationQueueRow[];
  replicationQueueAvailable: boolean;
  replicationQueueWarningSize: number;
  replicationQueueMaxRetries: number;
}
