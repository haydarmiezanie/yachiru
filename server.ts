import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { DEMO_CLUSTERS } from './server/scanner/demoDatasets.js';
import { ClickHouseScannerClient } from './server/scanner/clickhouseClient.js';
import { runDeterministicScan } from './server/scanner/deterministicRules.js';
import { synthesizeWithAI } from './server/scanner/aiSynthesis.js';
import { buildAiMigrationScript } from './server/scanner/synthesisShared.js';
import { ScanHistoryStore } from './server/storage/scanHistory.js';
import { ScanReport } from './src/types/yachiru.js';
import {
  ScanRequestSchema,
  TestConnectionRequestSchema,
  SavedConnectionCreateSchema,
  SavedConnectionUpdateSchema,
  RetrustHostKeySchema,
} from './server/validation/scanSchemas.js';
import {
  saveConnection,
  updateConnection,
  listSavedConnections,
  deleteConnection,
  resolveConnectionForScan,
} from './server/storage/connectionStore.js';
import { retrustHostKey, getAllHostKeys } from './server/scanner/hostKeyStore.js';
import { redactScanTarget } from './server/security/redaction.js';
import { logger } from './server/logger.js';
import { requireRole, isRequireApiKey, isStrictAuth, safeCompare, matchesAllowedApiKey } from './server/auth/rbacMiddleware.js';
import { apiLimiter, scanLimiter } from './server/rateLimiter.js';
import YAML from 'yaml';
import { buildOpenApiSpec } from './server/openapi/openApiSpec.js';
export { safeCompare, matchesAllowedApiKey };

// Process-Level Resilience: prevent unhandled promise rejections or uncaught exceptions from abruptly exiting process (which causes 502 Bad Gateway)
process.on('unhandledRejection', (reason: any) => {
  logger.error({ err: reason instanceof Error ? reason.message : reason, stack: reason?.stack }, 'Unhandled Promise Rejection caught at process level');
});

process.on('uncaughtException', (err: Error) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught Exception caught at process level');
});

let cachedOpenApiSpec: Record<string, any> | null = null;
let cachedOpenApiYaml: string | null = null;

function getOpenApiSpec(): Record<string, any> {
  if (!cachedOpenApiSpec) {
    cachedOpenApiSpec = buildOpenApiSpec();
  }
  return cachedOpenApiSpec;
}

function getOpenApiYaml(): string {
  if (!cachedOpenApiYaml) {
    cachedOpenApiYaml = YAML.stringify(getOpenApiSpec(), { indent: 2 });
  }
  return cachedOpenApiYaml;
}

export function resolveAllowedOrigins(env = process.env): string[] {
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (env.APP_URL) {
    try {
      const appOrigin = new URL(env.APP_URL).origin;
      if (!configured.includes(appOrigin)) {
        configured.push(appOrigin);
      }
    } catch {
      // Ignore invalid APP_URL format
    }
  }

  if (env.NODE_ENV !== 'production') {
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ];
    for (const dev of devOrigins) {
      if (!configured.includes(dev)) {
        configured.push(dev);
      }
    }
  }

  return configured;
}

export const app = express();
const PORT = 3000;

// Trust reverse proxy (Cloud Run, Nginx, load balancers)
app.set('trust proxy', 1);

// -------------------------------------------------------------
// Security Middlewares (P0)
// -------------------------------------------------------------

// Helmet for robust HTTP security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Prevents iframe preview and Vite development HMR blocking
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false, // CRITICAL: Allows Firebase/Google Auth popups to communicate with window.opener
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // Required for Google OAuth domain verification
  })
);

// CORS with strict origin whitelist enforcement (Defense-in-depth: No fail-open with credentials)
const allowedOrigins = resolveAllowedOrigins();

// Warn if not explicitly configured in production
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  logger.warn('ALLOWED_ORIGINS is not explicitly configured in production. Only same-origin requests will be accepted.');
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin direct requests)
      if (!origin) {
        return callback(null, true);
      }
      // Strictly check against whitelisted origins - NEVER allow arbitrary origins when credentials: true
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
    },
    credentials: true,
  })
);

app.use('/api', apiLimiter);
app.use(express.json({ limit: '10mb' }));

// Graceful JSON syntax error handler (catches malformed JSON payloads and returns structured JSON instead of HTML)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    logger.warn({ err: err.message, path: req.path, ip: req.ip }, 'Malformed JSON payload received');
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON payload. Ensure your request body is valid JSON with properly escaped quotes and matching braces.',
      syntaxError: err.message,
    });
  }
  next(err);
});

