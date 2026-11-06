import {
  AnalysisReport,
  ConnectionConfig,
  VerificationChecklistItem,
  VerificationListResponse,
  VerificationSession,
} from '../types.js';
import {
  compareVerificationSession,
  createDefaultChecklist,
  extractAfterMetricsForSession,
  extractBaselineMetrics,
} from './verificationEngine.js';
import { loadCostModel } from './costModel.js';

export const VERIFICATIONS_STORAGE_KEY = 'yachiru_verification_sessions';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // LocalStorage unavailable
  }
  return null;
}

/**
 * Returns authorization headers for API requests using sessionStorage or override key.
 */
export function getVerificationAuthHeaders(
  extraHeaders: Record<string, string> = {},
  apiKeyOverride?: string
): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  const key =
    apiKeyOverride ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('yachiru_server_api_key') : null);
  if (key && key.trim()) {
    headers['Authorization'] = `Bearer ${key.trim()}`;
  }
  return headers;
}

/**
 * Returns mock demo verification records for realistic simulation exploration.
 */
export function generateDemoVerifications(): VerificationSession[] {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  const demoVerified: VerificationSession = {
    id: 'verif_demo_compression_payload_json',
    workspaceId: 'demo.internal:::production',
    targetHost: 'demo.internal',
    targetDatabase: 'production',
    targetTable: 'events_raw',
    targetColumn: 'payload_json',
    findingId: 'low_compression_raw_payloads',
    findingTitle: "Suboptimal compression on 'events_raw.payload_json' (1.18x ratio)",
    findingCategory: 'compression',
    findingSeverity: 'warning',
    recommendationSqlOrText:
      '-- Verification Query to inspect column codecs:\nSELECT name, type, compression_codec FROM system.columns WHERE table = \'events_raw\' AND name = \'payload_json\';\n\n-- Recommended Codec Alteration:\nALTER TABLE production.events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(6));\nOPTIMIZE TABLE production.events_raw FINAL;',
    isSqlRecommendation: true,
    riskLevel: 'medium',
    rollbackGuidance:
      'Codec alterations apply to newly inserted or merged parts. You can revert via ALTER TABLE MODIFY COLUMN ... CODEC(Default). Existing parts remain readable.',
    baselineScanId: 'demo_scan_tminus14d',
    baselineCapturedAt: new Date(now - 14 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
    baselineMetrics: {
      column_compressed_bytes: 428 * 1024 * 1024 * 1024, // 428 GB
      column_uncompressed_bytes: 505 * 1024 * 1024 * 1024, // 505 GB
      compression_ratio: 1.18,
      table_compressed_bytes: 1420 * 1024 * 1024 * 1024,
      table_uncompressed_bytes: 3840 * 1024 * 1024 * 1024,
      table_rows: 450000000,
      active_parts: 245,
    },
    afterScanId: 'demo_scan_current',
    verifiedAt: new Date(now - 1 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
    afterMetrics: {
      column_compressed_bytes: 307 * 1024 * 1024 * 1024, // 307 GB (-121 GB, -28.3%)
      column_uncompressed_bytes: 505 * 1024 * 1024 * 1024,
      compression_ratio: 1.64,
      table_compressed_bytes: 1299 * 1024 * 1024 * 1024,
      table_uncompressed_bytes: 3840 * 1024 * 1024 * 1024,
      table_rows: 452000000,
      active_parts: 210,
    },
    status: 'verified',
    metricComparisons: [
      {
        metricKey: 'column_compressed_bytes',
        label: 'Column Compressed Footprint',
        unit: 'bytes',
        beforeValue: 428 * 1024 * 1024 * 1024,
        afterValue: 307 * 1024 * 1024 * 1024,
        absoluteChange: -121 * 1024 * 1024 * 1024,
        percentageChange: -28.27,
        higherIsBetter: false,
        status: 'improved',
        formattedBefore: '428.00 GB',
        formattedAfter: '307.00 GB',
        formattedChange: '-28.3% (-121.00 GB)',
      },
      {
        metricKey: 'compression_ratio',
        label: 'Compression Ratio',
        unit: 'ratio',
        beforeValue: 1.18,
        afterValue: 1.64,
        absoluteChange: 0.46,
        percentageChange: 38.98,
        higherIsBetter: true,
        status: 'improved',
        formattedBefore: '1.18x',
        formattedAfter: '1.64x',
        formattedChange: '+39.0% (+0.46x)',
      },
      {
        metricKey: 'table_compressed_bytes',
        label: 'Table Total Compressed Storage',
        unit: 'bytes',
        beforeValue: 1420 * 1024 * 1024 * 1024,
        afterValue: 1299 * 1024 * 1024 * 1024,
        absoluteChange: -121 * 1024 * 1024 * 1024,
        percentageChange: -8.52,
        higherIsBetter: false,
        status: 'improved',
        formattedBefore: '1.39 TB',
        formattedAfter: '1.27 TB',
        formattedChange: '-8.5% (-121.00 GB)',
      },
      {
        metricKey: 'active_parts',
        label: 'Active Parts Count',
        unit: 'count',
        beforeValue: 245,
        afterValue: 210,
        absoluteChange: -35,
        percentageChange: -14.29,
        higherIsBetter: false,
        status: 'improved',
        formattedBefore: '245',
        formattedAfter: '210',
        formattedChange: '-14.3% (-35)',
      },
    ],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [
        'Table row count is stable across baseline and verification scan (within ±1%).',
        'Direct physical column measurement verified from system.columns metadata.',
      ],
      confoundingFactors: [],
      caveats: [
        'Storage gains achieved on-disk following partition background merges.',
      ],
    },
    expectedImpact: {
      metricKey: 'column_compressed_bytes',
      minPercentage: 20,
      maxPercentage: 30,
      description: 'Expected 20–30% storage footprint reduction from ZSTD codec compression.',
      targetAchievedStatus: 'within_expected_range',
    },
    measuredImpactSummary: {
      storageReductionBytes: 121 * 1024 * 1024 * 1024,
      storageReductionPercentage: 28.27,
      summaryText:
        'Optimization successfully verified. 121.00 GB storage reduction measured on events_raw.payload_json with ZSTD(6).',
      overallOutcome: 'verified',
    },
    financialImpact: {
      estimatedMonthlySavings: 14.52,
      pricingModelApplied: {
        storagePricePerGBMonth: 0.12,
        computePricePerCPUHour: 0.045,
        queryCostPerTBScanned: 0,
      },
      caveat:
        'Financial estimate represents on-disk storage cost reduction based on configured rate ($0.12/GB-mo).',
    },
    checklist: [
      {
        id: 'step_review_finding',
        label: 'Review finding diagnostic and understand root cause',
        completed: true,
        completedAt: new Date(now - 14 * oneDay).toISOString(),
      },
      {
        id: 'step_review_sql',
        label: 'Inspect recommended SQL and verify schema compatibility',
        completed: true,
        completedAt: new Date(now - 13 * oneDay).toISOString(),
      },
      {
        id: 'step_apply_change',
        label: 'Apply the remediation in ClickHouse via clickhouse-client or admin console',
        completed: true,
        completedAt: new Date(now - 10 * oneDay).toISOString(),
      },
      {
        id: 'step_confirm_execution',
        label: 'Confirm change execution completed without errors',
        completed: true,
        completedAt: new Date(now - 5 * oneDay).toISOString(),
      },
      {
        id: 'step_run_rescan',
        label: 'Run a verification scan to measure before vs after impact',
        completed: true,
        completedAt: new Date(now - 1 * oneDay).toISOString(),
      },
    ],
    createdAt: new Date(now - 14 * oneDay).toISOString(),
    updatedAt: new Date(now - 1 * oneDay).toISOString(),
  };

  const demoInProgress: VerificationSession = {
    id: 'verif_demo_lowcard_event_type',
    workspaceId: 'demo.internal:::production',
    targetHost: 'demo.internal',
    targetDatabase: 'production',
    targetTable: 'events_raw',
    targetColumn: 'event_type',
    findingId: 'lowcard_candidate_events_raw_event_type',
    findingTitle: "High-cardinality String candidate for LowCardinality on 'events_raw.event_type'",
    findingCategory: 'compression',
    findingSeverity: 'warning',
    recommendationSqlOrText:
      '-- Verification Query (inspect distinct values before applying):\nSELECT uniq(event_type), count() FROM production.events_raw;\n-- Proceed only if uniq(event_type) is under ~10,000 distinct values.\n\n-- Recommended Alteration:\nALTER TABLE production.events_raw MODIFY COLUMN event_type LowCardinality(String);',
    isSqlRecommendation: true,
    riskLevel: 'medium',
    rollbackGuidance:
      'Can be reverted with ALTER TABLE production.events_raw MODIFY COLUMN event_type String;',
    baselineScanId: 'demo_scan_tminus2d',
    baselineCapturedAt: new Date(now - 2 * oneDay).toISOString().replace('T', ' ').substring(0, 19),
    baselineMetrics: {
      column_compressed_bytes: 12.4 * 1024 * 1024 * 1024,
      column_uncompressed_bytes: 38.0 * 1024 * 1024 * 1024,
      compression_ratio: 3.06,
      table_compressed_bytes: 1299 * 1024 * 1024 * 1024,
      table_rows: 452000000,
      active_parts: 210,
    },
    status: 'remediation_in_progress',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'medium',
      confidenceReasons: ['Baseline metrics recorded and locked.'],
      confoundingFactors: [],
      caveats: ['Awaiting remediation and subsequent verification scan.'],
    },
    expectedImpact: {
      metricKey: 'column_compressed_bytes',
      minPercentage: 15,
      maxPercentage: 45,
      description: 'Expected 15–45% storage reduction from dictionary-encoding repetitive strings.',
      targetAchievedStatus: 'no_target_set',
    },
    checklist: [
      {
        id: 'step_review_finding',
        label: 'Review finding diagnostic and understand root cause',
        completed: true,
        completedAt: new Date(now - 2 * oneDay).toISOString(),
      },
      {
        id: 'step_review_sql',
        label: 'Inspect recommended SQL and verify schema compatibility',
        completed: true,
        completedAt: new Date(now - 1 * oneDay).toISOString(),
      },
      {
        id: 'step_apply_change',
        label: 'Apply the remediation in ClickHouse via clickhouse-client or admin console',
        completed: false,
      },
      {
        id: 'step_confirm_execution',
        label: 'Confirm change execution completed without errors',
        completed: false,
      },
      {
        id: 'step_run_rescan',
        label: 'Run a verification scan to measure before vs after impact',
        completed: false,
      },
    ],
    createdAt: new Date(now - 2 * oneDay).toISOString(),
    updatedAt: new Date(now - 1 * oneDay).toISOString(),
  };

  return [demoVerified, demoInProgress];
}

