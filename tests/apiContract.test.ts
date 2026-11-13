import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp, rateLimitErrorPayload } from '../server.js';
import { flushPendingWrites, resetSessionsCacheForTesting } from '../server/verificationStore.js';

function extractJsonBlockAfterHeading(markdown: string, headingText: string): any {
  const headingIdx = markdown.indexOf(headingText);
  assert.notEqual(headingIdx, -1, `Heading not found in API.md: ${headingText}`);
  const afterHeading = markdown.slice(headingIdx);
  const match = afterHeading.match(/```json\r?\n([\s\S]*?)\r?\n\s*```/);
  assert.ok(match, `No \`\`\`json block found after heading: ${headingText}`);
  return JSON.parse(match[1]);
}

test('FIX 4 Contract: API.md examples, status codes, 404/409/413/429 payloads, and auth match server behavior', async () => {
  const apiMd = fs.readFileSync(path.join(process.cwd(), 'API.md'), 'utf-8');

  const createExample = extractJsonBlockAfterHeading(apiMd, '#### 2. `POST /api/verifications`');
  const patchExample = extractJsonBlockAfterHeading(apiMd, '#### 4. `PATCH /api/verifications/:id`');
  const verifyExample = extractJsonBlockAfterHeading(apiMd, '#### 5. `POST /api/verifications/:id/verify`');
  const rateLimitDocExample = extractJsonBlockAfterHeading(apiMd, '- **Exceeded**: Returns HTTP `429 Too Many Requests`:');
  const payloadTooLargeDocExample = extractJsonBlockAfterHeading(
    apiMd,
    '- **Oversized / Malformed Payloads**:'
  );

  // Verify documented 429 matches shared server payload
  assert.deepEqual(rateLimitErrorPayload(), rateLimitDocExample);

  const prevDataDir = process.env.YACHIRU_DATA_DIR;
  const prevApiKey = process.env.YACHIRU_API_KEY;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiru-api-contract-'));
  const apiKey = 'contract-secret-token';

  process.env.YACHIRU_DATA_DIR = tempDir;
  process.env.YACHIRU_API_KEY = apiKey;
  resetSessionsCacheForTesting();

  const app = createApp({ analyzeLimitPerMinute: 100, narrateLimitPerMinute: 2 });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    // 1. Protected routes reject unauthenticated requests with 401 (including /api/system-key-status & /api/system-key-reset)
    assert.equal((await fetch(`${baseUrl}/api/system-key-status`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/system-key-reset`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/verifications`)).status, 401);

    // 2. Authenticated GET /api/health includes documented fields
    const healthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as Record<string, any>;
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.apiKeyRequired, true);
    assert.ok(healthJson.verificationStore && typeof healthJson.verificationStore.ok === 'boolean');
    assert.ok(healthJson.systemKeyState && typeof healthJson.systemKeyState.depleted === 'boolean');

    // 3. Authenticated system-key-status & system-key-reset return 200
    const statusRes = await fetch(`${baseUrl}/api/system-key-status?provider=claude`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(statusRes.status, 200);

    const resetRes = await fetch(`${baseUrl}/api/system-key-reset?provider=gemini`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(resetRes.status, 200);
    const resetJson = (await resetRes.json()) as Record<string, any>;
    assert.equal(resetJson.success, true);
    assert.equal(resetJson.provider, 'gemini');

    // 4. POST /api/verifications with exact API.md example returns 201 Created
    const createRes = await fetch(`${baseUrl}/api/verifications`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(createExample),
    });
    assert.equal(createRes.status, 201, 'POST /api/verifications example from API.md must return 201');
    const created = (await createRes.json()) as Record<string, any>;
    assert.equal(created.id, createExample.id);

    // 5. Duplicate POST returns 409 Conflict
    const dupRes = await fetch(`${baseUrl}/api/verifications`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(createExample),
    });
    assert.equal(dupRes.status, 409);

    // 6. GET /api/verifications and GET /api/verifications/:id
    const listRes = await fetch(`${baseUrl}/api/verifications`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(listRes.status, 200);
    const getOneRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(getOneRes.status, 200);
    const getMissingRes = await fetch(`${baseUrl}/api/verifications/does_not_exist`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(getMissingRes.status, 404);

    // 7. PATCH /api/verifications/:id with exact API.md example returns 200; unknown id returns 404
    const patchRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(patchExample),
    });
    assert.equal(patchRes.status, 200);
    const patched = (await patchRes.json()) as Record<string, any>;
    assert.equal(patched.status, patchExample.status);
    assert.equal(patched.notes, patchExample.notes);

    const patchMissingRes = await fetch(`${baseUrl}/api/verifications/does_not_exist`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(patchExample),
    });
    assert.equal(patchMissingRes.status, 404);

    // 8. POST /api/verifications/:id/verify:
    // - unknown id returns 404
    const verifyMissingRes = await fetch(`${baseUrl}/api/verifications/does_not_exist/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(verifyExample),
    });
    assert.equal(verifyMissingRes.status, 404);

    // - mismatched target host returns 409
    const verifyMismatchRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        connectionConfig: {
          ...verifyExample.connectionConfig,
          host: 'other-host.internal',
        },
      }),
    });
    assert.equal(verifyMismatchRes.status, 409);

    // - demo verify using API.md shape returns 200
    const verifyDemoRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        connectionConfig: {
          ...verifyExample.connectionConfig,
          isDemo: true,
        },
      }),
    });
    assert.equal(verifyDemoRes.status, 200);

    // 9. DELETE /api/verifications/:id returns 200 then 404 on repeat
    const delRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), { success: true });

    const delMissingRes = await fetch(`${baseUrl}/api/verifications/${createExample.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(delMissingRes.status, 404);

    // 10. Oversized payload on /api/narrate (> 1MB) returns JSON 413 matching API.md
    const bigString = 'x'.repeat(1_200_000);
    const largeRes = await fetch(`${baseUrl}/api/narrate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        report: { scan_id: 'scan_big', findings: [], padding: bigString },
      }),
    });
    assert.equal(largeRes.status, 413);
    assert.match(largeRes.headers.get('content-type') || '', /application\/json/);
    assert.deepEqual(await largeRes.json(), payloadTooLargeDocExample);

    // 11. Exceeding narrate rate limit (2/min in test app) returns 429 matching API.md verbatim
    // Note: express.json({ limit: '1mb' }) rejects the 413 request before route-level narrateLimiter runs
    const hit1 = await fetch(`${baseUrl}/api/narrate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(hit1.status, 400);
    const hit2 = await fetch(`${baseUrl}/api/narrate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(hit2.status, 400);
    const limitRes = await fetch(`${baseUrl}/api/narrate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(limitRes.status, 429);
    assert.deepEqual(await limitRes.json(), rateLimitDocExample);

    await flushPendingWrites();
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
