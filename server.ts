import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ClickHouseClient } from '@clickhouse/client';
import { runLiveScan, runSimulationScan } from './server/analyzer.js';
import {
  generateNarrativeForProvider,
  generateDeterministicNarrative,
  geminiSystemKeyState,
  openaiSystemKeyState,
} from './server/narrator.js';
import { ConnectionConfig, AiProvider } from './src/types.js';

export function classifyConnectionError(errorMsg: string): { hint: string } {
  if (/timeout|etimedout/i.test(errorMsg)) {
    return {
      hint: 'Connection or query timed out. In cloud sandboxes, "localhost" refers to the isolated container, not your local desktop machine. If connecting to a local ClickHouse instance, expose your port 8123 via a tunnel (such as ngrok or Cloudflare tunnel) or use ClickHouse Cloud. You can also explore the realistic simulation demo cluster.',
    };
  }
  if (/econnrefused|connection refused|refused/i.test(errorMsg)) {
    return {
      hint: 'Connection was actively refused by the target host. Verify ClickHouse is running and listening on the specified HTTP port (default 8123 for HTTP, 8443 for HTTPS). Note: native TCP client port 9000 is not supported over HTTP.',
    };
  }
  if (/401|403|auth|password|credentials|access denied/i.test(errorMsg)) {
    return {
      hint: 'Authentication failed. Please verify your username and password, and ensure the user has SELECT privileges on the required system.* metadata tables (see in-app setup guide).',
    };
  }
  return {
    hint: 'Please verify host reachability, port (8123 HTTP / 8443 HTTPS), database name, and user privileges. Ensure the user has SELECT privileges on the required system.* metadata tables (see in-app setup guide).',
  };
}

const YACHIRU_API_KEY = process.env.YACHIRU_API_KEY?.trim() || null;

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!YACHIRU_API_KEY) return next(); // feature disabled, behave exactly as today
  const header = req.headers['authorization'];
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const altHeader = (req.headers['x-yachiru-api-key'] as string | undefined)?.trim();
  const provided = bearerToken || altHeader;
  if (!provided || provided !== YACHIRU_API_KEY) {
    return res.status(401).json({ error: 'Missing or invalid API key. Provide it via "Authorization: Bearer <key>" or "X-Yachiru-Api-Key: <key>".' });
  }
  next();
}

