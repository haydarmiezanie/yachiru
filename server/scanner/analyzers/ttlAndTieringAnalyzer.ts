import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import {
  DIMENSION_METADATA,
  formatBytes,
  formatRows,
  deriveTtlColumnOrPlaceholder,
} from './analyzerUtils.js';

export function analyzeTtlAndTiering(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'ttl_and_tiering';
  const dimName = DIMENSION_METADATA[dim].name;

  for (const table of data.tables) {
    if (table.total_rows > 50_000_000 || table.total_bytes > 50_000_000_000) {
      const derivedTtl = deriveTtlColumnOrPlaceholder(table, data.columns);
      const targetDb = table.database || data.database || 'default';

      findings.push({
        id: nextId('TTL'),
        dimension: dim,
        dimensionName: dimName,
        severity: 'warning',
        title: `Unbounded Storage Growth: Missing TTL on '${table.name}' (${formatRows(table.total_rows)} rows, ${formatBytes(table.total_bytes)})`,
        tableName: table.name,
        what: `Table '${table.name}' has accumulated ${formatBytes(table.total_bytes)} of data across ${formatRows(table.total_rows)} rows without an automated TTL retention rule or volume tiering policy.`,
        whyTechnical: `ClickHouse tables without TTL policies will grow indefinitely on high-speed NVMe storage. Older analytical data (> 90-180 days) is rarely queried with sub-second SLA requirements and should either be expired or automatically moved to S3/cold object storage.`,
        whyNarrative: `Your largest table is consuming ${formatBytes(table.total_bytes)} on primary storage. Adding a TTL policy ensures old historical data is cleaned up or moved to cheap cold storage automatically.`,
        recommendationSummary: `Add a TTL retention rule to drop or move rows older than 90/180 days.`,
        recommendationSql: `${derivedTtl.isPlaceholder ? '-- NOTE: Verify the Date/DateTime column name below exists in your table\n' : ''}-- Option A: Automatically drop data older than 180 days
ALTER TABLE ${targetDb}.${table.name}
MODIFY TTL ${derivedTtl.colName} + INTERVAL 180 DAY;

-- Option B: Move data older than 30 days to cold S3 volume (if storage policy configured)
-- ALTER TABLE ${targetDb}.${table.name}
-- MODIFY TTL ${derivedTtl.colName} + INTERVAL 30 DAY TO VOLUME 's3_cold';`,
        estimatedImpact: {
          metric: 'Storage Footprint & Cost',
          magnitude: '40% - 70% storage cost reduction',
          description: 'Prevents runaway disk exhaustion by pruning obsolete historical data.',
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
          justification: 'Automated TTL prevents unexpected production disk-full outages.',
        },
      });
      break; // Report largest instance
    }
  }

  return findings;
}
