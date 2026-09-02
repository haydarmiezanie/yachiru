import { describe, it, expect } from 'vitest';
import {
  isValidClickHouseIdentifier,
  escapeClickHouseString,
  ClickHouseScannerClient,
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

    it('handles empty or blank output gracefully', () => {
      expect(client.parseClickHouseOutput('')).toEqual([]);
      expect(client.parseClickHouseOutput('   \n  ')).toEqual([]);
    });
  });
});
