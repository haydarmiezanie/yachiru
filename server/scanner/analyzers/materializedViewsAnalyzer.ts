import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatRows } from './analyzerUtils.js';

export function analyzeMaterializedViews(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'materialized_views_redundant_compute';
  const dimName = DIMENSION_METADATA[dim].name;

  for (const q of data.queryLog) {
    if (
      q.read_rows > 10_000_000 &&
      (q.query.includes('GROUP BY') || q.query.includes('count(') || q.query.includes('sum(') || q.query.includes('avg(')) &&
      (q.frequency_per_hour || 1) >= 5
    ) {
      const sourceTable = q.tables[0] || 'source_table';
      const targetDb = data.database || 'default';

      findings.push({
        id: nextId('MVW'),
        dimension: dim,
        dimensionName: dimName,
        severity: 'warning',
        title: `Redundant Heavy Aggregation on '${sourceTable}' (Executed ${q.frequency_per_hour || 5}x/hr, scanned ${formatRows(q.read_rows)} rows)`,
        tableName: sourceTable,
        what: `A high-frequency aggregation query on table '${sourceTable}' scans ${formatRows(q.read_rows)} rows repeatedly (${q.frequency_per_hour || 5} executions/hour). It executes heavy CPU group-by aggregates on raw event data.`,
        whyTechnical: `Executing raw aggregations repeatedly over millions of records consumes massive CPU and mark cache bandwidth. Implementing a Materialized View with SummingMergeTree or AggregatingMergeTree incrementally pre-calculates the aggregations on insert.`,
        whyNarrative: `This dashboard/reporting query is re-scanning millions of rows every time it runs. A Materialized View precomputes the totals on insert, reducing query run time to under 10ms.`,
        recommendationSummary: `Build an incremental Materialized View with SummingMergeTree or AggregatingMergeTree.`,
        recommendationSql: `-- Step 1: Create the Aggregated Target Table
CREATE TABLE ${targetDb}.${sourceTable}_hourly_agg (
  event_date Date,
  category LowCardinality(String),
  total_events UInt64,
  total_value Float64
) ENGINE = SummingMergeTree()
ORDER BY (event_date, category);

-- Step 2: Create Materialized View to maintain aggregated state on insert
CREATE MATERIALIZED VIEW ${targetDb}.${sourceTable}_hourly_mv
TO ${targetDb}.${sourceTable}_hourly_agg AS
SELECT 
  toDate(event_time) AS event_date,
  category,
  count() AS total_events,
  sum(amount) AS total_value
FROM ${targetDb}.${sourceTable}
GROUP BY event_date, category;`,
        estimatedImpact: {
          metric: 'CPU Load & Query Latency',
          magnitude: '95% - 99% compute reduction',
          description: 'Replaces multi-million row full aggregations with instant lookup from pre-aggregated view.',
        },
        metrics: {
          queryId: q.query_id,
          sourceTable,
          readRows: q.read_rows,
          frequencyPerHour: q.frequency_per_hour,
        },
        relativePriority: {
          rank: 2,
          effort: 'Medium',
          impact: 'High',
          justification: 'Pre-aggregating hot queries frees up significant server CPU headroom.',
        },
      });
      break; // Report top query
    }
  }

  return findings;
}
