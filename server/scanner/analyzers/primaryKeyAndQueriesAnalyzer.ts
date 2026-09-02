import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatBytes, formatRows } from './analyzerUtils.js';

export function analyzePrimaryKeyAndQueries(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'primary_key_and_query_patterns';
  const dimName = DIMENSION_METADATA[dim].name;

  for (const q of data.queryLog) {
    // Check for queries where read_rows is huge while result_rows is tiny (e.g. read_rows > 1M, result_rows < 100)
    if (q.read_rows > 1_000_000 && q.result_rows < 100 && q.tables.length > 0) {
      const targetTableName = q.tables[0];
      const tableDef = data.tables.find((t) => t.name === targetTableName);
      const sortingKey = tableDef?.sorting_key || tableDef?.primary_key || '';

      // Check if WHERE clause filters on columns not in sorting_key
      const filteredCols = (q.columns || []).filter((c: string) => !sortingKey.includes(c));

      // Derive actual filter column from filteredCols or query columns
      const candidateFilterCol = filteredCols[0] || (q.columns && q.columns[0]) || 'filter_column';
      const targetDb = tableDef?.database || data.database || 'default';

      findings.push({
        id: nextId('PKQ'),
        dimension: dim,
        dimensionName: dimName,
        severity: 'critical',
        title: `Inefficient Primary Key Filtering on '${targetTableName}' (${formatRows(q.read_rows)} rows scanned for ${q.result_rows} results)`,
        tableName: targetTableName,
        what: `Query '${q.query_id}' executed ${q.frequency_per_hour || 1}x/hr scanned ${formatRows(q.read_rows)} rows (${formatBytes(q.read_bytes)}) to return only ${q.result_rows} rows. Existing ORDER BY key is '(${sortingKey || 'none'})', but query heavily filters by '${filteredCols.join(', ') || 'unindexed columns'}'.`,
        whyTechnical: `ClickHouse sparse primary indexes only skip granuled data when WHERE filters match the leading columns of the ORDER BY tuple. Because the query's high-selectivity equality conditions are missing from the primary key, ClickHouse had to scan all granules.`,
        whyNarrative: `Your queries are filtering by columns like ${filteredCols.join(', ') || 'tenant_id'}, but the table's sorting key doesn't lead with these columns. As a result, ClickHouse has to scan almost the entire table instead of jumping directly to the requested data.`,
        recommendationSummary: `Adjust the ORDER BY tuple to lead with high-cardinality equality filters, or add a secondary Projection.`,
        recommendationSql: `-- Option A: Add a PROJECTION for this query pattern (No full table rewrite required)
ALTER TABLE ${targetDb}.${targetTableName}
ADD PROJECTION proj_${candidateFilterCol} (
  SELECT * ORDER BY (${candidateFilterCol}${sortingKey ? `, ${sortingKey}` : ''})
);
ALTER TABLE ${targetDb}.${targetTableName}
MATERIALIZE PROJECTION proj_${candidateFilterCol};

-- Option B: Re-order table ORDER BY key for new tables
-- ORDER BY (${candidateFilterCol}${sortingKey ? `, ${sortingKey}` : ''})`,
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

  return findings;
}
