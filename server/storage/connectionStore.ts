import fs from 'fs';
import path from 'path';
import { getAdminFirestore } from '../auth/rbacMiddleware.js';
import { isFirestoreEnabled, setFirestoreBlocked } from './firestoreGuard.js';
import { encryptSecret, decryptSecret } from '../security/encryption.js';
import { ScanTarget, SavedClusterConnection, SshTunnelConfig } from '../../src/types/yachiru.js';
import { logger } from '../logger.js';

export interface StoredConnectionDocument {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  protocol?: 'http' | 'https';
  lookbackDays?: number;
  passwordEncrypted?: string;
  sshTunnel?: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey';
    passwordEncrypted?: string;
    privateKeyEncrypted?: string;
    passphraseEncrypted?: string;
  };
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

const LOCAL_CONNECTIONS_DIR = path.resolve(process.cwd(), 'data', 'connections');

function ensureDir(): void {
  if (!fs.existsSync(LOCAL_CONNECTIONS_DIR)) {
    fs.mkdirSync(LOCAL_CONNECTIONS_DIR, { recursive: true });
  }
}

function getLocalFilePath(id: string): string {
  ensureDir();
  return path.join(LOCAL_CONNECTIONS_DIR, `${id}.json`);
}

/**
 * Saves a cluster connection. All sensitive credentials (ClickHouse password,
 * SSH password, SSH privateKey, SSH passphrase) are encrypted with AES-256-GCM.
 */
export async function saveConnection(
  id: string,
  name: string,
  target: ScanTarget,
  userId?: string
): Promise<SavedClusterConnection> {
  const now = new Date().toISOString();

  const doc: StoredConnectionDocument = {
    id,
    name: name.trim(),
    host: target.host.trim(),
    port: target.port || 8123,
    database: target.database || 'default',
    user: target.user || 'default',
    protocol: target.protocol || 'http',
    lookbackDays: target.lookbackDays || 7,
    passwordEncrypted: target.password ? encryptSecret(target.password) : undefined,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  if (target.sshTunnel) {
    doc.sshTunnel = {
      enabled: Boolean(target.sshTunnel.enabled),
      host: target.sshTunnel.host.trim(),
      port: target.sshTunnel.port || 22,
      username: target.sshTunnel.username.trim(),
      authMethod: target.sshTunnel.authMethod,
      passwordEncrypted: target.sshTunnel.password ? encryptSecret(target.sshTunnel.password) : undefined,
      privateKeyEncrypted: target.sshTunnel.privateKey ? encryptSecret(target.sshTunnel.privateKey) : undefined,
      passphraseEncrypted: target.sshTunnel.passphrase ? encryptSecret(target.sshTunnel.passphrase) : undefined,
    };
  }

  // Save to local filesystem
  try {
    fs.writeFileSync(getLocalFilePath(id), JSON.stringify(doc, null, 2), 'utf-8');
  } catch (err: any) {
    logger.warn({ err: err?.message, id }, 'Failed to save connection to local file');
  }

  // Save to Firestore (only when explicitly enabled)
  if (isFirestoreEnabled('connections')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        await db.collection('connections').doc(id).set(doc);
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
        logger.warn({ err: err?.message, id }, 'Failed to persist connection to Firestore');
      }
    }
  }

  return sanitizeConnectionForClient(doc);
}

/**
 * Updates an existing connection.
 */
export async function updateConnection(
  id: string,
  name: string,
  target: ScanTarget,
  userId?: string
): Promise<SavedClusterConnection> {
  const existing = await getStoredConnection(id);
  const now = new Date().toISOString();

  // If password was omitted or empty in update request, retain existing encrypted password
  let passwordEncrypted = existing?.passwordEncrypted;
  if (target.password) {
    passwordEncrypted = encryptSecret(target.password);
  }

  const doc: StoredConnectionDocument = {
    id,
    name: name.trim(),
    host: target.host.trim(),
    port: target.port || 8123,
    database: target.database || 'default',
    user: target.user || 'default',
    protocol: target.protocol || 'http',
    lookbackDays: target.lookbackDays || 7,
    passwordEncrypted,
    createdBy: existing?.createdBy || userId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (target.sshTunnel) {
    let sshPassEncrypted = existing?.sshTunnel?.passwordEncrypted;
    if (target.sshTunnel.password) {
      sshPassEncrypted = encryptSecret(target.sshTunnel.password);
    }

    let sshKeyEncrypted = existing?.sshTunnel?.privateKeyEncrypted;
    if (target.sshTunnel.privateKey) {
      sshKeyEncrypted = encryptSecret(target.sshTunnel.privateKey);
    }

    let sshPassphraseEncrypted = existing?.sshTunnel?.passphraseEncrypted;
    if (target.sshTunnel.passphrase) {
      sshPassphraseEncrypted = encryptSecret(target.sshTunnel.passphrase);
    }

    doc.sshTunnel = {
      enabled: Boolean(target.sshTunnel.enabled),
      host: target.sshTunnel.host.trim(),
      port: target.sshTunnel.port || 22,
      username: target.sshTunnel.username.trim(),
      authMethod: target.sshTunnel.authMethod,
      passwordEncrypted: sshPassEncrypted,
      privateKeyEncrypted: sshKeyEncrypted,
      passphraseEncrypted: sshPassphraseEncrypted,
    };
  }

  // Save to local filesystem
  try {
    fs.writeFileSync(getLocalFilePath(id), JSON.stringify(doc, null, 2), 'utf-8');
  } catch (err: any) {
    logger.warn({ err: err?.message, id }, 'Failed to save updated connection to local file');
  }

  // Save to Firestore (only when explicitly enabled)
  if (isFirestoreEnabled('connections')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        await db.collection('connections').doc(id).set(doc);
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
        logger.warn({ err: err?.message, id }, 'Failed to update connection in Firestore');
      }
    }
  }

  return sanitizeConnectionForClient(doc);
}