// Authentication Middleware (Enforces Firebase ID token & RBAC roles)
// Roles: 'viewer' (read-only history), 'auditor' (scans & probes), 'admin' (destructive operations)
const requireViewer = requireRole('viewer');
const requireAuditor = requireRole('auditor');
const requireAdmin = requireRole('admin');

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

// Current Authenticated User & Role Context
app.get('/api/auth/me', requireViewer, (req: Request, res: Response) => {
  return res.json({ user: req.user });
});

// Health check (Open)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Yachiru ClickHouse Optimization Scanner',
    version: '1.0.0',
    aiConfigured: Boolean(
      (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY')
    ),
  });
});

// Available Demo Clusters / Presets (Open)
app.get('/api/demo-clusters', (req: Request, res: Response) => {
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

// OpenAPI 3.1 Specification Endpoints (Open)
app.get('/api/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(getOpenApiSpec());
});

app.get('/api/openapi.yaml', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  return res.send(getOpenApiYaml());
});

// Interactive Swagger UI Documentation (Open)
app.get('/api/docs', (req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Yachiru API Documentation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .topbar { display: none !important; }
    .swagger-ui .info .title { color: #f8fafc !important; }
    .swagger-ui .info p, .swagger-ui .info li { color: #94a3b8 !important; }
    .swagger-ui { max-width: 1280px; margin: 0 auto; padding: 24px 16px; background: #0f172a; }
    .swagger-ui .scheme-container { background: #1e293b !important; box-shadow: none !important; border-radius: 8px; border: 1px solid #334155; }
    .swagger-ui select { background: #0f172a !important; color: #f8fafc !important; border: 1px solid #475569 !important; }
    .swagger-ui .opblock { border-radius: 8px !important; box-shadow: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

// Test Connection (Protected: Auditor role required + Zod Runtime Validation)
app.post('/api/clickhouse/test-connection', requireAuditor, async (req: Request, res: Response) => {
  let targetData = req.body;
  if (req.body?.connectionId) {
    const resolved = await resolveConnectionForScan(req.body.connectionId);
    if (!resolved) {
      return res.status(404).json({ success: false, message: 'Saved cluster connection not found' });
    }
    targetData = { ...resolved, ...req.body };
  }

  const parsed = TestConnectionRequestSchema.safeParse(targetData);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid connection parameters',
      errors: parsed.error.format(),
    });
  }

  try {
    const client = new ClickHouseScannerClient(parsed.data);
    const result = await client.testConnection();
    return res.json(result);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: error }, 'Test connection failed');
    return res.status(500).json({ success: false, message: error.message || 'Connection test failed' });
  }
});

// Discover Accessible Databases (Protected: Auditor role required + Zod Runtime Validation)
app.post('/api/clickhouse/databases', requireAuditor, async (req: Request, res: Response) => {
  let targetData = req.body;
  if (req.body?.connectionId) {
    const resolved = await resolveConnectionForScan(req.body.connectionId);
    if (!resolved) {
      return res.status(404).json({ success: false, message: 'Saved cluster connection not found' });
    }
    targetData = { ...resolved, ...req.body };
  }

  const parsed = TestConnectionRequestSchema.safeParse(targetData);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid connection parameters',
      errors: parsed.error.format(),
    });
  }

  try {
    const client = new ClickHouseScannerClient(parsed.data);
    const result = await client.testConnection();
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json({
      success: true,
      databases: result.databases || ['default'],
      total: result.databases ? result.databases.length : 1,
      version: result.version,
      message: result.message,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: error }, 'Databases discovery failed');
    return res.status(500).json({ success: false, message: error.message || 'Failed to retrieve databases' });
  }
});

