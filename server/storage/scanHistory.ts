import fs from 'fs';
import path from 'path';
import { ScanReport } from '../../src/types/yachiru.js';
import { logger } from '../logger.js';

const STORAGE_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(STORAGE_DIR, 'scan_history.json');

/**
 * Redacts literal string and numeric values from SQL queries to prevent saving PII/sensitive customer data to disk.
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
    // 4. Redact bearer / token / password strings if present
    .replace(/(password|secret|token|api_key)\s*=\s*'[^']*'/gi, "$1 = '[REDACTED]'");
}

/**
 * Deeply sanitizes any query text or metrics in a ScanReport before persistence.
 */
export function sanitizeReportForStorage(report: ScanReport): ScanReport {
  try {
    const cloned: ScanReport = JSON.parse(JSON.stringify(report));

    if (Array.isArray(cloned.findings)) {
      for (const finding of cloned.findings) {
        if (finding.metrics) {
          if (typeof finding.metrics.querySample === 'string') {
            finding.metrics.querySample = maskQueryPii(finding.metrics.querySample);
          }
          if (typeof finding.metrics.sampleException === 'string') {
            finding.metrics.sampleException = maskQueryPii(finding.metrics.sampleException);
          }
        }
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
   * Asynchronously reads all stored scans.
   */
  public static async getAllScans(): Promise<ScanReport[]> {
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

  public static async getScanById(id: string): Promise<ScanReport | null> {
    const list = await this.getAllScans();
    return list.find((s) => s.id === id) || null;
  }

  /**
   * Atomic asynchronous save: writes to a unique temporary file first, then atomically renames it.
   */
  public static async saveScan(report: ScanReport): Promise<void> {
    await this.ensureStorageDirAsync();
    const sanitizedReport = sanitizeReportForStorage(report);
    const list = await this.getAllScans();
    // Keep last 50 scans
    const updated = [sanitizedReport, ...list.filter((s) => s.id !== sanitizedReport.id)].slice(0, 50);

    const tempFile = path.join(STORAGE_DIR, `scan_history.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    await fs.promises.writeFile(tempFile, JSON.stringify(updated, null, 2), 'utf-8');
    await fs.promises.rename(tempFile, HISTORY_FILE);
  }

  public static async clearHistory(): Promise<void> {
    await this.ensureStorageDirAsync();
    const tempFile = path.join(STORAGE_DIR, `scan_history.clear.${Date.now()}.tmp`);
    await fs.promises.writeFile(tempFile, JSON.stringify([]), 'utf-8');
    await fs.promises.rename(tempFile, HISTORY_FILE);
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
