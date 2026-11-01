import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeSqlString,
  escapeSqlIdentifier,
  assertReadOnlySql,
  stripLiteralsAndComments,
} from '../server/analyzer.js';
import { isValidIdentifier } from '../server/history.js';

test('Database Escaping: escapeSqlString basic and boundary values', () => {
  // 1. Standard identifier
  assert.equal(escapeSqlString('default'), 'default');
  assert.equal(escapeSqlString('analytics_prod_2026'), 'analytics_prod_2026');

  // 2. Empty string or non-string
  assert.equal(escapeSqlString(''), '');
  assert.equal(escapeSqlString(null as unknown as string), '');
  assert.equal(escapeSqlString(undefined as unknown as string), '');

  // 3. Hyphenated and dot-separated database names
  assert.equal(escapeSqlString('k8s-prod-db'), 'k8s-prod-db');
  assert.equal(escapeSqlString('data.warehouse'), 'data.warehouse');
});

test('Database Escaping: escapeSqlString handles quotes and backslashes safely', () => {
  // 1. Single quotes must be escaped with backslash
  assert.equal(escapeSqlString("user's_db"), "user\\'s_db");
  assert.equal(escapeSqlString("prod'db'test"), "prod\\'db\\'test");

  // 2. Backslashes must be doubled
  assert.equal(escapeSqlString('company\\analytics'), 'company\\\\analytics');

  // 3. Trailing backslash must be doubled (CRITICAL: if not doubled, 'test\' leaves quote escaped in SQL!)
  assert.equal(escapeSqlString('test\\'), 'test\\\\');
  const sqlWithTrailingSlash = `SELECT * FROM system.tables WHERE database = '${escapeSqlString('test\\')}';`;
  // In the generated SQL: WHERE database = 'test\\'; -> the closing quote is NOT escaped!
  assert.ok(sqlWithTrailingSlash.endsWith("'test\\\\';"));

  // 4. Injected backslash followed by single quote: test\' OR 1=1 --
  const dangerousDb = "test\\' OR 1=1 --";
  const escapedDangerous = escapeSqlString(dangerousDb);
  assert.equal(escapedDangerous, "test\\\\\\' OR 1=1 --");

  // 5. Classic SQL injection attempt
  const sqlInjection = "prod'; DROP TABLE users; --";
  const escapedInjection = escapeSqlString(sqlInjection);
  assert.equal(escapedInjection, "prod\\'; DROP TABLE users; --");
  const query = `SELECT * FROM system.tables WHERE database = '${escapedInjection}'`;
  // When passed to assertReadOnlySql, this must NOT fail because the entire payload is within string literal
  assert.doesNotThrow(() => assertReadOnlySql(query));
});

test('Database Escaping: escapeSqlString handles control characters and Unicode', () => {
  // 1. Control characters: newline, carriage return, tab, null byte
  assert.equal(escapeSqlString('db\nname'), 'db\\nname');
  assert.equal(escapeSqlString('db\rname'), 'db\\rname');
  assert.equal(escapeSqlString('db\tname'), 'db\\tname');
  assert.equal(escapeSqlString('db\0name'), 'db\\0name');

  // 2. International / Unicode database names
  assert.equal(escapeSqlString('база_данных'), 'база_данных');
  assert.equal(escapeSqlString('数据库'), '数据库');
  assert.equal(escapeSqlString('dâtābāse_ümlaut_öäü'), 'dâtābāse_ümlaut_öäü');
  assert.equal(escapeSqlString("日本語'db"), "日本語\\'db");
});