// Execute Full 9-Dimension Scan (Protected: Auditor role required + Rate-limited + Zod Validation)
app.post('/api/clickhouse/scan', requireAuditor, scanLimiter, async (req: Request, res: Response) => {
  // Support AI agentic options via JSON body or HTTP headers (with full alias support)
  let rawPayload = {
    ...req.body,
    aiProvider:
      req.body?.aiProvider ||
      req.body?.provider ||
      req.body?.ai_provider ||
      (req.headers['x-ai-provider'] as string) ||
      undefined,
    aiModel:
      req.body?.aiModel ||
      req.body?.model ||
      req.body?.ai_model ||
      (req.headers['x-ai-model'] as string) ||
      undefined,
    aiApiKey:
      req.body?.aiApiKey ||
      req.body?.apiKey ||
      req.body?.customApiKey ||
      req.body?.customKey ||
      req.body?.ai_api_key ||
      req.body?.openai_api_key ||
      req.body?.openai_key ||
      req.body?.gemini_api_key ||
      req.body?.gemini_key ||
      ((req.headers['x-ai-api-key'] ||
        req.headers['x-openai-key'] ||
        req.headers['x-gemini-key'] ||
        req.headers['x-custom-api-key'] ||
        req.headers['x-ai-key']) as string) ||
      undefined,
  };

  if (req.body?.connectionId) {
    const resolved = await resolveConnectionForScan(req.body.connectionId);
    if (!resolved) {
      return res.status(404).json({ error: 'Saved cluster connection not found' });
    }
    rawPayload = {
      ...rawPayload,
      target: { ...resolved, ...(req.body.target || {}) },
    };
  }

  const parsed = ScanRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid scan request payload',
      details: parsed.error.format(),
    });
  }

  const { target, aiEnabled, aiProvider, aiModel, aiApiKey } = parsed.data;
  const startTime = Date.now();

  try {
    logger.info(
      {
        target: target.isDemoCluster ? `Demo (${target.demoClusterId})` : `${target.host}:${target.port}/${target.database}`,
        ai: aiEnabled ? `${aiProvider} (${aiModel})` : 'Disabled',
      },
      'Starting ClickHouse health scan'
    );

    // 1. Fetch Cluster System Tables (Read-Only)
    const client = new ClickHouseScannerClient(target);
    const clusterData = await client.fetchClusterData();

    // 2. Run 9-Dimension Deterministic Scanner (Source of Truth)
    const deterministicResult = runDeterministicScan(clusterData);

    // 3. Optional AI Synthesis Layer (Gemini or OpenAI ChatGPT)
    const synthesis = await synthesizeWithAI(deterministicResult, {
      aiEnabled,
      provider: aiProvider,
      modelName: aiModel,
      databaseName: target.database || clusterData.tables[0]?.database || 'default',
      clusterName: clusterData.clusterName,
      apiKey: aiApiKey,
    });

    logger.info({ aiStatus: synthesis.aiStatus, error: synthesis.error, provider: aiProvider, model: aiModel }, 'AI synthesis completed');

    // 4. Assemble Final Scan Report
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const durationMs = Date.now() - startTime;

    const deterministicMigrationScript = deterministicResult.migrationScript;
    let aiMigrationScript: string | undefined = undefined;

    // Generate AI-tailored DDL migration plan if AI was enabled
    if (aiEnabled) {
      aiMigrationScript = buildAiMigrationScript({
        database: target.database || clusterData.tables[0]?.database || 'default',
        clusterName: clusterData.clusterName,
        findings: synthesis.enhancedFindings,
        executiveSummary: synthesis.executiveSummary,
        provider: synthesis.provider,
        modelUsed: synthesis.executiveSummary?.modelUsed || (synthesis.aiStatus === 'success' ? 'Google Gemini' : undefined),
      });
    }

    const isAiMigration = Boolean(aiMigrationScript) && (synthesis.aiStatus === 'success' || aiEnabled);
    const activeMigrationScript = isAiMigration ? (aiMigrationScript || deterministicMigrationScript) : deterministicMigrationScript;

    const report: ScanReport = {
      id: scanId,
      timestamp: new Date().toISOString(),
      target: {
        host: target.host || 'localhost',
        port: target.port || 8123,
        database: target.database || clusterData.tables[0]?.database || 'default',
        isDemoCluster: Boolean(target.isDemoCluster),
        clusterName: clusterData.clusterName,
        sshTunnel: target.sshTunnel
          ? {
              enabled: target.sshTunnel.enabled,
              host: target.sshTunnel.host,
              port: target.sshTunnel.port,
              username: target.sshTunnel.username,
              authMethod: target.sshTunnel.authMethod,
            }
          : undefined,
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
      migrationScript: activeMigrationScript,
      deterministicMigrationScript,
      aiMigrationScript,
      isAiMigration: Boolean(aiMigrationScript),
      scanDurationMs: durationMs,
      aiStatus: synthesis.aiStatus,
      aiProvider: synthesis.provider,
      aiErrorMessage: synthesis.error,
    };

    // 5. Save Report to History Store (Asynchronously & Atomically with PII masking)
    try {
      await ScanHistoryStore.saveScan(report);
    } catch (saveErr) {
      logger.warn({ err: saveErr }, 'Failed to persist scan to history store, proceeding with report delivery');
    }

    logger.info(
      { scanId, durationMs, overallScore: report.overallScore, grade: report.overallGrade },
      'Scan completed successfully'
    );
    return res.json(report);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.message }, 'Scan execution could not connect or failed');
    return res.status(400).json({ error: error.message || 'Scan execution failed' });
  }
});

// History Endpoints (Protected: Viewer role for reading, Admin role for deletion)
app.get('/api/history', requireViewer, async (req: Request, res: Response) => {
  const summaries = await ScanHistoryStore.getScanSummaries();
  res.json(summaries);
});

