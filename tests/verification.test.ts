import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Isolated Test Environment Setup for Data Persistence Hygiene (FIX 5)
// ---------------------------------------------------------------------------
const DEFAULT_DATA_FILE = path.join(process.cwd(), 'data', 'verifications.json');
const initialDefaultData = fs.existsSync(DEFAULT_DATA_FILE)
  ? fs.readFileSync(DEFAULT_DATA_FILE)
  : Buffer.from('[]\n');

const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiru-verification-test-'));
process.env.YACHIRU_DATA_DIR = tempTestDir;

import {
  calculateAbsoluteChange,
  calculatePercentageChange,
  evaluateMetricStatus,
  buildMetricComparisonItem,
  isValidVerificationTransition,
  assertValidVerificationTransition,
  extractBaselineMetrics,
  extractAfterMetricsForSession,
  compareVerificationSession,
  formatBytes,
  formatMetricValue,
} from '../src/utils/verificationEngine.js';

import {
  CheckFinding,
  TableMetadata,
  VerificationSession,
} from '../src/types.js';

import {
  createVerification,
  patchVerification,
  getVerification,
  listVerifications,
  resetSessionsCacheForTesting,
  getDataDir,
  getDataFile,
} from '../server/verificationStore.js';

import { DEFAULT_COST_MODEL } from '../src/utils/costModel.js';

// Reset cache so it loads from the isolated temp directory
resetSessionsCacheForTesting();

// ---------------------------------------------------------------------------
// 1. Metric Calculations Tests
// ---------------------------------------------------------------------------

test('Metric Calculations: Absolute & percentage differences with safe rounding', () => {
  // Lower is better (storage: 428 GB -> 307 GB)
  const abs = calculateAbsoluteChange(428, 307);
  assert.equal(abs, -121);

  const pct = calculatePercentageChange(428, 307);
  // (307 - 428) / 428 * 100 = -28.271%
  assert.equal(pct, -28.27);
});

test('Metric Calculations: Zero baseline and missing value handling (no NaN/Infinity)', () => {
  // 0 to 0
  assert.equal(calculatePercentageChange(0, 0), 0);
  assert.equal(calculateAbsoluteChange(0, 0), 0);

  // 0 to positive: returns null to prevent Infinity
  assert.equal(calculatePercentageChange(0, 100), null);
  assert.equal(calculateAbsoluteChange(0, 100), 100);

  // Null / undefined handling
  assert.equal(calculateAbsoluteChange(null, 50), null);
  assert.equal(calculateAbsoluteChange(100, undefined), null);
  assert.equal(calculatePercentageChange(null, 50), null);
  assert.equal(calculatePercentageChange(100, null), null);
});

test('Metric Calculations: Directionality (higher-is-better vs lower-is-better)', () => {
  // Compression ratio (higher is better): 1.18x -> 1.64x (+39%) => improved
  const ratioPct = calculatePercentageChange(1.18, 1.64);
  assert.ok(ratioPct !== null && ratioPct > 0);
  assert.equal(evaluateMetricStatus(ratioPct, true), 'improved');

  // Compression ratio decrease (-20%) => regressed
  assert.equal(evaluateMetricStatus(-20, true), 'regressed');

  // Query latency (lower is better): 8.2s -> 5.1s (-37.8%) => improved
  const latPct = calculatePercentageChange(8.2, 5.1);
  assert.ok(latPct !== null && latPct < 0);
  assert.equal(evaluateMetricStatus(latPct, false), 'improved');

  // Query latency increase (+40%) => regressed
  assert.equal(evaluateMetricStatus(40, false), 'regressed');

  // Neutral change within 3% margin => unchanged
  assert.equal(evaluateMetricStatus(1.5, false), 'unchanged');
  assert.equal(evaluateMetricStatus(-1.5, true), 'unchanged');
});

test('Metric Calculations: Unit formatting and byte rounding', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 428), '428.00 GB');

  assert.equal(formatMetricValue(500, 'ms'), '500 ms');
  assert.equal(formatMetricValue(8200, 'ms'), '8.20 s');
  assert.equal(formatMetricValue(1.64, 'ratio'), '1.64x');
  assert.equal(formatMetricValue(null, 'bytes'), 'Not measured');
});

// ---------------------------------------------------------------------------
// 2. Verification State Machine Tests
// ---------------------------------------------------------------------------

