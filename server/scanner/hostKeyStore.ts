import fs from 'fs';
import path from 'path';
import { getAdminFirestore } from '../auth/rbacMiddleware.js';
import { isFirestoreEnabled, setFirestoreBlocked } from '../storage/firestoreGuard.js';
import { logger } from '../logger.js';

export interface SshHostKeyRecord {
  hostKeyId: string; // `${host}:${port}`
  host: string;
  port: number;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

const LOCAL_KNOWN_HOSTS_PATH = path.resolve(process.cwd(), 'data', 'ssh_known_hosts.json');

// In-memory cache for fast lookup
const localCache = new Map<string, SshHostKeyRecord>();
let cacheInitialized = false;

function makeHostKeyId(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}

function ensureLocalFileDir(): void {
  const dir = path.dirname(LOCAL_KNOWN_HOSTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadLocalFile(): void {
  if (cacheInitialized) return;
  try {
    ensureLocalFileDir();
    if (fs.existsSync(LOCAL_KNOWN_HOSTS_PATH)) {
      const content = fs.readFileSync(LOCAL_KNOWN_HOSTS_PATH, 'utf-8');
      const data: SshHostKeyRecord[] = JSON.parse(content);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.hostKeyId) {
            localCache.set(item.hostKeyId, item);
          }
        }
      }
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Failed to load local ssh_known_hosts.json');
  } finally {
    cacheInitialized = true;
  }
}

function saveLocalFile(): void {
  try {
    ensureLocalFileDir();
    const list = Array.from(localCache.values());
    fs.writeFileSync(LOCAL_KNOWN_HOSTS_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Failed to save local ssh_known_hosts.json');
  }
}

/**
 * Retrieves a known host key record for the specified host:port.
 */
export async function getHostKeyRecord(host: string, port: number): Promise<SshHostKeyRecord | null> {
  loadLocalFile();
  const id = makeHostKeyId(host, port);

  // Check local cache first
  if (localCache.has(id)) {
    return localCache.get(id) || null;
  }

  // Check Firestore (only when explicitly enabled)
  if (isFirestoreEnabled('host_keys')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        const doc = await db.collection('ssh_host_keys').doc(id).get();
        if (doc.exists) {
          const data = doc.data() as SshHostKeyRecord;
          localCache.set(id, data);
          saveLocalFile();
          return data;
        }
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
        logger.warn({ err: err?.message, host, port }, 'Failed to query Firestore for ssh_host_keys');
      }
    }
  }

  return null;
}

/**
 * Trust-On-First-Use (TOFU) host key verification logic:
 * 1. If host:port has not been seen before, records fingerprint as trusted.
 * 2. If already seen and fingerprint matches, updates lastSeenAt.
 * 3. If already seen and fingerprint differs, returns 'mismatch' (potential MITM attack).
 */
export async function verifyOrRecordHostKey(
  host: string,
  port: number,
  fingerprint: string
): Promise<{
  action: 'trusted_first_use' | 'matched' | 'mismatch';
  storedFingerprint?: string;
}> {
  loadLocalFile();
  const id = makeHostKeyId(host, port);
  const existing = await getHostKeyRecord(host, port);
  const now = new Date().toISOString();

  if (!existing) {
    // First time seeing this host:port -> Trust On First Use (TOFU)
    const record: SshHostKeyRecord = {
      hostKeyId: id,
      host: host.trim().toLowerCase(),
      port,
      fingerprint,
      firstSeenAt: now,
      lastSeenAt: now,
    };

    localCache.set(id, record);
    saveLocalFile();

    if (isFirestoreEnabled('host_keys')) {
      const db = getAdminFirestore();
      if (db) {
        try {
          await db.collection('ssh_host_keys').doc(id).set(record);
        } catch (err: any) {
          if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
            setFirestoreBlocked(true);
          }
          logger.warn({ err: err?.message, host, port }, 'Failed to persist ssh_host_key to Firestore');
        }
      }
    }

    logger.info({ host, port, fingerprint }, 'SSH host key trusted on first use (TOFU)');
    return { action: 'trusted_first_use' };
  }

  // Check if fingerprint matches stored fingerprint
  if (existing.fingerprint === fingerprint) {
    existing.lastSeenAt = now;
    localCache.set(id, existing);
    saveLocalFile();

    if (isFirestoreEnabled('host_keys')) {
      const db = getAdminFirestore();
      if (db) {
        try {
          await db.collection('ssh_host_keys').doc(id).update({ lastSeenAt: now });
        } catch {}
      }
    }

    return { action: 'matched' };
  }

  // Mismatch detected! Potential MITM attack or replaced server
  logger.warn(
    {
      host,
      port,
      storedFingerprint: existing.fingerprint,
      receivedFingerprint: fingerprint,
    },
    'SSH host key fingerprint mismatch! Rejecting connection for security.'
  );

  return {
    action: 'mismatch',
    storedFingerprint: existing.fingerprint,
  };
}

