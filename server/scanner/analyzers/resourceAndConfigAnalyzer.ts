import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA } from './analyzerUtils.js';

export function analyzeResourceAndConfig(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'resource_and_config';
  const dimName = DIMENSION_METADATA[dim].name;

  const settingMap = new Map<string, string>();
  for (const s of data.settings) {
    settingMap.set(s.name, s.value);
  }

  // 8.1 background_pool_size check
  const bgPoolSize = parseInt(settingMap.get('background_pool_size') || '16', 10);
  if (bgPoolSize <= 8) {
    findings.push({
      id: nextId('CFG'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'warning',
      title: `Suboptimal background_pool_size (${bgPoolSize}) on High-Throughput Node`,
      what: `ClickHouse background_pool_size is currently set to ${bgPoolSize}. On servers handling frequent writes or large tables, a small pool limits parallel background part merges and mutations.`,
      whyTechnical: `background_pool_size controls the number of background threads available for table merges and mutations. If the write rate is high, 8 or fewer threads can easily become saturated, leading to parts backlog.`,
      whyNarrative: `The server has limited worker threads assigned for background data compression and merging. Increasing this setting prevents part accumulation during peak write periods.`,
      recommendationSummary: `Increase background_pool_size to 16 or 32 in config.xml / config.d/pool.xml.`,
      recommendationSql: `<!-- Add to /etc/clickhouse-server/config.d/background_pool.xml -->
<clickhouse>
    <background_pool_size>32</background_pool_size>
    <background_fetches_pool_size>16</background_fetches_pool_size>
</clickhouse>`,
      estimatedImpact: {
        metric: 'Background Merge Throughput',
        magnitude: '2x - 4x merge parallelism',
        description: 'Accelerates background merges to prevent "too many parts" errors under write spikes.',
      },
      metrics: {
        currentValue: bgPoolSize,
        recommendedValue: 32,
      },
      relativePriority: {
        rank: 3,
        effort: 'Low',
        impact: 'Medium',
        justification: 'Configuration change requires server reload/restart but improves merge resilience.',
      },
    });
  }

  // 8.2 max_bytes_before_external_group_by
  const extGroupBy = settingMap.get('max_bytes_before_external_group_by') || '0';
  if (extGroupBy === '0') {
    findings.push({
      id: nextId('CFG'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'warning',
      title: `Spill-to-Disk Disabled for Large GROUP BY Aggregations`,
      what: `Setting 'max_bytes_before_external_group_by' is 0 (disabled). High-cardinality aggregation queries will fail with 'Memory limit exceeded' instead of spilling intermediate states to disk.`,
      whyTechnical: `When external group by is disabled, any aggregation exceeding max_memory_usage is immediately aborted by the memory tracker. Enabling spill-to-disk allows long-running analytical queries to complete safely even when RAM is constrained.`,
      whyNarrative: `When memory is tight, complex reporting queries will crash with an out-of-memory error. Enabling spill-to-disk allows queries to use disk temporarily to complete successfully.`,
      recommendationSummary: `Configure max_bytes_before_external_group_by to half of max_memory_usage (e.g. 20GB).`,
      recommendationSql: `-- Set at user profile or session level
SET max_bytes_before_external_group_by = 21474836480; -- 20 GB
SET max_bytes_before_external_sort = 21474836480;`,
      estimatedImpact: {
        metric: 'Query Stability & OOM Prevention',
        magnitude: 'Eliminates MEMORY_LIMIT_EXCEEDED query failures',
        description: 'Allows memory-intensive analytics queries to complete gracefully using temporary disk storage.',
      },
      metrics: {
        currentSetting: extGroupBy,
      },
      relativePriority: {
        rank: 3,
        effort: 'Low',
        impact: 'High',
        justification: 'Prevents out-of-memory crashes on exploratory or large reporting queries.',
      },
    });
  }

  return findings;
}
