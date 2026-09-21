import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  ConnectionConfig,
  AnalysisReport,
  ScanHistoryRecord,
  ScanComparison,
  ScanHistoryResponse,
  FindingSummaryItem,
} from '../src/types.js';
import { openSshTunnel, OpenTunnelResult } from './sshTunnel.js';
import { assertReadOnlySql } from './analyzer.js';

/**
 * Validates ClickHouse SQL identifier (database / table name) to prevent SQL injection.
 */
export function isValidIdentifier(ident: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(ident);
}

/**
 * Escapes a single-quoted ClickHouse SQL string literal.
 */
function escapeSqlString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Computes comparative diff between the two most recent scans:
 * - which findings are new since the previous scan
 * - which findings from the previous scan no longer appear (resolved)
 * - which findings persist across both scans
 */
export function computeScanComparison(history: ScanHistoryRecord[]): ScanComparison {
  if (!history || history.length < 2) {
    return {
      hasComparison: false,
      newFindings: [],
      resolvedFindings: [],
      persistentFindings: [],
    };
  }

  const latestScan = history[history.length - 1];
  const previousScan = history[history.length - 2];

  const previousMap = new Map<string, FindingSummaryItem>();
  for (const f of previousScan.finding_summary) {
    const key = `${f.category}:::${f.title}`;
    previousMap.set(key, f);
  }

  const latestMap = new Map<string, FindingSummaryItem>();
  const newFindings: FindingSummaryItem[] = [];
  const persistentFindings: FindingSummaryItem[] = [];

  for (const f of latestScan.finding_summary) {
    const key = `${f.category}:::${f.title}`;
    latestMap.set(key, f);
    if (previousMap.has(key)) {
      persistentFindings.push(f);
    } else {
      newFindings.push(f);
    }
  }

  const resolvedFindings: FindingSummaryItem[] = [];
  for (const [key, f] of previousMap.entries()) {
    if (!latestMap.has(key)) {
      resolvedFindings.push(f);
    }
  }

  const scoreDelta = latestScan.overall_score - previousScan.overall_score;

  return {
    hasComparison: true,
    previousScanAt: previousScan.scanned_at,
    currentScanAt: latestScan.scanned_at,
    scoreDelta,
    newFindings,
    resolvedFindings,
    persistentFindings,
  };
}

/**
 * Generates realistic simulation history data for Demo / Simulation mode.
 */