/**
 * Admin explicit action to re-trust or replace a host key after verifying server authenticity.
 */
export async function retrustHostKey(host: string, port: number, newFingerprint?: string): Promise<void> {
  loadLocalFile();
  const id = makeHostKeyId(host, port);
  const now = new Date().toISOString();

  if (newFingerprint) {
    const record: SshHostKeyRecord = {
      hostKeyId: id,
      host: host.trim().toLowerCase(),
      port,
      fingerprint: newFingerprint,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    localCache.set(id, record);
    saveLocalFile();

    if (isFirestoreEnabled('host_keys')) {
      const db = getAdminFirestore();
      if (db) {
        try {
          await db.collection('ssh_host_keys').doc(id).set(record);
        } catch (err: any) {
          if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
            setFirestoreBlocked(true);
          }
          logger.warn({ err: err?.message, host, port }, 'Failed to persist re-trusted ssh_host_key to Firestore');
        }
      }
    }
  } else {
    // Delete existing entry so next connection will trigger TOFU
    localCache.delete(id);
    saveLocalFile();

    if (isFirestoreEnabled('host_keys')) {
      const db = getAdminFirestore();
      if (db) {
        try {
          await db.collection('ssh_host_keys').doc(id).delete();
        } catch (err: any) {
          if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
            setFirestoreBlocked(true);
          }
          logger.warn({ err: err?.message, host, port }, 'Failed to delete ssh_host_key from Firestore');
        }
      }
    }
  }

  logger.info({ host, port, newFingerprint: newFingerprint || '(cleared for TOFU)' }, 'SSH host key re-trusted by admin');
}

/**
 * Lists all known SSH host key records (for admin inspection).
 */
export async function getAllHostKeys(): Promise<SshHostKeyRecord[]> {
  loadLocalFile();
  if (isFirestoreEnabled('host_keys')) {
    const db = getAdminFirestore();
    if (db) {
      try {
        const snapshot = await db.collection('ssh_host_keys').get();
        snapshot.forEach((doc) => {
          const item = doc.data() as SshHostKeyRecord;
          if (item && item.hostKeyId) {
            localCache.set(item.hostKeyId, item);
          }
        });
        saveLocalFile();
      } catch (err: any) {
        if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('default credentials')) {
          setFirestoreBlocked(true);
        }
      }
    }
  }
  return Array.from(localCache.values());
}

/**
 * Helper for verifying host key via TOFU contract in tests or external checkers.
 */
export async function verifyHostKeyTofu(
  host: string,
  port: number,
  fingerprint: string
): Promise<{ trusted: boolean; isFirstUse?: boolean; reason?: string }> {
  const res = await verifyOrRecordHostKey(host, port, fingerprint);
  if (res.action === 'trusted_first_use') {
    return { trusted: true, isFirstUse: true };
  }
  if (res.action === 'matched') {
    return { trusted: true, isFirstUse: false };
  }
  return {
    trusted: false,
    reason: `POSSIBLE SSH HOST KEY MAN-IN-THE-MIDDLE ATTACK! Host key fingerprint for ${host}:${port} differs from recorded fingerprint (${res.storedFingerprint}).`,
  };
}

/**
 * Resets memory cache and local test file for unit tests.
 */
export function resetHostKeysForTesting(): void {
  localCache.clear();
  cacheInitialized = false;
  if (fs.existsSync(LOCAL_KNOWN_HOSTS_PATH)) {
    try {
      fs.unlinkSync(LOCAL_KNOWN_HOSTS_PATH);
    } catch {}
  }
}

