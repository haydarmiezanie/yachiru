import { describe, it, expect } from 'vitest';
import { RawClusterData } from '../server/scanner/clickhouseClient.js';
import { analyzeTableEngines } from '../server/scanner/analyzers/tableEnginesAnalyzer.js';
import { analyzePartsAndMerges } from '../server/scanner/analyzers/partsAndMergesAnalyzer.js';
import { analyzePrimaryKeyAndQueries } from '../server/scanner/analyzers/primaryKeyAndQueriesAnalyzer.js';
import { analyzeDataTypesAndStorage } from '../server/scanner/analyzers/dataTypesAndStorageAnalyzer.js';
import { runDeterministicScan } from '../server/scanner/deterministicRules.js';

const mockClusterData: RawClusterData = {
  version: '24.3.1',
  clusterName: 'test-cluster',
  database: 'test_db',
  tables: [
    {
      database: 'test_db',
      name: 'large_log_table',
      engine: 'Log',
      partition_key: '',
      sorting_key: '',
      primary_key: '',
      sampling_key: '',
      total_rows: 500_000,
      total_bytes: 150_000_000,
      comment: '',
    },
    {
      database: 'test_db',
      name: 'daily_partition_table',
      engine: 'MergeTree',
      partition_key: 'toYYYYMMDD(created_at)',
      sorting_key: 'id, created_at',
      primary_key: 'id',
      sampling_key: '',
      total_rows: 25_000_000,
      total_bytes: 2_000_000_000,
      comment: '',
    },
  ],
  columns: [
    {
      database: 'test_db',
      table: 'large_log_table',
      name: 'id',
      type: 'UInt64',
      default_type: '',
      default_expression: '',
      data_compressed_bytes: 1000,
      data_uncompressed_bytes: 2000,
      compression_codec: 'NONE',
    },
    {
      database: 'test_db',
      table: 'large_log_table',
      name: 'created_at',
      type: 'DateTime',
      default_type: '',
      default_expression: '',
      data_compressed_bytes: 1000,
      data_uncompressed_bytes: 2000,
      compression_codec: 'NONE',
    },
    // Add 6 Nullable columns
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      database: 'test_db',
      table: 'large_log_table',
      name: `nullable_col_${i}`,
      type: 'Nullable(String)',
      default_type: '',
      default_expression: '',
      data_compressed_bytes: 500,
      data_uncompressed_bytes: 1000,
      compression_codec: 'NONE',
    })),
  ],
  parts: [
    // Create 60 active parts for partition 20240101
    ...Array.from({ length: 60 }).map((_, i) => ({
      database: 'test_db',
      table: 'daily_partition_table',
      partition: '20240101',
      name: `20240101_${i}_${i}_0`,
      part_type: 'Compact',
      active: 1,
      rows: 1000,
      bytes_on_disk: 50000,
      modification_time: '2024-01-01 12:00:00',
    })),
  ],
  merges: [],
  queryLog: [
    {
      query_id: 'slow-q-1',
      event_time: '2024-01-01 12:00:00',
      query_duration_ms: 1500,
      query: 'SELECT * FROM daily_partition_table WHERE tenant_id = 42',
      tables: ['daily_partition_table'],
      columns: ['tenant_id', 'amount'],
      read_rows: 5_000_000,
      read_bytes: 100_000_000,
      result_rows: 5,
      result_bytes: 500,
      memory_usage: 10_000_000,
      exception_code: 0,
      exception: '',
      user: 'default',
    },
  ],
  settings: [
    { name: 'background_pool_size', value: '8', changed: 0, description: '', type: 'UInt64' },
    { name: 'max_bytes_before_external_group_by', value: '0', changed: 0, description: '', type: 'UInt64' },
  ],
  totalDatabases: 1,
  uptimeSeconds: 86400,
};

describe('Dimension Analyzers', () => {
  const nextId = (code: string) => `FND-${code}-001`;

  it('analyzeTableEngines detects non-MergeTree and excessive partition granularity', () => {
    const findings = analyzeTableEngines(mockClusterData, nextId);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const logEngineFinding = findings.find((f) => f.title.includes("Non-MergeTree engine 'Log'"));
    expect(logEngineFinding).toBeDefined();
    expect(logEngineFinding?.severity).toBe('critical');
    expect(logEngineFinding?.recommendationSql).toContain('CREATE TABLE');
  });

  it('analyzePartsAndMerges detects part fragmentation >= 50 parts', () => {
    const findings = analyzePartsAndMerges(mockClusterData, nextId);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const partFinding = findings.find((f) => f.title.includes('Severe Part Fragmentation'));
    expect(partFinding).toBeDefined();
    expect(partFinding?.recommendationSql).toContain('async_insert = 1');
  });

  it('analyzePartsAndMerges scopes merge analysis strictly to target database and excludes other databases', () => {
    const mixedMergeData: RawClusterData = {
      ...mockClusterData,
      database: 'tenant_prod',
      targetDatabase: 'tenant_prod',
      merges: [
        {
          database: 'unrelated_tenant_dev',
          table: 'unrelated_table',
          elapsed: 450, // Long running, but belonging to another database!
          progress: 0.1,
          num_parts: 50,
          total_size_bytes_compressed: 500_000_000,
          memory_usage: 100_000_000,
          is_mutation: 0,
        },
        {
          database: 'tenant_prod',
          table: 'events_raw',
          elapsed: 350, // Long running on the target database!
          progress: 0.4,
          num_parts: 20,
          total_size_bytes_compressed: 200_000_000,
          memory_usage: 50_000_000,
          is_mutation: 0,
        },
      ],
    };

    const findings = analyzePartsAndMerges(mixedMergeData, nextId);
    const mergeFindings = findings.filter((f) => f.title.includes('Long-running Merge'));

    // Must find only the merge on target database 'events_raw', ignoring 'unrelated_table' from unrelated_tenant_dev
    expect(mergeFindings).toHaveLength(1);
    expect(mergeFindings[0].tableName).toBe('events_raw');
    expect(mergeFindings[0].recommendationSql).toContain("WHERE database = 'tenant_prod'");
  });

  it('analyzePrimaryKeyAndQueries detects unindexed WHERE scans', () => {
    const findings = analyzePrimaryKeyAndQueries(mockClusterData, nextId);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const pkFinding = findings[0];
    expect(pkFinding.dimension).toBe('primary_key_and_query_patterns');
    expect(pkFinding.recommendationSql).toContain('PROJECTION');
  });

  it('analyzeDataTypesAndStorage detects excessive Nullable columns', () => {
    const findings = analyzeDataTypesAndStorage(mockClusterData, nextId);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const nullFinding = findings.find((f) => f.title.includes('Excessive Nullable Columns'));
    expect(nullFinding).toBeDefined();
  });

  it('runDeterministicScan performs full 9-dimension scoring and generates migration script', () => {
    const result = runDeterministicScan(mockClusterData);
    expect(result.findings.length).toBeGreaterThanOrEqual(4);
    expect(result.overallScore).toBeLessThan(100);
    expect(result.migrationScript).toContain('Yachiru ClickHouse Optimization Script');
    expect(result.stats.totalTables).toBe(2);
    expect(result.stats.totalParts).toBe(60);
  });
});
