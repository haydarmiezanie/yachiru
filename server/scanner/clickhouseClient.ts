import { DEMO_CLUSTERS, MockClickHouseCluster } from './demoDatasets.js';
import { ScanTarget } from '../../src/types/yachiru.js';

export interface RawClusterData {
  version: string;
  clusterName: string;
  database?: string;
  targetDatabase?: string;
  tables: any[];
  columns: any[];
  parts: any[];
  merges: any[];
  queryLog: any[];
  settings: any[];
  totalDatabases: number;
  uptimeSeconds: number;
}

export class ClickHouseScannerClient {
  private target: ScanTarget;

  constructor(target: ScanTarget) {
    this.target = target;
  }

  private getCleanEndpoint() {
    let rawHost = (this.target.host || 'localhost').trim();
    let port = Number(this.target.port) || 8123;
    let protocol = (this.target.protocol || 'http').toLowerCase();

    // If host contains protocol prefix, extract it
    if (rawHost.startsWith('https://')) {
      protocol = 'https';
      rawHost = rawHost.replace(/^https:\/\//i, '');
    } else if (rawHost.startsWith('http://')) {
      protocol = 'http';
      rawHost = rawHost.replace(/^http:\/\//i, '');
    }

    // Strip trailing slashes or subpaths
    rawHost = rawHost.replace(/\/.*$/, '').trim();

    // If host contains :port at the end (e.g. "myhost.com:8443")
    if (rawHost.includes(':')) {
      const parts = rawHost.split(':');
      rawHost = parts[0];
      const parsedPort = parseInt(parts[1], 10);
      if (!isNaN(parsedPort) && parsedPort > 0) {
        port = parsedPort;
      }
    }

    // Auto-select https if port is 8443, 443, or 9440 unless explicitly http
    if ((port === 8443 || port === 443 || port === 9440) && !this.target.protocol) {
      protocol = 'https';
    }

    const baseUrl = `${protocol}://${rawHost}:${port}`;
    return { host: rawHost, port, protocol, baseUrl };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Accept': 'application/json, text/plain, */*',
    };

    const user = (this.target.user || '').trim();
    const password = this.target.password || '';

    // ClickHouse expects X-ClickHouse-User & X-ClickHouse-Key headers.
    // NOTE: ClickHouse explicitly rejects requests that send both X-ClickHouse headers AND Authorization header simultaneously (Code 516).
    if (user) {
      headers['X-ClickHouse-User'] = user;
    }
    if (password) {
      headers['X-ClickHouse-Key'] = password;
    }

    return headers;
  }

  private parseClickHouseOutput(text: string): any[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // 1. Try parsing as standard JSON
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.data)) return parsed.data;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
    } catch {
      // Not a single JSON document, fall through to newline-delimited JSON (JSONEachRow)
    }

    // 2. Parse Newline-Delimited JSON (JSONEachRow format)
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows: any[] = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item !== null && item !== undefined) {
          rows.push(item);
        }
      } catch {
        // Skip unparseable lines (e.g. comment or trailing status text)
      }
    }

    return rows;
  }

  public async testConnection(): Promise<{ success: boolean; version?: string; message: string; databases?: string[] }> {
    if (this.target.isDemoCluster) {
      const demo = DEMO_CLUSTERS[this.target.demoClusterId || 'apex_ecommerce'] || DEMO_CLUSTERS.apex_ecommerce;
      return {
        success: true,
        version: demo.version,
        message: `Successfully connected to Demo Cluster: ${demo.name}`,
        databases: [demo.database, 'system', 'default'],
      };
    }

    try {
      const { baseUrl } = this.getCleanEndpoint();
      const url = `${baseUrl}/?default_format=JSONEachRow`;
      const headers = this.getHeaders();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: 'SELECT version() AS version, uptime() AS uptime, currentUser() AS user',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errText = await resp.text();
        const cleanErr = errText.replace(/^[0-9]+\s*/, '').trim().slice(0, 300);
        return {
          success: false,
          message: `ClickHouse HTTP ${resp.status}: ${cleanErr || 'Failed to authenticate or connect'}`,
        };
      }

      const text = await resp.text();
      const rows = this.parseClickHouseOutput(text);
      const row = rows[0] || {};

      // Fetch accessible databases
      let dbs: string[] = [];
      try {
        const dbController = new AbortController();
        const dbTimeoutId = setTimeout(() => dbController.abort(), 4000);

        const dbResp = await fetch(url, {
          method: 'POST',
          headers,
          body: 'SHOW DATABASES',
          signal: dbController.signal,
        });
        clearTimeout(dbTimeoutId);

        if (dbResp.ok) {
          const dbText = await dbResp.text();
          const dbRows = this.parseClickHouseOutput(dbText);
          dbs = dbRows.map((d: any) => d.name || Object.values(d)[0]).filter(Boolean);
        }
      } catch {
        // Non-critical, database list is optional for test connection
      }

      return {
        success: true,
        version: row?.version || 'ClickHouse Server',
        message: `Connected successfully as '${row?.user || this.target.user || 'default'}' (Version: ${row?.version || 'detected'}, Uptime: ${row?.uptime ? Math.floor(row.uptime / 3600) + 'h' : 'active'})`,
        databases: dbs.length > 0 ? dbs : [this.target.database || 'default'],
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      let errMsg = err.message || 'Failed to connect to ClickHouse instance';

      if (isTimeout) {
        errMsg = 'Connection timed out (8s). The target host is unreachable. If ClickHouse is behind a VPN, ensure the server running Yachiru is inside the VPN network, or check firewall rules & port.';
      } else if (err.code === 'ECONNREFUSED' || errMsg.includes('ECONNREFUSED')) {
        errMsg = `Connection refused at port ${this.target.port}. Ensure ClickHouse HTTP interface is active and listening on 0.0.0.0 (not just 127.0.0.1).`;
      } else if (err.code === 'ENOTFOUND' || errMsg.includes('ENOTFOUND')) {
        errMsg = `Host '${this.target.host}' could not be resolved. Check DNS or IP address.`;
      }

      return {
        success: false,
        message: errMsg,
      };
    }
  }