export function generateDemoHistory(): ScanHistoryRecord[] {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  const demoScans: ScanHistoryRecord[] = [
    {
      scan_id: `demo_scan_tminus14d`,
      scanned_at: new Date(now - 14 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
      target_host: 'demo.internal',
      target_database: 'production',
      overall_score: 58,
      overall_verdict: 'Critical Optimization Required',
      category_scores: {
        part_health: 45,
        primary_key: 55,
        partitioning: 60,
        compression: 65,
        table_engine: 70,
        skip_indices: 50,
        query_performance: 52,
        replication_distributed: 80,
        server_settings: 75,
        mutations: 40,
        disk_space: 68,
        system_errors: 60,
        replication_queue: 72,
      },
      finding_summary: [
        { category: 'part_health', title: "Excessive active parts on table 'events_raw'", severity: 'critical' },
        { category: 'primary_key', title: "Poor ORDER BY prefix selectivity on 'events_raw'", severity: 'warning' },
        { category: 'mutations', title: "Stuck ALTER UPDATE mutation on 'events_raw'", severity: 'critical' },
        { category: 'disk_space', title: "Disk capacity warning on storage nvme0", severity: 'warning' },
        { category: 'system_errors', title: "Elevated CANNOT_ALLOCATE_MEMORY error rate", severity: 'warning' },
      ],
      clickhouse_version: '24.8.4.13-lts',
    },
    {
      scan_id: `demo_scan_tminus10d`,
      scanned_at: new Date(now - 10 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
      target_host: 'demo.internal',
      target_database: 'production',
      overall_score: 66,
      overall_verdict: 'Needs Tuning',
      category_scores: {
        part_health: 55,
        primary_key: 65,
        partitioning: 65,
        compression: 70,
        table_engine: 75,
        skip_indices: 60,
        query_performance: 62,
        replication_distributed: 85,
        server_settings: 80,
        mutations: 60,
        disk_space: 70,
        system_errors: 70,
        replication_queue: 78,
      },
      finding_summary: [
        { category: 'part_health', title: "Excessive active parts on table 'events_raw'", severity: 'critical' },
        { category: 'primary_key', title: "Poor ORDER BY prefix selectivity on 'events_raw'", severity: 'warning' },
        { category: 'mutations', title: "Long-running mutation on 'events_raw' (2.4h)", severity: 'warning' },
        { category: 'disk_space', title: "Disk capacity warning on storage nvme0", severity: 'warning' },
      ],
      clickhouse_version: '24.8.4.13-lts',
    },
    {
      scan_id: `demo_scan_tminus6d`,
      scanned_at: new Date(now - 6 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
      target_host: 'demo.internal',
      target_database: 'production',
      overall_score: 74,
      overall_verdict: 'Needs Tuning',
      category_scores: {
        part_health: 68,
        primary_key: 75,
        partitioning: 75,
        compression: 78,
        table_engine: 80,
        skip_indices: 70,
        query_performance: 72,
        replication_distributed: 90,
        server_settings: 85,
        mutations: 75,
        disk_space: 82,
        system_errors: 85,
        replication_queue: 88,
      },
      finding_summary: [
        { category: 'part_health', title: "Excessive active parts on table 'events_raw'", severity: 'critical' },
        { category: 'primary_key', title: "Poor ORDER BY prefix selectivity on 'events_raw'", severity: 'warning' },
        { category: 'mutations', title: "Long-running mutation on 'events_raw' (2.4h)", severity: 'warning' },
        { category: 'disk_space', title: 'Adequate disk space across all storage volumes', severity: 'good' },
      ],
      clickhouse_version: '24.8.4.13-lts',
    },
    {
      scan_id: `demo_scan_tminus2d`,
      scanned_at: new Date(now - 2 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
      target_host: 'demo.internal',
      target_database: 'production',
      overall_score: 81,
      overall_verdict: 'Optimized',
      category_scores: {
        part_health: 76,
        primary_key: 82,
        partitioning: 80,
        compression: 85,
        table_engine: 85,
        skip_indices: 78,
        query_performance: 82,
        replication_distributed: 92,
        server_settings: 88,
        mutations: 80,
        disk_space: 88,
        system_errors: 90,
        replication_queue: 92,
      },
      finding_summary: [
        { category: 'part_health', title: "Excessive active parts on table 'events_raw'", severity: 'critical' },
        { category: 'mutations', title: "Long-running mutation on 'events_raw' (2.4h)", severity: 'warning' },
        { category: 'disk_space', title: 'Adequate disk space across all storage volumes', severity: 'good' },
        { category: 'system_errors', title: 'Error rates within normal operational thresholds', severity: 'good' },
      ],
      clickhouse_version: '24.8.4.13-lts',
    },
    {
      scan_id: `demo_scan_current`,
      scanned_at: new Date(now).toISOString().replace('T', ' ').substring(0, 19),
      target_host: 'demo.internal',
      target_database: 'production',
      overall_score: 86,
      overall_verdict: 'Optimized',
      category_scores: {
        part_health: 82,
        primary_key: 88,
        partitioning: 85,
        compression: 90,
        table_engine: 90,
        skip_indices: 84,
        query_performance: 88,
        replication_distributed: 95,
        server_settings: 92,
        mutations: 88,
        disk_space: 92,
        system_errors: 94,
        replication_queue: 95,
      },
      finding_summary: [
        { category: 'part_health', title: "Severe micro-batching on 'telemetry_stream' (78% tiny parts)", severity: 'warning' },
        { category: 'disk_space', title: 'Adequate disk space across all storage volumes', severity: 'good' },
        { category: 'system_errors', title: 'Error rates within normal operational thresholds', severity: 'good' },
        { category: 'replication_queue', title: 'Replication queue is clear', severity: 'good' },
      ],
      clickhouse_version: '24.8.4.13-lts',
    },
  ];

  return demoScans;
}

/**
 * Writes a completed scan report into the user's ClickHouse history table.
 *
 * Security & Architectural Boundaries:
 * 1. Uses separate history write credentials (never the read-only scan credentials).
 * 2. Only ever issues an INSERT statement (never CREATE TABLE, never GRANT, never ALTER).
 * 3. Never throws; surfaces success or failure in the returned status object.
 * 4. Finding summary contains ONLY { category, title, severity } — never remediation SQL or narrative text.
 * 5. Write ClickHouse client (and SSH tunnel if opened) are strictly closed in a finally block.
 */
export async function recordScanHistory(
  config: ConnectionConfig,
  report: AnalysisReport,
  options?: { tunnelOverride?: { host: string; port: number } }
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  // Never write history for demo/simulated scans
  if (config.isDemo || report.is_demo) {
    return { skipped: true, success: true };
  }

  // Check if history tracking is enabled
  if (!config.enableHistoryTracking) {
    return { skipped: true, success: true };
  }

  const writeUsername = config.historyWriteUsername?.trim();
  const writePassword = config.historyWritePassword || '';

  if (!writeUsername) {
    return {
      success: false,
      error: 'History tracking is enabled but history write username is missing.',
    };
  }

  const targetDb = (config.historyDatabase || config.database || 'default').trim();
  const targetTable = (config.historyTableName || 'yachiru_scan_history').trim();

  if (!isValidIdentifier(targetDb) || !isValidIdentifier(targetTable)) {
    return {
      success: false,
      error: `Invalid database or table name identifier: "${targetDb}.${targetTable}". Identifiers must be alphanumeric and underscore only.`,
    };
  }

  let tunnel: OpenTunnelResult | undefined = undefined;
  let writeClient: ClickHouseClient | undefined = undefined;

  try {
    const protocol = config.protocol || 'http';
    let host = config.host?.trim() || 'localhost';
    host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    const port = Number(config.port) || (protocol === 'https' ? 8443 : 8123);

    // If SSH tunnel is configured and no tunnelOverride provided, establish tunnel for write client
    if (options?.tunnelOverride) {
      // Use existing caller-provided tunnel override
    } else if (config.useSshTunnel) {
      tunnel = await openSshTunnel({
        sshHost: config.sshHost!.trim(),
        sshPort: Number(config.sshPort) || 22,
        sshUsername: config.sshUsername!.trim(),
        sshAuthMethod: config.sshAuthMethod || 'password',
        sshPassword: config.sshPassword,
        sshPrivateKey: config.sshPrivateKey,
        sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
        targetHost: host,
        targetPort: port,
      });
    }

    const clientHost = options?.tunnelOverride ? options.tunnelOverride.host : (tunnel ? tunnel.localHost : host);
    const clientPort = options?.tunnelOverride ? options.tunnelOverride.port : (tunnel ? tunnel.localPort : port);

    writeClient = createClient({
      url: `${protocol}://${clientHost}:${clientPort}`,
      username: writeUsername,
      password: writePassword,
      database: targetDb,
      request_timeout: 10000,
      clickhouse_settings: {
        connect_timeout: 5,
      },
    });

    // Extract lean, non-schema-revealing finding summaries (category, title, severity only)
    const findingSummary = report.findings.map((f) => ({
      category: f.category,
      title: f.title,
      severity: f.status,
    }));

    // Map category scores
    const categoryScores: Record<string, number> = {};
    for (const cat of report.categories) {
      categoryScores[cat.category] = cat.score;
    }

    const now = new Date();
    const scannedAtStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const row = {
      scan_id: report.scan_id,
      scanned_at: scannedAtStr,
      target_host: config.host.trim().toLowerCase(),
      target_database: config.database.trim().toLowerCase(),
      overall_score: Math.max(0, Math.min(100, Math.round(report.overall_score))),
      overall_verdict: report.overall_verdict,
      category_scores: JSON.stringify(categoryScores),
      finding_summary: JSON.stringify(findingSummary),
      clickhouse_version: report.clickhouse_version || '',
    };

    await writeClient.insert({
      table: `${targetDb}.${targetTable}`,
      values: [row],
      format: 'JSONEachRow',
    });

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown write error';
    console.warn('History write failed (non-fatal):', errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  } finally {
    await writeClient?.close();
    await tunnel?.close();
  }
}

/**
 * Reads historical scan time series from ClickHouse using read-only credentials.
 *
 * Security & Architectural Boundaries:
 * 1. Uses the read-only scan credentials, never write credentials.
 * 2. Strictly issues a SELECT query with assertReadOnlySql.
 * 3. Does not leak credentials in URL query strings (called via POST body).
 * 4. Differentiates table-not-found and permission-denied errors clearly.
 * 5. Closes client and tunnel in finally block.
 */
export async function fetchScanHistory(
  config: ConnectionConfig,
  limit: number = 100
): Promise<ScanHistoryResponse> {
  if (config.isDemo) {
    const demoHistory = generateDemoHistory();
    const comparison = computeScanComparison(demoHistory);
    return {
      success: true,
      history: demoHistory,
      comparison,
    };
  }

  const targetDb = (config.historyDatabase || config.database || 'default').trim();
  const targetTable = (config.historyTableName || 'yachiru_scan_history').trim();

  if (!isValidIdentifier(targetDb) || !isValidIdentifier(targetTable)) {
    return {
      success: false,
      history: [],
      error: `Invalid database or table name identifier: "${targetDb}.${targetTable}".`,
      errorType: 'UNKNOWN',
    };
  }

  let tunnel: OpenTunnelResult | undefined = undefined;
  let client: ClickHouseClient | undefined = undefined;

  try {
    const protocol = config.protocol || 'http';
    let host = config.host?.trim() || 'localhost';
    host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    const port = Number(config.port) || (protocol === 'https' ? 8443 : 8123);
    const username = config.username?.trim() || 'default';
    const password = config.password || '';

    if (config.useSshTunnel) {
      tunnel = await openSshTunnel({
        sshHost: config.sshHost!.trim(),
        sshPort: Number(config.sshPort) || 22,
        sshUsername: config.sshUsername!.trim(),
        sshAuthMethod: config.sshAuthMethod || 'password',
        sshPassword: config.sshPassword,
        sshPrivateKey: config.sshPrivateKey,
        sshPrivateKeyPassphrase: config.sshPrivateKeyPassphrase,
        targetHost: host,
        targetPort: port,
      });
    }

    const clientHost = tunnel ? tunnel.localHost : host;
    const clientPort = tunnel ? tunnel.localPort : port;

    client = createClient({
      url: `${protocol}://${clientHost}:${clientPort}`,
      username,
      password,
      database: targetDb,
      request_timeout: 15000,
      clickhouse_settings: {
        connect_timeout: 5,
        max_execution_time: 10,
      },
    });

    const targetHostFilter = escapeSqlString(config.host.trim().toLowerCase());
    const targetDbFilter = escapeSqlString(config.database.trim().toLowerCase());
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));

    const selectQuery = `
      SELECT
        scan_id,
        toString(scanned_at) AS scanned_at,
        target_host,
        target_database,
        overall_score,
        overall_verdict,
        category_scores,
        finding_summary,
        clickhouse_version
      FROM ${targetDb}.${targetTable}
      WHERE target_host = '${targetHostFilter}'
        AND target_database = '${targetDbFilter}'
      ORDER BY scanned_at ASC
      LIMIT ${safeLimit}
    `.trim();

    assertReadOnlySql(selectQuery);

    const queryRes = await client.query({
      query: selectQuery,
      format: 'JSONEachRow',
    });

    const rawRows = (await queryRes.json()) as Array<{
      scan_id: string;
      scanned_at: string;
      target_host: string;
      target_database: string;
      overall_score: number | string;
      overall_verdict: string;
      category_scores: string | Record<string, number>;
      finding_summary: string | FindingSummaryItem[];
      clickhouse_version: string;
    }>;

    const history: ScanHistoryRecord[] = rawRows.map((r) => {
      let categoryScores: Record<string, number> = {};
      if (typeof r.category_scores === 'string') {
        try {
          categoryScores = JSON.parse(r.category_scores);
        } catch {
          categoryScores = {};
        }
      } else if (typeof r.category_scores === 'object' && r.category_scores !== null) {
        categoryScores = r.category_scores as Record<string, number>;
      }

      let findingSummary: FindingSummaryItem[] = [];
      if (typeof r.finding_summary === 'string') {
        try {
          const parsed = JSON.parse(r.finding_summary);
          if (Array.isArray(parsed)) {
            findingSummary = parsed;
          }
        } catch {
          findingSummary = [];
        }
      } else if (Array.isArray(r.finding_summary)) {
        findingSummary = r.finding_summary;
      }

      return {
        scan_id: String(r.scan_id || ''),
        scanned_at: String(r.scanned_at || ''),
        target_host: String(r.target_host || ''),
        target_database: String(r.target_database || ''),
        overall_score: Number(r.overall_score || 0),
        overall_verdict: String(r.overall_verdict || 'Optimized'),
        category_scores: categoryScores,
        finding_summary: findingSummary,
        clickhouse_version: String(r.clickhouse_version || ''),
      };
    });

    const comparison = computeScanComparison(history);

    return {
      success: true,
      history,
      comparison,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown query error';

    // Differentiate missing table vs permission denied vs connection error
    if (/table.*doesn't exist|UNKNOWN_TABLE|Code: 60/i.test(errMsg)) {
      return {
        success: false,
        history: [],
        errorType: 'TABLE_NOT_FOUND',
        error: `The scan history table "${targetDb}.${targetTable}" does not exist in ClickHouse.`,
        hint: `To enable scan history tracking, run the setup script generated in the Connection Setup modal to create the table and grant permissions.`,
      };
    }

    if (/ACCESS_DENIED|Not enough privileges|permission denied|Code: 497/i.test(errMsg)) {
      return {
        success: false,
        history: [],
        errorType: 'PERMISSION_DENIED',
        error: `User "${config.username}" lacks SELECT privilege on "${targetDb}.${targetTable}".`,
        hint: `Run the following command as an administrator: GRANT SELECT ON ${targetDb}.${targetTable} TO ${config.username};`,
      };
    }

    return {
      success: false,
      history: [],
      errorType: 'CONNECTION_ERROR',
      error: errMsg,
      hint: 'Verify ClickHouse host connectivity, port, and credentials.',
    };
  } finally {
    await client?.close();
    await tunnel?.close();
  }
}
