import fs from 'fs';
import path from 'path';
import { ScanReport } from '../../src/types/yachiru.js';
import { logger } from '../logger.js';

const STORAGE_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(STORAGE_DIR, 'scan_history.json');

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
 * Redacts literal string, numeric values, and credentials from SQL queries to prevent saving PII/sensitive customer data to disk.
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
 */
export function sanitizeReportForStorage(report: ScanReport): ScanReport {
  try {
    const cloned: ScanReport = JSON.parse(JSON.stringify(report));

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
                finding.metrics[key] = maskQueryPii(val);
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
            sanitized.query = maskQueryPii(sanitized.query);
          }
          if (typeof sanitized.formatted_query === 'string') {
            sanitized.formatted_query = maskQueryPii(sanitized.formatted_query);
          }
          return sanitized;
        });
      }

      if (Array.isArray(cloned.rawStats.expensivePatterns)) {
        cloned.rawStats.expensivePatterns = cloned.rawStats.expensivePatterns.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const sanitized = { ...item };
          if (typeof sanitized.query === 'string') {
            sanitized.query = maskQueryPii(sanitized.query);
          }
          if (typeof sanitized.formatted_query === 'string') {
            sanitized.formatted_query = maskQueryPii(sanitized.formatted_query);
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
  public static async saveScan(report: ScanReport): Promise<void> {
    return storageMutex.runExclusive(async () => {
      await this.ensureStorageDirAsync();
      const sanitizedReport = sanitizeReportForStorage(report);
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
