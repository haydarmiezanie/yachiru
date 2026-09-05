import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  maskQueryPii,
  normalizeQueryPattern,
  fingerprintQuery,
  sanitizeReportForStorage,
  extractScanSummary,
  ScanHistoryStore,
} from '../server/storage/scanHistory.js';
import { ScanReport } from '../src/types/yachiru.js';

describe('Scan History Store & PII Masking', () => {
  beforeEach(async () => {
    await ScanHistoryStore.clearHistory();
  });

  describe('normalizeQueryPattern & fingerprintQuery', () => {
    it('normalizes queries into structural skeletons stripping literals', () => {
      const sql1 = "SELECT user_id, email FROM users WHERE email = 'alice@example.com' AND age > 25 LIMIT 50";
      const sql2 = "SELECT user_id, email FROM users WHERE email = 'bob@corp.internal' AND age > 99 LIMIT 50";

      const pattern1 = normalizeQueryPattern(sql1);
      const pattern2 = normalizeQueryPattern(sql2);

      // Both should match the exact same normalized structure
      expect(pattern1).toBe("SELECT user_id, email FROM users WHERE email = '?' AND age > ? LIMIT 50");
      expect(pattern2).toBe("SELECT user_id, email FROM users WHERE email = '?' AND age > ? LIMIT 50");
      expect(pattern1).toBe(pattern2);

      // Both should produce identical fingerprint for bug & slow-query pattern deduplication
      const fp1 = fingerprintQuery(sql1);
      const fp2 = fingerprintQuery(sql2);
      expect(fp1).toBe(fp2);
      expect(fp1.startsWith('fp_')).toBe(true);
    });

    it('handles IN lists, UUIDs, and comments in normalizeQueryPattern', () => {
      const sql = `-- Fetch order details\nSELECT * FROM orders /* block comment */ WHERE id IN ('ord-1', 'ord-2') AND tracking_uuid = '123e4567-e89b-12d3-a456-426614174000'`;
      const pattern = normalizeQueryPattern(sql);

      expect(pattern).not.toContain('Fetch order details');
      expect(pattern).not.toContain('block comment');
      expect(pattern).not.toContain('ord-1');
      expect(pattern).toContain('IN (?)');
      expect(pattern).toContain("tracking_uuid = '?'");
    });
  });

  describe('maskQueryPii', () => {
    it('masks string literals in SQL queries', () => {
      const sql = "SELECT * FROM users WHERE email = 'john.doe@example.com' AND name = 'SecretUser'";
      const masked = maskQueryPii(sql);
      expect(masked).not.toContain('john.doe@example.com');
      expect(masked).not.toContain('SecretUser');
      expect(masked).toContain("'[REDACTED]'");
    });

    it('masks numeric comparison literals', () => {
      const sql = 'SELECT * FROM orders WHERE amount > 500.50 AND user_id = 998811';
      const masked = maskQueryPii(sql);
      expect(masked).not.toContain('500.50');
      expect(masked).not.toContain('998811');
      expect(masked).toContain('[REDACTED]');
    });

    it('masks VALUES (...) in INSERT statements', () => {
      const sql = "INSERT INTO logs VALUES (1, 'sensitive token', '192.168.1.1')";
      const masked = maskQueryPii(sql);
      expect(masked).toContain('VALUES ([REDACTED])');
    });
  });

  describe('Zero-Raw-Query / Privacy Preserving Mode', () => {
    it('completely discards raw query and stores only normalized pattern and fingerprint', () => {
      const report: ScanReport = {
        id: 'test-privacy-001',
        timestamp: new Date().toISOString(),
        target: { host: 'ch.internal', port: 8123, database: 'default', isDemoCluster: false, clusterName: 'test' },
        overallScore: 90,
        overallGrade: 'A',
        dimensionScores: {} as any,
        findings: [
          {
            id: 'F-1',
            dimension: 'general_query_performance',
            dimensionName: 'Performance',
            severity: 'warning',
            title: 'Query with sensitive info',
            what: 'Slow query',
            whyTechnical: 'Full scan',
            recommendationSummary: 'Add index',
            estimatedImpact: { metric: 'Speed', magnitude: '2x', description: 'Fast' },
            metrics: {
              querySample: "SELECT ssn, password_hash FROM secret_table WHERE api_key = 'sk_live_999888777'",
            },
          },
        ],
        executiveSummary: {
          overview: 'Overview',
          overallHealthGrade: 'A',
          topRisk: 'None',
          quickWins: [],
          strategicFixes: [],
          aiGenerated: false,
        },
        clusterMetadata: {} as any,
        rawStats: {
          slowQueries: [
            {
              query: "SELECT credit_card FROM transactions WHERE customer_id = 'cust_12345'",
              query_duration_ms: 5000,
            },
          ],
          expensivePatterns: [],
          tables: [],
          partsSummary: {},
          mergesSummary: {},
          columnsWithIssues: [],
          configSettings: [],
        },
        migrationScript: '',
        scanDurationMs: 50,
        aiStatus: 'disabled',
      };

      const sanitized = sanitizeReportForStorage(report, { privacyPreserving: true });

      // Finding query check: completely discarded raw query literals, replaced with fingerprint & pattern
      expect(sanitized.findings[0].metrics.querySample).not.toContain('sk_live_999888777');
      expect(sanitized.findings[0].metrics.querySample).toContain('[ZERO_RAW_QUERY_MODE');
      expect(sanitized.findings[0].metrics.querySampleFingerprint).toBeDefined();

      // rawStats slowQueries check
      expect(sanitized.rawStats.slowQueries[0].query).not.toContain('cust_12345');
      expect(sanitized.rawStats.slowQueries[0].query).toContain('[ZERO_RAW_QUERY_MODE');
      expect(sanitized.rawStats.slowQueries[0].query_fingerprint).toBeDefined();
    });
  });

  describe('ScanHistoryStore operations', () => {
    const mockReport: ScanReport = {
      id: 'test-scan-001',
      timestamp: new Date().toISOString(),
      target: { host: 'localhost', port: 8123, database: 'default', isDemoCluster: false, clusterName: 'localhost:8123 (default)' },
      overallScore: 88,
      overallGrade: 'A',
      dimensionScores: {} as any,
      findings: [
        {
          id: 'FND-001',
          dimension: 'general_query_performance',
          dimensionName: 'Query Performance',
          severity: 'warning',
          title: 'Slow Query Test',
          what: 'Test',
          whyTechnical: 'Test',
          whyNarrative: 'Test',
          recommendationSummary: 'Test',
          estimatedImpact: { metric: 'Speed', magnitude: '2x', description: 'Fast' },
          metrics: {
            querySample: "SELECT * FROM secrets WHERE api_key = 'super-secret-12345'",
          },
        },
      ],
      executiveSummary: {
        overview: 'Overview',
        overallHealthGrade: 'A',
        topRisk: 'None',
        quickWins: [],
        strategicFixes: [],
        aiGenerated: false,
      },
      clusterMetadata: {
        version: '24.3',
        clusterName: 'test',
        totalDatabases: 1,
        totalTables: 5,
        totalParts: 10,
        totalRows: 1000,
        totalDiskSizeBytes: 10000,
        totalDiskSizeFormatted: '10 KB',
        queriesAnalyzed: 1,
        timeWindow: '7d',
        uptimeSeconds: 3600,
      },
      rawStats: {} as any,
      migrationScript: '-- Clean',
      scanDurationMs: 120,
      aiStatus: 'disabled',
    };

    it('saves and retrieves scan reports asynchronously with atomic safety', async () => {
      await ScanHistoryStore.saveScan(mockReport);

      const all = await ScanHistoryStore.getAllScans();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('test-scan-001');

      const retrieved = await ScanHistoryStore.getScanById('test-scan-001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.overallScore).toBe(88);

      // Verify PII in query sample was redacted before saving
      expect(retrieved?.findings[0].metrics?.querySample).not.toContain('super-secret-12345');
      expect(retrieved?.findings[0].metrics?.querySample).toContain('[REDACTED]');
    });

    it('clears history properly', async () => {
      await ScanHistoryStore.saveScan(mockReport);
      expect(await ScanHistoryStore.getAllScans()).toHaveLength(1);

      await ScanHistoryStore.clearHistory();
      expect(await ScanHistoryStore.getAllScans()).toHaveLength(0);
    });

    it('stores reports as isolated documents and generates lightweight summaries without full reads', async () => {
      await ScanHistoryStore.saveScan(mockReport);

      // Verify individual document file exists in data/scans/
      const docPath = path.join(process.cwd(), 'data', 'scans', 'test-scan-001.json');
      expect(fs.existsSync(docPath)).toBe(true);

      const parsedDoc = JSON.parse(fs.readFileSync(docPath, 'utf-8'));
      expect(parsedDoc.id).toBe('test-scan-001');

      // Verify lightweight summary index does NOT contain heavy rawStats
      const summaries = await ScanHistoryStore.getScanSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe('test-scan-001');
      expect(summaries[0].overallScore).toBe(88);
      expect((summaries[0] as any).rawStats).toBeUndefined();
      expect((summaries[0] as any).findings).toBeUndefined();
    });

    it('prunes oldest document files when exceeding 50 scans', async () => {
      // Save 55 reports
      for (let i = 1; i <= 55; i++) {
        const report = {
          ...mockReport,
          id: `scan-prune-${String(i).padStart(3, '0')}`,
        };
        await ScanHistoryStore.saveScan(report);
      }

      const summaries = await ScanHistoryStore.getScanSummaries();
      expect(summaries.length).toBe(50);
      expect(summaries[0].id).toBe('scan-prune-055');

      // The oldest 5 documents (scan-prune-001 to scan-prune-005) should have been unlinked
      const oldestDocPath = path.join(process.cwd(), 'data', 'scans', 'scan-prune-001.json');
      expect(fs.existsSync(oldestDocPath)).toBe(false);

      // The newest document should exist
      const newestDocPath = path.join(process.cwd(), 'data', 'scans', 'scan-prune-055.json');
      expect(fs.existsSync(newestDocPath)).toBe(true);
    });

    it('handles concurrent saves safely without race conditions or lost updates', async () => {
      const reports = Array.from({ length: 10 }, (_, i) => ({
        ...mockReport,
        id: `scan-concurrent-${i}`,
      }));

      await Promise.all(reports.map((r) => ScanHistoryStore.saveScan(r)));

      const summaries = await ScanHistoryStore.getScanSummaries();
      expect(summaries.length).toBe(10);
      const summaryIds = summaries.map((s) => s.id);
      for (let i = 0; i < 10; i++) {
        expect(summaryIds).toContain(`scan-concurrent-${i}`);
      }

      // Check all individual documents exist
      for (let i = 0; i < 10; i++) {
        const docPath = path.join(process.cwd(), 'data', 'scans', `scan-concurrent-${i}.json`);
        expect(fs.existsSync(docPath)).toBe(true);
      }
    });
  });
});
