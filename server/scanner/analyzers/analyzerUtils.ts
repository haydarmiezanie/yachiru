import { DimensionId } from '../../../src/types/yachiru.js';

export const DIMENSION_METADATA: Record<DimensionId, { name: string; description: string }> = {
  table_engines_partitioning: {
    name: 'Table Engines & Partitioning',
    description: 'Validates MergeTree family choices and partition granularity against data scale',
  },
  parts_and_merges: {
    name: 'Parts Health & Merge Pressure',
    description: 'Monitors active parts count per partition, insert micro-batching, and merge bottlenecks',
  },
  primary_key_and_query_patterns: {
    name: 'Primary Key / ORDER BY vs Real Queries',
    description: 'Correlates query_log WHERE clauses with sorting keys to detect full-scan waste',
  },
  skip_indexes: {
    name: 'Skip Indexes & Secondary Data Skipping',
    description: 'Detects high-frequency filter columns lacking bloom_filter, minmax, or set indices',
  },
  data_types_and_storage: {
    name: 'Data Types, Codecs & Storage Density',
    description: 'Flags Nullable overuse, oversized integers, LowCardinality candidates, and missing ZSTD/Gorilla/Delta codecs',
  },
  ttl_and_tiering: {
    name: 'TTL Policies & Data Lifecycle',
    description: 'Identifies massive timeseries tables lacking automated retention or storage tiering',
  },
  materialized_views_redundant_compute: {
    name: 'Materialized Views & Redundant Compute',
    description: 'Detects high-frequency expensive aggregation queries that should be precomputed',
  },
  resource_and_config: {
    name: 'Resource Allocation & Server Settings',
    description: 'Audits memory limits, background pools, and thread concurrency settings',
  },
  general_query_performance: {
    name: 'Query Bottlenecks & Execution Health',
    description: 'Identifies slowest queries, full-table scans, memory hogs, and exception patterns',
  },
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.max(1, bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + (sizes[i] || 'B');
}

export function formatRows(rows: number): string {
  if (rows >= 1_000_000_000) return `${(rows / 1_000_000_000).toFixed(2)}B`;
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(2)}M`;
  if (rows >= 1_000) return `${(rows / 1_000).toFixed(1)}k`;
  return rows.toString();
}

export function createIdGenerator(dimCode: string, startSeq = 1) {
  let counter = startSeq;
  return () => `FND-${dimCode.toUpperCase().slice(0, 4)}-${String(counter++).padStart(3, '0')}`;
}

/**
 * Inspects table columns to derive actual sorting columns or generate an explicit placeholder comment.
 */
export function deriveSortingKeyOrPlaceholder(table: any, allColumns: any[]): { keySql: string; isPlaceholder: boolean } {
  // If table has sorting_key or primary_key defined, use it
  if (table.sorting_key && table.sorting_key.trim()) {
    return { keySql: table.sorting_key.trim(), isPlaceholder: false };
  }
  if (table.primary_key && table.primary_key.trim()) {
    return { keySql: table.primary_key.trim(), isPlaceholder: false };
  }

  const tableCols = allColumns.filter((c) => c.table === table.name);
  if (tableCols.length === 0) {
    return { keySql: '/* placeholder: specify your leading filter column(s) */ id', isPlaceholder: true };
  }

  // Look for identifier columns (e.g. id, tenant_id, user_id, device_id)
  const idCols = tableCols.filter((c) =>
    c.name.toLowerCase() === 'id' ||
    c.name.toLowerCase().endsWith('_id') ||
    c.name.toLowerCase().endsWith('id') ||
    c.name.toLowerCase().includes('uuid')
  );

  // Look for date/time columns
  const dateCols = tableCols.filter((c) =>
    c.type.includes('Date') ||
    c.type.includes('Time') ||
    c.name.toLowerCase().includes('time') ||
    c.name.toLowerCase().includes('date') ||
    c.name.toLowerCase().includes('created')
  );

  const pickedCols: string[] = [];
  if (idCols.length > 0) {
    pickedCols.push(idCols[0].name);
  }
  if (dateCols.length > 0 && !pickedCols.includes(dateCols[0].name)) {
    pickedCols.push(dateCols[0].name);
  }

  if (pickedCols.length > 0) {
    return { keySql: `(${pickedCols.join(', ')})`, isPlaceholder: false };
  }

  // Fallback to first column with explicit placeholder notice
  const firstCol = tableCols[0]?.name || 'id';
  return {
    keySql: `(/* placeholder: choose columns matching your primary WHERE filter */ ${firstCol})`,
    isPlaceholder: true,
  };
}

/**
 * Inspects table columns to derive date/time partition column or generate explicit placeholder.
 */
export function derivePartitionKeyOrPlaceholder(table: any, allColumns: any[]): { partSql: string; isPlaceholder: boolean } {
  const tableCols = allColumns.filter((c) => c.table === table.name);
  const dateCols = tableCols.filter((c) =>
    c.type.includes('Date') ||
    c.type.includes('Time') ||
    c.name.toLowerCase().includes('time') ||
    c.name.toLowerCase().includes('date') ||
    c.name.toLowerCase().includes('created')
  );

  if (dateCols.length > 0) {
    return { partSql: `toYYYYMM(${dateCols[0].name})`, isPlaceholder: false };
  }

  return {
    partSql: `toYYYYMM(/* placeholder: replace with your DateTime column, e.g. created_at */ timestamp)`,
    isPlaceholder: true,
  };
}

/**
 * Inspects table columns to derive TTL date column or generate explicit placeholder.
 */
export function deriveTtlColumnOrPlaceholder(table: any, allColumns: any[]): { colName: string; isPlaceholder: boolean } {
  const tableCols = allColumns.filter((c) => c.table === table.name);
  const dateCols = tableCols.filter((c) =>
    c.type.includes('Date') ||
    c.type.includes('Time') ||
    c.name.toLowerCase().includes('time') ||
    c.name.toLowerCase().includes('date') ||
    c.name.toLowerCase().includes('created')
  );

  if (dateCols.length > 0) {
    return { colName: dateCols[0].name, isPlaceholder: false };
  }

  return {
    colName: `/* placeholder: date/time column */ timestamp`,
    isPlaceholder: true,
  };
}
