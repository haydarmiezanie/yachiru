import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { parseSshPublicKey, matchesExpectedHostKey } from '../server/sshTunnel.js';
import { classifyConnectionError } from '../server.js';

test('SSH Host Key: parseSshPublicKey and fingerprint generation', () => {
  // Generate a real ephemeral ed25519 keypair
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawKeyBytes = pubDer.subarray(pubDer.length - 32);

  // Construct RFC 4253 wire format for ssh-ed25519:
  // [uint32 length = 11]["ssh-ed25519"][uint32 length = 32][32 raw bytes]
  const typeStr = 'ssh-ed25519';
  const typeBuf = Buffer.from(typeStr, 'utf8');
  const wireBuf = Buffer.concat([
    Buffer.from([0, 0, 0, typeBuf.length]),
    typeBuf,
    Buffer.from([0, 0, 0, rawKeyBytes.length]),
    rawKeyBytes,
  ]);

  const info = parseSshPublicKey(wireBuf);

  assert.equal(info.type, 'ssh-ed25519');
  assert.ok(info.fingerprintSha256.startsWith('SHA256:'), 'SHA256 fingerprint should start with SHA256:');
  assert.equal(info.fingerprintHexSha256.length, 64, 'Hex SHA256 should be 64 characters');
  assert.ok(/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/.test(info.fingerprintMd5), 'MD5 fingerprint should have colon delimiters');
  assert.equal(info.rawBase64, wireBuf.toString('base64'));
  assert.equal(info.authorizedKeyString, `ssh-ed25519 ${wireBuf.toString('base64')}`);
});

test('SSH Host Key: matchesExpectedHostKey formats', () => {
  // Synthesize wire buffer
  const typeStr = 'ssh-ed25519';
  const typeBuf = Buffer.from(typeStr, 'utf8');
  const mockKey = Buffer.from('12345678901234567890123456789012', 'utf8');
  const wireBuf = Buffer.concat([
    Buffer.from([0, 0, 0, typeBuf.length]),
    typeBuf,
    Buffer.from([0, 0, 0, mockKey.length]),
    mockKey,
  ]);

  const info = parseSshPublicKey(wireBuf);

  // 1. Exact OpenSSH SHA256 with prefix
  assert.equal(matchesExpectedHostKey(info.fingerprintSha256, info), true);

  // 2. OpenSSH SHA256 without prefix
  const bareSha256 = info.fingerprintSha256.replace('SHA256:', '');
  assert.equal(matchesExpectedHostKey(bareSha256, info), true);

  // 3. OpenSSH SHA256 with trailing base64 padding '='
  assert.equal(matchesExpectedHostKey(info.fingerprintSha256 + '==', info), true);

  // 4. Hex SHA256 (lowercase and uppercase)
  assert.equal(matchesExpectedHostKey(info.fingerprintHexSha256, info), true);
  assert.equal(matchesExpectedHostKey(info.fingerprintHexSha256.toUpperCase(), info), true);
  assert.equal(matchesExpectedHostKey(`SHA256:${info.fingerprintHexSha256}`, info), true);

  // 5. MD5 colon-delimited (with and without prefix)
  assert.equal(matchesExpectedHostKey(info.fingerprintMd5, info), true);
  assert.equal(matchesExpectedHostKey(`MD5:${info.fingerprintMd5}`, info), true);
  assert.equal(matchesExpectedHostKey(info.fingerprintMd5.toUpperCase(), info), true);

  // 6. MD5 plain hex without colons
  const plainMd5 = info.fingerprintMd5.replace(/:/g, '');
  assert.equal(matchesExpectedHostKey(plainMd5, info), true);

  // 7. Full authorized_keys string
  assert.equal(matchesExpectedHostKey(info.authorizedKeyString, info), true);

  // 8. known_hosts format line: "bastion.example.com ssh-ed25519 AAAAC3..."
  assert.equal(matchesExpectedHostKey(`bastion.example.com ${info.authorizedKeyString}`, info), true);

  // 9. Mismatched fingerprint must return false
  assert.equal(matchesExpectedHostKey('SHA256:dGhpcyBpcyBhIGZha2UgZmluZ2VycHJpbnQ', info), false);
  assert.equal(matchesExpectedHostKey('00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff', info), false);
});

test('classifyConnectionError: accurately flags SSH host key verification failure', () => {
  const hostMismatchError =
    'SSH host key verification failed for bastion.internal:22. Remote server presented ssh-ed25519 key with fingerprint SHA256:abc, which does NOT match expected fingerprint "SHA256:xyz". Possible Man-In-The-Middle (MITM) attack!';

  const result = classifyConnectionError(hostMismatchError);
  assert.ok(result.hint.includes('SSH host key verification failed'));
  assert.ok(result.hint.includes('Man-In-The-Middle (MITM) attack'));
});
