import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { runLiveScan, runSimulationScan } from './server/analyzer.js';
import { generateNarrative, generateDeterministicNarrative, systemKeyState } from './server/narrator.js';
import { ConnectionConfig } from './src/types.js';

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
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      systemKeyState: systemKeyState.getStatus(),
    });
  });

  // System key status endpoint
  app.get('/api/system-key-status', (req, res) => {
    res.json(systemKeyState.getStatus());
  });

  // System key reset endpoint
  app.post('/api/system-key-reset', (req, res) => {
    systemKeyState.reset('Manual admin trigger via /api/system-key-reset');
    res.json({ success: true, status: systemKeyState.getStatus() });
  });

  // Fast test connection endpoint
  app.post('/api/test-connection', async (req, res) => {
    const config: ConnectionConfig = req.body;
    if (config.isDemo) {
      return res.json({
        success: true,
        message: 'Demo cluster verified successfully (24.8.4.13-lts).',
        version: '24.8.4.13-lts',
        uptime: '14 days, 6 hours',
      });
    }

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

      const client = createClient({
        url: `${protocol}://${host}:${port}`,
        username,
        password,
        database,
        request_timeout: 8000,
        clickhouse_settings: {
          max_execution_time: 5,
        },
      });

      try {
        const pingRes = await client.ping();
        if (!pingRes.success) {
          const pingErr = 'error' in pingRes ? (pingRes as unknown as { error?: { message?: string } }).error : undefined;
          throw new Error(pingErr?.message || 'Server ping check failed');
        }

        const verRes = await client.query({
          query: 'SELECT version() AS version, uptime() AS uptime',
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 5 },
        });
        const verRows = await verRes.json<{ version: string; uptime: number }>();
        const version = verRows[0]?.version || 'Connected';
        const uptimeSec = verRows[0]?.uptime || 0;
        const uptimeStr = `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h`;

        return res.json({
          success: true,
          message: `Successfully connected to ClickHouse v${version} (${protocol.toUpperCase()})`,
          version,
          uptime: uptimeStr,
        });
      } finally {
        await client.close();
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown connection error';
      let hint = 'Please verify host reachability, port (8123 HTTP / 8443 HTTPS), database name, and user credentials.';
      if (/timeout|etimedout/i.test(errorMsg)) {
        hint = 'Connection timed out. In cloud sandboxes, "localhost" refers to the isolated container. If connecting to a local instance, expose via tunnel (ngrok/Cloudflare) or use ClickHouse Cloud.';
      } else if (/econnrefused/i.test(errorMsg)) {
        hint = 'Connection refused. Ensure ClickHouse is running and listening on the specified HTTP port (8123 HTTP / 8443 HTTPS). Note that native port 9000 is not supported.';
      } else if (/401|403|auth|password|credentials|access denied/i.test(errorMsg)) {
        hint = 'Authentication failed. Please verify your username and password, and verify permissions on target database.';
      }

      return res.status(400).json({
        success: false,
        error: errorMsg,
        hint,
      });
    }
  });

  // Analysis endpoint
  app.post('/api/analyze', async (req, res) => {
    const config: ConnectionConfig = req.body;

    try {
      let report;
      if (config.isDemo || !config.host) {
        // Run realistic simulated production ClickHouse cluster analysis
        report = runSimulationScan();
      } else {
        // Live ClickHouse analysis via official @clickhouse/client
        // Credentials are held in memory only for the duration of this request
        report = await runLiveScan(config);
      }

      // If AI narrative is requested vs Without AI (Deterministic)
      if (config.enableAiNarrative) {
        try {
          const narrative = await generateNarrative(
            report,
            config.geminiModel,
            config.geminiApiKey,
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
            model: config.geminiModel || 'Gemini AI',
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

      let diagnosis = 'Please verify host reachability, port (8123 HTTP / 8443 HTTPS), database name, and user privileges. Ensure user has SELECT permissions on system.* and target tables.';
      if (/timeout|etimedout/i.test(errorMsg)) {
        diagnosis = 'Connection or query timed out. In cloud sandboxes, "localhost" refers to the isolated container, not your local desktop machine. If connecting to a local ClickHouse instance, expose your port 8123 via a tunnel (such as ngrok or Cloudflare tunnel) or use ClickHouse Cloud. You can also explore the realistic simulation demo cluster.';
      } else if (/econnrefused/i.test(errorMsg)) {
        diagnosis = 'Connection was actively refused by the target host. Verify ClickHouse is running and listening on the specified HTTP port (default 8123 for HTTP, 8443 for HTTPS). Note: native TCP client port 9000 is not supported over HTTP.';
      } else if (/401|403|auth|password|credentials|access denied/i.test(errorMsg)) {
        diagnosis = 'Authentication failed. Please verify your username and password, and ensure the user has SELECT permissions on system.* and target database tables.';
      }

      res.status(500).json({
        error: errorMsg,
        hint: diagnosis,
      });
    }
  });

  // Narrative generation on-demand for existing report
  app.post('/api/narrate', async (req, res) => {
    const { report, model, geminiApiKey, enableAiNarrative, allowSystemKeyFallback } = req.body;
    if (!report) {
      return res.status(400).json({ error: 'Missing report payload' });
    }

    try {
      const isAiRequested = enableAiNarrative !== false;
      const canUseSystemFallback = allowSystemKeyFallback ?? isAiRequested;

      const narrative = await generateNarrative(report, model, geminiApiKey, {
        enableAiNarrative: isAiRequested,
        allowSystemKeyFallback: canUseSystemFallback,
      });

      if (!narrative) {
        return res.status(503).json({
          error: 'AI Narrative could not be generated. Please check your Gemini API key or proceed with the deterministic engine.',
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
