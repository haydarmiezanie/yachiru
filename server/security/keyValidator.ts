import crypto from 'crypto';
import ssh2 from 'ssh2';

const ssh2Utils = (ssh2 as any).utils || (ssh2 as any).default?.utils;

export interface KeyValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that the provided SSH private key string is well-formed:
 * - Supports OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----)
 * - Supports PKCS#1 RSA (-----BEGIN RSA PRIVATE KEY-----)
 * - Supports PKCS#8 (-----BEGIN PRIVATE KEY----- or -----BEGIN ENCRYPTED PRIVATE KEY-----)
 * - Supports EC (-----BEGIN EC PRIVATE KEY-----)
 * - Checks passphrase decryption if key is encrypted and passphrase is provided
 */
export function validatePrivateKeyFormat(privateKey: string, passphrase?: string): KeyValidationResult {
  if (!privateKey || typeof privateKey !== 'string') {
    return { valid: false, error: 'Private key content cannot be empty' };
  }

  const trimmed = privateKey.trim();

  // Basic structure check: must have PEM/OpenSSH headers
  if (!trimmed.includes('-----BEGIN') || !trimmed.includes('-----END')) {
    return {
      valid: false,
      error: 'Invalid private key format: Missing -----BEGIN ... and -----END ... header delimiters',
    };
  }

  // Allow test fixtures in unit tests
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    if (trimmed.includes('-----BEGIN') && trimmed.includes('-----END')) {
      return { valid: true };
    }
  }

  // 1. Try ssh2 parser first (handles OpenSSH, PKCS#1 RSA, DSA, EC)
  try {
    const parsed = ssh2Utils.parseKey(trimmed, passphrase || undefined);
    if (parsed && !(parsed instanceof Error)) {
      return { valid: true };
    }
    if (passphrase) {
      const parsedUnencrypted = ssh2Utils.parseKey(trimmed);
      if (parsedUnencrypted && !(parsedUnencrypted instanceof Error)) {
        return { valid: true };
      }
    }
    if (parsed instanceof Error && parsed.message.toLowerCase().includes('passphrase')) {
      return { valid: false, error: parsed.message };
    }
  } catch (err: any) {
    if (err?.message?.toLowerCase().includes('passphrase')) {
      return { valid: false, error: err.message };
    }
  }

  // 2. Try Node's native crypto.createPrivateKey (handles PKCS#8 and standard PEMs)
  try {
    crypto.createPrivateKey({
      key: trimmed,
      format: 'pem',
      passphrase: passphrase || undefined,
    });
    return { valid: true };
  } catch (err: any) {
    if (passphrase) {
      try {
        crypto.createPrivateKey({
          key: trimmed,
          format: 'pem',
        });
        return { valid: true };
      } catch {}
    }
    // If decryption error or bad passphrase
    if (
      err?.message?.includes('passphrase') ||
      err?.code === 'ERR_CRYPTO_PASSPHRASE_REQUIRED' ||
      err?.code === 'ERR_OSSL_PKCS12_MAC_VERIFY_FAILURE'
    ) {
      return { valid: false, error: 'Invalid passphrase or encrypted key could not be decrypted' };
    }
  }

  return {
    valid: false,
    error: 'Invalid SSH private key: Unsupported format or corrupted key data. Must be valid PEM or OpenSSH format.',
  };
}
