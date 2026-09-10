import { RawClusterData } from '../clickhouseClient.js';
import { Finding, FindingSeverity } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatBytes } from './analyzerUtils.js';

export function analyzePartsAndMerges(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'parts_and_merges';
  const dimName = DIMENSION_METADATA[dim].name;

  // 2.1 Parts count per partition
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
      const targetDb = data.database || data.tables.find((t) => t.name === tableName)?.database || 'default';

      findings.push({
        id: nextId('MRG'),
        dimension: dim,
        dimensionName: dimName,
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
OPTIMIZE TABLE ${targetDb}.${tableName} PARTITION ID '${worstPartition}' FINAL;`,
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

  // 2.2 Stuck or excessively slow merges (scoped strictly to target database)
  const scopedDb = data.targetDatabase || data.database;
  for (const merge of data.merges) {
    if (scopedDb && merge.database && merge.database !== scopedDb) {
      continue;
    }
    if (merge.elapsed > 300) {
      findings.push({
        id: nextId('MRG'),
        dimension: dim,
        dimensionName: dimName,
        severity: 'warning',
        title: `Long-running Merge on '${merge.table}' (Elapsed: ${Math.round(merge.elapsed)}s, Progress: ${Math.round(merge.progress * 100)}%)`,
        tableName: merge.table,
        what: `Background merge operation on '${merge.table}' has been running for ${Math.round(merge.elapsed)}s combining ${merge.num_parts} parts (${formatBytes(merge.total_size_bytes_compressed)}) with memory usage ${formatBytes(merge.memory_usage)}.`,
        whyTechnical: `Merges taking over 5 minutes indicate high disk I/O contention, inadequate background thread pool sizing, or massive individual part sizes. If mutation is active, it may lock background resources.`,
        whyNarrative: `A background merge is taking unusually long to combine data parts. This can consume disk I/O and delay other merges.`,
        recommendationSummary: `Check background_pool_size settings and inspect disk I/O queue.`,
        recommendationSql: `-- Check active merges status
SELECT database, table, elapsed, progress, num_parts, memory_usage
FROM system.merges${scopedDb ? `\nWHERE database = '${scopedDb}'` : ''};`,
        estimatedImpact: {
          metric: 'Background Thread Utilization',
          magnitude: 'Eliminates merge bottlenecks',
          description: 'Frees background threads for faster ingestion part compaction.',
        },
        metrics: merge,
      });
    }
  }

  return findings;
}