test('State Machine: Valid transitions', () => {
  assert.ok(isValidVerificationTransition('pending_baseline', 'baseline_captured'));
  assert.ok(isValidVerificationTransition('baseline_captured', 'remediation_in_progress'));
  assert.ok(isValidVerificationTransition('remediation_in_progress', 'awaiting_verification'));
  assert.ok(isValidVerificationTransition('awaiting_verification', 'verified'));
  assert.ok(isValidVerificationTransition('awaiting_verification', 'partially_verified'));
  assert.ok(isValidVerificationTransition('awaiting_verification', 'regression_detected'));
  assert.ok(isValidVerificationTransition('awaiting_verification', 'not_improved'));
  assert.ok(isValidVerificationTransition('awaiting_verification', 'inconclusive'));
  assert.ok(isValidVerificationTransition('remediation_in_progress', 'cancelled'));
});

test('State Machine: Rejects invalid transitions', () => {
  // Direct jump from pending to verified is forbidden
  assert.equal(isValidVerificationTransition('pending_baseline', 'verified'), false);

  // Transitioning from cancelled is forbidden
  assert.equal(isValidVerificationTransition('cancelled', 'verified'), false);
  assert.equal(isValidVerificationTransition('cancelled', 'remediation_in_progress'), false);

  assert.throws(() => {
    assertValidVerificationTransition('cancelled', 'verified');
  }, /Invalid verification state transition/);
});

// ---------------------------------------------------------------------------
// 3. Baseline Extraction & Immutability Tests
// ---------------------------------------------------------------------------

test('Baseline Extraction: Correctly extracts relevant metrics per category', () => {
  const sampleFinding: CheckFinding = {
    id: 'low_compression_raw_payloads',
    category: 'compression',
    category_name: 'Compression & Codecs',
    title: "Suboptimal compression on 'events_raw.payload_json'",
    table: 'events_raw',
    status: 'warning',
    metric_value: '1.18x',
    threshold: '< 1.35x',
    evidence: 'Measured compression 1.18x',
    impact: 'Wasting storage space',
    recommendation_sql_or_text: 'ALTER TABLE production.events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(6));',
    is_sql_recommendation: true,
    metrics: {
      columnCompressedBytes: 428 * 1024 * 1024 * 1024,
      columnUncompressedBytes: 505 * 1024 * 1024 * 1024,
      compressionRatio: 1.18,
      columnName: 'payload_json',
      columnType: 'String',
    },
  };

  const sampleTables: TableMetadata[] = [
    {
      database: 'production',
      name: 'events_raw',
      engine: 'MergeTree',
      total_rows: 450000000,
      total_bytes_uncompressed: 3840 * 1024 * 1024 * 1024,
      total_bytes_compressed: 1420 * 1024 * 1024 * 1024,
      compression_ratio: 2.7,
      active_parts: 245,
      partition_count: 14,
      order_by_key: 'event_time, event_type',
      partition_key: 'toYYYYMM(event_time)',
      skip_indices_count: 0,
      findings_count: { critical: 0, warning: 1, good: 0 },
    },
  ];

  const extracted = extractBaselineMetrics(sampleFinding, sampleTables);

  assert.equal(extracted.metrics.column_compressed_bytes, 428 * 1024 * 1024 * 1024);
  assert.equal(extracted.metrics.compression_ratio, 1.18);
  assert.equal(extracted.metrics.table_compressed_bytes, 1420 * 1024 * 1024 * 1024);
  assert.equal(extracted.metrics.active_parts, 245);
  assert.equal(extracted.metrics.table_rows, 450000000);
  assert.ok(extracted.expectedImpact !== undefined);
  assert.equal(extracted.riskLevel, 'medium');
});

test('Persistence & Immutability: Baseline fields cannot be overwritten by updates', () => {
  const sessionId = `test_session_${Date.now()}`;
  const originalBaseline = {
    column_compressed_bytes: 428000000,
    compression_ratio: 1.18,
  };

  const session = {
    id: sessionId,
    workspaceId: 'test.internal:::default',
    targetHost: 'test.internal',
    targetDatabase: 'default',
    targetTable: 'test_table',
    findingId: 'finding_1',
    findingTitle: 'Test finding',
    findingCategory: 'compression' as const,
    findingSeverity: 'warning' as const,
    recommendationSqlOrText: 'ALTER TABLE test;',
    isSqlRecommendation: true,
    riskLevel: 'low' as const,
    baselineScanId: 'scan_initial_001',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: originalBaseline,
  };

  createVerification(session);

  // Attempt to patch the baseline metrics
  const patched = patchVerification(sessionId, {
    status: 'remediation_in_progress',
    // malicious attempt to alter baseline
    baselineScanId: 'hacked_scan',
    baselineMetrics: { column_compressed_bytes: 999999999 },
  } as any);

  // Assert baseline remains strictly immutable
  assert.equal(patched.baselineScanId, 'scan_initial_001');
  assert.deepEqual(patched.baselineMetrics, originalBaseline);
  assert.equal(patched.status, 'remediation_in_progress');
});