test('Database Escaping: escapeSqlIdentifier quotes and protects identifiers', () => {
  // 1. Standard identifiers
  assert.equal(escapeSqlIdentifier('default'), '`default`');
  assert.equal(escapeSqlIdentifier('prod_analytics'), '`prod_analytics`');
  assert.equal(escapeSqlIdentifier('k8s-prod-db'), '`k8s-prod-db`');

  // 2. Identifier with backticks and backslashes
  assert.equal(escapeSqlIdentifier('weird`name'), '`weird\\`name`');
  assert.equal(escapeSqlIdentifier('path\\db'), '`path\\\\db`');

  // 3. Empty or null-byte identifiers must throw
  assert.throws(() => escapeSqlIdentifier(''), /cannot be empty/i);
  assert.throws(() => escapeSqlIdentifier('db\0null'), /cannot contain null bytes/i);
});

test('Database Escaping: isValidIdentifier accurately validates ClickHouse identifiers', () => {
  // Valid identifiers
  assert.equal(isValidIdentifier('default'), true);
  assert.equal(isValidIdentifier('analytics_2026'), true);
  assert.equal(isValidIdentifier('k8s-prod-cluster'), true);
  assert.equal(isValidIdentifier('yachiru_scan_history'), true);

  // Invalid identifiers (prevent SQL injection before entering queries)
  assert.equal(isValidIdentifier(''), false);
  assert.equal(isValidIdentifier('prod; DROP TABLE x'), false);
  assert.equal(isValidIdentifier("db' OR '1'='1"), false);
  assert.equal(isValidIdentifier('db name with spaces'), false);
  assert.equal(isValidIdentifier('db`name'), false);
});

test('Database Escaping: stripLiteralsAndComments correctly isolates code from data', () => {
  // 1. Preserves structure but empties string literals
  const sql = "SELECT * FROM system.tables WHERE database = 'create-prod-db' AND name = 'drop_table'";
  const stripped = stripLiteralsAndComments(sql);
  assert.equal(stripped, "SELECT * FROM system.tables WHERE database = '' AND name = ''");

  // 2. Correctly respects escaped single quotes inside string literals
  const sqlWithEscapedQuote = "SELECT * FROM system.tables WHERE database = 'company\\'s_db' AND active = 1";
  const strippedEscaped = stripLiteralsAndComments(sqlWithEscapedQuote);
  assert.equal(strippedEscaped, "SELECT * FROM system.tables WHERE database = '' AND active = 1");

  // 3. Strips comments
  const sqlWithComments = "SELECT 1 -- comment with DROP TABLE\nFROM system.tables /* block comment with ALTER */";
  const strippedComments = stripLiteralsAndComments(sqlWithComments);
  assert.ok(!strippedComments.includes('DROP'));
  assert.ok(!strippedComments.includes('ALTER'));
});

test('Database Escaping: assertReadOnlySql permits valid read-only queries with keyword-containing database names', () => {
  // Database names that contain mutating SQL words as substrings/tokens
  const dbsWithKeywords = [
    'create-service',
    'drop_metrics',
    'update_feed',
    'alter_events',
    'delete-logs',
    'grant_audit',
    'truncate-pipeline',
    'kill_switch',
  ];

  for (const db of dbsWithKeywords) {
    const escaped = escapeSqlString(db);
    const query = `SELECT * FROM system.tables WHERE database = '${escaped}' AND is_temporary = 0`;
    assert.doesNotThrow(
      () => assertReadOnlySql(query),
      `Expected assertReadOnlySql to permit read-only query with database name '${db}'`
    );
  }
});

test('Database Escaping: assertReadOnlySql strictly blocks real mutating SQL injections', () => {
  // Actual mutating statements disguised or appended
  const dangerousQueries = [
    'DROP DATABASE production;',
    'ALTER TABLE events DELETE WHERE 1=1;',
    'TRUNCATE TABLE users;',
    'INSERT INTO telemetry VALUES (1, 2);',
    "SELECT 1; DROP TABLE users; --",
    "SELECT * FROM system.tables WHERE database = 'x'; ALTER TABLE y DROP COLUMN z;",
  ];

  for (const query of dangerousQueries) {
    assert.throws(
      () => assertReadOnlySql(query),
      /SECURITY EXCEPTION/i,
      `Expected assertReadOnlySql to reject mutating query: ${query}`
    );
  }
});
