import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScores } from '../server/analyzer.js';
import {
  getModelFallbackChain,
  getOpenAiModelFallbackChain,
  getClaudeModelFallbackChain,
} from '../server/narrator.js';
import { getVerificationAuthHeaders } from '../src/utils/verificationClient.js';
import { computeScanComparison } from '../server/history.js';
import { CheckFinding, ScanHistoryRecord } from '../src/types.js';

test('Product Correctness 1: Unpermitted/empty categories are excluded from score calculation rather than inflating score', () => {
  // Scenario: User only has permission to inspect parts; system.query_log, system.mutations, etc. are unpermitted.
  // There is 1 critical finding in 'part_health' (100 - 30 = 70 score).
  const findings: CheckFinding[] = [
    {
      id: 'crit_part_count',
      category: 'part_health',
      category_name: 'Part Health & Compaction',
      title: 'Excessive active parts count',
      status: 'critical',
      metric_value: '1,200 parts',
      threshold: '< 300 parts',
      evidence: 'Active parts count is critical',
      impact: 'High merge overhead',
      recommendation_sql_or_text: 'OPTIMIZE TABLE table_name FINAL;',
      is_sql_recommendation: true,
    },
  ];

  const result = calculateScores(findings);

  // Evaluated categories should only be the ones with findings
  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0].category, 'part_health');
  assert.equal(result.categories[0].score, 70);

  // Overall score must be 70 (not diluted/inflated to 90+ by phantom 'good' categories)
  assert.equal(result.overall_score, 70);
  assert.equal(result.verdict, 'Needs Tuning');

  // If a second category with warning is evaluated (e.g. compression, 100 - 12 = 88)
  findings.push({
    id: 'warn_compression',
    category: 'compression',
    category_name: 'Compression & Codecs',
    title: 'Low compression ratio',
    status: 'warning',
    metric_value: '1.2x',
    threshold: '> 2x',
    evidence: 'Low ratio',
    impact: 'Storage waste',
    recommendation_sql_or_text: 'ALTER TABLE ...',
    is_sql_recommendation: true,
  });

  const twoCategoryResult = calculateScores(findings);
  assert.equal(twoCategoryResult.categories.length, 2);
  // Average of 70 and 88 = 79
  assert.equal(twoCategoryResult.overall_score, 79);
});

test('Product Correctness 2: AI model fallback chains fail fast without silently switching models', () => {
  // Gemini model fallback chain returns only the user-selected model
  assert.deepEqual(getModelFallbackChain('gemini-3.8-flash'), ['gemini-3.8-flash']);
  assert.deepEqual(getModelFallbackChain('gemini-4-argon'), ['gemini-4-argon']);
  assert.deepEqual(getModelFallbackChain('custom-gemini-model'), ['custom-gemini-model']);

  // OpenAI model fallback chain returns only the user-selected model
  assert.deepEqual(getOpenAiModelFallbackChain('gpt-5.6-luna'), ['gpt-5.6-luna']);
  assert.deepEqual(getOpenAiModelFallbackChain('gpt-6-astra'), ['gpt-6-astra']);

  // Claude model fallback chain returns only the user-selected model
  assert.deepEqual(getClaudeModelFallbackChain('claude-sonnet-5'), ['claude-sonnet-5']);
  assert.deepEqual(getClaudeModelFallbackChain('claude-haiku-4-5-20251001'), ['claude-haiku-4-5-20251001']);
});

test('Product Correctness 3: Verification client attaches Bearer auth header when API key is set', () => {
  // Direct key override
  const headersWithKey = getVerificationAuthHeaders({ 'Content-Type': 'application/json' }, 'yachiru-secret-key-123');
  assert.equal(headersWithKey['Content-Type'], 'application/json');
  assert.equal(headersWithKey['Authorization'], 'Bearer yachiru-secret-key-123');

  // Without key override or sessionStorage
  const headersEmpty = getVerificationAuthHeaders();
  assert.equal(headersEmpty['Authorization'], undefined);

  // Mock sessionStorage in environment
  const originalSessionStorage = globalThis.sessionStorage;
  try {
    const mockStorage: Record<string, string> = {
      yachiru_server_api_key: 'session-token-abc',
    };
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
    };

    const headersFromSession = getVerificationAuthHeaders();
    assert.equal(headersFromSession['Authorization'], 'Bearer session-token-abc');

    // Key override takes precedence over session
    const headersOverride = getVerificationAuthHeaders({}, 'override-key-xyz');
    assert.equal(headersOverride['Authorization'], 'Bearer override-key-xyz');
  } finally {
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = originalSessionStorage;
  }
});

test('Product Correctness 4: History comparison operates chronologically on latest scans', () => {
  const scans: ScanHistoryRecord[] = [
    {
      scan_id: 'scan_1',
      scanned_at: '2026-03-01 10:00:00',
      target_host: 'localhost',
      target_database: 'analytics',
      overall_score: 65,
      overall_verdict: 'Needs Tuning',
      category_scores: { part_health: 65 },
      finding_summary: [
        { category: 'part_health', title: 'High parts count', severity: 'warning' },
      ],
      clickhouse_version: '24.8.4',
    },
    {
      scan_id: 'scan_2',
      scanned_at: '2026-03-02 10:00:00',
      target_host: 'localhost',
      target_database: 'analytics',
      overall_score: 95,
      overall_verdict: 'Optimized',
      category_scores: { part_health: 95 },
      finding_summary: [
        { category: 'part_health', title: 'Part count healthy', severity: 'good' },
      ],
      clickhouse_version: '24.8.4',
    },
  ];

  // In chronological order, scan_2 is latest and scan_1 is previous
  const diff = computeScanComparison(scans);
  assert.equal(diff.hasComparison, true);
  // 'High parts count' from scan_1 resolved in scan_2
  assert.equal(diff.resolvedFindings.length, 1);
  assert.equal(diff.resolvedFindings[0].title, 'High parts count');
});
