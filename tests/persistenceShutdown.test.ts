import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createApp } from '../server.js';
import { resetSessionsCacheForTesting } from '../server/verificationStore.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        return reject(new Error('Could not determine ephemeral port'));
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

test('FIX 2 Repro: 6 of 6 rapid POST /api/verifications followed immediately by SIGTERM persist to disk', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiru-sigterm-'));
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

  try {
    for (let run = 1; run <= 6; run++) {
      const dataDir = path.join(tempRoot, `run-${run}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const child = spawn(process.execPath, [tsxCli, 'server.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          YACHIRU_ALLOW_OPEN_API: 'true',
          YACHIRU_API_KEY: '',
          PORT: String(port),
          YACHIRU_DATA_DIR: dataDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });

      try {
        await waitForServerReady(baseUrl);

        const sessionId = `sigterm_session_${run}`;
        const postRes = await fetch(`${baseUrl}/api/verifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            findingId: 'low_compression_raw_payloads',
            findingTitle: 'Suboptimal compression on events_raw.payload_json',
            findingCategory: 'compression',
            findingSeverity: 'warning',
            targetHost: 'clickhouse.internal',
            targetDatabase: 'analytics',
            baselineScanId: `scan_${run}`,
            baselineMetrics: { compression_ratio: 1.18 },
          }),
        });
        assert.equal(postRes.status, 201, `Run ${run} POST should return 201`);

        // Immediately send SIGTERM before background coalesced timer would naturally settle
        child.kill('SIGTERM');

        const { code, signal } = await exitPromise;
        assert.equal(signal, null, `Run ${run} expected clean exit, not signal ${signal}. stderr=${stderr}`);
        assert.equal(code, 0, `Run ${run} expected exit code 0, got ${code}. stderr=${stderr}`);

        const filePath = path.join(dataDir, 'verifications.json');
        assert.ok(fs.existsSync(filePath), `Run ${run} verifications.json must exist after SIGTERM`);
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Array<{ id: string }>;
        assert.ok(
          saved.some((s) => s.id === sessionId),
          `Run ${run} missing persisted session '${sessionId}' in ${filePath}`
        );
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('FIX 2 Repro: disk write failure surfaces on /api/health verificationStore with auth redaction', async () => {
  const prevDataDir = process.env.YACHIRU_DATA_DIR;
  const prevApiKey = process.env.YACHIRU_API_KEY;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiru-health-fail-'));
  // Point YACHIRU_DATA_DIR at an existing regular file so mkdir/writeFile reliably fails
  const blockingFile = path.join(tempRoot, 'not-a-directory');
  fs.writeFileSync(blockingFile, 'lock', 'utf-8');

  process.env.YACHIRU_DATA_DIR = blockingFile;
  delete process.env.YACHIRU_API_KEY;
  resetSessionsCacheForTesting();

  const app = createApp({ analyzeLimitPerMinute: 100 });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const postRes = await fetch(`${baseUrl}/api/verifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'disk_fail_session_1',
        findingId: 'finding_1',
        findingTitle: 'Disk fail test',
        findingCategory: 'compression',
        findingSeverity: 'warning',
        targetHost: 'localhost',
        targetDatabase: 'default',
        baselineScanId: 'scan_disk_fail',
        baselineMetrics: { compression_ratio: 1.1 },
      }),
    });
    assert.equal(postRes.status, 201);

    // Wait briefly for the async write attempt to fail and record lastError
    let healthBody: any = null;
    for (let i = 0; i < 20; i++) {
      const hRes = await fetch(`${baseUrl}/api/health`);
      healthBody = await hRes.json();
      if (healthBody?.verificationStore?.ok === false) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(healthBody.verificationStore.ok, false);
    assert.ok(healthBody.verificationStore.pending > 0);
    assert.ok(
      typeof healthBody.verificationStore.lastError === 'string' &&
        healthBody.verificationStore.lastError.length > 0
    );

    // Verify redaction when YACHIRU_API_KEY is enabled
    process.env.YACHIRU_API_KEY = 'health-secret-key';
    const unauthHealth = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(unauthHealth.verificationStore.ok, false);
    assert.equal(unauthHealth.verificationStore.lastError, 'Persistence write error');

    const authHealth = await (
      await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: 'Bearer health-secret-key' },
      })
    ).json();
    assert.equal(authHealth.verificationStore.ok, false);
    assert.notEqual(authHealth.verificationStore.lastError, 'Persistence write error');
    assert.ok(authHealth.verificationStore.lastError.length > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetSessionsCacheForTesting();
    if (prevDataDir === undefined) {
      delete process.env.YACHIRU_DATA_DIR;
    } else {
      process.env.YACHIRU_DATA_DIR = prevDataDir;
    }
    if (prevApiKey === undefined) {
      delete process.env.YACHIRU_API_KEY;
    } else {
      process.env.YACHIRU_API_KEY = prevApiKey;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
