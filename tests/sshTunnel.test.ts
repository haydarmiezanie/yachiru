import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertSafeHost } from '../server/security/ssrfValidator.js';
import { redactScanTarget, redactObjectSecrets } from '../server/security/redaction.js';
import { encryptSecret, decryptSecret } from '../server/security/encryption.js';
import { verifyHostKeyTofu, retrustHostKey, resetHostKeysForTesting } from '../server/scanner/hostKeyStore.js';
import { ScanTarget } from '../src/types/yachiru.js';

describe('SSH Tunnel Security & TOFU Subsystem', () => {
  beforeEach(() => {
    resetHostKeysForTesting();
  });

  describe('SSRF Protection with SSH Tunnel Routing Model', () => {
    it('enforces strict SSRF protection on the SSH bastion host', async () => {
      // Cloud metadata, loopback, private ranges must be rejected for SSH bastion
      await expect(assertSafeHost('169.254.169.254')).rejects.toThrow(/restricted|prohibited|blocked|not permitted/i);
      await expect(assertSafeHost('10.0.1.5')).rejects.toThrow(/restricted|prohibited|blocked|not permitted/i);
      await expect(assertSafeHost('127.0.0.1')).rejects.toThrow(/restricted|prohibited|blocked|not permitted/i);
      await expect(assertSafeHost('metadata.google.internal')).rejects.toThrow(/restricted|prohibited|blocked|not permitted/i);
    });

    it('redacts SSH credentials in logs and scan targets', () => {
      const targetWithSsh: ScanTarget = {
        host: '10.0.0.25', // internal ClickHouse IP behind bastion
        port: 8123,
        database: 'prod_db',
        user: 'default',
        password: 'ch-super-secret-password',
        sshTunnel: {
          enabled: true,
          host: 'bastion.corp.net',
          port: 22,
          username: 'ch-operator',
          authMethod: 'password' as const,
          password: 'bastion-ssh-password',
          privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nMIIE...\n-----END OPENSSH PRIVATE KEY-----',
          passphrase: 'key-passphrase',
        },
      };

      const redacted = redactScanTarget(targetWithSsh);

      expect(redacted.password).toBeUndefined();
      expect(redacted.sshTunnel).toBeDefined();
      expect(redacted.sshTunnel?.password).toBeUndefined();
      expect(redacted.sshTunnel?.privateKey).toBeUndefined();
      expect(redacted.sshTunnel?.passphrase).toBeUndefined();
      expect(redacted.sshTunnel?.username).toBe('ch-operator');
      expect(redacted.sshTunnel?.host).toBe('bastion.corp.net');
    });

    it('redacts nested objects containing secret keywords', () => {
      const payload = {
        scanId: '123',
        target: {
          token: 'sensitive-token',
          apiKey: 'AIzaSy123456789',
          private_key: 'rsa-key-data',
          nested: {
            auth_password: 'nested-secret',
            clusterName: 'analytics-eu',
          },
        },
      };

      const sanitized = redactObjectSecrets(payload);
      expect(sanitized.target.token).toBe('[REDACTED]');
      expect(sanitized.target.apiKey).toBe('[REDACTED]');
      expect(sanitized.target.private_key).toBe('[REDACTED]');
      expect(sanitized.target.nested.auth_password).toBe('[REDACTED]');
      expect(sanitized.target.nested.clusterName).toBe('analytics-eu');
    });
  });

  describe('Symmetric AES-256-GCM Encryption Store', () => {
    it('encrypts and successfully decrypts SSH credentials', () => {
      const secret = 'super-secret-ssh-private-key-material-2026';
      const encrypted = encryptSecret(secret);

      expect(encrypted).not.toBe(secret);
      expect(encrypted).toContain(':'); // iv:tag:ciphertext

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const secret = 'same-secret';
      const enc1 = encryptSecret(secret);
      const enc2 = encryptSecret(secret);

      expect(enc1).not.toBe(enc2);
      expect(decryptSecret(enc1)).toBe(secret);
      expect(decryptSecret(enc2)).toBe(secret);
    });

    it('handles empty strings and rejects tampered ciphertexts', () => {
      expect(encryptSecret('')).toBe('');
      expect(decryptSecret('')).toBe('');

      // Tampered tag or ciphertext
      const parts = encryptSecret('test-secret').split(':');
      const tampered = `${parts[0]}:${parts[1]}:corruptedciphertext`;
      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe('SSH Host Key Verification with TOFU (Trust On First Use)', () => {
    it('trusts host key on first connection and stores fingerprint', async () => {
      const host = 'bastion-prod.example.com';
      const port = 22;
      const initialFingerprint = 'SHA256:abc123firstsecurersafingerprint456';

      // First connection -> should accept
      const firstResult = await verifyHostKeyTofu(host, port, initialFingerprint);
      expect(firstResult.trusted).toBe(true);
      expect(firstResult.isFirstUse).toBe(true);

      // Second connection with SAME fingerprint -> should accept
      const secondResult = await verifyHostKeyTofu(host, port, initialFingerprint);
      expect(secondResult.trusted).toBe(true);
      expect(secondResult.isFirstUse).toBe(false);
    });

    it('rejects connection if host key changes (MITM / Host Key Mismatch)', async () => {
      const host = 'bastion-finance.example.com';
      const port = 22;
      const initialFingerprint = 'SHA256:genuine-valid-fingerprint';
      const attackerFingerprint = 'SHA256:malicious-attacker-mitm-fingerprint';

      await verifyHostKeyTofu(host, port, initialFingerprint);

      // Changed fingerprint -> MITM alert!
      const mismatchResult = await verifyHostKeyTofu(host, port, attackerFingerprint);
      expect(mismatchResult.trusted).toBe(false);
      expect(mismatchResult.reason).toContain('POSSIBLE SSH HOST KEY MAN-IN-THE-MIDDLE ATTACK');
    });

    it('allows Admin to explicitly re-trust a rotated host key', async () => {
      const host = 'bastion-rotated.example.com';
      const port = 22;
      const oldFingerprint = 'SHA256:old-server-fingerprint';
      const newLegitimateFingerprint = 'SHA256:new-provisioned-fingerprint';

      await verifyHostKeyTofu(host, port, oldFingerprint);

      // Re-trust via Admin action
      await retrustHostKey(host, port, newLegitimateFingerprint);

      // Next connection with new fingerprint succeeds
      const postRetrustResult = await verifyHostKeyTofu(host, port, newLegitimateFingerprint);
      expect(postRetrustResult.trusted).toBe(true);
    });
  });
});
