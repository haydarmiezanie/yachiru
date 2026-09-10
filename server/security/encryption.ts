import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits auth tag

let derivedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;

  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    process.env.FIREBASE_PROJECT_ID ||
    'yachiru-production-ssh-credential-encryption-key-v1';

  // Use scrypt to securely derive a 32-byte (256-bit) key from the secret string
  derivedKey = crypto.scryptSync(secret, 'yachiru-credential-salt-2026', 32);
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
