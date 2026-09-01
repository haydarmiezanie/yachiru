import { RawClusterData } from './clickhouseClient.js';
import { DimensionId, DimensionScore, Finding, FindingSeverity } from '../../src/types/yachiru.js';

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

const DIMENSION_METADATA: Record<DimensionId, { name: string; description: string }> = {
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

export function runDeterministicScan(data: RawClusterData): DeterministicScanResult {
  const findings: Finding[] = [];
  let findingCounter = 1;

  const createId = (dim: string) => `FND-${dim.toUpperCase().slice(0, 4)}-${String(findingCounter++).padStart(3, '0')}`;

  // Helper to format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Helper to format rows
  const formatRows = (rows: number) => {
    if (rows >= 1_000_000_000) return `${(rows / 1_000_000_000).toFixed(2)}B`;
    if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(2)}M`;
    if (rows >= 1_000) return `${(rows / 1_000).toFixed(1)}k`;
    return rows.toString();
  };

  // -------------------------------------------------------------
  // 1. Table Engines & Partitioning
  // -------------------------------------------------------------
  for (const table of data.tables) {
    // 1.1 Non-MergeTree in production large tables
    const nonMergeTreeEngines = ['Log', 'TinyLog', 'StripeLog', 'Memory'];
    if (nonMergeTreeEngines.includes(table.engine) && (table.total_rows > 100_000 || table.total_bytes > 50_000_000)) {
      findings.push({
        id: createId('ENG'),
        dimension: 'table_engines_partitioning',
        dimensionName: DIMENSION_METADATA.table_engines_partitioning.name,
        severity: 'critical',
        title: `Non-MergeTree engine '${table.engine}' used on large table '${table.name}'`,
        tableName: table.name,
        what: `Table '${table.name}' uses engine '${table.engine}' with ${formatRows(table.total_rows)} rows (${formatBytes(table.total_bytes)}). The ${table.engine} engine does not support primary keys, indexing, data compression partitioning, or parallel mutations.`,
        whyTechnical: `The Log family engines write data without block compression, do not support indexes, and execute all queries via sequential full-table scans. For production tables exceeding 100k rows, this causes severe query latency and excessive disk I/O.`,
        whyNarrative: `Using a ${table.engine} engine for high-volume data causes every single query to scan the entire dataset from disk without indexes. Migrating to MergeTree will unlock columnar indexing, parallel multi-threaded queries, and 4x-10x compression.`,
        recommendationSummary: `Migrate '${table.name}' to MergeTree with an appropriate ORDER BY key.`,
        recommendationSql: `-- Step 1: Create replacement MergeTree table
CREATE TABLE ${table.database}.${table.name}_v2
ENGINE = MergeTree()
ORDER BY (id, created_at)
AS ${table.database}.${table.name};

-- Step 2: Swap tables
RENAME TABLE ${table.database}.${table.name} TO ${table.database}.${table.name}_old,
             ${table.database}.${table.name}_v2 TO ${table.database}.${table.name};`,
        estimatedImpact: {
          metric: 'Query Latency & Storage',
          magnitude: '80% - 95% latency drop',
          description: 'Enables parallel index-driven lookups and columnar compression.',
        },
        metrics: {
          tableName: table.name,
          engine: table.engine,
          totalRows: table.total_rows,
          totalBytes: table.total_bytes,
        },
        relativePriority: {
          rank: 1,
          effort: 'Medium',
          impact: 'Critical',
          justification: 'Log engines on high-volume tables cripple query throughput and lack crash resilience.',
        },
      });
    }

    // 1.2 Excessive partition granularity (e.g. toYYYYMMDD on multi-year data creating > 200 partitions)
    const partitionExpr = table.partition_key || '';
    const activeParts = data.parts.filter((p) => p.table === table.name);
    const uniquePartitions = new Set(activeParts.map((p) => p.partition)).size;

    if (
      (partitionExpr.includes('toYYYYMMDD') || partitionExpr.includes('toDate') || uniquePartitions > 200) &&
      table.total_rows > 10_000_000
    ) {
      findings.push({
        id: createId('PRT'),
        dimension: 'table_engines_partitioning',
        dimensionName: DIMENSION_METADATA.table_engines_partitioning.name,
        severity: 'critical',
        title: `Partition Explosion on '${table.name}' (${uniquePartitions} partitions via ${partitionExpr || 'daily granularity'})`,
        tableName: table.name,
        what: `Table '${table.name}' has ${uniquePartitions} active partitions generated by expression '${partitionExpr}'. ClickHouse best practice is < 50-100 total partitions per table.`,
        whyTechnical: `Each partition creates multiple directories and file handles (columns * parts * 2 files). Having hundreds/thousands of partitions drastically increases metadata memory overhead, slows down server startup, degrades ZooKeeper/Keeper synchronization in replicated setups, and degrades merge efficiency.`,
        whyNarrative: `Partitioning by day ('toYYYYMMDD') on long-lived datasets creates thousands of tiny partition folders. ClickHouse merges parts ONLY within the same partition. Coarsening partitioning to monthly ('toYYYYMM') reduces RAM usage and prevents server memory degradation.`,
        recommendationSummary: `Change partition granularity to monthly 'toYYYYMM(date_col)' or weekly 'toMonday(date_col)'.`,
        recommendationSql: `-- Suggested Table definition with Monthly Partitioning
CREATE TABLE ${table.database}.${table.name}_new
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (device_id, timestamp);

-- Attach partitions or insert from old table
-- INSERT INTO ${table.database}.${table.name}_new SELECT * FROM ${table.database}.${table.name};`,
        estimatedImpact: {
          metric: 'Server Memory & Metadata',
          magnitude: `${Math.round((1 - 12 / Math.max(uniquePartitions, 1)) * 100)}% partition count reduction`,
          description: 'Reduces file descriptors, ZooKeeper coordination overhead, and accelerates server startup.',
        },
        metrics: {
          tableName: table.name,
          currentPartitions: uniquePartitions,
          partitionKey: partitionExpr,
          totalRows: table.total_rows,
        },
        relativePriority: {
          rank: 2,
          effort: 'High',
          impact: 'Critical',
          justification: 'Thousands of partitions pose a severe cluster stability risk and waste RAM.',
        },
      });
    }
  }

  // -------------------------------------------------------------
  // 2. Parts Health & Merge Pressure
  // -------------------------------------------------------------
  const partsByTableAndPartition: Record<string, Record<string, number>> = {};
  for (const part of data.parts) {
    if (!partsByTableAndPartition[part.table]) {
      partsByTableAndPartition[part.table] = {};
    }
    const partKey = part.partition || 'all';
    partsByTableAndPartition[part.table][partKey] = (partsByTableAndPartition[part.table][partKey] || 0) + 1;
  }

  for (const [tableName, partitions] of Object.entries(partsByTableAndPartition)) {
    let maxPartsInSinglePartition = 0;
    let worstPartition = '';
    for (const [partName, count] of Object.entries(partitions)) {
      if (count > maxPartsInSinglePartition) {
        maxPartsInSinglePartition = count;
        worstPartition = partName;
      }
    }

    if (maxPartsInSinglePartition >= 50) {
      const severity: FindingSeverity = maxPartsInSinglePartition >= 100 ? 'critical' : 'warning';
      findings.push({
        id: createId('MRG'),
        dimension: 'parts_and_merges',
        dimensionName: DIMENSION_METADATA.parts_and_merges.name,
        severity,
        title: `Severe Part Fragmentation on '${tableName}' (${maxPartsInSinglePartition} parts in partition '${worstPartition}')`,
        tableName,
        what: `Partition '${worstPartition}' of table '${tableName}' currently has ${maxPartsInSinglePartition} active data parts. Healthy ClickHouse tables typically have < 10-15 parts per partition.`,
        whyTechnical: `A high parts count is a direct indicator of frequent, small unbatched INSERT statements (e.g. streaming single records or micro-batches < 1,000 rows). When parts accumulate faster than the background merge pool can combine them, ClickHouse throttles or rejects inserts with 'Too many parts in all data parts in table' errors.`,
        whyNarrative: `ClickHouse is an analytical database designed for massive batch writes. Ingesting single rows or micro-batches creates hundreds of small parts, placing immense strain on background CPU and disk threads.`,
        recommendationSummary: `Enable async_insert = 1 or implement batching (> 5,000 rows / 1s interval) at ingestion layer.`,
        recommendationSql: `-- Option A: Enable Server-Side Asynchronous Inserts for this user/table
SET async_insert = 1;
SET wait_for_async_insert = 1;
SET async_insert_busy_timeout_ms = 1000;
SET async_insert_max_data_size = 10485760;

-- Option B: Force immediate merge on fragmented partition (run during off-peak)
OPTIMIZE TABLE ${data.database || 'default'}.${tableName} PARTITION ID '${worstPartition}' FINAL;`,
        estimatedImpact: {
          metric: 'Write Throughput & Merge I/O',
          magnitude: '10x - 50x insert efficiency',
          description: 'Prevents "Too many parts" query rejections and cuts background disk write amplification.',
        },
        metrics: {
          tableName,
          maxParts: maxPartsInSinglePartition,
          worstPartition,
        },
        relativePriority: {
          rank: 2,
          effort: 'Low',
          impact: 'Critical',
          justification: 'High parts count will trigger ingestion failure (Too many parts exception) if unaddressed.',
        },
      });
    }
  }

  // 2.2 Stuck or excessively slow merges
  for (const merge of data.merges) {
    if (merge.elapsed > 300) {
      findings.push({
        id: createId('MRG'),
        dimension: 'parts_and_merges',
        dimensionName: DIMENSION_METADATA.parts_and_merges.name,
        severity: 'warning',
        title: `Long-running Merge on '${merge.table}' (Elapsed: ${Math.round(merge.elapsed)}s, Progress: ${Math.round(merge.progress * 100)}%)`,
        tableName: merge.table,
        what: `Background merge operation on '${merge.table}' has been running for ${Math.round(merge.elapsed)}s combining ${merge.num_parts} parts (${formatBytes(merge.total_size_bytes_compressed)}) with memory usage ${formatBytes(merge.memory_usage)}.`,
        whyTechnical: `Merges taking over 5 minutes indicate high disk I/O contention, inadequate background thread pool sizing, or massive individual part sizes. If mutation is active, it may lock background resources.`,
        whyNarrative: `A background merge is taking unusually long to combine data parts. This can consume disk I/O and delay other merges.`,
        recommendationSummary: `Check background_pool_size settings and inspect disk I/O queue.`,
        recommendationSql: `-- Check active merges status
SELECT database, table, elapsed, progress, num_parts, memory_usage
FROM system.merges;`,
        estimatedImpact: {
          metric: 'Background Thread Utilization',
          magnitude: 'Eliminates merge bottlenecks',
          description: 'Frees background threads for faster ingestion part compaction.',
        },
        metrics: merge,
      });
    }
  }

  // -------------------------------------------------------------
  // 3. Primary Key / ORDER BY vs Query Patterns (system.query_log)
  // -------------------------------------------------------------
  for (const q of data.queryLog) {
    // Check for queries where read_rows is huge while result_rows is tiny (e.g. read_rows > 1M, result_rows < 100, ratio > 1000)
    if (q.read_rows > 1_000_000 && q.result_rows < 100 && q.tables.length > 0) {
      const targetTableName = q.tables[0];
      const tableDef = data.tables.find((t) => t.name === targetTableName);
      const sortingKey = tableDef?.sorting_key || tableDef?.primary_key || '';

      // Check if WHERE clause filters on columns not in sorting_key
      const filteredCols = q.columns.filter((c) => !sortingKey.includes(c));

      findings.push({
        id: createId('PKQ'),
        dimension: 'primary_key_and_query_patterns',
        dimensionName: DIMENSION_METADATA.primary_key_and_query_patterns.name,
        severity: 'critical',
        title: `Inefficient Primary Key Filtering on '${targetTableName}' (${formatRows(q.read_rows)} rows scanned for ${q.result_rows} results)`,
        tableName: targetTableName,
        what: `Query '${q.query_id}' executed ${q.frequency_per_hour || 1}x/hr scanned ${formatRows(q.read_rows)} rows (${formatBytes(q.read_bytes)}) to return only ${q.result_rows} rows. Existing ORDER BY key is '(${sortingKey || 'none'})', but query heavily filters by '${filteredCols.join(', ') || 'unindexed columns'}'.`,
        whyTechnical: `ClickHouse sparse primary indexes only skip granuled data when WHERE filters match the leading columns of the ORDER BY tuple. Because the query's high-selectivity equality conditions are missing from the primary key, ClickHouse had to scan all granules.`,
        whyNarrative: `Your queries are filtering by columns like ${filteredCols.join(', ') || 'tenant_id'}, but the table's sorting key doesn't lead with these columns. As a result, ClickHouse has to scan almost the entire table instead of jumping directly to the requested data.`,
        recommendationSummary: `Adjust the ORDER BY tuple to lead with high-cardinality equality filters, or add a secondary Projection.`,
        recommendationSql: `-- Option A: Add a PROJECTION for this query pattern (No full table rewrite required)
ALTER TABLE ${tableDef?.database || 'default'}.${targetTableName}
ADD PROJECTION proj_${filteredCols[0] || 'tenant_filter'} (
  SELECT * ORDER BY (${filteredCols[0] || 'tenant_id'}, ${sortingKey || 'timestamp'})
);
ALTER TABLE ${tableDef?.database || 'default'}.${targetTableName}
MATERIALIZE PROJECTION proj_${filteredCols[0] || 'tenant_filter'};

-- Option B: Re-order table ORDER BY key for new tables
-- ORDER BY (${filteredCols[0] || 'tenant_id'}, ${sortingKey || 'timestamp'})`,
        estimatedImpact: {
          metric: 'Rows Read & Query CPU',
          magnitude: `Up to ${Math.round((1 - q.result_rows / Math.max(q.read_rows, 1)) * 100)}% scan reduction`,
          description: `Decreases read_rows from ${formatRows(q.read_rows)} to ~${formatRows(q.result_rows * 100)} per query.`,
        },
        metrics: {
          queryId: q.query_id,
          querySample: q.query,
          readRows: q.read_rows,
          resultRows: q.result_rows,
          currentSortingKey: sortingKey,
          filteredColumns: filteredCols,
          frequencyPerHour: q.frequency_per_hour,
        },
        relativePriority: {
          rank: 1,
          effort: 'Medium',
          impact: 'Critical',
          justification: 'Leading ORDER BY alignment delivers order-of-magnitude faster queries and slashes server CPU.',
        },
      });
      break; // Report strongest instance
    }
  }

  // -------------------------------------------------------------
  // 4. Skip Indexes (Secondary Data Skipping)
  // -------------------------------------------------------------
  for (const q of data.queryLog) {
    // Check if query filters by a specific ID / UUID / hash (like device_uuid, tx_hash, user_id) on a table > 5M rows
    if (q.tables.length > 0 && q.read_rows > 5_000_000) {
      const targetTable = q.tables[0];
      const tableDef = data.tables.find((t) => t.name === targetTable);
      const sortingKey = tableDef?.sorting_key || '';

      // Find columns that look like candidate UUIDs / hashes / status filters
      const candidateCols = q.columns.filter((c) =>
        (c.includes('uuid') || c.includes('hash') || c.includes('id') || c.includes('tag') || c.includes('level')) &&
        !sortingKey.includes(c)
      );

      if (candidateCols.length > 0) {
        const targetCol = candidateCols[0];
        findings.push({
          id: createId('SKP'),
          dimension: 'skip_indexes',
          dimensionName: DIMENSION_METADATA.skip_indexes.name,
          severity: 'warning',
          title: `Missing Skip Index on Column '${targetTable}.${targetCol}'`,
          tableName: targetTable,
          what: `Queries repeatedly filter by column '${targetCol}' (e.g. query ${q.query_id} scanned ${formatRows(q.read_rows)} rows). The column is not part of the primary key '${sortingKey}' and currently lacks a data skipping index.`,
          whyTechnical: `Data skipping indices (bloom_filter, minmax, set) allow ClickHouse to prune granules during WHERE filtering for non-primary key columns without rewriting the entire table sorting order.`,
          whyNarrative: `Since '${targetCol}' is frequently used in WHERE filters but isn't the primary sorting key, adding a bloom_filter index will allow ClickHouse to skip entire blocks of non-matching data quickly.`,
          recommendationSummary: `Add a bloom_filter or set skip index on '${targetCol}'.`,
          recommendationSql: `-- Add and materialize Bloom Filter Skip Index
ALTER TABLE ${tableDef?.database || 'default'}.${targetTable}
ADD INDEX idx_${targetCol}_bf (${targetCol}) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE ${tableDef?.database || 'default'}.${targetTable}
MATERIALIZE INDEX idx_${targetCol}_bf;`,
          estimatedImpact: {
            metric: 'Granule Pruning & Latency',
            magnitude: '70% - 90% granule skipping',
            description: `Skips non-matching granules when filtering by ${targetCol}.`,
          },
          metrics: {
            tableName: targetTable,
            columnName: targetCol,
            queryId: q.query_id,
            readRows: q.read_rows,
          },
          relativePriority: {
            rank: 3,
            effort: 'Low',
            impact: 'High',
            justification: 'Skip indices can be added online via ALTER TABLE without table downtime.',
          },
        });
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // 5. Data Types, Codecs & Storage
  // -------------------------------------------------------------
  // 5.1 Nullable Overuse
  const nullableCols = data.columns.filter((c) => c.is_nullable || c.type.startsWith('Nullable'));
  if (nullableCols.length >= 2) {
    const totalNullableBytes = nullableCols.reduce((acc, c) => acc + c.data_uncompressed_bytes, 0);
    findings.push({
      id: createId('TYP'),
      dimension: 'data_types_and_storage',
      dimensionName: DIMENSION_METADATA.data_types_and_storage.name,
      severity: 'warning',
      title: `Nullable Overuse Detected (${nullableCols.length} Nullable columns found)`,
      tableName: nullableCols[0].table,
      what: `Found ${nullableCols.length} columns defined as 'Nullable(...)' across database tables (e.g. ${nullableCols.slice(0, 3).map((c) => `${c.table}.${c.name}`).join(', ')}), representing ${formatBytes(totalNullableBytes)} uncompressed data.`,
      whyTechnical: `In ClickHouse, 'Nullable' columns require a dedicated null mask file (.null) on disk alongside column data. This prevents SIMD vectorized query optimizations, degrades columnar compression efficiency, and increases disk read operations by 15-30%.`,
      whyNarrative: `In ClickHouse, Nullable types carry a heavy performance penalty because they disable SIMD hardware vectorization and create an extra mask file for every column. Unless NULL has a strict semantic difference from empty string ('') or zero (0), non-nullable with default values is strongly recommended.`,
      recommendationSummary: `Convert Nullable columns to native types with appropriate DEFAULT expressions.`,
      recommendationSql: `-- Example: Convert Nullable(String) to non-nullable String with default empty string
ALTER TABLE ${nullableCols[0].database}.${nullableCols[0].table}
MODIFY COLUMN ${nullableCols[0].name} ${nullableCols[0].type.replace('Nullable(', '').replace(')', '')} DEFAULT '';`,
      estimatedImpact: {
        metric: 'Storage & Vectorization Speed',
        magnitude: '15% - 25% storage & memory savings',
        description: 'Eliminates .null mask files and restores full SIMD vectorized query execution.',
      },
      metrics: {
        nullableColumnCount: nullableCols.length,
        sampleColumns: nullableCols.slice(0, 4).map((c) => `${c.table}.${c.name} (${c.type})`),
        totalBytes: totalNullableBytes,
      },
      relativePriority: {
        rank: 3,
        effort: 'Medium',
        impact: 'High',
        justification: 'Removing Nullable improves compression and query execution across all analytics workloads.',
      },
    });
  }

  // 5.2 LowCardinality Candidates
  const lowCardCandidates = data.columns.filter((c) => {
    const isString = c.type === 'String' || c.type === 'Nullable(String)';
    const card = c.cardinality_approx || 0;
    return isString && card > 0 && card < 10_000;
  });

  if (lowCardCandidates.length > 0) {
    const candidate = lowCardCandidates[0];
    findings.push({
      id: createId('TYP'),
      dimension: 'data_types_and_storage',
      dimensionName: DIMENSION_METADATA.data_types_and_storage.name,
      severity: 'warning',
      title: `Candidate for 'LowCardinality(String)': '${candidate.table}.${candidate.name}' (Cardinality: ~${candidate.cardinality_approx})`,
      tableName: candidate.table,
      what: `Column '${candidate.table}.${candidate.name}' is defined as plain '${candidate.type}' but has only ~${candidate.cardinality_approx} distinct values. Uncompressed size is ${formatBytes(candidate.data_uncompressed_bytes)}.`,
      whyTechnical: `LowCardinality creates an internal dictionary of unique strings (using 8-bit/16-bit numeric positions). For string columns with < 10,000 distinct values, LowCardinality reduces memory usage by 4x-10x and drastically accelerates GROUP BY / WHERE operations by computing against integer dictionary positions rather than raw string bytes.`,
      whyNarrative: `Using plain String for low-cardinality columns (like status, country, device_type, log_level) wastes memory. LowCardinality transforms strings into an efficient numeric dictionary, speeding up filters and aggregations.`,
      recommendationSummary: `Alter column '${candidate.name}' to 'LowCardinality(String)'.`,
      recommendationSql: `ALTER TABLE ${candidate.database}.${candidate.table}
MODIFY COLUMN ${candidate.name} LowCardinality(String);`,
      estimatedImpact: {
        metric: 'RAM & Disk Compression',
        magnitude: 'Up to 5x memory reduction in GROUP BY',
        description: `Shrinks disk footprint and accelerates filtering on ${candidate.name}.`,
      },
      metrics: {
        table: candidate.table,
        column: candidate.name,
        currentType: candidate.type,
        cardinality: candidate.cardinality_approx,
      },
      relativePriority: {
        rank: 2,
        effort: 'Low',
        impact: 'High',
        justification: 'One-line ALTER TABLE command delivers immediate RAM savings and faster aggregations.',
      },
    });
  }

  // 5.3 Oversized Integer Types
  const oversizedInts = data.columns.filter((c) => {
    const isUInt64 = c.type === 'UInt64' || c.type === 'Int64';
    const card = c.cardinality_approx || 0;
    return isUInt64 && (card > 0 && card <= 255) && !c.name.includes('id');
  });

  if (oversizedInts.length > 0) {
    const col = oversizedInts[0];
    findings.push({
      id: createId('TYP'),
      dimension: 'data_types_and_storage',
      dimensionName: DIMENSION_METADATA.data_types_and_storage.name,
      severity: 'info',
      title: `Oversized Integer Type on '${col.table}.${col.name}' (${col.type} for ~${col.cardinality_approx} distinct values)`,
      tableName: col.table,
      what: `Column '${col.name}' on '${col.table}' uses '${col.type}' (8 bytes per row), but only represents ~${col.cardinality_approx} unique status/code values that easily fit in 'UInt8' (1 byte per row) or 'Enum8'.`,
      whyTechnical: `Using 64-bit integers for low-value enumerations wastes 7 bytes per row of RAM during queries and reduces columnar compression efficiency.`,
      whyNarrative: `Using an 8-byte integer (UInt64) for small numbers like status codes wastes 8x more memory than UInt8.`,
      recommendationSummary: `Downscale column type from UInt64 to UInt8 or Enum8.`,
      recommendationSql: `ALTER TABLE ${col.database}.${col.table}
MODIFY COLUMN ${col.name} UInt8;`,
      estimatedImpact: {
        metric: 'Memory per Row',
        magnitude: '87.5% memory reduction per row',
        description: 'Saves 7 bytes per row across billions of records.',
      },
      metrics: {
        table: col.table,
        column: col.name,
        type: col.type,
        cardinality: col.cardinality_approx,
      },
    });
  }

  // 5.4 Missing Specialized Compression Codecs
  const floatCols = data.columns.filter((c) => (c.type.includes('Float') || c.type.includes('DateTime')) && (!c.compression_codec || c.compression_codec === 'NONE'));
  if (floatCols.length > 0) {
    const col = floatCols[0];
    const isFloat = col.type.includes('Float');
    const recommendedCodec = isFloat ? 'CODEC(Gorilla, ZSTD(1))' : 'CODEC(DoubleDelta, ZSTD(1))';
    findings.push({
      id: createId('CDC'),
      dimension: 'data_types_and_storage',
      dimensionName: DIMENSION_METADATA.data_types_and_storage.name,
      severity: 'info',
      title: `Missing Specialized Codec on '${col.table}.${col.name}' (Recommend ${recommendedCodec})`,
      tableName: col.table,
      what: `Column '${col.name}' (${col.type}) currently has no specialized compression codec (using default LZ4/NONE). Uncompressed size: ${formatBytes(col.data_uncompressed_bytes)}.`,
      whyTechnical: isFloat
        ? `Gorilla compression codec is specifically engineered for floating-point timeseries data (XOR of IEEE 754 mantissa/exponent), typically achieving 50%-70% higher compression ratios than general-purpose LZ4.`
        : `DoubleDelta codec calculates delta-of-deltas for monotonically increasing timestamps/IDs, collapsing sequential sequences into tiny 1-2 bit representations prior to ZSTD compression.`,
      whyNarrative: `Applying specialized codecs like Gorilla (for float metrics) or DoubleDelta (for timestamps) can cut storage requirements in half compared to standard compression.`,
      recommendationSummary: `Apply ${recommendedCodec} to column '${col.name}'.`,
      recommendationSql: `ALTER TABLE ${col.database}.${col.table}
MODIFY COLUMN ${col.name} ${col.type} ${recommendedCodec};`,
      estimatedImpact: {
        metric: 'Disk Storage Ratio',
        magnitude: '40% - 65% additional compression',
        description: `Reduces compressed bytes on disk for column ${col.name}.`,
      },
      metrics: {
        table: col.table,
        column: col.name,
        type: col.type,
      },
    });
  }

  // -------------------------------------------------------------
  // 6. TTL Policies & Data Tiering
  // -------------------------------------------------------------
  for (const table of data.tables) {
    const isMergeTree = table.engine.includes('MergeTree');
    const hasDateTime = data.columns.some((c) => c.table === table.name && (c.type.includes('DateTime') || c.type.includes('Date')));
    const isLarge = table.total_rows > 10_000_000;

    if (isMergeTree && hasDateTime && isLarge && (!table.ttl_expression || table.ttl_expression.trim() === '')) {
      findings.push({
        id: createId('TTL'),
        dimension: 'ttl_and_tiering',
        dimensionName: DIMENSION_METADATA.ttl_and_tiering.name,
        severity: 'warning',
        title: `No TTL Policy Defined on Timeseries Table '${table.name}' (${formatRows(table.total_rows)} rows)`,
        tableName: table.name,
        what: `Table '${table.name}' contains ${formatRows(table.total_rows)} rows (${formatBytes(table.total_bytes)}) of timeseries data but has no TTL (Time-To-Live) retention or tiering expression configured.`,
        whyTechnical: `Without TTL policies, fast-growing event tables will continuously expand disk usage until volume exhaustion occurs. ClickHouse supports automatic background data purging or hot-to-cold disk tiering (e.g. NVMe -> S3/Object Storage) via TTL expressions.`,
        whyNarrative: `Time-series tables without TTL policies will eventually fill up your storage disks. Setting a TTL automatically deletes expired logs or moves older data to cheaper cloud storage.`,
        recommendationSummary: `Define an automated retention TTL (e.g., retain 90 or 180 days) or cold storage tiering.`,
        recommendationSql: `-- Option 1: Automatic deletion after 90 days
ALTER TABLE ${table.database}.${table.name}
MODIFY TTL timestamp + INTERVAL 90 DAY;

-- Option 2: Tiered storage (Move data older than 30 days to S3/cold volume)
-- ALTER TABLE ${table.database}.${table.name}
-- MODIFY TTL timestamp + INTERVAL 30 DAY TO VOLUME 's3_cold';`,
        estimatedImpact: {
          metric: 'Storage Growth & Cloud Costs',
          magnitude: 'Caps storage growth indefinitely',
          description: 'Prevents unbounded disk usage by automatically pruning old partitions during merges.',
        },
        metrics: {
          tableName: table.name,
          totalRows: table.total_rows,
          totalBytes: table.total_bytes,
        },
        relativePriority: {
          rank: 2,
          effort: 'Low',
          impact: 'High',
          justification: 'Prevents catastrophic disk fill-up events on fast-growing tables.',
        },
      });
    }
  }

  // -------------------------------------------------------------
  // 7. Materialized Views & Redundant Compute
  // -------------------------------------------------------------
  const heavyAggregations = data.queryLog.filter(
    (q) => q.used_aggregate_functions && (q.frequency_per_hour >= 500 || (q.read_rows > 10_000_000 && q.frequency_per_hour >= 50))
  );

  if (heavyAggregations.length > 0) {
    const q = heavyAggregations[0];
    findings.push({
      id: createId('MVW'),
      dimension: 'materialized_views_redundant_compute',
      dimensionName: DIMENSION_METADATA.materialized_views_redundant_compute.name,
      severity: 'warning',
      title: `High Redundant Compute: Frequent Aggregation on '${q.tables.join(', ')}' (${q.frequency_per_hour}x/hr, ${formatRows(q.read_rows)} rows/query)`,
      tableName: q.tables[0],
      what: `Query '${q.query_id}' executes ~${q.frequency_per_hour} times per hour scanning ${formatRows(q.read_rows)} rows each time (${formatBytes(q.read_bytes)} / query) to compute aggregate summaries.`,
      whyTechnical: `Recomputing heavy GROUP BY aggregations (e.g. hourly hits, sums, distincts) on raw data repeatedly wastes massive CPU and memory. In ClickHouse, Materialized Views backed by SummingMergeTree or AggregatingMergeTree incrementally pre-aggregate data at insert time with zero query runtime overhead.`,
      whyNarrative: `Your dashboards or services are repeatedly running heavy aggregation queries across millions of rows. Creating a Materialized View will pre-calculate these totals as data arrives, making queries run in milliseconds.`,
      recommendationSummary: `Create a Materialized View backed by SummingMergeTree/AggregatingMergeTree.`,
      recommendationSql: `-- Step 1: Create target pre-aggregated table
CREATE TABLE ${data.database || 'default'}.${q.tables[0] || 'events'}_hourly_summary (
  hour DateTime,
  total_count SimpleAggregateFunction(sum, UInt64)
) ENGINE = SummingMergeTree()
ORDER BY hour;

-- Step 2: Create Materialized View to populate target table on insert
CREATE MATERIALIZED VIEW ${data.database || 'default'}.mv_${q.tables[0] || 'events'}_hourly
TO ${data.database || 'default'}.${q.tables[0] || 'events'}_hourly_summary AS
SELECT
  toStartOfHour(event_time) AS hour,
  count() AS total_count
FROM ${data.database || 'default'}.${q.tables[0] || 'events'}
GROUP BY hour;`,
      estimatedImpact: {
        metric: 'Aggregation Query Latency & CPU',
        magnitude: '99% query acceleration (< 5ms response)',
        description: 'Replaces multi-gigabyte table scans with instant lookups on pre-aggregated rows.',
      },
      metrics: {
        queryId: q.query_id,
        frequencyPerHour: q.frequency_per_hour,
        readRowsPerQuery: q.read_rows,
        totalRowsScannedPerHour: q.read_rows * (q.frequency_per_hour || 1),
      },
      relativePriority: {
        rank: 2,
        effort: 'Medium',
        impact: 'High',
        justification: 'Materialized views eliminate CPU spikes from heavy recurring dashboard queries.',
      },
    });
  }

  // -------------------------------------------------------------
  // 8. Resource & Config Settings
  // -------------------------------------------------------------
  const bgPool = data.settings.find((s) => s.name === 'background_pool_size');
  if (bgPool && parseInt(bgPool.value) < 16 && data.parts.length > 200) {
    findings.push({
      id: createId('CFG'),
      dimension: 'resource_and_config',
      dimensionName: DIMENSION_METADATA.resource_and_config.name,
      severity: 'warning',
      title: `Low 'background_pool_size' (${bgPool.value}) for Cluster Part Load (${data.parts.length} parts)`,
      what: `Setting 'background_pool_size' is configured to ${bgPool.value} threads, but the cluster has ${data.parts.length} active parts and active merge queues.`,
      whyTechnical: `'background_pool_size' sets the thread concurrency for parts compaction merges. On multi-core servers under heavy insert workloads, a small pool creates a merge backlog, triggering 'Too many parts' errors.`,
      whyNarrative: `The background worker thread pool is too small to handle the volume of data parts being created. Increasing this allows ClickHouse to merge parts in parallel without falling behind.`,
      recommendationSummary: `Increase background_pool_size to 16-32 threads in config.xml.`,
      recommendationSql: `<!-- Add/Update in /etc/clickhouse-server/config.d/tuning.xml -->
<clickhouse>
    <background_pool_size>16</background_pool_size>
</clickhouse>`,
      estimatedImpact: {
        metric: 'Background Merge Concurrency',
        magnitude: '2x - 4x faster background merges',
        description: 'Prevents merge queues from stalling active ingestion.',
      },
      metrics: {
        currentValue: bgPool.value,
        totalParts: data.parts.length,
      },
    });
  }

  const memLimit = data.settings.find((s) => s.name === 'max_memory_usage');
  if (memLimit && parseInt(memLimit.value) <= 2147483648) {
    findings.push({
      id: createId('CFG'),
      dimension: 'resource_and_config',
      dimensionName: DIMENSION_METADATA.resource_and_config.name,
      severity: 'warning',
      title: `Restrictive 'max_memory_usage' (${formatBytes(parseInt(memLimit.value))})`,
      what: `'max_memory_usage' is set to ${formatBytes(parseInt(memLimit.value))} per query. Heavy analytical queries with large GROUP BY or JOIN operations risk encountering 'MEMORY_LIMIT_EXCEEDED'.`,
      whyTechnical: `Complex aggregations on high-cardinality keys require sufficient RAM buffers before spilling to disk. Setting max_memory_usage too tight aborts legitimate analytics queries.`,
      whyNarrative: `The per-query memory cap is set very low (2GB). This may cause queries with large GROUP BY or JOIN clauses to fail unexpectedly.`,
      recommendationSummary: `Raise max_memory_usage to 10GB - 20GB (or enable spill-to-disk).`,
      recommendationSql: `-- Set higher limit or enable external group by spilling
SET max_memory_usage = 10000000000;
SET max_bytes_before_external_group_by = 5000000000;`,
      estimatedImpact: {
        metric: 'Query Reliability',
        magnitude: 'Eliminates MEMORY_LIMIT_EXCEEDED crashes',
        description: 'Allows memory-intensive analytics to complete reliably.',
      },
      metrics: {
        maxMemoryUsageBytes: parseInt(memLimit.value),
      },
    });
  }

  // -------------------------------------------------------------
  // 9. General Query Performance
  // -------------------------------------------------------------
  const slowQueries = data.queryLog.filter((q) => q.query_duration_ms > 3000);
  if (slowQueries.length > 0) {
    const slowest = slowQueries[0];
    findings.push({
      id: createId('QPF'),
      dimension: 'general_query_performance',
      dimensionName: DIMENSION_METADATA.general_query_performance.name,
      severity: 'warning',
      title: `Slow Query Bottleneck: ${slowest.query_duration_ms}ms Execution Time (Query ID: ${slowest.query_id})`,
      tableName: slowest.tables[0],
      what: `Query '${slowest.query_id}' by user '${slowest.user}' took ${(slowest.query_duration_ms / 1000).toFixed(2)}s to execute, reading ${formatRows(slowest.read_rows)} rows (${formatBytes(slowest.read_bytes)}) and consuming ${formatBytes(slowest.memory_usage)} RAM.`,
      whyTechnical: `The query duration is driven by extensive row scanning (${formatRows(slowest.read_rows)} rows) and high memory allocation. Full-scan queries degrade overall cluster throughput by locking I/O bandwidth.`,
      whyNarrative: `This query took several seconds to complete because it read millions of rows from disk. Optimizing the sorting key or adding an index will bring execution down to milliseconds.`,
      recommendationSummary: `Inspect EXPLAIN pipeline and apply filtering / index recommendations.`,
      recommendationSql: `-- Run EXPLAIN to inspect query execution pipeline
EXPLAIN indexes = 1, actions = 1
${slowest.query};`,
      estimatedImpact: {
        metric: 'Execution Time',
        magnitude: 'Sub-second response time',
        description: 'Reduces server CPU and disk consumption during peak query traffic.',
      },
      metrics: {
        queryId: slowest.query_id,
        durationMs: slowest.query_duration_ms,
        readRows: slowest.read_rows,
        readBytes: slowest.read_bytes,
        memoryUsage: slowest.memory_usage,
      },
    });
  }

  // If no findings in a dimension, add an optimal finding
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

  const dimensionScores: Record<DimensionId, DimensionScore> = {} as any;

  for (const dim of allDimensions) {
    const dimFindings = findings.filter((f) => f.dimension === dim);
    const criticalCount = dimFindings.filter((f) => f.severity === 'critical').length;
    const warningCount = dimFindings.filter((f) => f.severity === 'warning').length;
    const infoCount = dimFindings.filter((f) => f.severity === 'info').length;
    const optimalCount = dimFindings.filter((f) => f.severity === 'optimal').length;

    // Scoring formula: Base 100 - (critical * 35) - (warning * 15) - (info * 5)
    let score = Math.max(0, Math.min(100, 100 - criticalCount * 35 - warningCount * 15 - infoCount * 5));

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
-- Target Database: ${data.tables[0]?.database || 'default'}
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