/**
 * Retrieves raw stored connection document with encrypted credentials (internal use only).
 */
export async function getStoredConnection(id: string): Promise<StoredConnectionDocument | null> {
  const filePath = getLocalFilePath(id);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as StoredConnectionDocument;
    } catch {}
  }

  if (isFirestoreEnabled('connections')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        const doc = await db.collection('connections').doc(id).get();
        if (doc.exists) {
          return doc.data() as StoredConnectionDocument;
        }
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
      }
    }
  }

  return null;
}

/**
 * Retrieves a connection and decrypts credentials into a live ScanTarget for scanner execution.
 */
export async function resolveConnectionForScan(id: string): Promise<ScanTarget | null> {
  const stored = await getStoredConnection(id);
  if (!stored) return null;

  const target: ScanTarget = {
    host: stored.host,
    port: stored.port,
    database: stored.database,
    user: stored.user,
    protocol: stored.protocol,
    lookbackDays: stored.lookbackDays,
    password: stored.passwordEncrypted ? decryptSecret(stored.passwordEncrypted) : '',
  };

  if (stored.sshTunnel && stored.sshTunnel.enabled) {
    target.sshTunnel = {
      enabled: true,
      host: stored.sshTunnel.host,
      port: stored.sshTunnel.port,
      username: stored.sshTunnel.username,
      authMethod: stored.sshTunnel.authMethod,
      password: stored.sshTunnel.passwordEncrypted
        ? decryptSecret(stored.sshTunnel.passwordEncrypted)
        : undefined,
      privateKey: stored.sshTunnel.privateKeyEncrypted
        ? decryptSecret(stored.sshTunnel.privateKeyEncrypted)
        : undefined,
      passphrase: stored.sshTunnel.passphraseEncrypted
        ? decryptSecret(stored.sshTunnel.passphraseEncrypted)
        : undefined,
    };
  }

  return target;
}

/**
 * Strips all secrets and encrypted strings, returning safe representation for client UI.
 */
export function sanitizeConnectionForClient(doc: StoredConnectionDocument): SavedClusterConnection {
  const target: ScanTarget = {
    host: doc.host,
    port: doc.port,
    database: doc.database,
    user: doc.user,
    protocol: doc.protocol,
    lookbackDays: doc.lookbackDays,
    sshTunnel: doc.sshTunnel
      ? {
          enabled: doc.sshTunnel.enabled,
          host: doc.sshTunnel.host,
          port: doc.sshTunnel.port,
          username: doc.sshTunnel.username,
          authMethod: doc.sshTunnel.authMethod,
        }
      : undefined,
  };

  return {
    id: doc.id,
    name: doc.name,
    host: doc.host,
    port: doc.port,
    database: doc.database,
    user: doc.user,
    protocol: doc.protocol,
    lookbackDays: doc.lookbackDays,
    passwordConfigured: Boolean(doc.passwordEncrypted),
    sshTunnel: doc.sshTunnel
      ? {
          enabled: doc.sshTunnel.enabled,
          host: doc.sshTunnel.host,
          port: doc.sshTunnel.port,
          username: doc.sshTunnel.username,
          authMethod: doc.sshTunnel.authMethod,
          passwordConfigured: Boolean(doc.sshTunnel.passwordEncrypted),
          privateKeyConfigured: Boolean(doc.sshTunnel.privateKeyEncrypted),
          passphraseConfigured: Boolean(doc.sshTunnel.passphraseEncrypted),
        }
      : undefined,
    target,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Lists all connections with secrets stripped.
 */
export async function listSavedConnections(): Promise<SavedClusterConnection[]> {
  ensureDir();
  const map = new Map<string, StoredConnectionDocument>();

  // Read local directory
  try {
    const files = fs.readdirSync(LOCAL_CONNECTIONS_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const fullPath = path.join(LOCAL_CONNECTIONS_DIR, f);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const doc: StoredConnectionDocument = JSON.parse(content);
        if (doc && doc.id) {
          map.set(doc.id, doc);
        }
      }
    }
  } catch {}

  // Read Firestore (only when explicitly enabled)
  if (isFirestoreEnabled('connections')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        const snap = await db.collection('connections').get();
        snap.forEach((d) => {
          const doc = d.data() as StoredConnectionDocument;
          if (doc && doc.id) {
            map.set(doc.id, doc);
          }
        });
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
      }
    }
  }

  return Array.from(map.values()).map(sanitizeConnectionForClient);
}

/**
 * Deletes a connection.
 */
export async function deleteConnection(id: string): Promise<boolean> {
  let deleted = false;
  const filePath = getLocalFilePath(id);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      deleted = true;
    } catch {}
  }

  if (isFirestoreEnabled('connections')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        await db.collection('connections').doc(id).delete();
        deleted = true;
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
      }
    }
  }

  return deleted;
}
