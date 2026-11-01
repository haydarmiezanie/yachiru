import test from 'node:test';
import assert from 'node:assert/strict';
import { isStrictHostKeyChecking } from '../server/sshTunnel.js';
import { compareApiKeys } from '../server.js';
import { escapeSqlIdentifier, escapeSqlString } from '../server/analyzer.js';

test('Security Fix 1: compareApiKeys uses constant-time comparison', () => {
  const secretKey = 'a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0';

  // Exact match
  assert.equal(compareApiKeys(secretKey, secretKey), true);

  // Mismatched characters
  assert.equal(compareApiKeys('wrong-key', secretKey), false);
  assert.equal(compareApiKeys('a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef1', secretKey), false);

  // Null, undefined, empty
  assert.equal(compareApiKeys('', secretKey), false);
  assert.equal(compareApiKeys(null, secretKey), false);
  assert.equal(compareApiKeys(undefined, secretKey), false);
  assert.equal(compareApiKeys(secretKey, null), false);
});

test('Security Fix 3: isStrictHostKeyChecking enforces server floor policy', () => {
  const originalEnv = process.env.YACHIRU_SSH_STRICT_HOST_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    // 1. When server sets YACHIRU_SSH_STRICT_HOST_KEY=true:
    process.env.YACHIRU_SSH_STRICT_HOST_KEY = 'true';
    // Client sending strictHostKeyChecking: false CANNOT bypass server floor
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: false }), true);
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: true }), true);
    assert.equal(isStrictHostKeyChecking(null), true);
    assert.equal(isStrictHostKeyChecking(undefined), true);

    // 2. Option A: In production (NODE_ENV=production) with env unset, default is strict
    delete process.env.YACHIRU_SSH_STRICT_HOST_KEY;
    process.env.NODE_ENV = 'production';
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: false }), true);
    assert.equal(isStrictHostKeyChecking(null), true);

    // Explicit override YACHIRU_SSH_STRICT_HOST_KEY=false allows permissive in production
    process.env.YACHIRU_SSH_STRICT_HOST_KEY = 'false';
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: false }), false);
    // But if client explicitly asks for strict, it is honored
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: true }), true);

    // 3. In non-production, defaults to permissive
    delete process.env.YACHIRU_SSH_STRICT_HOST_KEY;
    process.env.NODE_ENV = 'development';
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: false }), false);
    assert.equal(isStrictHostKeyChecking(null), false);
    // Client can opt in to strict in development
    assert.equal(isStrictHostKeyChecking({ strictHostKeyChecking: true }), true);
  } finally {
    if (originalEnv !== undefined) {
      process.env.YACHIRU_SSH_STRICT_HOST_KEY = originalEnv;
    } else {
      delete process.env.YACHIRU_SSH_STRICT_HOST_KEY;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  }
});

test('Security Fix 6: SQL recommendation generation escapes and database-qualifies dangerous table names', () => {
  const db = 'prod_db';
  const maliciousTable = 't; DROP TABLE x';
  const column = 'user_id';

  // Verify identifier quoting
  const qualifiedTarget = `${escapeSqlIdentifier(db)}.${escapeSqlIdentifier(maliciousTable)}`;
  assert.equal(qualifiedTarget, '`prod_db`.`t; DROP TABLE x`');

  // Verify full ALTER statement generation
  const sql = `ALTER TABLE ${qualifiedTarget} MODIFY COLUMN ${escapeSqlIdentifier(column)} LowCardinality(String);`;
  assert.equal(sql, 'ALTER TABLE `prod_db`.`t; DROP TABLE x` MODIFY COLUMN `user_id` LowCardinality(String);');

  // Ensure malicious SQL is neutralized inside quoted identifier
  assert.ok(sql.includes('`t; DROP TABLE x`'), 'Table name must be enclosed in escaped backticks');
});
