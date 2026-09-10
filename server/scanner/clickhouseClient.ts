import { DEMO_CLUSTERS, MockClickHouseCluster } from './demoDatasets.js';
import { ScanTarget } from '../../src/types/yachiru.js';
import { assertSafeHost } from '../security/ssrfValidator.js';
import { openSshTunnel, SshTunnelInstance } from './sshTunnel.js';

export interface ClickHouseTableRow {
  database: string;
  name: string;
  engine: string;
  partition_key?: string;
  sorting_key?: string;
  primary_key?: string;
  sampling_key?: string;
  total_rows: number;
  total_bytes: number;
  comment?: string;
  parts_count?: number;
  active_partitions?: number;
  ttl_expression?: string;
}

export interface ClickHouseColumnRow {
  database: string;
  table: string;
  name: string;
  type: string;
  default_type?: string;
  default_expression?: string;
  data_compressed_bytes: number;
  data_uncompressed_bytes: number;
  compression_codec?: string;
  cardinality_approx?: number;
  is_nullable?: boolean | number;
}

export interface ClickHousePartRow {
  database: string;
  table: string;
  partition?: string;
  name: string;
  part_type?: string;
  active: number;
  rows: number;
  bytes_on_disk: number;
  modification_time?: string;
}

export interface ClickHouseMergeRow {
  database: string;
  table: string;
  elapsed: number;
  progress: number;
  num_parts: number;
  total_size_bytes_compressed: number;
  memory_usage: number;
  is_mutation: number;
}

export interface ClickHouseQueryLogRow {
  query_id: string;
  event_time?: string;
  query_duration_ms: number;
  query: string;
  tables: string[];
  columns: string[];
  read_rows: number;
  read_bytes: number;
  result_rows: number;
  result_bytes: number;
  memory_usage: number;
  exception_code?: number;
  exception?: string;
  user?: string;
  read_rows_after_pk?: number;
  used_aggregate_functions?: boolean;
  frequency_per_hour?: number;
}

export interface ClickHouseSettingRow {
  name: string;
  value: string;
  changed?: number | boolean;
  description?: string;
  type?: string;
}

export interface ClickHouseVersionRow {
  version?: string;
  uptime?: number;
  user?: string;
}

export interface RawClusterData {
  version: string;
  clusterName: string;
  database?: string;
  targetDatabase?: string;
  tables: ClickHouseTableRow[];
  columns: ClickHouseColumnRow[];
  parts: ClickHousePartRow[];
  merges: ClickHouseMergeRow[];
  queryLog: ClickHouseQueryLogRow[];
  settings: ClickHouseSettingRow[];
  totalDatabases: number;
  uptimeSeconds: number;
}

/**
 * Validates ClickHouse database/table identifiers against alphanumeric + underscore conventions.
 */
export function isValidClickHouseIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name.trim()) && name.trim().length <= 256;
}

/**
 * Escapes single quotes and backslashes for ClickHouse string literals.
 */