// ---------------------------------------------------------------------------
// 4. Comparison & Confounding Factors Tests
// ---------------------------------------------------------------------------

test('Comparison Engine: Successfully verifies improved compression with expected range', () => {
  const session: VerificationSession = {
    id: 'test_session_verify',
    workspaceId: 'demo.internal:::production',
    targetHost: 'demo.internal',
    targetDatabase: 'production',
    targetTable: 'events_raw',
    targetColumn: 'payload_json',
    findingId: 'low_compression_raw_payloads',
    findingTitle: "Suboptimal compression on 'events_raw.payload_json'",
    findingCategory: 'compression',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'ALTER TABLE production.events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(6));',
    isSqlRecommendation: true,
    riskLevel: 'medium',
    baselineScanId: 'scan_before',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      column_compressed_bytes: 428 * 1024 * 1024 * 1024,
      column_uncompressed_bytes: 505 * 1024 * 1024 * 1024,
      compression_ratio: 1.18,
      table_compressed_bytes: 1420 * 1024 * 1024 * 1024,
      table_rows: 450000000,
      active_parts: 245,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    expectedImpact: {
      metricKey: 'column_compressed_bytes',
      minPercentage: 20,
      maxPercentage: 30,
      description: 'Expected 20-30% storage footprint reduction.',
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const afterMetrics = {
    column_compressed_bytes: 307 * 1024 * 1024 * 1024,
    column_uncompressed_bytes: 505 * 1024 * 1024 * 1024,
    compression_ratio: 1.64,
    table_compressed_bytes: 1299 * 1024 * 1024 * 1024,
    table_rows: 452000000, // stable rows
    active_parts: 210,
  };

  const afterTableMeta: TableMetadata = {
    database: 'production',
    name: 'events_raw',
    engine: 'MergeTree',
    total_rows: 452000000,
    total_bytes_uncompressed: 505 * 1024 * 1024 * 1024,
    total_bytes_compressed: 1299 * 1024 * 1024 * 1024,
    compression_ratio: 1.64,
    active_parts: 210,
    partition_count: 14,
    order_by_key: 'event_time, event_type',
    partition_key: 'toYYYYMM(event_time)',
    skip_indices_count: 0,
    findings_count: { critical: 0, warning: 0, good: 1 },
  };

  const result = compareVerificationSession(
    session,
    'scan_after',
    afterMetrics,
    afterTableMeta,
    { ...DEFAULT_COST_MODEL, storagePricePerGBMonth: 0.12 }
  );

  assert.equal(result.status, 'verified');
  assert.equal(result.measuredImpactSummary.overallOutcome, 'verified');
  assert.ok(result.measuredImpactSummary.storageReductionBytes !== undefined);
  assert.equal(result.measuredImpactSummary.storageReductionBytes, 121 * 1024 * 1024 * 1024);

  // Financial impact calculation: 121 GB * $0.12 = $14.52/month
  assert.ok(result.financialImpact !== undefined);
  assert.equal(result.financialImpact.estimatedMonthlySavings, 14.52);

  // Target expected outcome check
  assert.equal(result.expectedImpact?.targetAchievedStatus, 'within_expected_range');
});

test('Cost Integration: Rate of 0 returns technical impact only without fabricate dollar figures', () => {
  const session: VerificationSession = {
    id: 'test_session_zeroprice',
    workspaceId: 'demo.internal:::production',
    targetHost: 'demo.internal',
    targetDatabase: 'production',
    targetTable: 'events_raw',
    findingId: 'f1',
    findingTitle: 'Test title',
    findingCategory: 'compression',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'ALTER TABLE',
    isSqlRecommendation: false,
    riskLevel: 'low',
    baselineScanId: 'scan_1',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      table_compressed_bytes: 100 * 1024 * 1024 * 1024,
      table_rows: 1000000,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const afterMetrics = {
    table_compressed_bytes: 70 * 1024 * 1024 * 1024, // 30 GB reduced
    table_rows: 1000000,
  };

  // Pricing model with 0 storage rate
  const result = compareVerificationSession(
    session,
    'scan_2',
    afterMetrics,
    undefined,
    { ...DEFAULT_COST_MODEL, storagePricePerGBMonth: 0 }
  );

  // Technical impact is measured
  assert.equal(result.status, 'verified');
  assert.equal(result.measuredImpactSummary.storageReductionBytes, 30 * 1024 * 1024 * 1024);

  // But financial impact is undefined because price is 0
  assert.equal(result.financialImpact, undefined);
});

// ---------------------------------------------------------------------------
// 5. Brief v10 FIX 1 Acceptance Tests: Repro A and Repro B
// ---------------------------------------------------------------------------

test('FIX 1 Repro A (Finding disappears after real fix): Measured column size proves resolution -> verified', () => {
  // Baseline: column 10 GB, table 100 GB, 1,000,000 rows
  const session: VerificationSession = {
    id: 'session_repro_a',
    workspaceId: 'prod:::analytics',
    targetHost: 'prod',
    targetDatabase: 'analytics',
    targetTable: 'events',
    targetColumn: 'user_agent',
    findingId: 'finding_lowcard_user_agent',
    findingTitle: 'Convert user_agent to LowCardinality(String)',
    findingCategory: 'schema_type',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'ALTER TABLE analytics.events MODIFY COLUMN user_agent LowCardinality(String);',
    isSqlRecommendation: true,
    riskLevel: 'low',
    baselineScanId: 'scan_baseline_repro_a',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      column_compressed_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
      table_compressed_bytes: 100 * 1024 * 1024 * 1024, // 100 GB
      table_rows: 1000000,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    expectedImpact: {
      metricKey: 'column_compressed_bytes',
      minPercentage: 10,
      maxPercentage: 50,
      description: 'Expected column reduction',
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // After scan: finding is gone! Table has 1,050,000 rows, table compressed 99 GB.
  const afterReport = {
    scan_id: 'scan_after_repro_a',
    findings: [], // Finding is resolved, so it stopped matching
    tables: [
      {
        database: 'analytics',
        name: 'events',
        engine: 'MergeTree',
        total_rows: 1050000,
        total_bytes_uncompressed: 200 * 1024 * 1024 * 1024,
        total_bytes_compressed: 99 * 1024 * 1024 * 1024,
        compression_ratio: 2.02,
        active_parts: 20,
        partition_count: 5,
        order_by_key: 'id',
        partition_key: '',
        skip_indices_count: 0,
        findings_count: { critical: 0, warning: 0, good: 1 },
      },
    ],
    categories: [
      {
        category: 'schema_type' as const,
        name: 'Data Types & Schema',
        score: 100,
        status: 'good' as const,
        critical_count: 0,
        warning_count: 0,
        good_count: 1,
        total_checks: 1,
        description: 'Schema types evaluated',
      },
    ],
  };

  // Targeted read-only query on system.columns measures post-fix column size (9 GB) and type (LowCardinality)
  const columnTelemetry = {
    name: 'user_agent',
    type: 'LowCardinality(String)',
    compressedBytes: 9 * 1024 * 1024 * 1024, // 10 GB -> 9 GB (1 GB reduction)
    uncompressedBytes: 25 * 1024 * 1024 * 1024,
  };

  const { afterMetrics, afterTableMeta, findingResolved, categoryCheckDidNotRun } =
    extractAfterMetricsForSession(session, afterReport, columnTelemetry);

  assert.equal(findingResolved, true);
  assert.equal(categoryCheckDidNotRun, false);
  assert.equal(afterMetrics.column_compressed_bytes, 9 * 1024 * 1024 * 1024);

  const verdict = compareVerificationSession(
    session,
    afterReport.scan_id,
    afterMetrics,
    afterTableMeta,
    DEFAULT_COST_MODEL,
    { findingResolved, categoryCheckDidNotRun }
  );

  // Must yield verified via finding_resolved plus measured column size
  assert.equal(verdict.status, 'verified');
  assert.equal(verdict.measuredImpactSummary.overallOutcome, 'finding_resolved');
  assert.equal(verdict.measuredImpactSummary.findingResolved, true);
  assert.equal(verdict.measuredImpactSummary.storageReductionBytes, 1 * 1024 * 1024 * 1024);
});

test('FIX 1 Repro B (Confounded improvement from 70% row deletion): Severe confounder -> inconclusive', () => {
  // Baseline: column 10 GB, table 100 GB, 1,000,000 rows
  const session: VerificationSession = {
    id: 'session_repro_b',
    workspaceId: 'prod:::analytics',
    targetHost: 'prod',
    targetDatabase: 'analytics',
    targetTable: 'events',
    targetColumn: 'user_agent',
    findingId: 'finding_lowcard_user_agent',
    findingTitle: 'Convert user_agent to LowCardinality(String)',
    findingCategory: 'schema_type',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'ALTER TABLE',
    isSqlRecommendation: false,
    riskLevel: 'low',
    baselineScanId: 'scan_baseline_repro_b',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      column_compressed_bytes: 10 * 1024 * 1024 * 1024,
      table_compressed_bytes: 100 * 1024 * 1024 * 1024,
      table_rows: 1000000,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    expectedImpact: {
      metricKey: 'column_compressed_bytes',
      minPercentage: 20,
      maxPercentage: 50,
      description: 'Expected column reduction',
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // After scan: finding shows column 3 GB, but table has 300,000 rows (~70% of rows deleted!)
  const afterMetrics = {
    column_compressed_bytes: 3 * 1024 * 1024 * 1024,
    table_compressed_bytes: 30 * 1024 * 1024 * 1024,
    table_rows: 300000,
  };

  const afterTableMeta: TableMetadata = {
    database: 'analytics',
    name: 'events',
    engine: 'MergeTree',
    total_rows: 300000,
    total_bytes_uncompressed: 60 * 1024 * 1024 * 1024,
    total_bytes_compressed: 30 * 1024 * 1024 * 1024,
    compression_ratio: 2.0,
    active_parts: 10,
    partition_count: 2,
    order_by_key: 'id',
    partition_key: '',
    skip_indices_count: 0,
    findings_count: { critical: 0, warning: 1, good: 0 },
  };

  const verdict = compareVerificationSession(
    session,
    'scan_after_repro_b',
    afterMetrics,
    afterTableMeta,
    DEFAULT_COST_MODEL
  );

  // Row deletion is not an optimization: verdict must be inconclusive, NOT verified!
  assert.equal(verdict.status, 'inconclusive');
  assert.equal(verdict.comparability.confidence, 'low');
  assert.ok(
    verdict.comparability.confoundingFactors.some((f) => f.includes('row count dropped drastically'))
  );
});

test('FIX 1 Rule: Missing target metric after scan produces inconclusive, never not_improved', () => {
  const session: VerificationSession = {
    id: 'session_missing_target_after',
    workspaceId: 'prod:::analytics',
    targetHost: 'prod',
    targetDatabase: 'analytics',
    targetTable: 'events',
    findingId: 'f_query',
    findingTitle: 'Query optimization',
    findingCategory: 'query_performance',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'EXPLAIN',
    isSqlRecommendation: false,
    riskLevel: 'low',
    baselineScanId: 's1',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      query_read_bytes: 500000000,
      table_rows: 1000000,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    expectedImpact: {
      metricKey: 'query_read_bytes',
      minPercentage: 30,
      description: 'Query scan reduction',
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // After metrics has table rows but NO query_read_bytes
  const afterMetrics = {
    table_rows: 1020000,
  };

  const verdict = compareVerificationSession(session, 's2', afterMetrics, undefined, DEFAULT_COST_MODEL);

  // Must be inconclusive, NEVER not_improved!
  assert.equal(verdict.status, 'inconclusive');
});

test('FIX 1 Rule: Omitted category in after-scan produces inconclusive', () => {
  const session: VerificationSession = {
    id: 'session_cat_omitted',
    workspaceId: 'prod:::analytics',
    targetHost: 'prod',
    targetDatabase: 'analytics',
    targetTable: 'events',
    findingId: 'f_codec',
    findingTitle: 'Codec optimization',
    findingCategory: 'compression',
    findingSeverity: 'warning',
    recommendationSqlOrText: 'ALTER TABLE',
    isSqlRecommendation: false,
    riskLevel: 'low',
    baselineScanId: 's1',
    baselineCapturedAt: '2026-10-10 10:00:00',
    baselineMetrics: {
      compression_ratio: 1.15,
      table_rows: 1000000,
    },
    status: 'awaiting_verification',
    metricComparisons: [],
    comparability: {
      isComparable: true,
      confidence: 'high',
      confidenceReasons: [],
      confoundingFactors: [],
      caveats: [],
    },
    checklist: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // afterReport ran, but compression category is missing (e.g. grant removed)
  const afterReport = {
    scan_id: 's2',
    findings: [],
    tables: [],
    categories: [
      {
        category: 'query_performance' as const,
        name: 'Query Performance',
        score: 90,
        status: 'good' as const,
        critical_count: 0,
        warning_count: 0,
        good_count: 1,
        total_checks: 1,
        description: 'Queries',
      },
    ],
  };

  const { categoryCheckDidNotRun, findingResolved } = extractAfterMetricsForSession(session, afterReport);
  assert.equal(categoryCheckDidNotRun, true);
  assert.equal(findingResolved, false);

  const verdict = compareVerificationSession(
    session,
    's2',
    {},
    undefined,
    DEFAULT_COST_MODEL,
    { categoryCheckDidNotRun, findingResolved }
  );
  assert.equal(verdict.status, 'inconclusive');
});

// ---------------------------------------------------------------------------
// 6. Brief v10 FIX 3 Acceptance Tests: Mass Assignment Protection
// ---------------------------------------------------------------------------

test('FIX 3 Mass Assignment: POST rejects/strips client computed fields on create', () => {
  const forgedPayload = {
    id: `session_forged_${Date.now()}`,
    targetHost: 'prod.clickhouse',
    targetDatabase: 'default',
    findingId: 'f_forged',
    findingTitle: 'Test finding',
    findingCategory: 'compression',
    findingSeverity: 'warning',
    baselineScanId: 'scan_001',
    baselineCapturedAt: new Date().toISOString(),
    baselineMetrics: { compression_ratio: 1.2 },
    // Maliciously forged computed fields
    status: 'verified',
    financialImpact: { estimatedMonthlySavings: 999999 },
    measuredImpactSummary: { summaryText: 'Hacked 100% saved' },
    afterScanId: 'invented_after_scan',
  };

  const created = createVerification(forgedPayload);

  // Status must be forced to baseline_captured
  assert.equal(created.status, 'baseline_captured');
  // Computed fields must be strictly stripped / undefined
  assert.equal(created.financialImpact, undefined);
  assert.equal(created.measuredImpactSummary, undefined);
  assert.equal(created.afterScanId, undefined);
  assert.equal(created.verifiedAt, undefined);
});

test('FIX 3 Mass Assignment: PATCH rejects setting computed fields or verified status', () => {
  const sessionId = `session_patch_test_${Date.now()}`;
  createVerification({
    id: sessionId,
    targetHost: 'prod.clickhouse',
    targetDatabase: 'default',
    findingId: 'f_patch',
    findingTitle: 'Test finding',
    findingCategory: 'compression',
    findingSeverity: 'warning',
    baselineScanId: 'scan_001',
    baselineCapturedAt: new Date().toISOString(),
    baselineMetrics: { compression_ratio: 1.2 },
  });

  // Attempting to PATCH status to 'verified' must be rejected
  assert.throws(() => {
    patchVerification(sessionId, { status: 'verified' });
  }, /Cannot manually set computed verification status 'verified' via PATCH/);

  // Attempting to PATCH financialImpact must be rejected
  assert.throws(() => {
    patchVerification(sessionId, { financialImpact: { estimatedMonthlySavings: 50000 } });
  }, /Computed verification results cannot be set via client PATCH/);

  // Allowed PATCH: user transition to remediation_in_progress
  const validPatch = patchVerification(sessionId, {
    status: 'remediation_in_progress',
    notes: 'Applying ALTER TABLE in production console',
  });
  assert.equal(validPatch.status, 'remediation_in_progress');
  assert.equal(validPatch.notes, 'Applying ALTER TABLE in production console');
});

// ---------------------------------------------------------------------------
// 7. Brief v10 FIX 5 Acceptance Test: Default data file remains byte-identical
// ---------------------------------------------------------------------------

test('FIX 5 Data Persistence Isolation: Default ./data/verifications.json remained byte-identical', () => {
  // Check that getDataDir() used the isolated temp directory
  assert.equal(getDataDir(), tempTestDir);
  assert.ok(getDataFile().startsWith(tempTestDir));

  // Check default data file on disk
  const finalDefaultData = fs.existsSync(DEFAULT_DATA_FILE)
    ? fs.readFileSync(DEFAULT_DATA_FILE)
    : Buffer.from('[]\n');

  assert.deepEqual(
    finalDefaultData,
    initialDefaultData,
    'Default ./data/verifications.json was modified during testing! Tests must run in isolated directory.'
  );

  // Clean up temporary directory
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup error
  }
});
