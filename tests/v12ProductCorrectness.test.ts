import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScores, buildQueryLogFilter } from '../server/analyzer.js';
import {
  validateAiModel,
  resolveGeminiModelId,
  resolveOpenAiModelId,
  resolveClaudeModelId,
} from '../server/narrator.js';
import { computeScanComparison } from '../server/history.js';
import { extractAfterMetricsForSession } from '../src/utils/verificationEngine.js';
import {
  CheckFinding,
  AnalysisCoverage,
  AnalysisReport,
  ScanHistoryRecord,
  VerificationSession,
} from '../src/types.js';

test('v12 FIX 1: Missing grants produce Incomplete verdict, never Optimized', () => {
  // Scenario from Brief: part_health is good, but query_performance, replication_distributed,
  // and mutations failed due to missing grants (unavailable).
  const coverageWithUnavailable: AnalysisCoverage = {
    categories: [
      { id: 'part_health', name: 'Part Health', state: 'evaluated' },
      {
        id: 'query_performance',
        name: 'Query Performance',
        state: 'unavailable',
        reason: 'permission_denied',
        requiredGrant: 'GRANT SELECT ON system.query_log TO ...',
      },
      {
        id: 'replication_distributed',
        name: 'Replication & Distributed',
        state: 'unavailable',
        reason: 'permission_denied',
        requiredGrant: 'GRANT SELECT ON system.replicas TO ...',
      },
      {
        id: 'mutations',
        name: 'Background Mutations',
        state: 'unavailable',
        reason: 'permission_denied',
        requiredGrant: 'GRANT SELECT ON system.mutations TO ...',
      },
    ],
    evaluatedCount: 1,
    applicableCount: 4,
    totalCount: 13,
    unavailableCount: 3,
    notApplicableCount: 0,
    isComplete: false,
    hasUnavailable: true,
  };

  const emptyFindings: CheckFinding[] = [];
  const result = calculateScores(emptyFindings, coverageWithUnavailable);

  // Verdict MUST be Incomplete, never Optimized, even though 0 findings were recorded for the 1 evaluated check
  assert.equal(result.verdict, 'Incomplete');
  assert.equal(result.isPartial, true);
  assert.equal(result.overall_score, 100); // numeric score preserved over evaluated categories
  assert.equal(coverageWithUnavailable.hasUnavailable, true);
  assert.equal(coverageWithUnavailable.evaluatedCount, 1);
});

test('v12 FIX 1: Non-replicated clusters with not_applicable categories can still be Optimized', () => {
  // Scenario: Cluster legitimately has no replicated tables (system.replicas is empty).
  // replication_distributed and replication_queue are not_applicable. All other 11 categories evaluated and good.
  const allCategories: CheckFinding['category'][] = [
    'part_health',
    'primary_key',
    'partitioning',
    'compression',
    'table_engine',
    'skip_indices',
    'query_performance',
    'server_settings',
    'mutations',
    'disk_space',
    'system_errors',
  ];

  const coverageNoReplication: AnalysisCoverage = {
    categories: [
      ...allCategories.map(id => ({ id, name: id, state: 'evaluated' as const })),
      { id: 'replication_distributed', name: 'Replication', state: 'not_applicable' as const, reason: 'no_replicated_tables' as const },
      { id: 'replication_queue', name: 'Replication Queue', state: 'not_applicable' as const, reason: 'no_replicated_tables' as const },
    ],
    evaluatedCount: 11,
    applicableCount: 11,
    totalCount: 13,
    unavailableCount: 0,
    notApplicableCount: 2,
    isComplete: true,
    hasUnavailable: false,
  };

  const result = calculateScores([], coverageNoReplication);
  // With 0 unavailable checks and coverage >= 60%, a healthy cluster is legitimately Optimized!
  assert.equal(result.verdict, 'Optimized');
  assert.equal(result.isPartial, false);
  assert.equal(result.overall_score, 100);
});

test('v12 FIX 1: Verification engine checks report coverage directly', () => {
  const session = {
    id: 'verif-1',
    workspaceId: 'default',
    targetHost: 'localhost',
    targetDatabase: 'default',
    findingId: 'f-mutations-stuck',
    findingTitle: 'Mutations stuck',
    findingCategory: 'mutations' as const,
    status: 'remediation_in_progress' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    baselineMetrics: {},
    checklist: [],
  } as unknown as VerificationSession;

  // Report where mutations was unavailable
  const reportWithUnavailable: AnalysisReport = {
    scan_id: 'scan-after',
    timestamp: new Date().toISOString(),
    database_name: 'default',
    clickhouse_version: '24.8',
    cluster_mode: 'standalone',
    overall_score: 95,
    overall_verdict: 'Incomplete',
    categories: [],
    findings: [],
    tables: [],
    is_demo: false,
    summary: {
      total_tables: 0,
      total_rows: 0,
      total_size_compressed: '0 B',
      total_size_uncompressed: '0 B',
      avg_compression_ratio: '1x',
      total_parts: 0,
      total_queries_analyzed: 0,
      critical_count: 0,
      warning_count: 0,
      good_count: 0,
    },
    coverage: {
      categories: [
        { id: 'part_health', name: 'Part Health', state: 'evaluated' },
        { id: 'mutations', name: 'Mutations', state: 'unavailable', reason: 'permission_denied' },
      ],
      evaluatedCount: 1,
      applicableCount: 2,
      totalCount: 13,
      unavailableCount: 1,
      notApplicableCount: 0,
      isComplete: false,
      hasUnavailable: true,
    },
  };

  const metrics = extractAfterMetricsForSession(session, reportWithUnavailable);
  assert.equal(metrics.categoryCheckDidNotRun, true);
  assert.match(metrics.resolutionNote || '', /unavailable/i);
});

