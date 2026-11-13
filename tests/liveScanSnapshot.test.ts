import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runLiveScan, type ClickHouseQueryExecutor } from '../server/analyzer.js';
import type { AnalysisReport, ConnectionConfig } from '../src/types.js';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const FULL_FIXTURE_PATH = path.join(FIXTURES_DIR, 'liveScanFullSnapshot.json');
const PERM_DENIED_FIXTURE_PATH = path.join(FIXTURES_DIR, 'liveScanPermDeniedSnapshot.json');

const BASE_CONFIG: ConnectionConfig = {
  host: 'ch-prod.internal',
  port: 8123,
  protocol: 'http',
  username: 'yachiru_readonly',
  password: '',
  database: 'analytics',
  queryDurationThresholdMs: 3000,
  queryMemoryThresholdBytes: 1024 * 1024 * 1024,
  mutationWarningAgeHours: 1,
  mutationCriticalAgeHours: 6,
  diskWarningFreePct: 20,
  diskCriticalFreePct: 10,
  errorRecentWindowHours: 24,
  errorWarningCount: 100,
  errorCriticalCount: 1000,
  replicationQueueWarningSize: 50,
  replicationQueueMaxRetries: 10,
};

function createMockExecutor(options?: { denySystemTables?: string[] }): ClickHouseQueryExecutor {
  const denied = new Set(options?.denySystemTables ?? []);

  return {
    async ping() {
      return { success: true };
    },
    async query({ query }) {
      const wrap = (rows: unknown[]) => ({
        async json<T = unknown>() {
          return rows as T[];
        },
      });

      if (query.includes('SELECT version() AS version')) {
        return wrap([{ version: '24.8.4.13', uptime: 1209600 }]);
      }

      if (query.includes('SELECT count() AS total_tables') && query.includes('FROM system.tables')) {
        return wrap([{ total_tables: 3 }]);
      }

      if (query.includes('FROM system.tables')) {
        return wrap([
          {
            database: 'analytics',
            name: 'events_raw',
            engine: 'ReplicatedMergeTree',
            total_rows: 28500000,
            total_bytes: 14200000000,
            sorting_key: 'event_time, id',
            partition_key: 'toYYYYMM(event_time)',
          },
          {
            database: 'analytics',
            name: 'session_cache',
            engine: 'Memory',
            total_rows: 620000,
            total_bytes: 1800000000,
            sorting_key: '',
            partition_key: '',
          },
          {
            database: 'analytics',
            name: 'dim_users',
            engine: 'MergeTree',
            total_rows: 1800000,
            total_bytes: 210000000,
            sorting_key: 'user_id',
            partition_key: 'toYYYYMM(created_at)',
          },
        ]);
      }

      if (query.includes('FROM system.parts')) {
        if (denied.has('system.parts')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.parts');
        }
        return wrap([
          {
            table: 'events_raw',
            active_parts: 220,
            partition_count: 14,
            total_rows: 28500000,
            compressed_bytes: 14200000000,
            uncompressed_bytes: 31200000000,
            tiny_parts_count: 90,
            min_part_size: 256000,
            max_part_size: 524288000,
            avg_part_size: 64545454,
          },
          {
            table: 'dim_users',
            active_parts: 8,
            partition_count: 4,
            total_rows: 1800000,
            compressed_bytes: 210000000,
            uncompressed_bytes: 920000000,
            tiny_parts_count: 1,
            min_part_size: 2048000,
            max_part_size: 64000000,
            avg_part_size: 26250000,
          },
        ]);
      }

      if (query.includes('FROM system.columns')) {
        if (denied.has('system.columns')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.columns');
        }
        return wrap([
          {
            table: 'events_raw',
            name: 'payload_json',
            type: 'String',
            data_compressed_bytes: 7100000000,
            data_uncompressed_bytes: 8400000000,
            compression_codec: 'CODEC(LZ4)',
          },
          {
            table: 'dim_users',
            name: 'country_code',
            type: 'String',
            data_compressed_bytes: 18000000,
            data_uncompressed_bytes: 42000000,
            compression_codec: 'CODEC(ZSTD(3))',
          },
        ]);
      }

      if (query.includes('FROM system.data_skipping_indices')) {
        if (denied.has('system.data_skipping_indices')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.data_skipping_indices');
        }
        return wrap([
          {
            table: 'dim_users',
            name: 'idx_user_email',
            type: 'bloom_filter',
            expr: 'email',
            granularity: 4,
          },
        ]);
      }

      if (query.includes('FROM system.query_log')) {
        if (denied.has('system.query_log')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.query_log');
        }
        return wrap([
          {
            normalized_query: 'SELECT count() FROM analytics.events_raw WHERE user_id = ? GROUP BY event_type',
            normalized_query_hash: '112233445566',
            tables: ['analytics.events_raw'],
            query_duration_ms: 8200,
            memory_usage: 2147483648,
            read_rows: 18450000,
            read_bytes: 2400000000,
            result_rows: 54,
            ratio: 341666.7,
          },
        ]);
      }

      if (query.includes('FROM system.replicas')) {
        if (denied.has('system.replicas')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.replicas');
        }
        return wrap([
          {
            table: 'events_raw',
            is_readonly: 0,
            absolute_delay: 95,
            queue_size: 48,
          },
        ]);
      }

      if (query.includes('FROM system.distribution_queue')) {
        if (denied.has('system.distribution_queue')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.distribution_queue');
        }
        return wrap([
          {
            table: 'events_dist',
            data_compressed_bytes: 0,
            compressed_large_files: 0,
            error_count: 0,
            is_blocked: 0,
          },
        ]);
      }

      if (query.includes('FROM system.settings')) {
        if (denied.has('system.settings')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.settings');
        }
        return wrap([
          {
            name: 'max_memory_usage',
            value: '2147483648',
            changed: 1,
            description: 'Maximum memory usage per query',
          },
        ]);
      }

      if (query.includes('FROM system.mutations')) {
        if (denied.has('system.mutations')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.mutations');
        }
        return wrap([
          {
            database: 'analytics',
            table: 'events_raw',
            mutation_id: 'mutation_0042.txt',
            command: "UPDATE status = 'archived' WHERE event_time < '2026-01-01'",
            create_time: '2026-09-15T09:00:00.000Z',
            is_done: 0,
            parts_to_do: 14,
            latest_fail_reason: '',
          },
        ]);
      }

      if (query.includes('FROM system.disks')) {
        if (denied.has('system.disks')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.disks');
        }
        return wrap([
          {
            name: 'default',
            path: '/var/lib/clickhouse/',
            free_space: 150000000000,
            total_space: 1000000000000,
          },
        ]);
      }

      if (query.includes('FROM system.errors')) {
        if (denied.has('system.errors')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.errors');
        }
        return wrap([
          {
            name: 'MEMORY_LIMIT_EXCEEDED',
            code: 241,
            error_count: 140,
            last_error_message: 'Memory limit exceeded while sorting',
            last_error_time: '2026-09-15T11:30:00.000Z',
          },
        ]);
      }

      if (query.includes('FROM system.replication_queue')) {
        if (denied.has('system.replication_queue')) {
          throw new Error('Code: 497. DB::Exception: Not enough privileges (ACCESS_DENIED) on system.replication_queue');
        }
        return wrap([
          {
            database: 'analytics',
            table: 'events_raw',
            node_name: 'queue-0000001234',
            type: 'GET_PART',
            create_time: '2026-09-15T11:00:00.000Z',
            num_tries: 12,
            last_exception: 'Connection refused from replica-02',
          },
        ]);
      }

      throw new Error(`Unexpected query in mock executor: ${query}`);
    },
  };
}

