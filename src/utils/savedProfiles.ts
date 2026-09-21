import { SavedConnectionProfile } from '../types.js';

export type { SavedConnectionProfile };

export const STORAGE_KEY = 'yachiru_saved_profiles';

/**
 * Safely retrieves window.localStorage, handling environments where
 * accessing window.localStorage throws (sandboxed iframes, private browsing, disabled cookies).
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access denied / disabled storage
  }
  return null;
}

/**
 * Validates and extracts ONLY allowed non-secret fields from an untrusted profile entry.
 * Silently drops invalid entries (missing id, name, or host) and strips any unexpected fields.
 */
function sanitizeProfileEntry(item: unknown): SavedConnectionProfile | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const host = typeof record.host === 'string' ? record.host.trim() : '';

  // Minimal validation: requires valid non-empty id, name, and host
  if (!id || !name || !host) {
    return null;
  }

  const rawPort = Number(record.port);
  const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 8123;
  const protocol = record.protocol === 'https' ? 'https' : 'http';
  const database = typeof record.database === 'string' ? record.database.trim() : 'default';
  const username = typeof record.username === 'string' ? record.username.trim() : 'default';
  const createdAt = typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : new Date().toISOString();
  const lastUsedAt = typeof record.lastUsedAt === 'string' && record.lastUsedAt ? record.lastUsedAt : undefined;

  const useSshTunnel = Boolean(record.useSshTunnel);
  let sshHost: string | undefined;
  let sshPort: number | undefined;
  let sshUsername: string | undefined;
  let sshAuthMethod: 'password' | 'privateKey' | undefined;

  if (useSshTunnel) {
    sshHost = typeof record.sshHost === 'string' ? record.sshHost.trim() : undefined;
    const rawSshPort = Number(record.sshPort);
    sshPort = Number.isFinite(rawSshPort) && rawSshPort > 0 ? rawSshPort : 22;
    sshUsername = typeof record.sshUsername === 'string' ? record.sshUsername.trim() : undefined;
    sshAuthMethod = record.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password';
  }

  const enableHistoryTracking = Boolean(record.enableHistoryTracking);
  let historyDatabase: string | undefined;
  let historyTableName: string | undefined;
  let historyWriteUsername: string | undefined;

  if (enableHistoryTracking) {
    historyDatabase = typeof record.historyDatabase === 'string' ? record.historyDatabase.trim() : undefined;
    historyTableName = typeof record.historyTableName === 'string' ? record.historyTableName.trim() : undefined;
    historyWriteUsername = typeof record.historyWriteUsername === 'string' ? record.historyWriteUsername.trim() : undefined;
  }

  // Strictly construct new object literal with ONLY allowlisted non-secret fields
  return {
    id,
    name,
    host,
    port,
    protocol,
    database,
    username,
    useSshTunnel,
    ...(sshHost !== undefined && { sshHost }),
    ...(sshPort !== undefined && { sshPort }),
    ...(sshUsername !== undefined && { sshUsername }),
    ...(sshAuthMethod !== undefined && { sshAuthMethod }),
    ...(enableHistoryTracking && {
      enableHistoryTracking: true,
      ...(historyDatabase !== undefined && { historyDatabase }),
      ...(historyTableName !== undefined && { historyTableName }),
      ...(historyWriteUsername !== undefined && { historyWriteUsername }),
    }),
    createdAt,
    ...(lastUsedAt !== undefined && { lastUsedAt }),
  };
}

/**
 * Reads and parses saved connection profiles from localStorage.
 * Defensive against storage unavailability, JSON parsing failures, and corrupted entries.
 */
export function listSavedProfiles(): SavedConnectionProfile[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const validProfiles: SavedConnectionProfile[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeProfileEntry(item);
      if (sanitized) {
        validProfiles.push(sanitized);
      }
    }

    return validProfiles;
  } catch {
    return [];
  }
}

/**
 * Saves a connection profile using an explicit allowlist of non-secret fields.
 * If existingId matches an existing profile, updates it in place preserving createdAt.
 * Otherwise creates a new profile with a fresh id and createdAt.
 * Throws an Error if localStorage write fails (e.g. storage disabled or quota exceeded).
 */
