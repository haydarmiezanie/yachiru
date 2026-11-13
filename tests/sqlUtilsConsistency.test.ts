import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as sqlUtils from '../server/sqlUtils.js';
import * as analyzer from '../server/analyzer.js';
import * as checkHelpers from '../server/checks/helpers.js';
import * as checksIndex from '../server/checks/index.js';
import {
  evaluatePartHealthChecks,
  evaluateSchemaChecks,
  evaluateQueryChecks,
  evaluateReplicationChecks,
  evaluateSystemChecks,
  CheckEvaluationContext,
} from '../server/checks/index.js';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

test('FIX 1 Guard: SQL and formatting helpers are defined in only one file under server/', () => {
  const serverDir = path.resolve(process.cwd(), 'server');
  const files = collectTsFiles(serverDir);
  const targetFunctions = [
    'escapeSqlString',
    'escapeSqlIdentifier',
    'formatBytes',
    'tokenizeColumnName',
    'matchesColumnTokens',
    'assertReadOnlySql',
    'stripLiteralsAndComments',
  ];

  for (const fnName of targetFunctions) {
    const pattern = new RegExp(`\\bfunction\\s+${fnName}\\b`);
    const definingFiles = files.filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      return pattern.test(content);
    });

    assert.equal(
      definingFiles.length,
      1,
      `Expected 'function ${fnName}' to be defined in exactly 1 file under server/, found in: ${definingFiles.join(', ')}`
    );
    assert.ok(
      definingFiles[0].endsWith(path.join('server', 'sqlUtils.ts')),
      `Expected 'function ${fnName}' to be defined in server/sqlUtils.ts, found in ${definingFiles[0]}`
    );
  }
});

test('FIX 1 Repro: all import paths produce identical strict escaping and reject empty identifiers', () => {
  const sources = [
    { name: 'sqlUtils', mod: sqlUtils },
    { name: 'analyzer', mod: analyzer },
    { name: 'checks/helpers', mod: checkHelpers },
    { name: 'checks/index', mod: checksIndex },
  ];

  for (const { name, mod } of sources) {
    assert.equal(
      mod.escapeSqlIdentifier('a`b'),
      '`a\\`b`',
      `${name}.escapeSqlIdentifier('a\`b') must preserve and escape backtick`
    );
    assert.equal(
      mod.escapeSqlIdentifier('x\\'),
      '`x\\\\`',
      `${name}.escapeSqlIdentifier('x\\') must escape backslash before closing backtick`
    );
    assert.equal(
      mod.escapeSqlString("ev'ents\nDROP\0"),
      "ev\\'ents\\nDROP\\0",
      `${name}.escapeSqlString must escape backslash, quote, newline, and NUL`
    );
    assert.throws(
      () => mod.escapeSqlIdentifier(''),
      /cannot be empty/i,
      `${name}.escapeSqlIdentifier('') must throw`
    );
  }
});

