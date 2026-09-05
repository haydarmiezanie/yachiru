import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ScanReport } from '../../src/types/yachiru.js';
import { logger } from '../logger.js';
import { getAdminFirestore } from '../auth/rbacMiddleware.js';

const STORAGE_DIR = path.join(process.cwd(), 'data');
const SCANS_DIR = path.join(STORAGE_DIR, 'scans');
const INDEX_FILE = path.join(STORAGE_DIR, 'scan_index.json');
const HISTORY_FILE = path.join(STORAGE_DIR, 'scan_history.json');
const MAX_HISTORY_ITEMS = 50;

export interface ScanSummaryItem {
  id: string;
  timestamp: string;
  target: ScanReport['target'];
  overallScore: number;
  overallGrade: string;
  findingsCount: number;
  criticalCount: number;
  warningCount: number;
  aiStatus: string;
  scanDurationMs?: number;
}

/**
 * Extracts a lightweight metadata summary from a full scan report.
 */
export function extractScanSummary(report: ScanReport): ScanSummaryItem {
  return {
    id: report.id,
    timestamp: report.timestamp,
    target: report.target,
    overallScore: report.overallScore,
    overallGrade: report.overallGrade,
    findingsCount: Array.isArray(report.findings) ? report.findings.length : 0,
    criticalCount: Array.isArray(report.findings)
      ? report.findings.filter((f) => f.severity === 'critical').length
      : 0,
    warningCount: Array.isArray(report.findings)
      ? report.findings.filter((f) => f.severity === 'warning').length
      : 0,
    aiStatus: report.aiStatus || 'disabled',
    scanDurationMs: report.scanDurationMs,
  };
}

function isFirestoreSyncEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.USE_FIRESTORE_HISTORY === 'true') return true;
  return false;
}

/**
 * Checks whether high-privacy / zero-raw-query mode is active.
 * When true, Yachiru completely discards raw SQL queries and stores only
 * normalized query patterns and SHA-256 fingerprints.
 */
export function isPrivacyPreservingMode(env = process.env): boolean {
  if (env.PRIVACY_PRESERVING_HISTORY === 'true') return true;
  if (env.STORE_RAW_QUERIES === 'false') return true;
  return false;
}

/**
 * Normalizes an arbitrary SQL query into a structural AST-like pattern skeleton,
 * stripping all variable literals (strings, numbers, parameter tuples).
 *
 * This normalizes:
 * - Comments (-- and /* * /)
 * - Single-quoted string literals -> '?'
 * - VALUES (...) tuples -> VALUES (?)
 * - IN (...) lists -> IN (?)
 * - Comparison and arithmetic numeric values -> ?
 * - Multiple whitespaces collapsed to a single space
 */
export function normalizeQueryPattern(queryText: string): string {
  if (!queryText || typeof queryText !== 'string') return '';

  return queryText
    // Remove inline and block comments
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Redact string literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
    // Redact VALUES clause contents
    .replace(/VALUES\s*\([^)]+\)/gi, 'VALUES (?)')
    // Redact IN list contents
    .replace(/IN\s*\([^)]+\)/gi, 'IN (?)')
    // Redact comparison numbers: = 12345, > 99999, <= 0.5
    .replace(/(=|!=|<>|>=|<=|>|<)\s*\d+(\.\d+)?/g, '$1 ?')
    // Redact UUIDs & hex hashes
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '?')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '?')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a deterministic, truncated SHA-256 fingerprint from a normalized query pattern.
 * Enables deduplicating query patterns and bug profiles across audit scans without exposing sensitive data.
 */
export function fingerprintQuery(queryText: string): string {
  if (!queryText || typeof queryText !== 'string') return 'fp_empty';
  const normalized = normalizeQueryPattern(queryText);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `fp_${hash}`;
}

/**
 * Simple in-process FIFO mutex to serialize read-modify-write cycles and prevent lost updates during concurrent scans.
 */
class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    const currentQueue = this.queue;
    this.queue = nextPromise;

    await currentQueue;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

const storageMutex = new AsyncMutex();

/**
 * Best-effort heuristic sanitization helper.
 *
 * ⚠️ COMPLIANCE & PRIVACY NOTICE:
 * Regex-based masking is a best-effort, heuristic hygiene layer to catch obvious
 * literal strings, numeric values, passwords, and tokens before writing to local disk.
 * It is NOT a cryptographic guarantee or formal regulatory compliance boundary (e.g. GDPR, HIPAA).
 * Heuristics can over-mask benign numbers or under-mask complex/nested structures
 * (e.g. concatenated strings, base64 values, JSON-embedded attributes).
 *
 * For zero-risk privacy compliance, configure `PRIVACY_PRESERVING_HISTORY=true` or
 * `STORE_RAW_QUERIES=false` to store ONLY normalized structural patterns and SHA-256 fingerprints.
 */