export function escapeClickHouseString(val: string): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class ClickHouseScannerClient {
  private target: ScanTarget;

  constructor(target: ScanTarget) {
    this.target = target;
  }

  public getCleanEndpoint() {
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

    // Auto-detect and upgrade ClickHouse Cloud clusters (*.clickhouse.cloud)
    if (rawHost.toLowerCase().includes('.clickhouse.cloud')) {
      protocol = 'https';
      if (port === 8123 || !port) {
        port = 8443;
      }
    } else if ((port === 8443 || port === 443 || port === 9440) && !this.target.protocol) {
      // Auto-select https if port is 8443, 443, or 9440 unless explicitly http
      protocol = 'https';
    }

    const baseUrl = `${protocol}://${rawHost}:${port}`;
    return { host: rawHost, port, protocol, baseUrl };
  }

  public getHeaders(): Record<string, string> {
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

  public parseClickHouseOutput<T = Record<string, any>>(text: string): T[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // 1. Try parsing as standard JSON
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as T[];
      if (parsed && Array.isArray(parsed.data)) return parsed.data as T[];
      if (typeof parsed === 'object' && parsed !== null) return [parsed as T];
    } catch {
      // Not a single JSON document, fall through to newline-delimited JSON (JSONEachRow)
    }

    // 2. Parse Newline-Delimited JSON (JSONEachRow format)
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows: T[] = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item !== null && item !== undefined) {
          rows.push(item as T);
        }
      } catch {
        // Skip unparseable lines (e.g. comment or trailing status text)
      }
    }

    return rows;
  }

  private formatNetworkError(err: unknown, baseUrl: string, host: string, port: number): string {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message.startsWith('Refusing to connect to restricted')) {
      return error.message;
    }
    const cause = (err as any)?.cause;
    const causeMsg = cause?.message || '';
    const causeCode = cause?.code || (err as any)?.code || '';
    const fullText = `${error.name} ${error.message} ${causeMsg} ${causeCode}`;

    const isTimeout =
      error.name === 'AbortError' ||
      fullText.includes('aborted') ||
      fullText.includes('timeout') ||
      causeCode === 'ETIMEDOUT';

    const isRefused =
      causeCode === 'ECONNREFUSED' ||
      fullText.includes('ECONNREFUSED') ||
      fullText.includes('Connection refused');

    const isReset =
      causeCode === 'ECONNRESET' ||
      fullText.includes('ECONNRESET') ||
      fullText.includes('disconnected before secure TLS') ||
      fullText.includes('SSL_ERROR_SYSCALL') ||
      fullText.includes('socket disconnected');

    const isNotFound =
      causeCode === 'ENOTFOUND' ||
      causeCode === 'EAI_AGAIN' ||
      fullText.includes('ENOTFOUND') ||
      fullText.includes('EAI_AGAIN');

    if (isReset) {
      if (host.toLowerCase().includes('clickhouse.cloud')) {
        return `Connection to ClickHouse Cloud at ${baseUrl} was abruptly closed during TLS negotiation (SSL_ERROR_SYSCALL / ECONNRESET). ClickHouse Cloud drops connections from unwhitelisted IP addresses. In your ClickHouse Cloud Console, navigate to Cluster > Settings > IP Access List, and ensure your IP is added (or temporarily allow 0.0.0.0/0 for testing).`;
      }
      return `Connection to ${baseUrl} was reset by the server (ECONNRESET). Verify network firewall and TLS certificate settings.`;
    }

    if (isTimeout) {
      if (host.toLowerCase().includes('clickhouse.cloud')) {
        return `Connection to ClickHouse Cloud at ${baseUrl} timed out. Target is unreachable. If connecting from a self-hosted server (such as yachiru.id), please ensure your server's outbound public IP is added to the ClickHouse Cloud IP Access List in your Cloud Console.`;
      }
      return `Connection to ClickHouse at ${baseUrl} timed out. Target is unreachable. If ClickHouse is behind a firewall/VPN, check network routing or use a Demo Cluster.`;
    }
    if (isRefused) {
      if (host.toLowerCase().includes('clickhouse.cloud')) {
        return `Connection refused at ${baseUrl}. ClickHouse Cloud requires HTTPS on port 8443 (HTTP on port 8123 is not supported). Please verify port 8443 with HTTPS is configured.`;
      }
      return `Connection refused at ${baseUrl}. No ClickHouse server is responding at ${host}:${port}. If you don't have a live ClickHouse instance running locally, select one of the built-in Demo Clusters (e.g. Apex E-commerce or Nexus IoT) to explore.`;
    }
    if (isNotFound) {
      return `Host '${host}' could not be resolved. Please check DNS configuration or IP address.`;
    }
    return error.message || 'Failed to connect to ClickHouse instance';
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

    const { baseUrl, host, port, protocol } = this.getCleanEndpoint();
    let tunnel: SshTunnelInstance | null = null;

    try {
      let activeBaseUrl = baseUrl;

      if (this.target.sshTunnel?.enabled) {
        tunnel = await openSshTunnel(this.target.sshTunnel, host, port);
        activeBaseUrl = `${protocol}://${tunnel.localHost}:${tunnel.localPort}`;
      } else {
        // SSRF Prevention: Enforce DNS resolution & verify destination is not an internal, loopback, or metadata address
        await assertSafeHost(host, Boolean(this.target.isDemoCluster));
      }

      const url = `${activeBaseUrl}/?default_format=JSONEachRow`;
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
      const rows = this.parseClickHouseOutput<ClickHouseVersionRow>(text);
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
          const dbRows = this.parseClickHouseOutput<{ name?: string } & Record<string, any>>(dbText);
          dbs = dbRows.map((d) => d.name || Object.values(d)[0]).filter(Boolean);
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
    } catch (err: unknown) {
      return {
        success: false,
        message: this.formatNetworkError(err, baseUrl, host, port),
      };
    } finally {
      if (tunnel) {
        await tunnel.close();
      }
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

    const { baseUrl, host, port, protocol } = this.getCleanEndpoint();
    let tunnel: SshTunnelInstance | null = null;

    try {
      let activeBaseUrl = baseUrl;

      if (this.target.sshTunnel?.enabled) {
        tunnel = await openSshTunnel(this.target.sshTunnel, host, port);
        activeBaseUrl = `${protocol}://${tunnel.localHost}:${tunnel.localPort}`;
      } else {
        // SSRF Prevention: Enforce DNS resolution & verify destination is not an internal, loopback, or metadata address
        await assertSafeHost(host, Boolean(this.target.isDemoCluster));
      }

      const url = `${activeBaseUrl}/?default_format=JSONEachRow`;
    
    // Strict Validation & Escaping of database identifier
    const rawDb = (this.target.database || 'default').trim();
    if (!isValidClickHouseIdentifier(rawDb)) {
      throw new Error(`Invalid target database identifier: '${rawDb}'. Only alphanumeric characters, dots, dashes, and underscores are allowed.`);
    }
    const targetDb = escapeClickHouseString(rawDb);

    // Validate lookbackDays to safe integer range (1-365)
    const rawLookback = Number(this.target.lookbackDays);
    const lookback = Number.isFinite(rawLookback) && rawLookback > 0 ? Math.min(365, Math.max(1, Math.floor(rawLookback))) : 7;

    const headers = this.getHeaders();

    // 0. Preliminary Health Probe & Connectivity Verification
    try {
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 6000);
      const probeResp = await fetch(url, {
        method: 'POST',
        headers,
        body: 'SELECT version() AS version, uptime() AS uptime',
        signal: probeController.signal,
      });
      clearTimeout(probeTimeout);

      if (!probeResp.ok) {
        const errText = await probeResp.text();
        const cleanErr = errText.replace(/^[0-9]+\s*/, '').trim().slice(0, 300);
        throw new Error(`ClickHouse server returned HTTP ${probeResp.status}: ${cleanErr || 'Failed to authenticate or connect'}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('ClickHouse server returned HTTP')) {
        throw err;
      }
      throw new Error(this.formatNetworkError(err, baseUrl, host, port));
    }

    const defaultTimeoutMs = Number(process.env.CLICKHOUSE_QUERY_TIMEOUT_MS) || 10000;

    const runQuery = async <T = Record<string, any>>(
      query: string,
      fallback: T[] = [],
      timeoutMs = defaultTimeoutMs
    ): Promise<T[]> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: query,
          signal: controller.signal,
        });
        if (!resp.ok) {
          const errBody = await resp.text();
          console.warn(`[ClickHouse Scanner] Query warning (${resp.status}): ${query.slice(0, 80)} -> ${errBody.slice(0, 150)}`);
          return fallback;
        }
        const text = await resp.text();
        return this.parseClickHouseOutput<T>(text);
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          console.warn(`[ClickHouse Scanner] Query timed out after ${timeoutMs}ms: ${query.slice(0, 80)}`);
        } else {
          console.warn(`[ClickHouse Scanner] Non-fatal query error:`, err?.message || err);
        }
        return fallback;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Execute all 7 independent system queries concurrently via Promise.all.
    // This reduces the network latency overhead from sum(latency_1..7) to max(latency),
    // eliminating latency accumulation across slow queries such as system.query_log.
    const [versionRes, tables, columns, parts, merges, queryLog, settings] = await Promise.all([
      // 1. Fetch Version & Uptime
      runQuery<ClickHouseVersionRow>('SELECT version() AS version, uptime() AS uptime'),

      // 2. Fetch Tables in target database (Safe escaped parameter)
      runQuery<ClickHouseTableRow>(`
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
      `),

      // 3. Fetch Columns (Safe escaped parameter)
      runQuery<ClickHouseColumnRow>(`
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
      `),

      // 4. Fetch Parts status (Safe escaped parameter)
      runQuery<ClickHousePartRow>(`
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
      `),

      // 5. Fetch Active Merges
      runQuery<ClickHouseMergeRow>(`
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
      `),

      // 6. Fetch Query Log (Safe lookback integer and escaped database parameter)
      runQuery<ClickHouseQueryLogRow>(`
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
      `),

      // 7. Fetch System Settings
      runQuery<ClickHouseSettingRow>(`
        SELECT name, value, changed, description, type 
        FROM system.settings 
        WHERE name IN (
          'max_threads', 'background_pool_size', 'background_fetches_pool_size',
          'max_memory_usage', 'max_bytes_before_external_group_by',
          'optimize_trivial_approximate_count_query', 'join_use_nulls',
          'max_execution_time', 'mark_cache_size', 'uncompressed_cache_size'
        )
      `),
    ]);

    const version = versionRes[0]?.version || 'ClickHouse Server';
    const uptime = Number(versionRes[0]?.uptime) || 86400;

      return {
        version,
        clusterName: this.target.sshTunnel?.enabled
          ? `${host}:${port} (${targetDb}) via SSH [${this.target.sshTunnel.host}]`
          : `${host}:${port} (${targetDb})`,
        database: targetDb,
        targetDatabase: targetDb,
        tables,
        columns,
        parts,
        merges,
        queryLog,
        settings,
        totalDatabases: 1,
        uptimeSeconds: uptime,
      };
    } finally {
      if (tunnel) {
        await tunnel.close();
      }
    }
  }
}
