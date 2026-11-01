import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeQueryForPrivacy } from '../server/analyzer.js';
import { sanitizeEvidenceForLLM, buildAuditPrompt } from '../server/narrator.js';
import { AnalysisReport } from '../src/types.js';

test('Privacy Sanitizer: sanitizeQueryForPrivacy scrubs string literals and comments', () => {
  const query = `
    -- Fetch customer account details
    SELECT user_id, email, address 
    FROM customer_accounts 
    WHERE email = 'alice.smith@example.com' 
      AND status = 'active'
      /* ignore inactive */
  `;

  const sanitized = sanitizeQueryForPrivacy(query);

  assert.ok(!sanitized.includes('alice.smith@example.com'), 'Email literal must be stripped');
  assert.ok(!sanitized.includes('active'), 'Status string literal must be stripped');
  assert.ok(!sanitized.includes('Fetch customer account details'), 'Single-line comment must be stripped');
  assert.ok(!sanitized.includes('ignore inactive'), 'Multi-line comment must be stripped');
  assert.ok(sanitized.includes("WHERE email = '[REDACTED]'"), 'String literal must be replaced with [REDACTED]');
  assert.ok(sanitized.includes("SELECT user_id, email, address"), 'SELECT clause must be preserved');
  assert.ok(sanitized.includes("FROM customer_accounts"), 'FROM clause must be preserved');
});

test('Privacy Sanitizer: sanitizeQueryForPrivacy scrubs numbers, IDs, and IN list parameters', () => {
  const query = "SELECT * FROM orders WHERE account_id = 987654 AND amount >= 1500.50 AND category_id IN (10, 20, 30)";
  const sanitized = sanitizeQueryForPrivacy(query);

  assert.ok(!sanitized.includes('987654'), 'Account ID number must not be present');
  assert.ok(!sanitized.includes('1500.50'), 'Amount number must not be present');
  assert.ok(!sanitized.includes('10'), 'IN list first element must not be present');
  assert.ok(!sanitized.includes('20'), 'IN list second element must not be present');
  assert.ok(!sanitized.includes('30'), 'IN list third element must not be present');
  assert.ok(sanitized.includes('[NUM]'), 'Numbers must be replaced by [NUM]');
});

test('Privacy Sanitizer: sanitizeQueryForPrivacy scrubs UUIDs, IPs, and hashes', () => {
  const query = "SELECT count() FROM logs WHERE session_uuid = 'e91b1234-abcd-5678-ef01-23456789abcd' AND client_ip = '192.168.1.42'";
  const sanitized = sanitizeQueryForPrivacy(query);

  assert.ok(!sanitized.includes('e91b1234-abcd-5678-ef01-23456789abcd'), 'UUID must be stripped');
  assert.ok(!sanitized.includes('192.168.1.42'), 'IP must be stripped');
});

test('Privacy Sanitizer: sanitizeEvidenceForLLM cleanses SQL query lines while preserving operational metrics', () => {
  const rawEvidence = [
    "Query read 18,450,000 rows (2.4 GB) to return only 54 rows (341,666x amplification).",
    "Sample query: SELECT * FROM payment_logs WHERE card_hash = '8f434346648f6b96df89dda901c5176b' AND amount > 45000;"
  ].join('\n');

  const sanitized = sanitizeEvidenceForLLM(rawEvidence);

  // Operational metrics preserved
  assert.ok(sanitized.includes("18,450,000 rows"), "Row count metric must be preserved");
  assert.ok(sanitized.includes("2.4 GB"), "Byte size metric must be preserved");
  assert.ok(sanitized.includes("54 rows"), "Result rows metric must be preserved");

  // Query literals redacted
  assert.ok(!sanitized.includes('8f434346648f6b96df89dda901c5176b'), "Card hash literal must be redacted");
  assert.ok(!sanitized.includes('45000'), "Amount number must be redacted");
  assert.ok(sanitized.includes("[REDACTED]"), "String literal must be replaced with [REDACTED]");
  assert.ok(sanitized.includes("[NUM]"), "Amount must be replaced with [NUM]");
});