export function maskQueryPii(queryText: string): string {
  if (!queryText || typeof queryText !== 'string') return '';

  return queryText
    // 1. Redact single-quoted string literals: 'secret' -> '[REDACTED]'
    .replace(/'(?:[^'\\]|\\.)*'/g, "'[REDACTED]'")
    // 2. Redact VALUES (...) tuples in INSERT statements
    .replace(/VALUES\s*\([^)]+\)/gi, 'VALUES ([REDACTED])')
    // 3. Redact comparison literals: = 12345, > 99999, IN (1, 2, 3)
    .replace(/(=|!=|<>|>=|<=|>|<)\s*\d+(\.\d+)?/g, '$1 [REDACTED]')
    .replace(/IN\s*\([0-9,\s.'"]+\)/gi, 'IN ([REDACTED])')
    // 4. Redact bearer / token / password / email strings if present
    .replace(/(password|secret|token|api_key|jwt|authorization|key)\s*=\s*'[^']*'/gi, "$1 = '[REDACTED]'")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

/**
 * Deeply sanitizes any query text or metrics in a ScanReport before persistence.
 * Sanitizes finding metrics, rawStats.slowQueries, and rawStats.expensivePatterns.
 *
 * When privacyPreserving mode is active (or configured via environment), raw query text is
 * completely discarded and replaced with normalized query skeletons and SHA-256 fingerprints.
 */
export function sanitizeReportForStorage(
  report: ScanReport,
  options?: { privacyPreserving?: boolean }
): ScanReport {
  try {
    const cloned: ScanReport = JSON.parse(JSON.stringify(report));
    const zeroRawQueries = options?.privacyPreserving ?? isPrivacyPreservingMode();

    const processQuery = (rawText: string): { processed: string; fingerprint: string } => {
      const fp = fingerprintQuery(rawText);
      if (zeroRawQueries) {
        const pattern = normalizeQueryPattern(rawText);
        return {
          processed: `/* [ZERO_RAW_QUERY_MODE - FINGERPRINT: ${fp}] */ ${pattern}`,
          fingerprint: fp,
        };
      }
      return {
        processed: maskQueryPii(rawText),
        fingerprint: fp,
      };
    };

    // 1. Mask Findings Metrics
    if (Array.isArray(cloned.findings)) {
      for (const finding of cloned.findings) {
        if (finding.metrics && typeof finding.metrics === 'object') {
          for (const key of Object.keys(finding.metrics)) {
            const val = finding.metrics[key];
            if (typeof val === 'string') {
              const lowerKey = key.toLowerCase();
              if (
                lowerKey.includes('query') ||
                lowerKey.includes('sample') ||
                lowerKey.includes('exception') ||
                lowerKey.includes('sql')
              ) {
                const { processed, fingerprint } = processQuery(val);
                finding.metrics[key] = processed;
                if (!finding.metrics[`${key}Fingerprint`]) {
                  finding.metrics[`${key}Fingerprint`] = fingerprint;
                }
              }
            }
          }
        }
      }
    }

    // 2. Mask rawStats.slowQueries and rawStats.expensivePatterns (P1)
    if (cloned.rawStats && typeof cloned.rawStats === 'object') {
      if (Array.isArray(cloned.rawStats.slowQueries)) {
        cloned.rawStats.slowQueries = cloned.rawStats.slowQueries.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const sanitized = { ...item };
          if (typeof sanitized.query === 'string') {
            const { processed, fingerprint } = processQuery(sanitized.query);
            sanitized.query = processed;
            sanitized.query_fingerprint = fingerprint;
          }
          if (typeof sanitized.formatted_query === 'string') {
            const { processed } = processQuery(sanitized.formatted_query);
            sanitized.formatted_query = processed;
          }
          return sanitized;
        });
      }

      if (Array.isArray(cloned.rawStats.expensivePatterns)) {
        cloned.rawStats.expensivePatterns = cloned.rawStats.expensivePatterns.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const sanitized = { ...item };
          if (typeof sanitized.query === 'string') {
            const { processed, fingerprint } = processQuery(sanitized.query);
            sanitized.query = processed;
            sanitized.query_fingerprint = fingerprint;
          }
          if (typeof sanitized.formatted_query === 'string') {
            const { processed } = processQuery(sanitized.formatted_query);
            sanitized.formatted_query = processed;
          }
          return sanitized;
        });
      }
    }

    return cloned;
  } catch {
    return report;
  }
}

