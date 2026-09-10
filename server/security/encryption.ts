import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits auth tag

let derivedKey: Buffer | null = null;
let isEphemeralKey = false;

/**
 * Resets or overrides derived key (strictly for unit tests).
 */
export function __resetEncryptionKeyForTesting(customSecret?: string | null): void {
  if (customSecret) {
    derivedKey = crypto.scryptSync(customSecret, 'yachiru-credential-salt-2026', 32);
    isEphemeralKey = false;
  } else {
    derivedKey = null;
    isEphemeralKey = false;
  }
}

/**
 * Retrieves the cryptographic key used for AES-256-GCM encryption of stored credentials.
 *
 * Security Policy:
 * 1. Production (NODE_ENV=production): ENCRYPTION_KEY is STRICTLY MANDATORY. Fails fast with a
 *    fatal error if missing. Never falls back to predictable/hardcoded keys.
 * 2. Development/Test: If ENCRYPTION_KEY is not configured, generates a cryptographically
 *    random ephemeral key per process lifetime and emits a prominent security warning.
 *
 * Migration Note:
 * Any legacy saved connections encrypted under previous fallback keys must be re-saved
 * or re-entered through the UI/API following ENCRYPTION_KEY configuration.
 */
export function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;

  const envKey = process.env.ENCRYPTION_KEY?.trim();

  if (envKey) {
    derivedKey = crypto.scryptSync(envKey, 'yachiru-credential-salt-2026', 32);
    return derivedKey;
  }

  // Fatal check in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL SECURITY CONFIGURATION ERROR: The ENCRYPTION_KEY environment variable is required in production ' +
        'to encrypt saved ClickHouse credentials and SSH private keys. ' +
        'Please generate a 32+ character random secret and define ENCRYPTION_KEY in your deployment environment.'
    );
  }

  // Development/Test fallback: generate ephemeral random key
  isEphemeralKey = true;
  const ephemeralSecret = crypto.randomBytes(32).toString('hex');
  derivedKey = crypto.scryptSync(ephemeralSecret, 'yachiru-credential-salt-2026', 32);

  console.warn(
    '\n================================================================================\n' +
      '[Yachiru Security Warning] ENCRYPTION_KEY is not defined in environment!\n' +
      'Generating an ephemeral random in-memory key for this development session.\n' +
      'Saved cluster credentials and SSH private keys will NOT decrypt across restarts.\n' +
      'Set ENCRYPTION_KEY in your .env or environment to persist encrypted credentials.\n' +
      '================================================================================\n'
  );

  return derivedKey;
}

/**
 * Encrypts sensitive credentials (SSH passwords, private keys, passphrases) using AES-256-GCM.
 * Output format: `iv:authTag:ciphertext` in base64.
 */
export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts AES-256-GCM encrypted credentials.
 */
export function decryptSecret(cipherString: string): string {
  if (!cipherString) return '';
  const parts = cipherString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format: Expected iv:authTag:ciphertext');
  }

  const [ivB64, tagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