function validateConnectionConfig(config: ConnectionConfig): { error?: string } {
  // Skip validation entirely when isDemo is true
  if (config && config.isDemo === true) {
    return {};
  }

  // 1. host must be a non-empty string after trimming
  if (typeof config?.host !== 'string' || config.host.trim() === '') {
    return { error: 'host is required and must be a non-empty string.' };
  }

  // 2. port, if provided, must be a positive integer <= 65535
  if (config.port !== undefined && config.port !== null && String(config.port).trim() !== '') {
    const portNum = Number(config.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { error: 'port must be a positive integer between 1 and 65535.' };
    }
  }

  // 3. protocol, if provided, must be exactly 'http' or 'https'
  if (config.protocol !== undefined && config.protocol !== null && String(config.protocol).trim() !== '') {
    if (config.protocol !== 'http' && config.protocol !== 'https') {
      return { error: "protocol must be 'http' or 'https'." };
    }
  }

  return {};
}

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.YACHIRU_RATE_LIMIT_PER_MINUTE) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer the API key as the rate-limit identity when auth is enabled, so one
    // caller can't be starved by another IP behind the same NAT/proxy; fall back to
    // IP when no key is configured.
    const header = req.headers['authorization'];
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const altHeader = req.headers['x-yachiru-api-key'] as string | undefined;
    const apiKeyIdentity = bearerToken || altHeader;
    if (apiKeyIdentity) return apiKeyIdentity;
    return ipKeyGenerator(req.ip ?? '127.0.0.1');
  },
  message: { error: 'Too many analysis requests. Please wait before retrying.' },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parser for connection payloads
  app.use(express.json({ limit: '10mb' }));

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Yachiru ClickHouse Analyzer',
      apiKeyRequired: Boolean(YACHIRU_API_KEY),
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
      hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      geminiSystemKeyState: geminiSystemKeyState.getStatus(),
      openaiSystemKeyState: openaiSystemKeyState.getStatus(),
      // Backward compatibility
      systemKeyState: geminiSystemKeyState.getStatus(),
    });
  });

  // System key status endpoint
  app.get('/api/system-key-status', (req, res) => {
    const provider = (req.query.provider as string)?.toLowerCase();
    if (provider === 'openai') {
      return res.json(openaiSystemKeyState.getStatus());
    }
    res.json(geminiSystemKeyState.getStatus());
  });

  // System key reset endpoint
  app.post('/api/system-key-reset', requireApiKey, (req, res) => {
    const provider = (req.query.provider as string)?.toLowerCase();
    if (provider === 'openai') {
      openaiSystemKeyState.reset('Manual admin trigger via /api/system-key-reset?provider=openai');
      return res.json({ success: true, provider: 'openai', status: openaiSystemKeyState.getStatus() });
    }
    geminiSystemKeyState.reset('Manual admin trigger via /api/system-key-reset');
    res.json({ success: true, provider: 'gemini', status: geminiSystemKeyState.getStatus() });
  });

  // Fast test connection endpoint
  app.post('/api/test-connection', analyzeLimiter, requireApiKey, async (req, res) => {
    const config: ConnectionConfig = req.body;
    const validation = validateConnectionConfig(config);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    if (config.isDemo) {
      return res.json({
        success: true,
        message: 'Demo cluster verified successfully (24.8.4.13-lts).',
        version: '24.8.4.13-lts',
        uptime: '14 days, 6 hours',
      });
    }

    let client: ClickHouseClient | undefined = undefined;
    try {
      const { createClient } = await import('@clickhouse/client');
      const protocol = config.protocol || 'http';
      let host = config.host?.trim() || 'localhost';
      // Strip any accidental protocol or paths from host
      host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      const port = Number(config.port) || (protocol === 'https' ? 8443 : 8123);
      const username = config.username?.trim() || 'default';
      const password = config.password || '';
      const database = config.database?.trim() || 'default';

      client = createClient({
        url: `${protocol}://${host}:${port}`,
        username,
        password,
        database,
        clickhouse_settings: {
          connect_timeout: 5,
        },
      });

      // Quick ping test
      const pingOk = await client.ping();
      if (!pingOk) {
        throw new Error('ClickHouse server did not respond with OK to ping test.');
      }

      // Quick query test to verify credentials and fetch ClickHouse version
      const versionResult = await client.query({
        query: 'SELECT version() AS ver',
        format: 'JSONEachRow',
      });
      const versionRows = (await versionResult.json()) as Array<{ ver: string }>;
      const clickhouseVersion = versionRows[0]?.ver || 'OK';

      // Quick permissions check: attempt to read 1 row from system.build_options or system.tables
      try {
        await client.query({
          query: 'SELECT name FROM system.build_options LIMIT 1',
          format: 'JSONEachRow',
        });
      } catch (permErr: any) {
        return res.json({
          success: false,
          error: `Connected to ClickHouse v${clickhouseVersion}, but lack SELECT permissions on system.* tables.`,
          hint: 'Please ensure your database user has SELECT grants on system.* tables (e.g. system.parts, system.columns, system.tables).',
        });
      }

      res.json({
        success: true,
        version: clickhouseVersion,
        message: `Successfully connected to ClickHouse v${clickhouseVersion} at ${host}:${port}`,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown connection error';
      console.warn('Test connection failure:', errMsg);
      const { hint } = classifyConnectionError(errMsg);
      res.status(400).json({
        success: false,
        error: errMsg,
        hint,
      });
    } finally {
      await client?.close();
    }
  });

  // Analysis endpoint
  app.post('/api/analyze', analyzeLimiter, requireApiKey, async (req, res) => {
    const config: ConnectionConfig = req.body;
    const validation = validateConnectionConfig(config);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      let report;
      if (config.isDemo) {
        // Run realistic simulated production ClickHouse cluster analysis
        report = runSimulationScan();
      } else {
        // Live ClickHouse analysis via official @clickhouse/client
        // Credentials are held in memory only for the duration of this request
        report = await runLiveScan(config);
      }

      // If AI narrative is requested vs Without AI (Deterministic)
      if (config.enableAiNarrative) {
        const provider: AiProvider = config.aiProvider || (config.geminiModel?.startsWith('gpt-') ? 'openai' : 'gemini');
        const activeApiKey = provider === 'openai' ? config.openaiApiKey : config.geminiApiKey;
        const activeModel = config.geminiModel;

        try {
          const narrative = await generateNarrativeForProvider(
            report,
            provider,
            activeModel,
            activeApiKey,
            {
              enableAiNarrative: true,
              allowSystemKeyFallback: true,
            }
          );
          report.ai_narrative = narrative;
          report.ai_diagnoses = narrative.ai_diagnoses || [];

          // If AI produced deep diagnoses, enrich findings list with AI-diagnosed flags and findings
          if (narrative.isAiGenerated && narrative.ai_diagnoses && narrative.ai_diagnoses.length > 0) {
            const aiFindings = narrative.ai_diagnoses.map((diag, idx) => ({
              id: `ai_${diag.category || 'finding'}_${idx}_${diag.id ? diag.id.replace(/[^a-zA-Z0-9_]/g, '_') : crypto.randomUUID()}`,
              category: diag.category,
              category_name: diag.category_name || (diag.category ? diag.category.replace(/_/g, ' ').toUpperCase() : 'AI ARCHITECTURAL FINDING'),
              title: diag.title,
              table: diag.table,
              status: diag.status,
              metric_value: 'AI Architectural Assessment',
              threshold: 'Best Practice Standard',
              evidence: diag.deep_assessment,
              impact: diag.risk_vector,
              recommendation_sql_or_text: diag.remediation_sql || (diag.remediation_plan ? diag.remediation_plan.join('\n') : ''),
              is_sql_recommendation: Boolean(diag.remediation_sql && diag.remediation_sql.trim().length > 0),
              is_ai_diagnosed: true,
              ai_root_cause: diag.root_cause,
              ai_remediation_steps: diag.remediation_plan,
              ai_risk_vector: diag.risk_vector,
            }));

            // Prepend AI diagnosed findings
            report.findings = [...aiFindings, ...report.findings];
          }
        } catch (narrativeErr) {
          console.warn('AI Narrative generation failed:', narrativeErr);
          report.ai_narrative = {
            model: activeModel || (provider === 'openai' ? 'OpenAI' : 'Gemini AI'),
            executive_summary: '',
            top_priorities: [],
            workload_risk_analysis: '',
            ai_diagnoses: [],
            isAiGenerated: false,
            aiError: narrativeErr instanceof Error ? narrativeErr.message : 'AI generation error',
            aiErrorCategory: 'unknown',
          };
        }
      } else {
        // Explicit without-AI deterministic synthesis
        report.ai_narrative = generateDeterministicNarrative(
          report,
          'Deterministic Rule Engine (Without AI)'
        );
      }

      res.json(report);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown connection or query error';
      console.error('ClickHouse scan failure:', errorMsg);

      const { hint } = classifyConnectionError(errorMsg);

      res.status(500).json({
        error: errorMsg,
        hint,
      });
    }
  });

  // Narrative generation on-demand for existing report
  app.post('/api/narrate', requireApiKey, async (req, res) => {
    const {
      report,
      provider: reqProvider,
      model,
      geminiApiKey,
      openaiApiKey,
      enableAiNarrative,
      allowSystemKeyFallback,
    } = req.body;

    if (!report) {
      return res.status(400).json({ error: 'Missing report payload' });
    }

    try {
      const isAiRequested = enableAiNarrative !== false;
      const canUseSystemFallback = allowSystemKeyFallback ?? isAiRequested;

      // Determine provider from explicit body or infer from model ID
      const provider: AiProvider = reqProvider || (model?.startsWith('gpt-') ? 'openai' : 'gemini');
      const apiKey = provider === 'openai' ? openaiApiKey : geminiApiKey;

      const narrative = await generateNarrativeForProvider(
        report,
        provider,
        model,
        apiKey,
        {
          enableAiNarrative: isAiRequested,
          allowSystemKeyFallback: canUseSystemFallback,
        }
      );

      if (!narrative) {
        return res.status(503).json({
          error: `AI Narrative could not be generated. Please check your ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key or proceed with the deterministic engine.`,
        });
      }
      res.json(narrative);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to synthesize narrative';
      res.status(500).json({ error: msg });
    }
  });

  // Vite middleware for development vs static build for production
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
    console.log(`[Yachiru] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
