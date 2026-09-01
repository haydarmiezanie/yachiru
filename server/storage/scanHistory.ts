import fs from 'fs';
import path from 'path';
import { ScanReport } from '../../src/types/yachiru.js';

const STORAGE_DIR = path.join(process.cwd(), 'data');
const HISTORY_FILE = path.join(STORAGE_DIR, 'scan_history.json');

export class ScanHistoryStore {
  private static ensureStorageDir() {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]), 'utf-8');
    }
  }

  public static getAllScans(): ScanReport[] {
    this.ensureStorageDir();
    try {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn('Error reading scan history:', e);
      return [];
    }
  }

  public static getScanById(id: string): ScanReport | null {
    const list = this.getAllScans();
    return list.find((s) => s.id === id) || null;
  }

  public static saveScan(report: ScanReport): void {
    this.ensureStorageDir();
    const list = this.getAllScans();
    // Keep last 50 scans
    const updated = [report, ...list.filter((s) => s.id !== report.id)].slice(0, 50);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  }

  public static clearHistory(): void {
    this.ensureStorageDir();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([]), 'utf-8');
  }
}
