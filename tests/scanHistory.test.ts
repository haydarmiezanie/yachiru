import { describe, it, expect, beforeEach } from 'vitest';
import { maskQueryPii, ScanHistoryStore } from '../server/storage/scanHistory.js';
import { ScanReport } from '../src/types/yachiru.js';

describe('Scan History Store & PII Masking', () => {
  beforeEach(async () => {
    await ScanHistoryStore.clearHistory();
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
  });
});