export function saveProfile(
  profile: Omit<SavedConnectionProfile, 'id' | 'createdAt'>,
  existingId?: string
): SavedConnectionProfile {
  const storage = getStorage();
  if (!storage) {
    throw new Error('Local browser storage is unavailable or disabled.');
  }

  const existingList = listSavedProfiles();
  const nowIso = new Date().toISOString();

  let targetId = existingId;
  let createdAt = nowIso;
  let lastUsedAt: string | undefined;

  const existingIndex = existingId ? existingList.findIndex((p) => p.id === existingId) : -1;

  if (existingIndex >= 0) {
    const existing = existingList[existingIndex];
    targetId = existing.id;
    createdAt = existing.createdAt;
    lastUsedAt = existing.lastUsedAt;
  } else {
    // Generate UUID or fallback for non-secure contexts
    targetId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `prof_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Explicit field-by-field allowlist creation - NO passwords, NO API keys, NO private keys
  const newProfile: SavedConnectionProfile = {
    id: targetId,
    name: profile.name.trim(),
    host: profile.host.trim(),
    port: Number(profile.port) || 8123,
    protocol: profile.protocol === 'https' ? 'https' : 'http',
    database: profile.database.trim() || 'default',
    username: profile.username.trim() || 'default',
    useSshTunnel: Boolean(profile.useSshTunnel),
    createdAt,
    ...(lastUsedAt ? { lastUsedAt } : {}),
  };

  if (profile.useSshTunnel) {
    if (profile.sshHost) newProfile.sshHost = profile.sshHost.trim();
    newProfile.sshPort = Number(profile.sshPort) || 22;
    if (profile.sshUsername) newProfile.sshUsername = profile.sshUsername.trim();
    newProfile.sshAuthMethod = profile.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password';
  }

  if (profile.enableHistoryTracking) {
    newProfile.enableHistoryTracking = true;
    if (profile.historyDatabase) newProfile.historyDatabase = profile.historyDatabase.trim();
    if (profile.historyTableName) newProfile.historyTableName = profile.historyTableName.trim();
    if (profile.historyWriteUsername) newProfile.historyWriteUsername = profile.historyWriteUsername.trim();
  }

  let updatedList: SavedConnectionProfile[];
  if (existingIndex >= 0) {
    updatedList = [...existingList];
    updatedList[existingIndex] = newProfile;
  } else {
    updatedList = [...existingList, newProfile];
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
  } catch (err) {
    throw new Error(`Failed to save connection profile to localStorage: ${err instanceof Error ? err.message : 'Storage quota exceeded'}`);
  }

  return newProfile;
}

/**
 * Removes a saved profile by id.
 */
export function deleteProfile(id: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const existingList = listSavedProfiles();
    const updatedList = existingList.filter((p) => p.id !== id);
    storage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
  } catch {
    // Graceful catch for storage write errors
  }
}

/**
 * Updates lastUsedAt timestamp for the given profile id.
 */
export function touchProfileLastUsed(id: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const existingList = listSavedProfiles();
    const profile = existingList.find((p) => p.id === id);
    if (!profile) return;

    profile.lastUsedAt = new Date().toISOString();
    storage.setItem(STORAGE_KEY, JSON.stringify(existingList));
  } catch {
    // Graceful catch for storage write errors
  }
}

/**
 * Explicit allowlist constructor for extracting non-secret fields from connection form state.
 * Structurally guarantees that no password, API key, or SSH secret is ever read or included.
 */
export function extractProfileFromFormState(input: {
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  database: string;
  username: string;
  useSshTunnel?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: 'password' | 'privateKey';
  enableHistoryTracking?: boolean;
  historyDatabase?: string;
  historyTableName?: string;
  historyWriteUsername?: string;
}): Omit<SavedConnectionProfile, 'id' | 'createdAt'> {
  return {
    name: input.name.trim(),
    host: input.host.trim(),
    port: Number(input.port) || 8123,
    protocol: input.protocol === 'https' ? 'https' : 'http',
    database: input.database.trim() || 'default',
    username: input.username.trim() || 'default',
    useSshTunnel: Boolean(input.useSshTunnel),
    sshHost: input.sshHost ? input.sshHost.trim() : undefined,
    sshPort: input.sshPort ? Number(input.sshPort) : 22,
    sshUsername: input.sshUsername ? input.sshUsername.trim() : undefined,
    sshAuthMethod: input.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password',
    enableHistoryTracking: Boolean(input.enableHistoryTracking),
    historyDatabase: input.historyDatabase ? input.historyDatabase.trim() : undefined,
    historyTableName: input.historyTableName ? input.historyTableName.trim() : undefined,
    historyWriteUsername: input.historyWriteUsername ? input.historyWriteUsername.trim() : undefined,
  };
}
