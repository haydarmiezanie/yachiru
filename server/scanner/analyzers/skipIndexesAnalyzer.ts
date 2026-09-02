import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatRows } from './analyzerUtils.js';

export function analyzeSkipIndexes(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'skip_indexes';
  const dimName = DIMENSION_METADATA[dim].name;

  for (const q of data.queryLog) {
    if (q.tables && q.tables.length > 0 && q.read_rows > 5_000_000) {
      const targetTable = q.tables[0];
      const tableDef = data.tables.find((t) => t.name === targetTable);
      const sortingKey = tableDef?.sorting_key || '';
      const targetDb = tableDef?.database || data.database || 'default';

      // Find columns that look like candidate UUIDs / hashes / status / tag filters
      const candidateCols = (q.columns || []).filter((c: string) =>
        (c.includes('uuid') || c.includes('hash') || c.includes('id') || c.includes('tag') || c.includes('level')) &&
        !sortingKey.includes(c)
      );

      if (candidateCols.length > 0) {
        const targetCol = candidateCols[0];
        findings.push({
          id: nextId('SKP'),
          dimension: dim,
          dimensionName: dimName,
          severity: 'warning',
          title: `Missing Skip Index on Column '${targetTable}.${targetCol}'`,
          tableName: targetTable,
          what: `Queries repeatedly filter by column '${targetCol}' (e.g. query ${q.query_id} scanned ${formatRows(q.read_rows)} rows). The column is not part of the primary key '${sortingKey}' and currently lacks a data skipping index.`,
          whyTechnical: `Data skipping indices (bloom_filter, minmax, set) allow ClickHouse to prune granules during WHERE filtering for non-primary key columns without rewriting the entire table sorting order.`,
          whyNarrative: `Since '${targetCol}' is frequently used in WHERE filters but isn't the primary sorting key, adding a bloom_filter index will allow ClickHouse to skip entire blocks of non-matching data quickly.`,
          recommendationSummary: `Add a bloom_filter or set skip index on '${targetCol}'.`,
          recommendationSql: `-- Add and materialize Bloom Filter Skip Index
ALTER TABLE ${targetDb}.${targetTable}
ADD INDEX idx_${targetCol}_bf (${targetCol}) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE ${targetDb}.${targetTable}
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
        break; // Report strongest instance
      }
    }
  }

  return findings;
}