export class ScanHistoryStore {
  private static async ensureStorageDirAsync(): Promise<void> {
    try {
      await fs.promises.mkdir(STORAGE_DIR, { recursive: true });
      await fs.promises.mkdir(SCANS_DIR, { recursive: true });

      // Check if scan_index.json exists
      try {
        await fs.promises.access(INDEX_FILE, fs.constants.F_OK);
      } catch {
        // If scan_index.json does not exist, check if legacy scan_history.json exists to migrate
        let migrated = false;
        try {
          const legacyRaw = await fs.promises.readFile(HISTORY_FILE, 'utf-8');
          const legacyList = JSON.parse(legacyRaw);
          if (Array.isArray(legacyList) && legacyList.length > 0) {
            const summaries: ScanSummaryItem[] = [];
            for (const item of legacyList) {
              if (item && item.id) {
                const itemFile = path.join(SCANS_DIR, `${item.id}.json`);
                await fs.promises.writeFile(itemFile, JSON.stringify(item, null, 2), 'utf-8');
                summaries.push(extractScanSummary(item));
              }
            }
            await fs.promises.writeFile(INDEX_FILE, JSON.stringify(summaries, null, 2), 'utf-8');
            migrated = true;
          }
        } catch {
          // No legacy data or unreadable
        }
        if (!migrated) {
          await fs.promises.writeFile(INDEX_FILE, JSON.stringify([]), 'utf-8');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to ensure storage directory');
    }
  }

  private static ensureStorageDirSync(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(SCANS_DIR)) {
      fs.mkdirSync(SCANS_DIR, { recursive: true });
    }
    if (!fs.existsSync(INDEX_FILE)) {
      fs.writeFileSync(INDEX_FILE, JSON.stringify([]), 'utf-8');
    }
  }

  /**
   * Reads lightweight scan index from disk.
   */
  private static async readIndexFromFile(): Promise<ScanSummaryItem[]> {
    await this.ensureStorageDirAsync();
    try {
      const data = await fs.promises.readFile(INDEX_FILE, 'utf-8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      logger.warn({ err: e }, 'Error reading scan index file');
      return [];
    }
  }

  /**
   * Legacy helper to read legacy monolithic scan_history.json if present.
   */
  private static async readScansFromFile(): Promise<ScanReport[]> {
    await this.ensureStorageDirAsync();
    try {
      if (!fs.existsSync(HISTORY_FILE)) return [];
      const data = await fs.promises.readFile(HISTORY_FILE, 'utf-8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      logger.warn({ err: e }, 'Error reading legacy scan history file');
      return [];
    }
  }

  /**
   * Returns lightweight metadata summaries for all scans (O(1) payload size, avoids loading full reports).
   */
  public static async getScanSummaries(): Promise<ScanSummaryItem[]> {
    return this.readIndexFromFile();
  }

  /**
   * Asynchronously reads all stored scans. Reads documents concurrently based on the index.
   */
  public static async getAllScans(): Promise<ScanReport[]> {
    await this.ensureStorageDirAsync();
    const summaries = await this.readIndexFromFile();
    if (summaries.length === 0) {
      return this.readScansFromFile();
    }

    const docPromises = summaries.map(async (sum) => {
      const docPath = path.join(SCANS_DIR, `${sum.id}.json`);
      try {
        const raw = await fs.promises.readFile(docPath, 'utf-8');
        return JSON.parse(raw) as ScanReport;
      } catch {
        return null;
      }
    });

    const reports = await Promise.all(docPromises);
    return reports.filter((r): r is ScanReport => r !== null);
  }

  /**
   * Direct document retrieval by ID: O(1) single-file lookup without parsing other reports.
   * Checks local document store first, then legacy file, then Firestore cloud document.
   */
  public static async getScanById(id: string): Promise<ScanReport | null> {
    await this.ensureStorageDirAsync();
    // 1. Direct document file lookup: O(1)
    const docPath = path.join(SCANS_DIR, `${id}.json`);
    try {
      const raw = await fs.promises.readFile(docPath, 'utf-8');
      return JSON.parse(raw) as ScanReport;
    } catch {
      // 2. Legacy fallback
      const legacy = await this.readScansFromFile();
      const match = legacy.find((s) => s.id === id);
      if (match) return match;

      // 3. Optional Firestore cloud document lookup (if cloud history enabled)
      if (isFirestoreSyncEnabled()) {
        try {
          const adminDb = getAdminFirestore();
          if (adminDb) {
            const docSnap = await adminDb.collection('scans').doc(id).get();
            if (docSnap.exists) {
              return docSnap.data() as ScanReport;
            }
          }
        } catch (cloudErr) {
          logger.debug({ err: cloudErr }, 'Firestore scan lookup skipped');
        }
      }

      return null;
    }
  }

  /**
   * Incremental document save:
   * 1. Writes ONLY the single new/updated report document file (O(1) regarding historical scans).
   * 2. Updates the lightweight scan index (~5-10 KB, not megabytes).
   * 3. Prunes expired files beyond MAX_HISTORY_ITEMS.
   * 4. Syncs document to Firestore (incremental doc write) if configured.
   */
  public static async saveScan(
    report: ScanReport,
    options?: { privacyPreserving?: boolean }
  ): Promise<void> {
    return storageMutex.runExclusive(async () => {
      await this.ensureStorageDirAsync();
      const sanitizedReport = sanitizeReportForStorage(report, options);
      const scanId = sanitizedReport.id;

      // 1. Incremental single document save (O(1) write)
      const docPath = path.join(SCANS_DIR, `${scanId}.json`);
      const tempDocPath = path.join(
        SCANS_DIR,
        `${scanId}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      );
      await fs.promises.writeFile(tempDocPath, JSON.stringify(sanitizedReport, null, 2), 'utf-8');
      await fs.promises.rename(tempDocPath, docPath);

      // 2. Update lightweight index (~5-10 KB)
      const summaries = await this.readIndexFromFile();
      const newSummary = extractScanSummary(sanitizedReport);
      const updated = [newSummary, ...summaries.filter((s) => s.id !== scanId)];

      const toKeep = updated.slice(0, MAX_HISTORY_ITEMS);
      const toPrune = updated.slice(MAX_HISTORY_ITEMS);

      // Prune old report documents from disk
      for (const pruned of toPrune) {
        const prunedPath = path.join(SCANS_DIR, `${pruned.id}.json`);
        fs.promises.unlink(prunedPath).catch(() => {});
      }

      const tempIndexPath = path.join(
        STORAGE_DIR,
        `scan_index.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      );
      await fs.promises.writeFile(tempIndexPath, JSON.stringify(toKeep, null, 2), 'utf-8');
      await fs.promises.rename(tempIndexPath, INDEX_FILE);

      // 3. Optional Firestore Cloud Document Sync (Incremental single-doc set)
      if (isFirestoreSyncEnabled()) {
        try {
          const adminDb = getAdminFirestore();
          if (adminDb) {
            await adminDb.collection('scans').doc(scanId).set(sanitizedReport, { merge: true });
          }
        } catch (cloudErr) {
          logger.debug({ err: cloudErr }, 'Firestore cloud scan sync skipped or unavailable');
        }
      }
    });
  }

  /**
   * Clears scan history: resets index, unlinks all individual report documents.
   */
  public static async clearHistory(): Promise<void> {
    return storageMutex.runExclusive(async () => {
      await this.ensureStorageDirAsync();

      // Clear scan_index.json
      const tempIndexPath = path.join(STORAGE_DIR, `scan_index.clear.${Date.now()}.tmp`);
      await fs.promises.writeFile(tempIndexPath, JSON.stringify([], null, 2), 'utf-8');
      await fs.promises.rename(tempIndexPath, INDEX_FILE);

      // Clear legacy scan_history.json if present
      try {
        if (fs.existsSync(HISTORY_FILE)) {
          await fs.promises.writeFile(HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
        }
      } catch {}

      // Delete all stored report documents from SCANS_DIR
      try {
        const files = await fs.promises.readdir(SCANS_DIR);
        await Promise.all(
          files
            .filter((f) => f.endsWith('.json'))
            .map((f) => fs.promises.unlink(path.join(SCANS_DIR, f)).catch(() => {}))
        );
      } catch (err) {
        logger.warn({ err }, 'Error cleaning scans directory during clearHistory');
      }
    });
  }

  // Synchronous fallbacks for backwards compatibility
  public static getAllScansSync(): ScanReport[] {
    this.ensureStorageDirSync();
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const indexRaw = fs.readFileSync(INDEX_FILE, 'utf-8');
        const summaries = JSON.parse(indexRaw) as ScanSummaryItem[];
        const results: ScanReport[] = [];
        for (const sum of summaries) {
          const docPath = path.join(SCANS_DIR, `${sum.id}.json`);
          if (fs.existsSync(docPath)) {
            try {
              results.push(JSON.parse(fs.readFileSync(docPath, 'utf-8')));
            } catch {}
          }
        }
        return results;
      }
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        const list = JSON.parse(data);
        return Array.isArray(list) ? list : [];
      }
      return [];
    } catch (e) {
      logger.warn({ err: e }, 'Error reading scan history sync');
      return [];
    }
  }
}