  public async fetchClusterData(): Promise<RawClusterData> {
    if (this.target.isDemoCluster) {
      const demo = DEMO_CLUSTERS[this.target.demoClusterId || 'apex_ecommerce'] || DEMO_CLUSTERS.apex_ecommerce;
      return {
        version: demo.version,
        clusterName: demo.name,
        tables: demo.tables,
        columns: demo.columns,
        parts: demo.parts,
        merges: demo.merges,
        queryLog: demo.queryLog,
        settings: demo.settings,
        totalDatabases: demo.totalTables > 0 ? 3 : 1,
        uptimeSeconds: demo.uptimeSeconds,
      };
    }

    const { baseUrl, host, port } = this.getCleanEndpoint();
    const url = `${baseUrl}/?default_format=JSONEachRow`;
    const targetDb = (this.target.database || 'default').trim();
    const headers = this.getHeaders();

    const runQuery = async (query: string, fallback: any[] = []): Promise<any[]> => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: query,
        });
        if (!resp.ok) {
          const errBody = await resp.text();
          console.warn(`[ClickHouse Scanner] Query failed (${resp.status}): ${query.slice(0, 80)} -> ${errBody.slice(0, 150)}`);
          return fallback;
        }
        const text = await resp.text();
        return this.parseClickHouseOutput(text);
      } catch (err) {
        console.warn(`[ClickHouse Scanner] Query network error:`, err);
        return fallback;
      }
    };

    // 1. Fetch Version & Uptime
    const versionRes = await runQuery('SELECT version() AS version, uptime() AS uptime');
    const version = versionRes[0]?.version || 'ClickHouse Server';
    const uptime = Number(versionRes[0]?.uptime) || 86400;

    // 2. Fetch Tables in target database
    const tables = await runQuery(`
      SELECT 
        database,
        name,
        engine,
        partition_key,
        sorting_key,
        primary_key,
        sampling_key,
        total_rows,
        total_bytes,
        comment
      FROM system.tables 
      WHERE database = '${targetDb}' AND is_temporary = 0
    `);

    // 3. Fetch Columns
    const columns = await runQuery(`
      SELECT 
        database,
        table,
        name,
        type,
        default_type,
        default_expression,
        data_compressed_bytes,
        data_uncompressed_bytes,
        compression_codec
      FROM system.columns 
      WHERE database = '${targetDb}'
    `);

    // 4. Fetch Parts status
    const parts = await runQuery(`
      SELECT 
        database,
        table,
        partition,
        name,
        part_type,
        active,
        rows,
        bytes_on_disk,
        modification_time
      FROM system.parts 
      WHERE database = '${targetDb}' AND active = 1
      ORDER BY modification_time DESC
      LIMIT 1000
    `);

    // 5. Fetch Active Merges
    const merges = await runQuery(`
      SELECT 
        database,
        table,
        elapsed,
        progress,
        num_parts,
        total_size_bytes_compressed,
        memory_usage,
        is_mutation
      FROM system.merges
    `);

    // 6. Fetch Query Log (last N days)
    const lookback = Number(this.target.lookbackDays) || 7;
    const queryLog = await runQuery(`
      SELECT 
        query_id,
        event_time,
        query_duration_ms,
        query,
        tables,
        columns,
        read_rows,
        read_bytes,
        result_rows,
        result_bytes,
        memory_usage,
        exception_code,
        exception,
        user
      FROM system.query_log 
      WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing') 
        AND event_date >= today() - ${lookback}
        AND (current_database = '${targetDb}' OR has(databases, '${targetDb}'))
        AND query NOT LIKE '%system.%'
      ORDER BY query_duration_ms DESC
      LIMIT 500
    `);

    // 7. Fetch System Settings
    const settings = await runQuery(`
      SELECT name, value, changed, description, type 
      FROM system.settings 
      WHERE name IN (
        'max_threads', 'background_pool_size', 'background_fetches_pool_size',
        'max_memory_usage', 'max_bytes_before_external_group_by',
        'optimize_trivial_approximate_count_query', 'join_use_nulls',
        'max_execution_time', 'mark_cache_size', 'uncompressed_cache_size'
      )
    `);

    return {
      version,
      clusterName: `${host}:${port} (${targetDb})`,
      tables,
      columns,
      parts,
      merges,
      queryLog,
      settings,
      totalDatabases: 1,
      uptimeSeconds: uptime,
    };
  }
}
