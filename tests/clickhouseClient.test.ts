import { describe, it, expect, vi } from 'vitest';
import {
  isValidClickHouseIdentifier,
  escapeClickHouseString,
  ClickHouseScannerClient,
  ClickHouseTableRow,
} from '../server/scanner/clickhouseClient.js';

describe('ClickHouse Scanner Client Security & Parsing', () => {
  describe('isValidClickHouseIdentifier', () => {
    it('accepts valid ClickHouse identifiers', () => {
      expect(isValidClickHouseIdentifier('analytics_db')).toBe(true);
      expect(isValidClickHouseIdentifier('default')).toBe(true);
      expect(isValidClickHouseIdentifier('system')).toBe(true);
      expect(isValidClickHouseIdentifier('events_v2')).toBe(true);
      expect(isValidClickHouseIdentifier('my-db.test')).toBe(true);
    });

    it('rejects SQL injection attempts and dangerous characters', () => {
      expect(isValidClickHouseIdentifier("default' OR '1'='1")).toBe(false);
      expect(isValidClickHouseIdentifier('default; DROP TABLE users;--')).toBe(false);
      expect(isValidClickHouseIdentifier('db\nUNION SELECT *')).toBe(false);
      expect(isValidClickHouseIdentifier('"injected"')).toBe(false);
      expect(isValidClickHouseIdentifier('`escaped`')).toBe(false);
      expect(isValidClickHouseIdentifier('')).toBe(false);
      expect(isValidClickHouseIdentifier(' ')).toBe(false);
    });
  });

  describe('escapeClickHouseString', () => {
    it('escapes quotes and backslashes', () => {
      expect(escapeClickHouseString("test'db")).toBe("test\\'db");
      expect(escapeClickHouseString('test\\db')).toBe('test\\\\db');
      expect(escapeClickHouseString('normal_db')).toBe('normal_db');
    });
  });

  describe('getCleanEndpoint', () => {
    it('correctly parses standard host and port', () => {
      const client = new ClickHouseScannerClient({
        host: 'ch-prod.internal',
        port: 8123,
        database: 'default',
        user: 'default',
      });
      const endpoint = client.getCleanEndpoint();
      expect(endpoint.baseUrl).toBe('http://ch-prod.internal:8123');
      expect(endpoint.protocol).toBe('http');
    });

    it('automatically uses https for port 8443 or https prefix', () => {
      const client = new ClickHouseScannerClient({
        host: 'https://play.clickhouse.com',
        port: 8443,
        database: 'default',
        user: 'default',
      });
      const endpoint = client.getCleanEndpoint();
      expect(endpoint.baseUrl).toBe('https://play.clickhouse.com:8443');
      expect(endpoint.protocol).toBe('https');
    });

    it('strips inline ports and subpaths from host string', () => {
      const client = new ClickHouseScannerClient({
        host: 'http://localhost:8123/subpath',
        port: 8123,
        database: 'default',
        user: 'default',
      });
      const endpoint = client.getCleanEndpoint();
      expect(endpoint.host).toBe('localhost');
      expect(endpoint.baseUrl).toBe('http://localhost:8123');
    });
  });

  describe('parseClickHouseOutput', () => {
    const client = new ClickHouseScannerClient({
      host: 'localhost',
      port: 8123,
      database: 'default',
      user: 'default',
    });

    it('parses single JSON objects or wrapped arrays', () => {
      const json = JSON.stringify([{ version: '24.3.1.2672' }]);
      const parsed = client.parseClickHouseOutput(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].version).toBe('24.3.1.2672');
    });

    it('parses JSONEachRow newline-delimited output', () => {
      const ndjson = `{"name":"table_a","rows":100}\n{"name":"table_b","rows":200}`;
      const parsed = client.parseClickHouseOutput(ndjson);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('table_a');
      expect(parsed[1].rows).toBe(200);
    });

    it('supports generic type parameters for strict row type safety', () => {
      const json = JSON.stringify([
        {
          database: 'analytics',
          name: 'events',
          engine: 'ReplacingMergeTree',
          total_rows: 500000,
          total_bytes: 10485760,
        },
      ]);
      const typedRows = client.parseClickHouseOutput<ClickHouseTableRow>(json);
      expect(typedRows).toHaveLength(1);
      expect(typedRows[0].engine).toBe('ReplacingMergeTree');
      expect(typedRows[0].total_rows).toBe(500000);
    });

    it('handles empty or blank output gracefully', () => {
      expect(client.parseClickHouseOutput('')).toEqual([]);
      expect(client.parseClickHouseOutput('   \n  ')).toEqual([]);
    });
  });

  describe('fetchClusterData parallel execution', () => {
    it('executes all 7 system queries concurrently in parallel using Promise.all', async () => {
      const client = new ClickHouseScannerClient({
        host: '93.184.216.34',
        port: 8123,
        database: 'analytics',
        user: 'default',
        lookbackDays: 7,
      });

      let inFlight = 0;
      let maxConcurrent = 0;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        inFlight++;
        if (inFlight > maxConcurrent) {
          maxConcurrent = inFlight;
        }

        const body = (init?.body as string) || '';

        // Simulate network delay to verify overlapping concurrency
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight--;

        if (body.includes('SELECT version()')) {
          return new Response(JSON.stringify([{ version: '24.3.1.2672', uptime: 3600 }]), { status: 200 });
        }
        if (body.includes('FROM system.tables')) {
          return new Response(JSON.stringify([{ database: 'analytics', name: 'events', total_rows: 1000 }]), { status: 200 });
        }
        if (body.includes('FROM system.columns')) {
          return new Response(JSON.stringify([{ database: 'analytics', table: 'events', name: 'id', type: 'UInt64' }]), { status: 200 });
        }
        if (body.includes('FROM system.parts')) {
          return new Response(JSON.stringify([{ database: 'analytics', table: 'events', active: 1, rows: 1000 }]), { status: 200 });
        }
        if (body.includes('FROM system.merges')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (body.includes('FROM system.query_log')) {
          return new Response(JSON.stringify([{ query_id: 'q1', query_duration_ms: 150 }]), { status: 200 });
        }
        if (body.includes('FROM system.settings')) {
          return new Response(JSON.stringify([{ name: 'max_threads', value: '16' }]), { status: 200 });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      });

      const data = await client.fetchClusterData();

      // Probe is sequential (1 request), then all 7 diagnostic queries run concurrently in parallel
      expect(maxConcurrent).toBe(7);
      expect(data.version).toBe('24.3.1.2672');
      expect(data.database).toBe('analytics');
      expect(data.tables).toHaveLength(1);
      expect(data.columns).toHaveLength(1);
      expect(data.parts).toHaveLength(1);
      expect(data.queryLog).toHaveLength(1);
      expect(data.settings).toHaveLength(1);

      fetchSpy.mockRestore();
    });

    it('aborts hanging queries via AbortController timeout and returns fallback without blocking the scan', async () => {
      const originalTimeout = process.env.CLICKHOUSE_QUERY_TIMEOUT_MS;
      process.env.CLICKHOUSE_QUERY_TIMEOUT_MS = '50';

      const client = new ClickHouseScannerClient({
        host: '93.184.216.34',
        port: 8123,
        database: 'analytics',
        user: 'default',
        lookbackDays: 7,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = (init?.body as string) || '';
        const signal = init?.signal;

        if (body.includes('SELECT version()')) {
          return new Response(JSON.stringify([{ version: '24.3.1.2672', uptime: 3600 }]), { status: 200 });
        }
        if (body.includes('FROM system.tables')) {
          return new Response(JSON.stringify([{ database: 'analytics', name: 'events' }]), { status: 200 });
        }
        // Simulate a slowloris / hanging connection on system.query_log
        if (body.includes('FROM system.query_log')) {
          return new Promise((_resolve, reject) => {
            if (signal) {
              signal.addEventListener('abort', () => {
                const abortErr = new Error('The operation was aborted.');
                abortErr.name = 'AbortError';
                reject(abortErr);
              });
            }
          });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      });

      const startTime = Date.now();
      const data = await client.fetchClusterData();
      const elapsed = Date.now() - startTime;

      // Scan should complete swiftly without hanging indefinitely
      expect(elapsed).toBeLessThan(1000);
      // Hanging query returns fallback empty array
      expect(data.queryLog).toEqual([]);
      // Other concurrent queries succeed
      expect(data.tables).toHaveLength(1);

      if (originalTimeout !== undefined) {
        process.env.CLICKHOUSE_QUERY_TIMEOUT_MS = originalTimeout;
      } else {
        delete process.env.CLICKHOUSE_QUERY_TIMEOUT_MS;
      }
      fetchSpy.mockRestore();
    });
  });
});