function normalizeSnapshot(report: AnalysisReport): Omit<AnalysisReport, 'scan_id' | 'timestamp'> {
  const { scan_id: _scanId, timestamp: _ts, ...rest } = report;
  return rest;
}

async function runWithFrozenClock<T>(fn: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => new Date('2026-09-15T12:00:00.000Z').getTime();
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

test('FIX 3 Snapshot: runLiveScan output matches baseline across all 11 system tables', async () => {
  const report = await runWithFrozenClock(() =>
    runLiveScan(BASE_CONFIG, { executor: createMockExecutor() })
  );
  const actual = normalizeSnapshot(report);

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(FULL_FIXTURE_PATH, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
  }

  const expected = JSON.parse(fs.readFileSync(FULL_FIXTURE_PATH, 'utf-8'));
  assert.deepEqual(actual, expected);
});

test('FIX 3 Snapshot: runLiveScan permission-denied degradation matches baseline', async () => {
  const report = await runWithFrozenClock(() =>
    runLiveScan(BASE_CONFIG, {
      executor: createMockExecutor({
        denySystemTables: [
          'system.query_log',
          'system.replicas',
          'system.mutations',
          'system.disks',
          'system.errors',
          'system.replication_queue',
        ],
      }),
    })
  );
  const actual = normalizeSnapshot(report);

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(PERM_DENIED_FIXTURE_PATH, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
  }

  const expected = JSON.parse(fs.readFileSync(PERM_DENIED_FIXTURE_PATH, 'utf-8'));
  assert.deepEqual(actual, expected);
});
