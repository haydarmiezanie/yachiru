import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiru-async-store-test-'));
process.env.YACHIRU_DATA_DIR = tempTestDir;

import {
  createVerification,
  patchVerification,
  deleteVerification,
  getVerification,
  listVerifications,
  resetSessionsCacheForTesting,
  flushPendingWrites,
  getDataFile,
} from '../server/verificationStore.js';

test('Async Verification Store: coalesced non-blocking writes and atomic file flush', async () => {
  resetSessionsCacheForTesting();

  // Create multiple sessions rapidly in succession
  const session1 = createVerification({
    id: 'test_session_1',
    findingId: 'finding_test_1',
    findingTitle: 'Test finding 1',
    findingCategory: 'part_health',
    findingSeverity: 'warning',
    targetHost: 'test-host-1',
    targetDatabase: 'analytics',
    targetTable: 'table_1',
    baselineScanId: 'scan_1',
    baselineScore: 75,
    baselineMetrics: { activeParts: 200 },
  });

  const session2 = createVerification({
    id: 'test_session_2',
    findingId: 'finding_test_2',
    findingTitle: 'Test finding 2',
    findingCategory: 'primary_keys',
    findingSeverity: 'warning',
    targetHost: 'test-host-2',
    targetDatabase: 'analytics',
    targetTable: 'table_2',
    baselineScanId: 'scan_1',
    baselineScore: 80,
    baselineMetrics: { marksRatio: 0.05 },
  });

  // Verify in-memory cache reflects creation immediately
  assert.equal(getVerification(session1.id)?.targetTable, 'table_1');
  assert.equal(getVerification(session2.id)?.targetTable, 'table_2');

  // Immediately patch session 1
  patchVerification(session1.id, {
    notes: 'In progress testing async writes',
    status: 'remediation_in_progress',
  });
  assert.equal(getVerification(session1.id)?.status, 'remediation_in_progress');

  // Flush pending writes asynchronously to disk
  await flushPendingWrites();

  // Check that the data file exists and contains valid JSON with both sessions
  const filePath = getDataFile();
  assert.ok(fs.existsSync(filePath), 'Target data file should exist on disk after flush');

  const rawDiskData = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(rawDiskData);
  assert.ok(Array.isArray(parsed), 'Disk content should be a JSON array');
  assert.equal(parsed.length, 2, 'Both sessions should be written to disk');

  const onDisk1 = parsed.find((s: any) => s.id === session1.id);
  assert.ok(onDisk1);
  assert.equal(onDisk1.status, 'remediation_in_progress');
  assert.equal(onDisk1.notes, 'In progress testing async writes');

  // Verify atomic replacement cleaned up any temp files
  const dirFiles = fs.readdirSync(tempTestDir);
  const tmpFiles = dirFiles.filter((f) => f.includes('.tmp'));
  assert.equal(tmpFiles.length, 0, 'No temporary files should linger after atomic flush');

  // Delete session 2 and flush
  const deleted = deleteVerification(session2.id);
  assert.equal(deleted, true);
  await flushPendingWrites();

  const rawDiskAfterDelete = fs.readFileSync(filePath, 'utf-8');
  const parsedAfterDelete = JSON.parse(rawDiskAfterDelete);
  assert.equal(parsedAfterDelete.length, 1);
  assert.equal(parsedAfterDelete[0].id, session1.id);

  // Clean up
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch {}
});
