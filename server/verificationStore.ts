import fs from 'fs';
import path from 'path';
import {
  CheckCategory,
  CheckSeverity,
  ExpectedImpactRange,
  MetricComparisonItem,
  TableMetadata,
  VerificationChecklistItem,
  VerificationComparability,
  VerificationSession,
  VerificationStatus,
} from '../src/types.js';
import { assertValidVerificationTransition } from '../src/utils/verificationEngine.js';

export function getDataDir(): string {
  return process.env.YACHIRU_DATA_DIR
    ? path.resolve(process.env.YACHIRU_DATA_DIR)
    : path.join(process.cwd(), 'data');
}

export function getDataFile(): string {
  return path.join(getDataDir(), 'verifications.json');
}

export class VerificationNotFoundError extends Error {
  constructor(id: string) {
    super(`Verification session '${id}' not found.`);
    this.name = 'VerificationNotFoundError';
  }
}

export class VerificationDuplicateError extends Error {
  constructor(id: string) {
    super(`Verification session '${id}' already exists.`);
    this.name = 'VerificationDuplicateError';
  }
}

export interface VerificationStoreHealth {
  ok: boolean;
  pending: number;
  lastError: string | null;
  lastWriteAt: string | null;
}

// In-memory cache backed by filesystem persistence
let sessionsCache: Map<string, VerificationSession> | null = null;
let activeFlush: Promise<void> | null = null;
let pendingChanges = 0;
let dirty = false;
let lastWriteError: string | null = null;
let lastWriteAt: string | null = null;

export function resetSessionsCacheForTesting(): void {
  sessionsCache = null;
  activeFlush = null;
  pendingChanges = 0;
  dirty = false;
  lastWriteError = null;
  lastWriteAt = null;
}

export function getVerificationStoreHealth(): VerificationStoreHealth {
  return {
    ok: lastWriteError === null,
    pending: pendingChanges,
    lastError: lastWriteError,
    lastWriteAt,
  };
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSessionsFromDisk(): Map<string, VerificationSession> {
  const map = new Map<string, VerificationSession>();
  try {
    ensureDataDir();
  } catch (err) {
    console.warn('[VerificationStore] Could not create data directory:', err);
  }
  const file = getDataFile();
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const s of list) {
          if (s && typeof s.id === 'string') {
            map.set(s.id, s);
          }
        }
      }
    } catch (err) {
      console.warn('[VerificationStore] Error loading verifications.json, initializing empty:', err);
    }
  }
  return map;
}

/**
 * Atomically writes current session cache to disk using a unique temporary file and rename.
 */
