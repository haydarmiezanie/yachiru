import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { maskQueryPii, sanitizeReportForStorage, ScanHistoryStore } from '../server/storage/scanHistory.js';
import { ScanReport } from '../src/types/yachiru.js';

describe('PII Masking & Query Sanitization', () => {
  it('should redact string literals, passwords, and sensitive comparison values', () => {
    const rawSql = `SELECT * FROM users WHERE email = 'user@example.com' AND age > 25 AND password = 'super_secret_password_123'`;
    const masked = maskQueryPii(rawSql);

    expect(masked).not.toContain('user@example.com');
    expect(masked).not.toContain('super_secret_password_123');
    expect(masked).toContain('[REDACTED]');
  });

  it('should redact INSERT values tuples', () => {
    const rawInsert = `INSERT INTO events (id, user_id, payload) VALUES (101, 'usr_9988', 'sensitive_json')`;
    const masked = maskQueryPii(rawInsert);

    expect(masked).toContain('VALUES ([REDACTED])');
    expect(masked).not.toContain('usr_9988');
  });

  it('should deeply sanitize findings metrics and rawStats queries', () => {
    const mockReport: ScanReport = {
      id: 'scan-test-1',
      timestamp: new Date().toISOString(),
      target: {
        host: 'ch.internal',
        port: 8123,
        database: 'prod_db',
        isDemoCluster: false,
        clusterName: 'ch-prod',
      },
      overallScore: 85,
      overallGrade: 'B',
      dimensionScores: {} as any,
      findings: [
        {
          id: 'find-1',
          dimension: 'primary_key_and_query_patterns',
          dimensionName: 'Primary Key & Query Patterns',
          severity: 'critical',
          title: 'Unindexed scan on email',
          what: 'Query scanned 10M rows',
          whyTechnical: 'No primary key match',
          recommendationSummary: 'Add index',
          estimatedImpact: { metric: 'Speed', magnitude: '10x', description: 'Faster' },
          metrics: {
            querySample: `SELECT * FROM orders WHERE customer_email = 'customer@confidential.com' AND total > 500`,
            sampleException: `Error connecting with token = 'tok_live_98765'`,
          },
        },
      ],
      executiveSummary: {
        overview: 'Test scan',
        overallHealthGrade: 'B',
        topRisk: 'Slow queries',
        quickWins: [],
        strategicFixes: [],
        aiGenerated: false,
      },
      clusterMetadata: {
        version: '24.3',
        clusterName: 'ch-prod',
        totalDatabases: 1,
        totalTables: 2,
        totalParts: 10,
        totalRows: 1000000,
        totalDiskSizeBytes: 10000000,
        totalDiskSizeFormatted: '10 MB',
        queriesAnalyzed: 5,
        timeWindow: '7d',
        uptimeSeconds: 3600,
      },
      rawStats: {
        tables: [],
        partsSummary: {},
        mergesSummary: {},
        slowQueries: [
          {
            query: `SELECT credit_card, ssn FROM payments WHERE user_id = 'usr_secret_123' AND amount > 9999`,
            query_duration_ms: 15000,
          },
        ],
        expensivePatterns: [
          {
            query: `SELECT * FROM audit_logs WHERE api_key = 'sk_live_very_secret_key' AND read_rows > 5000000`,
            read_rows: 6000000,
          },
        ],
        columnsWithIssues: [],
        configSettings: [],
      },
      migrationScript: '-- test script',
      scanDurationMs: 120,
      aiStatus: 'disabled',
    };

    const sanitized = sanitizeReportForStorage(mockReport);

    // Finding metrics check
    expect(sanitized.findings[0].metrics.querySample).not.toContain('customer@confidential.com');
    expect(sanitized.findings[0].metrics.querySample).toContain('[REDACTED]');
    expect(sanitized.findings[0].metrics.sampleException).not.toContain('tok_live_98765');

    // rawStats slowQueries check (P1)
    expect(sanitized.rawStats.slowQueries[0].query).not.toContain('usr_secret_123');
    expect(sanitized.rawStats.slowQueries[0].query).toContain('[REDACTED]');

    // rawStats expensivePatterns check (P1)
    expect(sanitized.rawStats.expensivePatterns[0].query).not.toContain('sk_live_very_secret_key');
    expect(sanitized.rawStats.expensivePatterns[0].query).toContain('[REDACTED]');
  });
});

describe('ScanHistoryStore Serialization & Mutex', () => {
  const dataDir = path.join(process.cwd(), 'data');
  const historyFile = path.join(dataDir, 'scan_history.json');

  beforeEach(async () => {
    await ScanHistoryStore.clearHistory();
  });

  afterEach(async () => {
    await ScanHistoryStore.clearHistory();
  });

  it('should handle concurrent saves without lost updates (P2 Mutex)', async () => {
    const reports: ScanReport[] = Array.from({ length: 10 }, (_, i) => ({
      id: `scan-concurrent-${i}`,
      timestamp: new Date().toISOString(),
      target: {
        host: 'localhost',
        port: 8123,
        database: `db_${i}`,
        isDemoCluster: true,
        clusterName: `cluster_${i}`,
      },
      overallScore: 70 + i,
      overallGrade: 'B',
      dimensionScores: {} as any,
      findings: [],
      executiveSummary: {
        overview: `Concurrent report ${i}`,
        overallHealthGrade: 'B',
        topRisk: 'None',
        quickWins: [],
        strategicFixes: [],
        aiGenerated: false,
      },
      clusterMetadata: {} as any,
      rawStats: {
        tables: [],
        partsSummary: {},
        mergesSummary: {},
        slowQueries: [],
        expensivePatterns: [],
        columnsWithIssues: [],
        configSettings: [],
      },
      migrationScript: '',
      scanDurationMs: 50,
      aiStatus: 'disabled',
    }));

    // Trigger all saves concurrently in parallel
    await Promise.all(reports.map((r) => ScanHistoryStore.saveScan(r)));

    const stored = await ScanHistoryStore.getAllScans();
    expect(stored.length).toBe(10);
    const storedIds = stored.map((s) => s.id);
    for (let i = 0; i < 10; i++) {
      expect(storedIds).toContain(`scan-concurrent-${i}`);
    }
  });
});
