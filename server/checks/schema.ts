import { CheckFinding } from '../../src/types.js';
import { CheckEvaluationContext } from './types.js';
import {
  escapeSqlIdentifier,
  formatBytes,
  matchesColumnTokens,
} from './helpers.js';

export function evaluateSchemaChecks(ctx: CheckEvaluationContext): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const database = ctx.database;

  // 2. Primary Key / ORDER BY effectiveness
  for (const t of ctx.tablesData) {
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
        recommendation_sql_or_text: `-- Recreate the table with an appropriate ORDER BY (e.g. (tenant_id, event_time, id)):\n-- Note: Changing sorting key requires table migration:\nCREATE TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(t.name + '_new')} (...)\nENGINE = MergeTree()\nORDER BY (date_col, high_filter_id);`,
        is_sql_recommendation: true,
      });
    } else if (totalRows > 500000) {
      const cols = sortingKey.split(',').map((c) => c.trim());
      if (cols.length > 0) {
        const firstCol = cols[0];
        const colMeta = ctx.colData.find((c) => c.table === t.name && c.name === firstCol);
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
  for (const [tableName, partInfo] of ctx.partsMap.entries()) {
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
        recommendation_sql_or_text: `-- Consider partitioning by month to enable fast data lifecycle management:\nPARTITION BY toYYYYMM(timestamp)\n-- This also enables zero-cost drops: ALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(tableName)} DROP PARTITION '202301';`,
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
  for (const col of ctx.colData) {
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
          recommendation_sql_or_text: `-- If values have repeated cardinality, wrap with LowCardinality:\n-- Or apply ZSTD compression for text/JSON payloads:\n-- ALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)} MODIFY COLUMN ${escapeSqlIdentifier(col.name)} ${col.type} CODEC(ZSTD(3));`,
          is_sql_recommendation: true,
          metrics: {
            columnCompressedBytes: comp,
            columnUncompressedBytes: uncomp,
            compressionRatio: ratio,
            columnName: col.name,
            columnType: col.type,
          },
        });
      }

      // LowCardinality Candidate
      const LOW_CARD_TERMS = [
        'event_type', 'status', 'action', 'type', 'category', 'method',
        'level', 'country', 'os', 'browser', 'role', 'platform',
        'state', 'code', 'currency', 'tag', 'plan'
      ];
      const isLowCardCandidate =
        col.type === 'String' &&
        !col.type.includes('LowCardinality') &&
        matchesColumnTokens(col.name, LOW_CARD_TERMS);

      if (isLowCardCandidate && uncomp > 20971520) {
        findings.push({
          id: `lowcard_candidate_${col.table}_${col.name}`,
          category: 'compression',
          category_name: 'Compression & Codecs',
          title: `LowCardinality candidate on '${col.table}.${col.name}' (LowCardinality(String))`,
          table: col.table,
          status: 'warning',
          metric_value: `String (${formatBytes(comp)} compressed)`,
          threshold: 'Threshold: Categorical string columns benefit from LowCardinality dictionary encoding',
          evidence: `Column '${col.name}' is type String using ${formatBytes(uncomp)} uncompressed (${formatBytes(comp)} compressed). Candidate based on column name only; cardinality / value range were not inspected.`,
          impact: 'Storing repeating strings without dictionary encoding increases storage and slows down string lookups. If distinct values exceed ~10,000, LowCardinality can degrade performance instead.',
          recommendation_sql_or_text: `-- Verify cardinality before converting (proceed only if uniq(col) is below roughly 10,000):\nSELECT uniq(${escapeSqlIdentifier(col.name)}) AS distinct_values FROM ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)};\n\n-- If distinct_values < 10000, apply:\nALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)} MODIFY COLUMN ${escapeSqlIdentifier(col.name)} LowCardinality(String);`,
          is_sql_recommendation: true,
          metrics: {
            columnCompressedBytes: comp,
            columnUncompressedBytes: uncomp,
            compressionRatio: ratio,
            columnName: col.name,
            columnType: col.type,
            suggestedType: 'LowCardinality(String)',
            isNameOnlyCandidate: true,
          },
        });
      }

      // Numeric Type Narrowing
      const NUMERIC_NARROWING_TERMS = [
        'status_code', 'http_status', 'year', 'month', 'day', 'port',
        'retry_count', 'priority', 'version_major', 'duration_ms'
      ];
      const isNumericNarrowingCandidate =
        (col.type === 'Int64' || col.type === 'UInt64') &&
        matchesColumnTokens(col.name, NUMERIC_NARROWING_TERMS);

      if (isNumericNarrowingCandidate && comp > 10485760) {
        const targetType = col.type === 'Int64' ? 'Int32' : 'UInt32';
        const maxAllowed = targetType === 'UInt32' ? '4,294,967,295' : '2,147,483,647';
        findings.push({
          id: `numeric_narrowing_${col.table}_${col.name}`,
          category: 'compression',
          category_name: 'Compression & Codecs',
          title: `Oversized integer type on '${col.table}.${col.name}' (${col.type} → ${targetType})`,
          table: col.table,
          status: 'warning',
          metric_value: `Current type: ${col.type} (${formatBytes(comp)} compressed)`,
          threshold: 'Threshold: Value ranges within 32-bit limits should use 32-bit types',
          evidence: `Column '${col.name}' uses ${col.type} (8 bytes/value) across ${formatBytes(comp)} compressed storage (${formatBytes(uncomp)} uncompressed). Candidate based on column name only; cardinality / value range were not inspected.`,
          impact: '64-bit integer width for bounded data wastes raw storage and memory bandwidth overhead. Narrowing a 64-bit column without verifying min/max can cause integer overflow if values exceed 32-bit bounds.',
          recommendation_sql_or_text: `-- Verify value domain before converting (proceed only if max <= ${maxAllowed} and min >= ${targetType === 'UInt32' ? 0 : '-2,147,483,648'}):\nSELECT min(${escapeSqlIdentifier(col.name)}), max(${escapeSqlIdentifier(col.name)}) FROM ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)};\n\n-- If values fit within 32-bit limits, apply:\nALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)} MODIFY COLUMN ${escapeSqlIdentifier(col.name)} ${targetType};`,
          is_sql_recommendation: true,
          metrics: {
            columnCompressedBytes: comp,
            columnUncompressedBytes: uncomp,
            compressionRatio: ratio,
            columnName: col.name,
            columnType: col.type,
            suggestedType: targetType,
            isNameOnlyCandidate: true,
          },
        });
      }

      // Date/DateTime Candidate
      const DATE_TERMS = [
        'created_at', 'updated_at', 'timestamp', 'event_time', 'event_date', 'log_time', 'date_str'
      ];
      const isDateCandidate =
        col.type === 'String' &&
        matchesColumnTokens(col.name, DATE_TERMS);

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
          evidence: `Temporal column '${col.name}' is stored as generic String (${formatBytes(uncomp)} uncompressed, ${formatBytes(comp)} compressed). Candidate based on column name only; value range was not inspected.`,
          impact: 'Generic String dates prevent partition pruning, date-interval arithmetic, and waste ~60% storage.',
          recommendation_sql_or_text: `-- Verify temporal format before converting:\nSELECT min(${escapeSqlIdentifier(col.name)}), max(${escapeSqlIdentifier(col.name)}) FROM ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)};\n\n-- If format is valid date string, apply:\nALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(col.table)} MODIFY COLUMN ${escapeSqlIdentifier(col.name)} ${targetType};`,
          is_sql_recommendation: true,
          metrics: {
            columnCompressedBytes: comp,
            columnUncompressedBytes: uncomp,
            compressionRatio: ratio,
            columnName: col.name,
            columnType: col.type,
            suggestedType: targetType,
            isNameOnlyCandidate: true,
          },
        });
      }
    }
  }

  // 5. Table Engine Sanity
  for (const t of ctx.tablesData) {
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
        recommendation_sql_or_text: `-- Migrate table to MergeTree engine:\nCREATE TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(t.name + '_mergetree')} AS ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(t.name)}\nENGINE = MergeTree()\nORDER BY (primary_id);`,
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

  // 6. Skip Indexes (only evaluate if system.data_skipping_indices was granted)
  if (ctx.skipIndicesAvailable) {
    for (const t of ctx.tablesData) {
      const rows = Number(t.total_rows || 0);
      const count = ctx.skipIndicesMap.get(t.name) || 0;
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
          recommendation_sql_or_text: `-- Example: Add a bloom filter or minmax index on frequently filtered secondary column:\n-- ALTER TABLE ${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(t.name)} ADD INDEX idx_user_id \`user_id\` TYPE bloom_filter(0.01) GRANULARITY 4;`,
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
  }

  return findings;
}
