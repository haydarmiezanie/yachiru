import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ClickHouseClient } from '@clickhouse/client';
import { runLiveScan, runSimulationScan, queryTargetColumnTelemetry } from './server/analyzer.js';
import { openSshTunnel, OpenTunnelResult } from './server/sshTunnel.js';
import { recordScanHistory, fetchScanHistory } from './server/history.js';
import {
  listVerifications,
  getVerification,
  createVerification,
  patchVerification,
  applyVerificationResult,
  deleteVerification,
  getDataDir,
} from './server/verificationStore.js';
import {
  compareVerificationSession,
  extractAfterMetricsForSession,
} from './src/utils/verificationEngine.js';
import { DEFAULT_COST_MODEL } from './src/utils/costModel.js';
import { buildSummaryResponse } from './src/utils/verificationClient.js';
import {
  generateNarrativeForProvider,
  generateDeterministicNarrative,
  geminiSystemKeyState,
  openaiSystemKeyState,
  claudeSystemKeyState,
  validateAiModel,
} from './server/narrator.js';
import { isStrictHostKeyChecking, matchesExpectedHostKey } from './server/sshTunnel.js';
import { ConnectionConfig, AiProvider, AnalysisReport, AVAILABLE_AI_MODELS } from './src/types.js';

export function classifyConnectionError(errorMsg: string): { hint: string } {
  // Check SSH tunnel specific errors first
  const isSsh = /ssh|bastion|all configured authentication methods failed|channel open failure|administratively prohibited|host key|handshake|passphrase|privatekey/i.test(errorMsg);

  if (isSsh) {
    if (/host key verification failed|mitm|host denied \(verification failed\)|host key mismatch|remote server presented/i.test(errorMsg)) {
      return {
        hint: 'SSH host key verification failed: The remote bastion presented a host key that does not match the configured fingerprint, or strict checking is enabled without a pinned key. If you did not change bastion hosts, this may indicate a Man-In-The-Middle (MITM) attack. If the key change was planned, update the expected SSH Host Key Fingerprint in your connection settings.',
      };
    }
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

let YACHIRU_API_KEY = process.env.YACHIRU_API_KEY?.trim() || null;
const YACHIRU_REQUIRE_API_KEY =
  process.env.YACHIRU_REQUIRE_API_KEY === 'true' || process.env.REQUIRE_API_KEY === 'true';

/**
 * Constant-time API key comparison using SHA-256 digests and crypto.timingSafeEqual.
 * Prevents length leaks and timing side-channel attacks.
 */
export function compareApiKeys(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const hashProvided = crypto.createHash('sha256').update(provided).digest();
  const hashExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashProvided, hashExpected);
}

export function isEnforcedApiKeyValid(req: express.Request): boolean {
  if (!YACHIRU_API_KEY) return false;
  const header = req.headers['authorization'];
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const altHeader = (req.headers['x-yachiru-api-key'] as string | undefined)?.trim();
  const provided = bearerToken || altHeader;
  return compareApiKeys(provided, YACHIRU_API_KEY);
}

export function checkApiKeyStartupConfig(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const allowOpenApi = process.env.YACHIRU_ALLOW_OPEN_API === 'true';

  if (!YACHIRU_API_KEY) {
    if (YACHIRU_REQUIRE_API_KEY) {
      console.error(
        '[Yachiru Security FATAL] YACHIRU_REQUIRE_API_KEY=true is active, but YACHIRU_API_KEY was not set. Refusing to start.'
      );
      console.error(
        '[Yachiru Security FATAL] Set YACHIRU_API_KEY in your environment, or generate one using "npm run generate-api-key".'
      );
      process.exit(1);
    }
    if (isProd && !allowOpenApi) {
      console.error(
        '[Yachiru Security FATAL] In production (NODE_ENV=production), API key enforcement is mandatory by default.'
      );
      console.error(
        '[Yachiru Security FATAL] Set YACHIRU_API_KEY in your deployment environment, or explicitly set YACHIRU_ALLOW_OPEN_API=true to run without authentication.'
      );
      process.exit(1);
    }
  }
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!YACHIRU_API_KEY) return next(); // feature disabled, behave as open
  if (!isEnforcedApiKeyValid(req)) {
    return res.status(401).json({
      error: 'Missing or invalid API key. Provide it via "Authorization: Bearer <key>" or "X-Yachiru-Api-Key: <key>".',
    });
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

  // 4. database validation if provided
  if (config.database !== undefined && config.database !== null && String(config.database).trim() !== '') {
    if (typeof config.database !== 'string') {
      return { error: 'database must be a string if provided.' };
    }
    if (config.database.includes('\0')) {
      return { error: 'database cannot contain null bytes.' };
    }
  }

  // 5. SSH Tunnel validation when useSshTunnel is true
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
    if (config.sshHostKeyFingerprint !== undefined && config.sshHostKeyFingerprint !== null) {
      if (typeof config.sshHostKeyFingerprint !== 'string') {
        return { error: 'sshHostKeyFingerprint must be a string.' };
      }
    }
    const isStrict = isStrictHostKeyChecking({ strictHostKeyChecking: config.strictHostKeyChecking });
    if (isStrict && (!config.sshHostKeyFingerprint || config.sshHostKeyFingerprint.trim() === '')) {
      return { error: 'Strict host key checking is enabled, but sshHostKeyFingerprint was not provided.' };
    }
  }

  return {};
}

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.YACHIRU_RATE_LIMIT_PER_MINUTE) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
  message: { error: 'Too many analysis requests. Please wait before retrying.' },
});

const narrateLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
  message: {
    error: 'Too many narrative requests. Please wait before retrying to conserve LLM quota.',
  },
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Configurable reverse proxy trust (hop count or boolean, default off)
  const trustProxyEnv = process.env.YACHIRU_TRUST_PROXY?.trim();
  if (trustProxyEnv !== undefined && trustProxyEnv !== '') {
    const hopCount = Number(trustProxyEnv);
    if (!Number.isNaN(hopCount)) {
      app.set('trust proxy', hopCount);
    } else if (trustProxyEnv.toLowerCase() === 'true' || trustProxyEnv.toLowerCase() === 'false') {
      app.set('trust proxy', trustProxyEnv.toLowerCase() === 'true');
    } else {
      app.set('trust proxy', trustProxyEnv);
    }
  }

  // Mount 1MB limit specifically on /api/narrate to prevent large payload LLM abuse (returns 413)
  app.use('/api/narrate', express.json({ limit: '1mb' }));

  // General JSON parser for other endpoints (connection payloads, reports)
  app.use(express.json({ limit: '10mb' }));

  // Favicon fallback route
  app.get('/favicon.ico', (req, res) => {
    res.redirect(302, '/favicon.svg');
  });

  // Health endpoint: status and apiKeyRequired are always public;
  // Provider keys and internal system status are protected behind API key authentication.
  app.get('/api/health', (req, res) => {
    const isAuthed = !YACHIRU_API_KEY || isEnforcedApiKeyValid(req);
    res.json({
      status: 'ok',
      service: 'Yachiru ClickHouse Analyzer',
      apiKeyRequired: Boolean(YACHIRU_API_KEY),
      ...(isAuthed
        ? {
            hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
            hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
            hasClaudeApiKey: Boolean(process.env.CLAUDE_API_KEY),
            defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
            geminiSystemKeyState: geminiSystemKeyState.getStatus(),
            openaiSystemKeyState: openaiSystemKeyState.getStatus(),
            claudeSystemKeyState: claudeSystemKeyState.getStatus(),
            systemKeyState: geminiSystemKeyState.getStatus(),
          }
        : {}),
    });
  });

  // System key status endpoint (protected behind API key)
  app.get('/api/system-key-status', requireApiKey, (req, res) => {
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
          sshHostKeyFingerprint: config.sshHostKeyFingerprint?.trim(),
          strictHostKeyChecking: config.strictHostKeyChecking,
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

      let pinMatches: boolean | undefined = undefined;
      if (tunnel?.serverHostKey && config.sshHostKeyFingerprint) {
        pinMatches = matchesExpectedHostKey(config.sshHostKeyFingerprint, tunnel.serverHostKey);
      }

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
          serverHostKey: tunnel?.serverHostKey,
          pinMatches,
        });
      }

      res.json({
        success: true,
        version: clickhouseVersion,
        message: `Successfully connected to ClickHouse v${clickhouseVersion} at ${host}:${port}`,
        serverHostKey: tunnel?.serverHostKey,
        pinMatches,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown connection error';
      console.warn('Test connection failure:', errMsg);
      const { hint } = classifyConnectionError(errMsg);
      let pinMatches: boolean | undefined = undefined;
      if (tunnel?.serverHostKey && config.sshHostKeyFingerprint) {
        pinMatches = matchesExpectedHostKey(config.sshHostKeyFingerprint, tunnel.serverHostKey);
      }
      res.status(400).json({
        success: false,
        error: errMsg,
        hint,
        serverHostKey: tunnel?.serverHostKey,
        pinMatches,
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

    if (config.enableAiNarrative || config.geminiModel) {
      const modelValidation = validateAiModel(config.geminiModel, config.aiProvider);
      if (!modelValidation.valid) {
        return res.status(400).json({ error: modelValidation.error });
      }
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
          sshHostKeyFingerprint: config.sshHostKeyFingerprint?.trim(),
          strictHostKeyChecking: config.strictHostKeyChecking,
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
              allowSystemKeyFallback:
                process.env.YACHIRU_ALLOW_SYSTEM_LLM_KEY === 'true' && isEnforcedApiKeyValid(req),
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

  // -------------------------------------------------------------------------
  // Before / After Verification Endpoints
  // -------------------------------------------------------------------------

  // List all verifications
  app.get('/api/verifications', requireApiKey, (req, res) => {
    try {
      const host = typeof req.query.host === 'string' ? req.query.host : undefined;
      const database = typeof req.query.database === 'string' ? req.query.database : undefined;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

      const sessions = listVerifications({ host, database, workspaceId });
      const response = buildSummaryResponse(sessions);
      res.json(response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to list verification sessions';
      res.status(500).json({ success: false, error: msg });
    }
  });

  // Create new verification session with baseline (mass-assignment protected & rate limited)
  app.post('/api/verifications', analyzeLimiter, requireApiKey, (req, res) => {
    try {
      const payloadStr = JSON.stringify(req.body);
      if (payloadStr.length > 65536) {
        return res.status(400).json({ error: 'Payload exceeds maximum allowed size of 64KB' });
      }

      const created = createVerification(req.body);
      res.status(201).json(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create verification session';
      res.status(400).json({ error: msg });
    }
  });

  // Get single verification session
  app.get('/api/verifications/:id', requireApiKey, (req, res) => {
    try {
      const session = getVerification(req.params.id);
      if (!session) {
        return res.status(404).json({ error: `Verification session '${req.params.id}' not found` });
      }
      res.json(session);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch verification session';
      res.status(500).json({ error: msg });
    }
  });

  // Update session (checklist, status transition, notes) - client mass assignment protected
  app.patch('/api/verifications/:id', analyzeLimiter, requireApiKey, (req, res) => {
    try {
      const payloadStr = JSON.stringify(req.body);
      if (payloadStr.length > 65536) {
        return res.status(400).json({ error: 'Payload exceeds maximum allowed size of 64KB' });
      }

      const updated = patchVerification(req.params.id, req.body);
      res.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update verification session';
      res.status(400).json({ error: msg });
    }
  });

  // Re-scan and verify session: Server executes the scan itself using validated connection config
  app.post('/api/verifications/:id/verify', analyzeLimiter, requireApiKey, async (req, res) => {
    try {
      const session = getVerification(req.params.id);
      if (!session) {
        return res.status(404).json({ error: `Verification session '${req.params.id}' not found` });
      }

      // Security: Client-supplied afterReport is strictly rejected to prevent forged verdicts
      if (req.body.afterReport !== undefined) {
        return res.status(400).json({
          error: 'Client-supplied afterReport is rejected. Verification scans must be run by the server via connectionConfig.',
        });
      }

      const connectionConfig: ConnectionConfig = req.body.connectionConfig;
      if (!connectionConfig) {
        return res.status(400).json({ error: 'connectionConfig is required for verification.' });
      }

      const validation = validateConnectionConfig(connectionConfig);
      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }

      // Enforce target match (host and database must equal the session target)
      const configHost = (connectionConfig.host || '').trim().toLowerCase();
      const configDb = (connectionConfig.database || 'default').trim().toLowerCase();
      const sessionHost = (session.targetHost || '').trim().toLowerCase();
      const sessionDb = (session.targetDatabase || 'default').trim().toLowerCase();

      if (!connectionConfig.isDemo && (configHost !== sessionHost || configDb !== sessionDb)) {
        return res.status(409).json({
          error: `Connection target (${configHost} / ${configDb}) does not match verification session target (${sessionHost} / ${sessionDb}).`,
        });
      }

      // Run fresh verification scan on the server
      let afterReport: AnalysisReport;
      try {
        if (connectionConfig.isDemo) {
          afterReport = runSimulationScan();
        } else {
          afterReport = await runLiveScan(connectionConfig);
        }
      } catch (scanErr: unknown) {
        const errMsg = scanErr instanceof Error ? scanErr.message : 'Unknown error during scan';
        console.warn('Verification scan failed:', errMsg);
        const { hint } = classifyConnectionError(errMsg);
        return res.status(400).json({ error: errMsg, hint });
      }

      // If targeted finding disappeared, query system.columns for post-remediation column telemetry
      let columnTelemetry: any = null;
      if (session.targetTable && session.targetColumn) {
        const hasMatchingFinding = afterReport.findings.some(
          (f) =>
            f.id === session.findingId ||
            (f.category === session.findingCategory &&
              f.table?.toLowerCase() === session.targetTable?.toLowerCase() &&
              f.metrics?.columnName?.toLowerCase() === session.targetColumn?.toLowerCase())
        );

        if (!hasMatchingFinding) {
          try {
            columnTelemetry = await queryTargetColumnTelemetry(
              connectionConfig,
              session.targetDatabase,
              session.targetTable,
              session.targetColumn
            );
          } catch (colErr) {
            console.warn('Failed to query targeted column telemetry:', colErr);
          }
        }
      }

      const { afterMetrics, afterTableMeta, findingResolved, categoryCheckDidNotRun, tableMissing } =
        extractAfterMetricsForSession(session, afterReport, columnTelemetry);

      const comparison = compareVerificationSession(
        session,
        afterReport.scan_id,
        afterMetrics,
        afterTableMeta,
        DEFAULT_COST_MODEL,
        { findingResolved, categoryCheckDidNotRun, tableMissing }
      );

      const updatedChecklist = session.checklist.map((item) => {
        if (item.id === 'step_run_rescan') {
          return { ...item, completed: true, completedAt: new Date().toISOString() };
        }
        return item;
      });

      const verified = applyVerificationResult(session.id, {
        afterScanId: afterReport.scan_id,
        verifiedAt: new Date().toISOString(),
        afterMetrics,
        afterTableMeta,
        status: comparison.status,
        metricComparisons: comparison.metricComparisons,
        comparability: comparison.comparability,
        expectedImpact: comparison.expectedImpact,
        measuredImpactSummary: comparison.measuredImpactSummary,
        financialImpact: comparison.financialImpact,
        checklist: updatedChecklist,
      });

      res.json(verified);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify session';
      res.status(500).json({ error: msg });
    }
  });

  // Delete verification session (rate limited)
  app.delete('/api/verifications/:id', analyzeLimiter, requireApiKey, (req, res) => {
    try {
      const deleted = deleteVerification(req.params.id);
      res.json({ success: deleted });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete verification session';
      res.status(500).json({ error: msg });
    }
  });

  // Narrative generation on-demand for existing report (rate-limited to prevent LLM quota exhaustion)
  app.post('/api/narrate', narrateLimiter, requireApiKey, async (req, res) => {
    const {
      report,
      provider: reqProvider,
      model,
      geminiApiKey,
      openaiApiKey,
      claudeApiKey,
      enableAiNarrative,
    } = req.body || {};

    if (!report || typeof report !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid report payload' });
    }

    // Validate report shape: string scan_id and findings array with max 250 items
    if (typeof report.scan_id !== 'string' || !report.scan_id.trim()) {
      return res.status(400).json({ error: 'Invalid report shape: scan_id must be a non-empty string.' });
    }
    if (!Array.isArray(report.findings) || report.findings.length > 250) {
      return res.status(400).json({
        error: 'Invalid report shape: findings must be an array with at most 250 items.',
      });
    }

    // Validate model using shared validator against AVAILABLE_AI_MODELS (400 if unknown)
    const modelValidation = validateAiModel(model, reqProvider);
    if (!modelValidation.valid) {
      return res.status(400).json({ error: modelValidation.error });
    }
    const provider: AiProvider = modelValidation.provider;
    const activeModel = modelValidation.resolvedModel;

    // Server decides whether system keys may be used, never the client:
    // Only when YACHIRU_ALLOW_SYSTEM_LLM_KEY=true AND request passed requireApiKey with enforcement active
    const systemKeyAllowed =
      process.env.YACHIRU_ALLOW_SYSTEM_LLM_KEY === 'true' && isEnforcedApiKeyValid(req);

    const apiKey = provider === 'openai' ? openaiApiKey : provider === 'claude' ? claudeApiKey : geminiApiKey;

    // With a system key configured and no opt-in, an unauthenticated call without its own key is rejected
    if (!apiKey && !systemKeyAllowed) {
      return res.status(401).json({
        error: 'System LLM keys are disabled for unauthenticated or external requests. Please provide your own AI API key.',
      });
    }

    try {
      const isAiRequested = enableAiNarrative !== false;

      const narrative = await generateNarrativeForProvider(
        report,
        provider,
        activeModel,
        apiKey,
        {
          enableAiNarrative: isAiRequested,
          allowSystemKeyFallback: systemKeyAllowed,
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
    console.log(`[Yachiru] Verification store directory: ${getDataDir()}`);
    if (YACHIRU_API_KEY) {
      console.log(
        '[Yachiru Security] API authentication is ENABLED. Protected routes require "Authorization: Bearer <key>".'
      );
    } else {
      console.warn(
        '[Yachiru Security] WARNING: YACHIRU_API_KEY is not set. API authentication is disabled; API routes (/api/analyze, /api/verifications, /api/test-connection) are open to unauthenticated callers. To lock down the API in deployment, set YACHIRU_API_KEY or set YACHIRU_REQUIRE_API_KEY=true.'
      );
    }
  });
}

const isTestRunner = process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test'));
if (!isTestRunner) {
  checkApiKeyStartupConfig();
  startServer();
}