test('Privacy Sanitizer: buildAuditPrompt completely prevents sensitive query_log data from reaching LLMs', () => {
  const sensitiveEmail = 'confidential_cfo@megacorp.internal';
  const sensitiveToken = 'bearer_sec_999988887777';
  const sensitiveSsn = '000-12-3456';

  const mockReport: AnalysisReport = {
    scan_id: 'test-scan-privacy-123',
    is_demo: false,
    categories: [],
    database_name: 'production_analytics',
    clickhouse_version: '24.3.1.2672',
    cluster_mode: 'Standalone Instance',
    overall_score: 45,
    overall_verdict: 'Critical Optimization Required',
    summary: {
      total_tables: 3,
      total_rows: 50000000,
      total_size_compressed: '12.4 GB',
      total_size_uncompressed: '65.2 GB',
      avg_compression_ratio: '5.26',
      total_parts: 180,
      total_queries_analyzed: 40,
      critical_count: 1,
      warning_count: 0,
      good_count: 5,
    },
    tables: [
      {
        database: 'production_analytics',
        name: 'user_events',
        engine: 'MergeTree',
        total_rows: 50000000,
        total_bytes_compressed: 12400000000,
        total_bytes_uncompressed: 65200000000,
        compression_ratio: 5.26,
        active_parts: 180,
        partition_count: 12,
        order_by_key: 'event_time',
        partition_key: 'toYYYYMM(event_time)',
        skip_indices_count: 0,
        findings_count: {
          critical: 1,
          warning: 0,
          good: 0,
        },
      },
    ],
    findings: [
      {
        id: 'query_poor_pruning',
        category: 'query_performance',
        category_name: 'Query Performance & Pruning',
        title: 'High scan-to-result row ratio detected in query_log',
        status: 'critical',
        metric_value: '50,000x read amplification',
        threshold: 'Threshold: < 1,000x',
        evidence: `Query read 25,000,000 rows (4.2 GB) to return only 5 rows.\nSample query: SELECT * FROM user_events WHERE user_email = '${sensitiveEmail}' AND api_token = '${sensitiveToken}' AND ssn = '${sensitiveSsn}' AND salary > 250000`,
        impact: 'Full table scanning causes excessive disk I/O.',
        recommendation_sql_or_text: '-- Check explain',
        is_sql_recommendation: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  const { systemInstruction, userPrompt } = buildAuditPrompt(mockReport);

  // Assert prompt includes operational privacy directive
  assert.ok(
    systemInstruction.includes('OPERATIONAL DATA PRIVACY DIRECTIVE'),
    'Prompt must include operational data privacy directive'
  );

  // Assert NO sensitive strings leaked into LLM prompt payload
  assert.ok(!userPrompt.includes(sensitiveEmail), 'Sensitive user email MUST NOT appear in LLM prompt');
  assert.ok(!userPrompt.includes(sensitiveToken), 'Sensitive API token MUST NOT appear in LLM prompt');
  assert.ok(!userPrompt.includes(sensitiveSsn), 'Sensitive SSN MUST NOT appear in LLM prompt');
  assert.ok(!userPrompt.includes('250000'), 'Sensitive salary filter MUST NOT appear in LLM prompt');

  // Assert payload retains structural diagnostics safely
  assert.ok(userPrompt.includes('user_events'), 'Table name is preserved');
  assert.ok(userPrompt.includes('query_poor_pruning'), 'Finding ID is preserved');
  assert.ok(userPrompt.includes('[REDACTED]'), 'Redacted tokens are present');
});

test('Privacy Sanitizer: 9 adversarial repro cases are completely sanitized', () => {
  // Repro 1: Comment characters inside string literal with comment stripping order
  const q1 = "SELECT * FROM users WHERE password = 'hunter2--x'";
  const s1 = sanitizeQueryForPrivacy(q1);
  assert.ok(!s1.includes('hunter2'), "password literal 'hunter2' must not survive");

  // Repro 2: Numeric arrays in ClickHouse function
  const q2 = "SELECT count() FROM events WHERE has([48291033, 77120045], user_id)";
  const s2 = sanitizeQueryForPrivacy(q2);
  assert.ok(!s2.includes('48291033'), 'Array first numeric element must not survive');
  assert.ok(!s2.includes('77120045'), 'Array second numeric element must not survive');

  // Repro 3: Negative numbers
  const q3 = "SELECT * FROM ledger WHERE balance = -987654321";
  const s3 = sanitizeQueryForPrivacy(q3);
  assert.ok(!s3.includes('987654321'), 'Negative number literal must not survive');

  // Repro 4: Function arguments (timestamp / epoch)
  const q4 = "SELECT * FROM logs WHERE event_time >= toDateTime(1700000123)";
  const s4 = sanitizeQueryForPrivacy(q4);
  assert.ok(!s4.includes('1700000123'), 'Timestamp argument must not survive');

  // Repro 5: Unterminated literal caused by ClickHouse log_queries_cut_to_length truncation
  const q5 = "SELECT * FROM customers WHERE name = 'Alice Johnson Sm";
  const s5 = sanitizeQueryForPrivacy(q5);
  assert.ok(!s5.includes('Alice Johnson Sm'), 'Unterminated string literal must not survive');

  // Repro 6: Heredoc / dollar-quoted string literal
  const q6 = "SELECT $$my secret note$$ AS note FROM dual";
  const s6 = sanitizeQueryForPrivacy(q6);
  assert.ok(!s6.includes('my secret note'), 'Heredoc literal content must not survive');

  // Repro 7: Double-quoted literal
  const q7 = 'SELECT * FROM sessions WHERE session_token = "abcd-secret-session"';
  const s7 = sanitizeQueryForPrivacy(q7);
  assert.ok(!s7.includes('abcd-secret-session'), 'Double-quoted literal must not survive');

  // Repro 8: IP address constant
  const q8 = "SELECT * FROM traffic WHERE ip = '10.20.30.40'";
  const s8 = sanitizeQueryForPrivacy(q8);
  assert.ok(!s8.includes('10.20.30.40'), 'IP address literal must not survive');

  // Repro 9: Standard tenant ID constant
  const q9 = "SELECT * FROM accounts WHERE tenant_id = 90817265";
  const s9 = sanitizeQueryForPrivacy(q9);
  assert.ok(!s9.includes('90817265'), 'Tenant ID numeric constant must not survive');
});

test('Privacy Sanitizer: sanitizeEvidenceForLLM cleanses multi-line evidence without line-by-line bypass', () => {
  const multiLineEvidence = [
    'Diagnostic scan summary for tenant partition',
    'WHERE tenant_id = 90817265',
    'AND session = "abcd-secret-session"',
    'AND ip = "10.20.30.40"',
  ].join('\n');

  const sanitized = sanitizeEvidenceForLLM(multiLineEvidence);

  assert.ok(!sanitized.includes('90817265'), 'Multi-line tenant ID must be redacted');
  assert.ok(!sanitized.includes('abcd-secret-session'), 'Multi-line session token must be redacted');
  assert.ok(!sanitized.includes('10.20.30.40'), 'Multi-line IP must be redacted');
});