app.get('/api/history/:id', requireViewer, async (req: Request, res: Response) => {
  const report = await ScanHistoryStore.getScanById(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Scan report not found' });
  }
  return res.json(report);
});

app.delete('/api/history', requireAdmin, async (req: Request, res: Response) => {
  await ScanHistoryStore.clearHistory();
  return res.json({ success: true, message: 'Scan history cleared' });
});

// -------------------------------------------------------------
// Cluster Connection Management (RBAC: Viewer reads, Admin writes)
// -------------------------------------------------------------
app.get('/api/connections', requireViewer, async (req: Request, res: Response) => {
  try {
    const list = await listSavedConnections();
    return res.json(list);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to list saved connections');
    return res.status(500).json({ error: 'Failed to retrieve saved connections' });
  }
});

app.post('/api/connections', requireAdmin, async (req: Request, res: Response) => {
  const parsed = SavedConnectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid connection configuration', details: parsed.error.format() });
  }

  try {
    const id = parsed.data.id || `conn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const saved = await saveConnection(id, parsed.data.name, parsed.data.target, req.user?.uid);
    logger.info({ id, name: parsed.data.name, user: req.user?.email }, 'Saved new cluster connection');
    return res.status(201).json(saved);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to save cluster connection');
    return res.status(500).json({ error: err?.message || 'Failed to save connection' });
  }
});

app.put('/api/connections/:id', requireAdmin, async (req: Request, res: Response) => {
  const parsed = SavedConnectionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid update payload', details: parsed.error.format() });
  }

  try {
    const updated = await updateConnection(req.params.id, parsed.data.name, parsed.data.target, req.user?.uid);
    logger.info({ id: req.params.id, name: parsed.data.name, user: req.user?.email }, 'Updated cluster connection');
    return res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to update cluster connection');
    return res.status(500).json({ error: err?.message || 'Failed to update connection' });
  }
});

app.delete('/api/connections/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const success = await deleteConnection(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    logger.info({ id: req.params.id, user: req.user?.email }, 'Deleted cluster connection');
    return res.json({ success: true, message: 'Connection removed successfully' });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to delete cluster connection');
    return res.status(500).json({ error: 'Failed to delete connection' });
  }
});

// -------------------------------------------------------------
// SSH Known Host Keys Management (Admin only)
// -------------------------------------------------------------
app.get('/api/ssh/host-keys', requireAdmin, async (req: Request, res: Response) => {
  try {
    const keys = await getAllHostKeys();
    return res.json(keys);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to retrieve SSH host keys');
    return res.status(500).json({ error: 'Failed to retrieve SSH host keys' });
  }
});

app.post('/api/ssh/retrust-host-key', requireAdmin, async (req: Request, res: Response) => {
  const parsed = RetrustHostKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload', details: parsed.error.format() });
  }

  try {
    await retrustHostKey(parsed.data.host, parsed.data.port, parsed.data.newFingerprint);
    logger.info({ host: parsed.data.host, port: parsed.data.port, user: req.user?.email }, 'SSH host key re-trusted');
    return res.json({
      success: true,
      message: `Host key for ${parsed.data.host}:${parsed.data.port} re-trusted successfully.`,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Failed to re-trust SSH host key');
    return res.status(500).json({ error: err?.message || 'Failed to re-trust host key' });
  }
});

// -------------------------------------------------------------
// Vite Integration / Static Serving & Server Startup
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`[Yachiru Server] Listening on http://0.0.0.0:${PORT}`);

    const secretKey = (process.env.YACHIRU_API_KEY || process.env.API_SECRET_KEY || '').trim();
    const requireKey = isRequireApiKey();
    const strictAuth = isStrictAuth();

    if (secretKey) {
      logger.info('[Yachiru Auth] YACHIRU_API_KEY boundary is ACTIVE. API endpoints are protected.');
    } else if (process.env.NODE_ENV === 'production') {
      logger.info(
        `[Yachiru Auth] Running in production with fail-closed security: REQUIRE_API_KEY=${requireKey} and STRICT_AUTH=${strictAuth} active by default. Authentication is strictly enforced on API endpoints.`
      );
    } else {
      logger.info(
        `[Yachiru Auth] Running in development mode (REQUIRE_API_KEY=${requireKey}, STRICT_AUTH=${strictAuth}).`
      );
    }
  });

  // Graceful shutdown handling (P2)
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Received termination signal. Closing server gracefully...');
    server.close(() => {
      logger.info('HTTP server closed. Exiting process.');
      process.exit(0);
    });

    // Force shutdown after 10s if hanging
    setTimeout(() => {
      logger.error('Forced shutdown due to timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
if (!isTestEnv) {
  startServer();
}

export { startServer };
