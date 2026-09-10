import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEncryptionKey,
  encryptSecret,
  decryptSecret,
  __resetEncryptionKeyForTesting,
} from '../server/security/encryption.js';

describe('P0-3: Credential Encryption & Key Management', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    __resetEncryptionKeyForTesting(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEncryptionKeyForTesting(null);
  });

  describe('Fatal Production Enforcement', () => {
    it('throws a fatal configuration error in production when ENCRYPTION_KEY is unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;
      delete process.env.SESSION_SECRET;
      delete process.env.FIREBASE_PROJECT_ID;

      expect(() => getEncryptionKey()).toThrow(
        /FATAL SECURITY CONFIGURATION ERROR.*ENCRYPTION_KEY.*required in production/
      );
    });

    it('does NOT silently fall back to SESSION_SECRET or FIREBASE_PROJECT_ID in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;
      process.env.SESSION_SECRET = 'predictable-session-secret';
      process.env.FIREBASE_PROJECT_ID = 'nifty-art-czp2g';

      expect(() => getEncryptionKey()).toThrow(
        /FATAL SECURITY CONFIGURATION ERROR.*ENCRYPTION_KEY.*required in production/
      );
    });

    it('succeeds in production when ENCRYPTION_KEY is explicitly configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'super-secret-production-key-for-yachiru-cluster-credentials-2026';

      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });
  });

  describe('Development Ephemeral Fallback & Warning', () => {
    it('generates an ephemeral random key in development when ENCRYPTION_KEY is unset and logs warning', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ENCRYPTION_KEY;

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Yachiru Security Warning] ENCRYPTION_KEY is not defined in environment!')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Cryptographic AES-256-GCM Operations', () => {
    it('encrypts and decrypts sensitive passwords and private keys successfully', () => {
      process.env.ENCRYPTION_KEY = 'my-master-encryption-key-passphrase-32b';
      __resetEncryptionKeyForTesting(process.env.ENCRYPTION_KEY);

      const secretText = 'ClickHouse_P@ssw0rd!2026';
      const encrypted = encryptSecret(secretText);

      expect(encrypted).not.toBe(secretText);
      expect(encrypted.split(':').length).toBe(3); // iv:tag:ciphertext

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secretText);
    });

    it('encrypts OpenSSH RSA/ED25519 private keys and decrypts accurately', () => {
      process.env.ENCRYPTION_KEY = 'my-master-encryption-key-passphrase-32b';
      __resetEncryptionKeyForTesting(process.env.ENCRYPTION_KEY);

      const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACB35yUa...sample...
-----END OPENSSH PRIVATE KEY-----`;

      const encrypted = encryptSecret(privateKey);
      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(privateKey);
    });

    it('rejects tampered cipherstrings with authentication tag verification failure', () => {
      process.env.ENCRYPTION_KEY = 'my-master-encryption-key-passphrase-32b';
      __resetEncryptionKeyForTesting(process.env.ENCRYPTION_KEY);

      const encrypted = encryptSecret('confidential-password');
      const parts = encrypted.split(':');
      // Tamper ciphertext
      const tamperedCipher = Buffer.from(parts[2], 'base64');
      tamperedCipher[0] = tamperedCipher[0] ^ 0xff;
      const tamperedStr = `${parts[0]}:${parts[1]}:${tamperedCipher.toString('base64')}`;

      expect(() => decryptSecret(tamperedStr)).toThrow();
    });

    it('verifies migration scenario: ciphertext encrypted with Key A fails to decrypt with Key B', () => {
      // Encrypt with Key A
      __resetEncryptionKeyForTesting('Key-A-32-character-secret-version-1');
      const encryptedUnderKeyA = encryptSecret('sensitive-credential');

      // Attempt decrypt with Key B (rotated key)
      __resetEncryptionKeyForTesting('Key-B-32-character-secret-version-2');
      expect(() => decryptSecret(encryptedUnderKeyA)).toThrow();
    });
  });
});