test('FIX 1 Acceptance: real check modules preserve escaped table x\\ and column a`b in recommendation SQL', () => {
  const nastyDb = 'db`1\\';
  const nastyTable = 'x\\';
  const nastyCol = 'a`b';
  // Use a LowCardinality-triggering name containing a`b so schema checks emit ALTER TABLE ... MODIFY COLUMN
  const nastyStatusCol = 'a`b_status';

  const ctx: CheckEvaluationContext = {
    database: nastyDb,
    tablesData: [
      {
        database: nastyDb,
        name: nastyTable,
        engine: 'Memory',
        total_rows: 200000,
        total_bytes: 100000000,
        sorting_key: 'tuple()',
        partition_key: '',
      },
    ],
    partsMap: new Map([
      [
        nastyTable,
        {
          table: nastyTable,
          active_parts: 200,
          partition_count: 1,
          total_rows: 20000000,
          compressed_bytes: 6 * 1024 * 1024 * 1024,
          uncompressed_bytes: 12 * 1024 * 1024 * 1024,
          tiny_parts_count: 10,
          min_part_size: 1024,
          max_part_size: 1024000,
          avg_part_size: 512000,
        },
      ],
    ]),
    colData: [
      {
        table: nastyTable,
        name: nastyStatusCol,
        type: 'String',
        data_compressed_bytes: 80 * 1024 * 1024,
        data_uncompressed_bytes: 90 * 1024 * 1024,
        compression_codec: 'LZ4',
      },
      {
        table: nastyTable,
        name: nastyCol,
        type: 'String',
        data_compressed_bytes: 80 * 1024 * 1024,
        data_uncompressed_bytes: 90 * 1024 * 1024,
        compression_codec: 'LZ4',
      },
    ],
    skipData: [],
    skipIndicesMap: new Map(),
    skipIndicesAvailable: true,
    queryStats: [
      {
        tables: [nastyTable],
        query_duration_ms: 5000,
        memory_usage: 1024,
        read_rows: 500000,
        read_bytes: 1024000,
        result_rows: 1,
        ratio: 500000,
      },
    ],
    queryLogAvailable: true,
    durationThresholdMs: 3000,
    memoryThresholdBytes: 1024 * 1024 * 1024,
    replicasData: [
      {
        table: nastyTable,
        is_readonly: 0,
        absolute_delay: 10,
        queue_size: 30,
      },
    ],
    distributionData: [
      {
        database: nastyDb,
        table: nastyTable,
        data_files: 60,
        data_compressed_bytes: 1024,
        is_blocked: 1,
      },
    ],
    replicationAvailable: true,
    settingsData: [],
    settingsAvailable: true,
    mutationsData: [
      {
        database: nastyDb,
        table: nastyTable,
        mutation_id: "m'1",
        command: 'UPDATE x SET a = 1',
        create_time: new Date().toISOString(),
        is_done: 0,
        parts_to_do: 5,
        latest_fail_reason: 'Test failure',
      },
    ],
    mutationsAvailable: true,
    mutationWarningAgeHours: 1,
    mutationCriticalAgeHours: 6,
    disksData: [],
    disksAvailable: true,
    diskWarningFreePct: 20,
    diskCriticalFreePct: 10,
    errorsData: [],
    errorsAvailable: true,
    errorRecentWindowHours: 24,
    errorWarningCount: 100,
    errorCriticalCount: 1000,
    replicationQueueData: [
      {
        database: nastyDb,
        table: nastyTable,
        type: 'GET_PART',
        create_time: new Date().toISOString(),
        num_tries: 20,
        last_exception: 'Connection reset',
      },
    ],
    replicationQueueAvailable: true,
    replicationQueueWarningSize: 50,
    replicationQueueMaxRetries: 10,
  };

  const partFindings = evaluatePartHealthChecks(ctx);
  const schemaFindings = evaluateSchemaChecks(ctx);
  const queryFindings = evaluateQueryChecks(ctx, analyzer.sanitizeQueryForPrivacy);
  const repFindings = evaluateReplicationChecks(ctx);
  const sysFindings = evaluateSystemChecks(ctx);

  const expectedQuotedTable = '`x\\\\`';
  const expectedQuotedDb = '`db\\`1\\\\`';
  const expectedQuotedCol = '`a\\`b`';
  const expectedQuotedStatusCol = '`a\\`b_status`';

  // Schema checks must quote db, table `x\\`, and columns `a\`b` / `a\`b_status`
  const lowComp = schemaFindings.find((f) => f.id === `low_compression_${nastyTable}_${nastyCol}`);
  assert.ok(lowComp, 'Expected low_compression finding for column a`b');
  assert.ok(
    lowComp.recommendation_sql_or_text.includes(`${expectedQuotedDb}.${expectedQuotedTable}`),
    `Expected ${expectedQuotedDb}.${expectedQuotedTable} in recommendation SQL, got: ${lowComp.recommendation_sql_or_text}`
  );
  assert.ok(
    lowComp.recommendation_sql_or_text.includes(`MODIFY COLUMN ${expectedQuotedCol}`),
    `Expected MODIFY COLUMN ${expectedQuotedCol} in recommendation SQL, got: ${lowComp.recommendation_sql_or_text}`
  );

  const lowCard = schemaFindings.find((f) => f.id === `lowcard_candidate_${nastyTable}_${nastyStatusCol}`);
  assert.ok(lowCard, 'Expected lowcard_candidate finding for column a`b_status');
  assert.ok(
    lowCard.recommendation_sql_or_text.includes(`MODIFY COLUMN ${expectedQuotedStatusCol}`),
    `Expected ${expectedQuotedStatusCol} in lowCard recommendation SQL`
  );

  // Query check (no normalized query fallback) must quote table `x\\`
  const queryPruning = queryFindings.find((f) => f.id === 'query_poor_pruning');
  assert.ok(queryPruning);
  assert.ok(
    queryPruning.recommendation_sql_or_text.includes(expectedQuotedTable),
    `Expected ${expectedQuotedTable} in query pruning recommendation SQL`
  );

  // Part health check must escape table string literal 'x\\'
  const partCount = partFindings.find((f) => f.id === `parts_count_${nastyTable}`);
  assert.ok(partCount);
  assert.ok(
    partCount.recommendation_sql_or_text.includes("WHERE table = 'x\\\\'"),
    `Expected escaped table literal 'x\\\\' in part_health recommendation SQL`
  );

  // Replication check must escape table string literal 'x\\'
  const repQueue = repFindings.find((f) => f.id === `replica_queue_${nastyTable}`);
  assert.ok(repQueue);
  assert.ok(
    repQueue.recommendation_sql_or_text.includes("WHERE table = 'x\\\\'"),
    `Expected escaped table literal 'x\\\\' in replication recommendation SQL`
  );

  // System check must escape mutation table and id
  const mutFail = sysFindings.find((f) => f.id.startsWith(`mutation_fail_${nastyTable}`));
  assert.ok(mutFail);
  assert.ok(
    mutFail.recommendation_sql_or_text.includes("mutation_id = 'm\\'1'") &&
      mutFail.recommendation_sql_or_text.includes("table = 'x\\\\'"),
    'Expected escaped mutation_id and table in system mutation recommendation SQL'
  );
});
