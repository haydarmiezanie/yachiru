import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ClickHouseClient } from '@clickhouse/client';
import { runLiveScan, runSimulationScan } from './server/analyzer.js';
import { openSshTunnel, OpenTunnelResult } from './server/sshTunnel.js';
import { recordScanHistory, fetchScanHistory } from './server/history.js';
import {
  generateNarrativeForProvider,
  generateDeterministicNarrative,
  geminiSystemKeyState,
  openaiSystemKeyState,
  claudeSystemKeyState,
} from './server/narrator.js';
import { ConnectionConfig, AiProvider } from './src/types.js';

export function classifyConnectionError(errorMsg: string): { hint: string } {
  // Check SSH tunnel specific errors first
  const isSsh = /ssh|bastion|all configured authentication methods failed|channel open failure|administratively prohibited|host key|handshake|passphrase|privatekey/i.test(errorMsg);

  if (isSsh) {
    if (/auth|all configured authentication methods failed|password|key|passphrase|denied/i.test(errorMsg)) {
      return {
        hint: 'Could not establish the SSH tunnel: SSH authentication failed. Verify the bastion SSH username, password, or private key (and passphrase, if encrypted).',
      };
    }
    if (/timeout|readytimeout/i.test(errorMsg)) {
      return {
        hint: 'Could not establish the SSH tunnel: connection to the bastion timed out. Verify that the bastion host and port (default 22) are reachable and firewall rules permit inbound SSH.',
      };
    }
    if (/refused|econnrefused/i.test(errorMsg)) {
      return {
        hint: 'Could not establish the SSH tunnel: connection refused by the bastion host. Verify that SSH daemon is running on the bastion and listening on the specified port (default 22).',
      };
    }
    if (/notfound|enotfound|eai_again/i.test(errorMsg)) {
      return {
        hint: 'Could not establish the SSH tunnel: bastion hostname could not be resolved. Verify the bastion address.',
      };
    }
    if (/channel open failure|administratively prohibited/i.test(errorMsg)) {
      return {
        hint: 'Could not establish the SSH tunnel: bastion refused port forwarding to the ClickHouse host. Ensure "AllowTcpForwarding yes" is enabled in the bastion SSH daemon configuration.',
      };
    }
    return {
      hint: 'Could not establish the SSH tunnel: verify the bastion host, port, username, and credentials.',
    };
  }

  // ClickHouse connection errors
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

  // 4. SSH Tunnel validation when useSshTunnel is true
  if (config?.useSshTunnel === true) {
    if (typeof config.sshHost !== 'string' || config.sshHost.trim() === '') {
      return { error: 'sshHost is required and must be a non-empty string when SSH tunnel is enabled.' };
    }
    if (config.sshPort !== undefined && config.sshPort !== null && String(config.sshPort).trim() !== '') {
      const sshPortNum = Number(config.sshPort);
      if (!Number.isInteger(sshPortNum) || sshPortNum < 1 || sshPortNum > 65535) {
        return { error: 'sshPort must be a positive integer between 1 and 65535.' };
      }
    }
    if (typeof config.sshUsername !== 'string' || config.sshUsername.trim() === '') {
      return { error: 'sshUsername is required and must be a non-empty string when SSH tunnel is enabled.' };
    }
    const authMethod = config.sshAuthMethod || 'password';
    if (authMethod === 'password') {
      if (typeof config.sshPassword !== 'string' || config.sshPassword.trim() === '') {
        return { error: 'sshPassword is required and must be a non-empty string when using password SSH authentication.' };
      }
    } else if (authMethod === 'privateKey') {
      if (typeof config.sshPrivateKey !== 'string' || config.sshPrivateKey.trim() === '') {
        return { error: 'sshPrivateKey is required and must be a non-empty string when using private key SSH authentication.' };
      }
    } else {
      return { error: "sshAuthMethod must be 'password' or 'privateKey'." };
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

  // Favicon fallback route
  app.get('/favicon.ico', (req, res) => {
    res.redirect(302, '/favicon.svg');
  });

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Yachiru ClickHouse Analyzer',
      apiKeyRequired: Boolean(YACHIRU_API_KEY),
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
      hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
      hasClaudeApiKey: Boolean(process.env.CLAUDE_API_KEY),
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      geminiSystemKeyState: geminiSystemKeyState.getStatus(),
      openaiSystemKeyState: openaiSystemKeyState.getStatus(),
      claudeSystemKeyState: claudeSystemKeyState.getStatus(),
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
    if (provider === 'claude' || provider === 'anthropic') {
      return res.json(claudeSystemKeyState.getStatus());
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
    if (provider === 'claude' || provider === 'anthropic') {
      claudeSystemKeyState.reset('Manual admin trigger via /api/system-key-reset?provider=claude');
      return res.json({ success: true, provider: 'claude', status: claudeSystemKeyState.getStatus() });
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

    let tunnel: OpenTunnelResult | undefined = undefined;
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

      if (config.useSshTunnel) {
        tunnel = await openSshTunnel({
          sshHost: config.sshHost!.trim(),
          sshPort: Number(config.sshPort) || 22,
          sshUsername: config.sshUsername!.trim(),
          sshAuthMethod: config.sshAuthMethod || 'password',
          sshPassword: config.sshPassword,
          sshPrivateKey: config.sshPrivateKey,
          sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
          targetHost: host,
          targetPort: port,
        });
      }

      const clientHost = tunnel ? tunnel.localHost : host;
      const clientPort = tunnel ? tunnel.localPort : port;

      client = createClient({
        url: `${protocol}://${clientHost}:${clientPort}`,
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
      await tunnel?.close();
    }
  });

  // Analysis endpoint
  app.post('/api/analyze', analyzeLimiter, requireApiKey, async (req, res) => {
    const config: ConnectionConfig = req.body;
    const validation = validateConnectionConfig(config);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    let sharedTunnel: OpenTunnelResult | undefined = undefined;
    try {
      let tunnelOverride: { host: string; port: number } | undefined = undefined;

      // If SSH tunnel is configured for live analysis, open it once and share between live scan & history write
      if (config.useSshTunnel && !config.isDemo) {
        const protocol = config.protocol || 'http';
        let targetHost = config.host?.trim() || 'localhost';
        targetHost = targetHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
        const targetPort = Number(config.port) || (protocol === 'https' ? 8443 : 8123);

        sharedTunnel = await openSshTunnel({
          sshHost: config.sshHost!.trim(),
          sshPort: Number(config.sshPort) || 22,
          sshUsername: config.sshUsername!.trim(),
          sshAuthMethod: config.sshAuthMethod || 'password',
          sshPassword: config.sshPassword,
          sshPrivateKey: config.sshPrivateKey,
          sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
          targetHost,
          targetPort,
        });

        tunnelOverride = {
          host: sharedTunnel.localHost,
          port: sharedTunnel.localPort,
        };
      }

      let report;
      if (config.isDemo) {
        // Run realistic simulated production ClickHouse cluster analysis
        report = runSimulationScan();
      } else {
        // Live ClickHouse analysis via official @clickhouse/client
        // Credentials are held in memory only for the duration of this request
        report = await runLiveScan(config, { tunnelOverride });
      }

      // If AI narrative is requested vs Without AI (Deterministic)
      if (config.enableAiNarrative) {
        const provider: AiProvider = config.aiProvider || (
          config.geminiModel?.startsWith('gpt-') ? 'openai' :
          config.geminiModel?.startsWith('claude-') ? 'claude' : 'gemini'
        );
        const activeApiKey = provider === 'openai' ? config.openaiApiKey : provider === 'claude' ? config.claudeApiKey : config.geminiApiKey;
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
            model: activeModel || (provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini AI'),
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

      // Step 3: Record scan history in user's ClickHouse instance if enabled
      // Non-fatal: write errors are attached to report.historyWriteStatus without breaking the scan
      if (config.enableHistoryTracking && !config.isDemo && !report.is_demo) {
        try {
          const writeResult = await recordScanHistory(config, report, { tunnelOverride });
          if (!writeResult.skipped) {
            report.historyWriteStatus = {
              success: writeResult.success,
              ...(writeResult.error && { error: writeResult.error }),
            };
          }
        } catch (writeErr: unknown) {
          const writeErrMsg = writeErr instanceof Error ? writeErr.message : 'Failed to write history record';
          report.historyWriteStatus = {
            success: false,
            error: writeErrMsg,
          };
        }
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
    } finally {
      await sharedTunnel?.close();
    }
  });

  // Step 4: Trend-reading endpoint (POST to prevent credentials leaking in query strings)
  // Protected with same analyzeLimiter and requireApiKey as /api/analyze
  app.post('/api/history', analyzeLimiter, requireApiKey, async (req, res) => {
    try {
      const config = req.body as ConnectionConfig;
      if (!config) {
        return res.status(400).json({ success: false, error: 'Missing connection configuration payload' });
      }

      const limit = Number(req.query.limit) || 100;
      const historyResponse = await fetchScanHistory(config, limit);

      if (!historyResponse.success) {
        // Distinguishable error response rather than generic 500
        return res.status(400).json(historyResponse);
      }

      res.json(historyResponse);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to retrieve scan history';
      console.error('History query failure:', errMsg);
      res.status(500).json({
        success: false,
        error: errMsg,
        errorType: 'UNKNOWN',
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
      claudeApiKey,
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
      const provider: AiProvider = reqProvider || (
        model?.startsWith('gpt-') ? 'openai' :
        model?.startsWith('claude-') ? 'claude' : 'gemini'
      );
      const apiKey = provider === 'openai' ? openaiApiKey : provider === 'claude' ? claudeApiKey : geminiApiKey;

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
          error: `AI Narrative could not be generated. Please check your ${provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini'} API key or proceed with the deterministic engine.`,
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