export async function flushSessionsToDisk(): Promise<void> {
  if (!sessionsCache) return;
  const file = getDataFile();
  const capturedChanges = pendingChanges;
  const list = Array.from(sessionsCache.values());
  const payload = JSON.stringify(list);
  const tempFile = `${file}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    ensureDataDir();
    await fs.promises.writeFile(tempFile, payload, 'utf-8');
    await fs.promises.rename(tempFile, file);
    pendingChanges = Math.max(0, pendingChanges - capturedChanges);
    lastWriteError = null;
    lastWriteAt = new Date().toISOString();
  } catch (err) {
    lastWriteError = err instanceof Error ? err.message : String(err);
    console.error('[VerificationStore] Failed to write verifications.json:', err);
    try {
      if (fs.existsSync(tempFile)) {
        await fs.promises.unlink(tempFile);
      }
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

async function runFlushLoop(): Promise<void> {
  try {
    while (dirty) {
      dirty = false;
      try {
        await flushSessionsToDisk();
      } catch {
        // Error recorded in lastWriteError and logged; break background retry loop until next mutation or explicit flush
        break;
      }
    }
  } finally {
    activeFlush = null;
    if (dirty && lastWriteError === null) {
      activeFlush = runFlushLoop();
    }
  }
}

/**
 * Coalesced asynchronous write queue: schedules a non-blocking background write.
 * Consecutive rapid mutations collapse into sequential non-racing writes.
 */
export function queueFlushToDisk(): Promise<void> {
  pendingChanges++;
  dirty = true;
  if (!activeFlush) {
    activeFlush = runFlushLoop();
  }
  return activeFlush;
}

/**
 * Flushes all pending writes to disk and awaits completion (for testing and shutdown).
 */
export async function flushPendingWrites(): Promise<void> {
  while (activeFlush) {
    await activeFlush;
  }
  if (pendingChanges > 0 || dirty) {
    dirty = false;
    await flushSessionsToDisk();
  }
}

function getCache(): Map<string, VerificationSession> {
  if (!sessionsCache) {
    sessionsCache = loadSessionsFromDisk();
  }
  return sessionsCache;
}

export function listVerifications(filter?: {
  host?: string;
  database?: string;
  workspaceId?: string;
}): VerificationSession[] {
  const cache = getCache();
  const all = Array.from(cache.values());

  return all
    .filter((s) => {
      if (filter?.workspaceId && s.workspaceId !== filter.workspaceId) {
        return false;
      }
      if (filter?.host && s.targetHost.toLowerCase() !== filter.host.toLowerCase()) {
        return false;
      }
      if (filter?.database && s.targetDatabase.toLowerCase() !== filter.database.toLowerCase()) {
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getVerification(id: string): VerificationSession | null {
  const cache = getCache();
  return cache.get(id) || null;
}

const MAX_SESSIONS = 1000;
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-:.]{1,100}$/;
const ALLOWED_USER_STATUS_PATCHES: VerificationStatus[] = [
  'remediation_in_progress',
  'awaiting_verification',
  'cancelled',
];

export function createVerification(raw: unknown): VerificationSession {
  const cache = getCache();

  if (cache.size >= MAX_SESSIONS) {
    throw new Error(`Maximum verification session limit (${MAX_SESSIONS}) reached.`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Verification session payload must be a non-null object.');
  }

  const s = raw as Record<string, any>;

  // Validate required baseline fields
  if (!s.id || typeof s.id !== 'string' || !VALID_ID_REGEX.test(s.id)) {
    throw new Error('Invalid or missing session id (must be 1-100 alphanumeric characters, dash, colon, or underscore).');
  }
  if (!s.targetHost || typeof s.targetHost !== 'string' || s.targetHost.length > 255) {
    throw new Error('targetHost is required and must be a string <= 255 characters.');
  }
  if (!s.targetDatabase || typeof s.targetDatabase !== 'string' || s.targetDatabase.length > 255) {
    throw new Error('targetDatabase is required and must be a string <= 255 characters.');
  }
  if (!s.findingId || typeof s.findingId !== 'string' || s.findingId.length > 255) {
    throw new Error('findingId is required and must be a string <= 255 characters.');
  }
  if (!s.findingTitle || typeof s.findingTitle !== 'string' || s.findingTitle.length > 500) {
    throw new Error('findingTitle is required and must be a string <= 500 characters.');
  }
  if (!s.findingCategory || typeof s.findingCategory !== 'string') {
    throw new Error('findingCategory is required.');
  }
  if (!s.findingSeverity || typeof s.findingSeverity !== 'string') {
    throw new Error('findingSeverity is required.');
  }
  if (!s.baselineScanId || typeof s.baselineScanId !== 'string' || s.baselineScanId.length > 255) {
    throw new Error('baselineScanId is required and must be a string <= 255 characters.');
  }
  if (!s.baselineMetrics || typeof s.baselineMetrics !== 'object' || Array.isArray(s.baselineMetrics)) {
    throw new Error('baselineMetrics is required and must be an object.');
  }

  // Ensure baseline immutability: if id already exists, do not overwrite baseline
  if (cache.has(s.id)) {
    throw new VerificationDuplicateError(s.id);
  }

  const host = s.targetHost.trim().toLowerCase();
  const database = s.targetDatabase.trim().toLowerCase();
  const nowStr = new Date().toISOString();

  // Strict allowlist: discard any client-provided computed verification results
  const cleanSession: VerificationSession = {
    id: s.id.trim(),
    workspaceId: typeof s.workspaceId === 'string' && s.workspaceId.length <= 255 ? s.workspaceId.trim() : `${host}:::${database}`,
    targetHost: host,
    targetDatabase: database,
    targetTable: typeof s.targetTable === 'string' && s.targetTable.length <= 255 ? s.targetTable.trim() : undefined,
    targetColumn: typeof s.targetColumn === 'string' && s.targetColumn.length <= 255 ? s.targetColumn.trim() : undefined,
    findingId: s.findingId.trim(),
    findingTitle: s.findingTitle.trim(),
    findingCategory: s.findingCategory as CheckCategory,
    findingSeverity: s.findingSeverity as CheckSeverity,
    recommendationSqlOrText: typeof s.recommendationSqlOrText === 'string' ? s.recommendationSqlOrText.slice(0, 15000) : '',
    isSqlRecommendation: Boolean(s.isSqlRecommendation),
    riskLevel: s.riskLevel === 'high' ? 'high' : s.riskLevel === 'medium' ? 'medium' : 'low',
    rollbackGuidance: typeof s.rollbackGuidance === 'string' ? s.rollbackGuidance.slice(0, 5000) : undefined,

    // Immutable baseline
    baselineScanId: s.baselineScanId.trim(),
    baselineCapturedAt: typeof s.baselineCapturedAt === 'string' && s.baselineCapturedAt.length <= 100 ? s.baselineCapturedAt : nowStr,
    baselineMetrics: s.baselineMetrics,
    baselineTableMeta: s.baselineTableMeta && typeof s.baselineTableMeta === 'object' ? s.baselineTableMeta : undefined,

    // Initial state machine status is always baseline_captured
    status: 'baseline_captured',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: ['Baseline captured and persisted.'],
      confoundingFactors: [],
      caveats: ['Awaiting manual remediation and follow-up verification scan.'],
    },
    expectedImpact: s.expectedImpact && typeof s.expectedImpact === 'object' ? s.expectedImpact : undefined,
    checklist: Array.isArray(s.checklist) ? s.checklist.slice(0, 20) : [],
    notes: typeof s.notes === 'string' ? s.notes.slice(0, 5000) : undefined,

    // Computed fields must NOT be set on creation
    afterScanId: undefined,
    verifiedAt: undefined,
    afterMetrics: undefined,
    afterTableMeta: undefined,
    measuredImpactSummary: undefined,
    financialImpact: undefined,

    createdAt: nowStr,
    updatedAt: nowStr,
  };

  cache.set(cleanSession.id, cleanSession);
  queueFlushToDisk();
  return cleanSession;
}

export function patchVerification(
  id: string,
  updates: Record<string, any>,
  options?: { allowComputed?: boolean }
): VerificationSession {
  const cache = getCache();
  const existing = cache.get(id);

  if (!existing) {
    throw new VerificationNotFoundError(id);
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('Invalid patch payload: must be an object.');
  }

  // If this is an external user PATCH (not internal engine verify), protect computed fields
  if (!options?.allowComputed) {
    // Disallow setting computed fields
    if (
      updates.financialImpact !== undefined ||
      updates.measuredImpactSummary !== undefined ||
      updates.metricComparisons !== undefined ||
      updates.afterMetrics !== undefined ||
      updates.afterTableMeta !== undefined ||
      updates.afterScanId !== undefined ||
      updates.verifiedAt !== undefined
    ) {
      throw new Error('Computed verification results cannot be set via client PATCH.');
    }

    // Only allow user-driven status transitions via PATCH
    if (updates.status && updates.status !== existing.status) {
      if (!ALLOWED_USER_STATUS_PATCHES.includes(updates.status)) {
        throw new Error(
          `Cannot manually set computed verification status '${updates.status}' via PATCH. Use the verification scan endpoint.`
        );
      }
      assertValidVerificationTransition(existing.status, updates.status);
    }
  }

  // Construct sanitized updated session
  const updated: VerificationSession = {
    ...existing,
    id: existing.id,
    workspaceId: existing.workspaceId,
    targetHost: existing.targetHost,
    targetDatabase: existing.targetDatabase,
    findingId: existing.findingId,
    baselineScanId: existing.baselineScanId,
    baselineCapturedAt: existing.baselineCapturedAt,
    baselineMetrics: existing.baselineMetrics,
    baselineTableMeta: existing.baselineTableMeta,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),

    // User-patchable fields
    notes: typeof updates.notes === 'string' ? updates.notes.slice(0, 5000) : existing.notes,
    checklist: Array.isArray(updates.checklist) ? updates.checklist.slice(0, 20) : existing.checklist,
    status: updates.status ? updates.status : existing.status,
  };

  if (options?.allowComputed) {
    if (updates.afterScanId !== undefined) updated.afterScanId = updates.afterScanId;
    if (updates.verifiedAt !== undefined) updated.verifiedAt = updates.verifiedAt;
    if (updates.afterMetrics !== undefined) updated.afterMetrics = updates.afterMetrics;
    if (updates.afterTableMeta !== undefined) updated.afterTableMeta = updates.afterTableMeta;
    if (updates.metricComparisons !== undefined) updated.metricComparisons = updates.metricComparisons;
    if (updates.comparability !== undefined) updated.comparability = updates.comparability;
    if (updates.expectedImpact !== undefined) updated.expectedImpact = updates.expectedImpact;
    if (updates.measuredImpactSummary !== undefined) updated.measuredImpactSummary = updates.measuredImpactSummary;
    if (updates.financialImpact !== undefined) updated.financialImpact = updates.financialImpact;
  }

  cache.set(id, updated);
  queueFlushToDisk();
  return updated;
}

export function applyVerificationResult(
  id: string,
  result: {
    afterScanId: string;
    verifiedAt: string;
    afterMetrics: Record<string, number | string | null | undefined>;
    afterTableMeta?: TableMetadata;
    status: VerificationStatus;
    metricComparisons: MetricComparisonItem[];
    comparability: VerificationComparability;
    expectedImpact?: ExpectedImpactRange;
    measuredImpactSummary?: VerificationSession['measuredImpactSummary'];
    financialImpact?: VerificationSession['financialImpact'];
    checklist?: VerificationChecklistItem[];
  }
): VerificationSession {
  return patchVerification(id, result, { allowComputed: true });
}

export function deleteVerification(id: string): boolean {
  const cache = getCache();
  const existed = cache.delete(id);
  if (existed) {
    queueFlushToDisk();
  }
  return existed;
}
