import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { DEMO_CLUSTERS } from './server/scanner/demoDatasets.js';
import { ClickHouseScannerClient } from './server/scanner/clickhouseClient.js';
import { runDeterministicScan } from './server/scanner/deterministicRules.js';
import { synthesizeWithGemini } from './server/scanner/geminiSynthesis.js';
import { ScanHistoryStore } from './server/storage/scanHistory.js';
import { ScanReport, ScanTarget } from './src/types/yachiru.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // -------------------------------------------------------------
  // API Routes
  // -------------------------------------------------------------
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Yachiru ClickHouse Optimization Scanner',
      version: '1.0.0',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  // Available Demo Clusters / Presets
  app.get('/api/demo-clusters', (req, res) => {
    const list = Object.values(DEMO_CLUSTERS).map((c) => ({
      id: c.id,
      name: c.name,
      tagline: c.tagline,
      industry: c.industry,
      database: c.database,
      tableCount: c.tables.length,
      rowCount: `${(c.totalRows / 1_000_000).toFixed(1)}M rows`,
      typicalIssues: [
        c.id === 'apex_ecommerce' ? 'Nullable overuse & unindexed tenant_id scan' : '',
        c.id === 'nexus_iot' ? 'Partition explosion & missing Gorilla codec' : '',
        c.id === 'finpulse_ledger' ? 'ReplacingMergeTree scan & missing skip index' : '',
        c.id === 'cloudtrace_logs' ? 'LowCardinality candidates & stuck merge' : '',
      ].filter(Boolean),
    }));
    res.json(list);
  });

  // Test Connection
  app.post('/api/clickhouse/test-connection', async (req, res) => {
    try {
      const target: ScanTarget = req.body;
      const client = new ClickHouseScannerClient(target);
      const result = await client.testConnection();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Connection test failed' });
    }
  });

  // Execute Full 9-Dimension Scan
  app.post('/api/clickhouse/scan', async (req, res) => {
    const startTime = Date.now();
    try {
      const {
        target,
        aiEnabled = true,
        aiModel = 'gemini-3.7-flash',
      }: {
        target: ScanTarget;
        aiEnabled?: boolean;
        aiModel?: string;
      } = req.body;

      if (!target) {
        return res.status(400).json({ error: 'Missing target connection parameters' });
      }

      console.log(`[Yachiru] Starting scan on target: ${target.isDemoCluster ? `Demo (${target.demoClusterId})` : `${target.host}:${target.port}/${target.database}`}`);

      // 1. Fetch Cluster System Tables (Read-Only)
      const client = new ClickHouseScannerClient(target);
      const clusterData = await client.fetchClusterData();

      // 2. Run 9-Dimension Deterministic Scanner (Source of Truth)
      const deterministicResult = runDeterministicScan(clusterData);

      // 3. Optional AI Synthesis Layer (Gemini)
      const synthesis = await synthesizeWithGemini(deterministicResult, {
        aiEnabled,
        modelName: aiModel,
        databaseName: target.database || clusterData.tables[0]?.database || 'default',
        clusterName: clusterData.clusterName,
      });

      // 4. Assemble Final Scan Report
      const scanId = `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const durationMs = Date.now() - startTime;

      const report: ScanReport = {
        id: scanId,
        timestamp: new Date().toISOString(),
        target: {
          host: target.host || 'localhost',
          port: target.port || 8123,
          database: target.database || clusterData.tables[0]?.database || 'default',
          isDemoCluster: Boolean(target.isDemoCluster),
          clusterName: clusterData.clusterName,
        },
        overallScore: deterministicResult.overallScore,
        overallGrade: deterministicResult.overallGrade,
        dimensionScores: deterministicResult.dimensionScores,
        findings: synthesis.enhancedFindings,
        executiveSummary: synthesis.executiveSummary,
        clusterMetadata: {
          version: clusterData.version,
          clusterName: clusterData.clusterName,
          totalDatabases: clusterData.totalDatabases,
          totalTables: deterministicResult.stats.totalTables,
          totalParts: deterministicResult.stats.totalParts,
          totalRows: deterministicResult.stats.totalRows,
          totalDiskSizeBytes: deterministicResult.stats.totalDiskSizeBytes,
          totalDiskSizeFormatted: deterministicResult.stats.totalDiskSizeFormatted,
          queriesAnalyzed: deterministicResult.stats.queriesAnalyzed,
          timeWindow: 'Last 7 Days',
          uptimeSeconds: clusterData.uptimeSeconds,
        },
        rawStats: {
          tables: clusterData.tables,
          partsSummary: { totalParts: clusterData.parts.length, sample: clusterData.parts.slice(0, 10) },
          mergesSummary: { activeMerges: clusterData.merges.length, sample: clusterData.merges },
          slowQueries: clusterData.queryLog.slice(0, 10),
          expensivePatterns: clusterData.queryLog.filter((q) => q.read_rows > 1_000_000),
          columnsWithIssues: clusterData.columns.filter((c) => c.is_nullable || (c.cardinality_approx && c.cardinality_approx < 100)),
          configSettings: clusterData.settings,
        },
        migrationScript: deterministicResult.migrationScript,
        scanDurationMs: durationMs,
        aiStatus: synthesis.aiStatus,
        aiErrorMessage: synthesis.error,
      };

      // 5. Save Report to History Store
      ScanHistoryStore.saveScan(report);

      console.log(`[Yachiru] Scan complete in ${durationMs}ms with overall score: ${report.overallScore}/100`);
      res.json(report);
    } catch (err: any) {
      console.error('[Yachiru] Scan error:', err);
      res.status(500).json({ error: err.message || 'Internal server error during scan execution' });
    }
  });

  // History Endpoints
  app.get('/api/history', (req, res) => {
    const list = ScanHistoryStore.getAllScans().map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      target: s.target,
      overallScore: s.overallScore,
      overallGrade: s.overallGrade,
      findingsCount: s.findings.length,
      criticalCount: s.findings.filter((f) => f.severity === 'critical').length,
      warningCount: s.findings.filter((f) => f.severity === 'warning').length,
      aiStatus: s.aiStatus,
    }));
    res.json(list);
  });

  app.get('/api/history/:id', (req, res) => {
    const report = ScanHistoryStore.getScanById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Scan report not found' });
    }
    res.json(report);
  });

  app.delete('/api/history', (req, res) => {
    ScanHistoryStore.clearHistory();
    res.json({ success: true, message: 'Scan history cleared' });
  });

  // -------------------------------------------------------------
  // Vite Integration / Static Serving
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Yachiru Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
