import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ScanReport } from '../../src/types/yachiru.js';
import { logger } from '../logger.js';

const STORAGE_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(STORAGE_DIR, 'scan_history.json');

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
      try {
        await fs.promises.access(HISTORY_FILE, fs.constants.F_OK);
      } catch {
        await fs.promises.writeFile(HISTORY_FILE, JSON.stringify([]), 'utf-8');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to ensure storage directory');
    }
  }

  private static ensureStorageDirSync(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]), 'utf-8');
    }
  }

  /**
   * Reads raw scan list directly from disk without locking (for internal reads inside mutex).
   */
  private static async readScansFromFile(): Promise<ScanReport[]> {
    await this.ensureStorageDirAsync();
    try {
      const data = await fs.promises.readFile(HISTORY_FILE, 'utf-8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      logger.warn({ err: e }, 'Error reading scan history file');
      return [];
    }
  }

  /**
   * Asynchronously reads all stored scans.
   */
  public static async getAllScans(): Promise<ScanReport[]> {
    return this.readScansFromFile();
  }

  public static async getScanById(id: string): Promise<ScanReport | null> {
    const list = await this.getAllScans();
    return list.find((s) => s.id === id) || null;
  }

  /**
   * Serialized atomic asynchronous save:
   * Uses AsyncMutex to prevent lost updates from concurrent scans, writes to temp file and renames atomically.
   */
  public static async saveScan(
    report: ScanReport,
    options?: { privacyPreserving?: boolean }
  ): Promise<void> {
    return storageMutex.runExclusive(async () => {
      await this.ensureStorageDirAsync();
      const sanitizedReport = sanitizeReportForStorage(report, options);
      const list = await this.readScansFromFile();
      // Keep last 50 scans
      const updated = [sanitizedReport, ...list.filter((s) => s.id !== sanitizedReport.id)].slice(0, 50);

      const tempFile = path.join(
        STORAGE_DIR,
        `scan_history.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      );
      await fs.promises.writeFile(tempFile, JSON.stringify(updated, null, 2), 'utf-8');
      await fs.promises.rename(tempFile, HISTORY_FILE);
    });
  }

  public static async clearHistory(): Promise<void> {
    return storageMutex.runExclusive(async () => {
      await this.ensureStorageDirAsync();
      const tempFile = path.join(STORAGE_DIR, `scan_history.clear.${Date.now()}.tmp`);
      await fs.promises.writeFile(tempFile, JSON.stringify([], null, 2), 'utf-8');
      await fs.promises.rename(tempFile, HISTORY_FILE);
    });
  }

  // Synchronous fallbacks for backwards compatibility
  public static getAllScansSync(): ScanReport[] {
    this.ensureStorageDirSync();
    try {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      logger.warn({ err: e }, 'Error reading scan history sync');
      return [];
    }
  }
}