/**
 * Loads sessions from localStorage mirror.
 */
export function loadLocalVerifications(): VerificationSession[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(VERIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VerificationSession[]) : [];
  } catch {
    return [];
  }
}

/**
 * Saves sessions to localStorage mirror.
 */
export function saveLocalVerifications(sessions: VerificationSession[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(VERIFICATIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Retrieves verifications, syncing from server API with local/demo fallback.
 */
export async function getVerificationSessions(
  host?: string,
  database?: string,
  isDemo?: boolean
): Promise<VerificationListResponse> {
  if (isDemo) {
    const local = loadLocalVerifications();
    const demo = generateDemoVerifications();
    // Merge local additions with demo
    const sessionMap = new Map<string, VerificationSession>();
    for (const d of demo) sessionMap.set(d.id, d);
    for (const l of local) {
      if (l.workspaceId === 'demo.internal:::production') {
        sessionMap.set(l.id, l);
      }
    }
    const merged = Array.from(sessionMap.values());
    return buildSummaryResponse(merged);
  }

  try {
    const query = new URLSearchParams();
    if (host) query.set('host', host.trim().toLowerCase());
    if (database) query.set('database', database.trim().toLowerCase());

    const res = await fetch(`/api/verifications?${query.toString()}`, {
      headers: getVerificationAuthHeaders(),
    });
    if (res.ok) {
      const data: VerificationListResponse = await res.json();
      if (data && Array.isArray(data.sessions)) {
        saveLocalVerifications(data.sessions);
        return data;
      }
    }
  } catch (err) {
    console.warn('Could not fetch verifications from server, reading local mirror:', err);
  }

  // Fallback to local mirror
  const local = loadLocalVerifications();
  const filtered = local.filter((s) => {
    if (host && s.targetHost.toLowerCase() !== host.trim().toLowerCase()) return false;
    if (database && s.targetDatabase.toLowerCase() !== database.trim().toLowerCase()) return false;
    return true;
  });

  return buildSummaryResponse(filtered);
}

/**
 * Computes aggregate summary metrics across a list of verification sessions.
 */
export function buildSummaryResponse(sessions: VerificationSession[]): VerificationListResponse {
  let verifiedCount = 0;
  let partiallyVerifiedCount = 0;
  let inProgressCount = 0;
  let inconclusiveCount = 0;
  let regressedCount = 0;
  let notImprovedCount = 0;
  let totalConfirmedStorageReductionBytes = 0;
  let totalVerifiedMonthlySavings = 0;
  const querySpeedupPcts: number[] = [];

  for (const s of sessions) {
    if (s.status === 'verified') {
      verifiedCount++;
      if (s.measuredImpactSummary?.storageReductionBytes) {
        totalConfirmedStorageReductionBytes += s.measuredImpactSummary.storageReductionBytes;
      }
      if (s.financialImpact?.estimatedMonthlySavings) {
        totalVerifiedMonthlySavings += s.financialImpact.estimatedMonthlySavings;
      }
      if (s.measuredImpactSummary?.queryDurationReductionPercentage) {
        querySpeedupPcts.push(s.measuredImpactSummary.queryDurationReductionPercentage);
      }
    } else if (s.status === 'partially_verified') {
      partiallyVerifiedCount++;
      if (s.measuredImpactSummary?.storageReductionBytes) {
        totalConfirmedStorageReductionBytes += s.measuredImpactSummary.storageReductionBytes;
      }
    } else if (
      s.status === 'pending_baseline' ||
      s.status === 'baseline_captured' ||
      s.status === 'remediation_in_progress' ||
      s.status === 'awaiting_verification'
    ) {
      inProgressCount++;
    } else if (s.status === 'regression_detected') {
      regressedCount++;
    } else if (s.status === 'not_improved') {
      notImprovedCount++;
    } else if (s.status === 'inconclusive') {
      inconclusiveCount++;
    }
  }

  const avgQueryLatencyReductionPct =
    querySpeedupPcts.length > 0
      ? Number((querySpeedupPcts.reduce((a, b) => a + b, 0) / querySpeedupPcts.length).toFixed(1))
      : null;

  return {
    success: true,
    sessions,
    summary: {
      totalSessions: sessions.length,
      verifiedCount,
      partiallyVerifiedCount,
      inProgressCount,
      inconclusiveCount,
      regressedCount,
      notImprovedCount,
      totalConfirmedStorageReductionBytes,
      avgQueryLatencyReductionPct,
      totalVerifiedMonthlySavings: Number(totalVerifiedMonthlySavings.toFixed(2)),
    },
  };
}

/**
 * Creates and persists a new verification session with an immutable baseline.
 */
export async function createVerificationSession(params: {
  finding: import('../types.js').CheckFinding;
  report: AnalysisReport;
  config: ConnectionConfig | null;
}): Promise<VerificationSession> {
  const { finding, report, config } = params;
  const host = (config?.host || 'localhost').trim().toLowerCase();
  const database = (report.database_name || config?.database || 'default').trim().toLowerCase();
  const workspaceId = `${host}:::${database}`;

  const { metrics, tableMeta, expectedImpact, riskLevel, rollbackGuidance } =
    extractBaselineMetrics(finding, report.tables);

  const sessionId = `verif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowStr = new Date().toISOString();

  const newSession: VerificationSession = {
    id: sessionId,
    workspaceId,
    targetHost: host,
    targetDatabase: database,
    targetTable: finding.table,
    targetColumn: finding.metrics?.columnName,
    findingId: finding.id,
    findingTitle: finding.title,
    findingCategory: finding.category,
    findingSeverity: finding.status,
    recommendationSqlOrText: finding.recommendation_sql_or_text,
    isSqlRecommendation: finding.is_sql_recommendation,
    riskLevel,
    rollbackGuidance,
    baselineScanId: report.scan_id,
    baselineCapturedAt: nowStr,
    baselineMetrics: metrics,
    baselineTableMeta: tableMeta,
    status: 'baseline_captured',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'medium',
      confidenceReasons: ['Baseline captured and persisted.'],
      confoundingFactors: [],
      caveats: ['Awaiting manual remediation and follow-up verification scan.'],
    },
    expectedImpact,
    checklist: createDefaultChecklist(),
    createdAt: nowStr,
    updatedAt: nowStr,
  };

  // Persist locally
  const local = loadLocalVerifications();
  saveLocalVerifications([newSession, ...local]);

  // Attempt server persistence
  try {
    await fetch('/api/verifications', {
      method: 'POST',
      headers: getVerificationAuthHeaders({ 'Content-Type': 'application/json' }, config?.yachiruApiKey),
      body: JSON.stringify(newSession),
    });
  } catch (err) {
    console.warn('Server persistence fallback:', err);
  }

  return newSession;
}

/**
 * Updates an existing verification session (checklist, status transition, notes).
 */
export async function updateVerificationSession(
  session: VerificationSession
): Promise<VerificationSession> {
  const updated = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  // Update local
  const local = loadLocalVerifications();
  const idx = local.findIndex((s) => s.id === updated.id);
  if (idx !== -1) {
    local[idx] = updated;
    saveLocalVerifications(local);
  } else {
    saveLocalVerifications([updated, ...local]);
  }

  // Update server
  try {
    await fetch(`/api/verifications/${encodeURIComponent(updated.id)}`, {
      method: 'PATCH',
      headers: getVerificationAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updated),
    });
  } catch (err) {
    console.warn('Server patch failed, saved locally:', err);
  }

  return updated;
}

/**
 * Executes or associates a subsequent scan against the baseline to produce verified results.
 */
export async function verifySessionWithScan(
  session: VerificationSession,
  afterReport: AnalysisReport
): Promise<VerificationSession> {
  const { afterMetrics, afterTableMeta } = extractAfterMetricsForSession(session, afterReport);
  const costModel = loadCostModel();

  const comparison = compareVerificationSession(
    session,
    afterReport.scan_id,
    afterMetrics,
    afterTableMeta,
    costModel
  );

  const updatedChecklist = session.checklist.map((item) => {
    if (item.id === 'step_run_rescan') {
      return { ...item, completed: true, completedAt: new Date().toISOString() };
    }
    return item;
  });

  const verifiedSession: VerificationSession = {
    ...session,
    afterScanId: afterReport.scan_id,
    verifiedAt: new Date().toISOString(),
    afterMetrics,
    afterTableMeta,
    status: comparison.status,
    metricComparisons: comparison.metricComparisons,
    comparability: comparison.comparability,
    expectedImpact: comparison.expectedImpact,
    measuredImpactSummary: comparison.measuredImpactSummary,
    financialImpact: comparison.financialImpact,
    checklist: updatedChecklist,
    updatedAt: new Date().toISOString(),
  };

  await updateVerificationSession(verifiedSession);
  return verifiedSession;
}

/**
 * Executes verification on the server by submitting the current connection config.
 * The server securely runs the scan, computes metrics, and persists the verdict.
 */
export async function verifySessionOnServer(
  session: VerificationSession,
  config: ConnectionConfig
): Promise<VerificationSession> {
  const res = await fetch(`/api/verifications/${encodeURIComponent(session.id)}/verify`, {
    method: 'POST',
    headers: getVerificationAuthHeaders({ 'Content-Type': 'application/json' }, config?.yachiruApiKey),
    body: JSON.stringify({ connectionConfig: config }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server verification failed with status ${res.status}`);
  }

  const verified: VerificationSession = await res.json();

  // Keep local storage in sync
  const local = loadLocalVerifications();
  const idx = local.findIndex((s) => s.id === verified.id);
  if (idx !== -1) {
    local[idx] = verified;
  } else {
    local.unshift(verified);
  }
  saveLocalVerifications(local);

  return verified;
}

/**
 * Deletes a verification session both from local mirror and server storage.
 */
export async function deleteVerificationSession(
  sessionId: string,
  apiKeyOverride?: string
): Promise<boolean> {
  const local = loadLocalVerifications();
  saveLocalVerifications(local.filter((s) => s.id !== sessionId));

  try {
    const res = await fetch(`/api/verifications/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: getVerificationAuthHeaders({}, apiKeyOverride),
    });
    return res.ok;
  } catch (err) {
    console.warn('Server delete failed, removed locally:', err);
    return false;
  }
}