test('v12 FIX 2: AI model resolution fails fast without silent swapping on unknown models', () => {
  // Repro model list from Brief:
  const reproModels: Array<{ model: string; provider: import('../src/types.js').AiProvider }> = [
    { model: 'gpt-4o-mini', provider: 'openai' },
    { model: 'console-x', provider: 'openai' },
    { model: 'claude-opus-4-8', provider: 'claude' },
    { model: 'claude-sonnet-4-5', provider: 'claude' },
    { model: 'nonsense', provider: 'claude' },
    { model: 'gemini-3.7-flash', provider: 'gemini' },
    { model: 'argon', provider: 'gemini' },
  ];

  for (const { model, provider } of reproModels) {
    const res = validateAiModel(model, provider);
    assert.equal(res.valid, false, `Expected ${model} on ${provider} to be invalid`);
    assert.match(res.error || '', /unsupported model/i);
  }

  // Valid models must pass
  assert.equal(validateAiModel('gemini-3.8-flash', 'gemini').valid, true);
  assert.equal(validateAiModel('gemini-4-argon', 'gemini').valid, true);
  assert.equal(validateAiModel('gpt-5.4-mini', 'openai').valid, true);
  assert.equal(validateAiModel('gpt-5.6-luna', 'openai').valid, true);
  assert.equal(validateAiModel('claude-haiku-4-5-20251001', 'claude').valid, true);
  assert.equal(validateAiModel('claude-sonnet-5', 'claude').valid, true);

  // Resolvers must throw rather than remapping
  assert.throws(() => resolveGeminiModelId('gemini-3.7-flash'), /unsupported model/i);
  assert.throws(() => resolveOpenAiModelId('console-x'), /unsupported model/i);
  assert.throws(() => resolveClaudeModelId('nonsense'), /unsupported model/i);
});

test('v12 FIX 3: query_log filter scopes strictly to target database using startsWith and query_kind', () => {
  const { mainFilter, fallbackFilter } = buildQueryLogFilter('prod_analytics');

  // Must use ClickHouse startsWith to match tables belonging to database
  assert.ok(mainFilter.includes("startsWith(tbl, 'prod_analytics.')"));
  assert.ok(fallbackFilter.includes("startsWith(tbl, 'prod_analytics.')"));

  // Must not include naive current_database = 'db'
  assert.ok(!mainFilter.includes("current_database = 'prod_analytics'"));
  assert.ok(!fallbackFilter.includes("current_database = 'prod_analytics'"));

  // Must filter query_kind = 'Select'
  assert.ok(mainFilter.includes("query_kind = 'Select'"));

  // Must exclude system tables
  assert.ok(mainFilter.includes("NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)"));
  assert.ok(fallbackFilter.includes("NOT arrayExists(tbl -> startsWith(tbl, 'system.'), tables)"));

  // Test with special chars (underscores and quotes)
  const specialRes = buildQueryLogFilter("db'special_test");
  assert.ok(specialRes.mainFilter.includes("db\\'special_test."));
  assert.ok(specialRes.fallbackFilter.includes("db\\'special_test."));
});

test('v12 FIX 4: Table and column truncations prevent Optimized verdict', () => {
  // Truncated tables
  const resultTableTruncated = calculateScores([], undefined, {
    tables_truncated: true,
    tables_total: 1000,
  });
  assert.equal(resultTableTruncated.verdict, 'Incomplete');
  assert.equal(resultTableTruncated.isPartial, true);

  // Truncated columns
  const resultColTruncated = calculateScores([], undefined, {
    columns_truncated: true,
  });
  assert.equal(resultColTruncated.verdict, 'Incomplete');
  assert.equal(resultColTruncated.isPartial, true);
});

test('v12 History & Trends: computeScanComparison flags when coverage changes', () => {
  const scans: ScanHistoryRecord[] = [
    {
      scan_id: 'scan_1',
      scanned_at: '2026-03-01 10:00:00',
      target_host: 'localhost',
      target_database: 'analytics',
      overall_score: 95,
      overall_verdict: 'Optimized',
      category_scores: { part_health: 95, primary_key: 90 },
      finding_summary: [],
      clickhouse_version: '24.8.4',
    },
    {
      scan_id: 'scan_2',
      scanned_at: '2026-03-02 10:00:00',
      target_host: 'localhost',
      target_database: 'analytics',
      overall_score: 70,
      overall_verdict: 'Needs Tuning',
      // scan_2 evaluated query_performance as well
      category_scores: { part_health: 95, primary_key: 90, query_performance: 40 },
      finding_summary: [{ category: 'query_performance', title: 'Slow queries', severity: 'critical' }],
      clickhouse_version: '24.8.4',
    },
  ];

  const diff = computeScanComparison(scans);
  assert.equal(diff.hasComparison, true);
  assert.equal(diff.coverageChanged, true);
  assert.match(diff.coverageNote || '', /Coverage changed since previous scan/i);
});
