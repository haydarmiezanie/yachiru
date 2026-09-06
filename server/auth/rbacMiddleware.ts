import fs from 'fs';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../logger.js';

export type UserRole = 'admin' | 'auditor' | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'revoked' | 'rejected';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName?: string;
  authMethod: 'firebase_token' | 'api_key' | 'anonymous_dev';
}

// Extend Express Request interface to include user profile
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const DEFAULT_FIREBASE_CONFIG = {
  projectId: 'nifty-art-czp2g',
  firestoreDatabaseId: 'ai-studio-yachiruclickhous-d2e31be2-2e73-49b5-a7b3-25ca7280abb7',
  authDomain: 'nifty-art-czp2g.firebaseapp.com',
};

// Read Firebase applet configuration
let firebaseConfig: {
  projectId?: string;
  firestoreDatabaseId?: string;
  [key: string]: any;
} = { ...DEFAULT_FIREBASE_CONFIG };

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    firebaseConfig = { ...firebaseConfig, ...loaded };
  }
} catch (err) {
  logger.warn({ err }, 'Could not load firebase-applet-config.json, using embedded fallback');
}

const projectId = firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId;
const firestoreDatabaseId =
  (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : process.env.FIRESTORE_DATABASE_ID && process.env.FIRESTORE_DATABASE_ID !== '(default)'
    ? process.env.FIRESTORE_DATABASE_ID
    : DEFAULT_FIREBASE_CONFIG.firestoreDatabaseId);

// Designated Super Admin Email (always full Admin + Approved)
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'idarstore24@gmail.com').toLowerCase().trim();

// Initialize Firebase Admin App singleton
let adminApp: App;
try {
  const existingApps = getApps();
  if (existingApps.length === 0) {
    adminApp = initializeApp({
      projectId,
    });
    logger.info({ projectId }, 'Firebase Admin initialized successfully');
  } else {
    adminApp = existingApps[0]!;
  }
} catch (err) {
  logger.error({ err }, 'Failed to initialize Firebase Admin');
  adminApp = getApps()[0]!;
}

// Role hierarchy rank for strict RBAC enforcement
const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  auditor: 1,
  admin: 2,
};

/**
 * Returns the Firestore instance initialized under Firebase Admin, or null if unconfigured.
 */
export function getAdminFirestore(): ReturnType<typeof getFirestore> | null {
  try {
    if (!adminApp) return null;
    return firestoreDatabaseId ? getFirestore(adminApp, firestoreDatabaseId) : getFirestore(adminApp);
  } catch {
    return null;
  }
}

// In-memory profile cache with 30-second TTL to avoid database hammering
interface CachedProfile {
  user: AuthenticatedUser;
  expiresAt: number;
}
const profileCache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 30 * 1000;

/**
 * Helper to parse Firestore REST API response fields into a standard JavaScript object
 */
function parseFirestoreFields(fields: Record<string, any> = {}): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (!val || typeof val !== 'object') continue;
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = Number(val.doubleValue);
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.nullValue !== undefined) result[key] = null;
    else if (val.mapValue?.fields) result[key] = parseFirestoreFields(val.mapValue.fields);
  }
  return result;
}

let firestoreAdminAvailable: boolean | null = null;

/**
 * Retrieves the user profile, role, and approval status from Firestore.
 * Supports:
 * 1. Super Admin instant override
 * 2. In-memory TTL cache
 * 3. Firestore Admin SDK (with circuit breaker to prevent repeated 2s+ gRPC timeouts when IAM credentials are not present)
 * 4. Firestore REST API fallback (authenticated via the user's verified ID token with strict timeout)
 */
export async function fetchUserProfile(uid: string, idToken: string, email: string): Promise<AuthenticatedUser> {
  const normalizedEmail = (email || '').toLowerCase().trim();

  // Super Admin check: always full Admin & Approved
  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    return {
      uid,
      email: normalizedEmail,
      role: 'admin',
      status: 'approved',
      displayName: 'Super Administrator',
      authMethod: 'firebase_token',
    };
  }

  // Check cache
  const cached = profileCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.user;
  }

  // 1. Try Firestore Admin SDK (if circuit breaker has not marked it unavailable)
  if (firestoreAdminAvailable !== false) {
    try {
      const adminDb = firestoreDatabaseId ? getFirestore(adminApp, firestoreDatabaseId) : getFirestore(adminApp);
      const docPromise = adminDb.collection('users').doc(uid).get();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore Admin SDK timed out')), 1500)
      );

      const docSnap = await Promise.race([docPromise, timeoutPromise]);

      if (docSnap && docSnap.exists) {
        firestoreAdminAvailable = true;
        const data = docSnap.data() as any;
        const user: AuthenticatedUser = {
          uid,
          email: (data.email || normalizedEmail).toLowerCase().trim(),
          role: (data.role as UserRole) || 'viewer',
          status: (data.status as UserStatus) || 'pending',
          displayName: data.displayName || undefined,
          authMethod: 'firebase_token',
        };
        if (user.status === 'approved') {
          profileCache.set(uid, { user, expiresAt: Date.now() + CACHE_TTL_MS });
        }
        return user;
      }
    } catch (adminErr: any) {
      if (adminErr?.code === 7 || String(adminErr?.message || '').includes('PERMISSION_DENIED')) {
        firestoreAdminAvailable = false;
        logger.debug({ uid }, 'Firestore Admin SDK lacks IAM permissions, disabling Admin SDK and using REST API with ID token');
      } else {
        logger.debug({ err: adminErr.message, uid }, 'Firestore Admin SDK read bypassed, using REST API with ID token');
      }
    }
  }

  // 2. Comprehensive Firestore REST API resolution with user's verified ID token
  const dbSegment = firestoreDatabaseId ? firestoreDatabaseId : '(default)';
  const candidateProfiles: AuthenticatedUser[] = [];

  const parseUserDoc = (fields: any, fallbackUid: string): AuthenticatedUser | null => {
    if (!fields) return null;
    const parsed = parseFirestoreFields(fields);
    if (!parsed || Object.keys(parsed).length === 0) return null;
    return {
      uid,
      email: (parsed.email || normalizedEmail).toLowerCase().trim(),
      role: (parsed.role as UserRole) || 'viewer',
      status: (parsed.status as UserStatus) || 'pending',
      displayName: parsed.displayName || undefined,
      authMethod: 'firebase_token',
    };
  };

  // 2a. Direct doc lookup by UID
  try {
    const userDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents/users/${uid}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(userDocUrl, {
      headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const json = await resp.json();
      const prof = parseUserDoc(json.fields, uid);
      if (prof) candidateProfiles.push(prof);
    } else {
      logger.debug({ status: resp.status, uid }, 'Direct UID user document lookup status');
    }
  } catch (err: any) {
    logger.debug({ err: err.message, uid }, 'Direct UID user document lookup error');
  }

  // 2b. Direct doc lookup by invite ID (derived from pre-whitelisted email)
  if (normalizedEmail) {
    try {
      const cleanEmailKey = normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const inviteDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents/users/invite_${cleanEmailKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(inviteDocUrl, {
        headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const json = await resp.json();
        const prof = parseUserDoc(json.fields, uid);
        if (prof) {
          logger.info({ email: normalizedEmail, role: prof.role, status: prof.status }, 'Found pre-whitelisted invite document');
          candidateProfiles.push(prof);
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, email: normalizedEmail }, 'Invite document lookup error');
    }
  }

  // 2c. Structured query across users collection by email (catches any documents associated with this email)
  if (normalizedEmail && !candidateProfiles.some((p) => p.status === 'approved')) {
    try {
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents:runQuery`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const queryResp = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'email' },
                op: 'EQUAL',
                value: { stringValue: normalizedEmail },
              },
            },
            limit: 5,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (queryResp.ok) {
        const results = await queryResp.json();
        if (Array.isArray(results)) {
          for (const item of results) {
            if (item.document?.fields) {
              const prof = parseUserDoc(item.document.fields, uid);
              if (prof) candidateProfiles.push(prof);
            }
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, email: normalizedEmail }, 'Firestore runQuery by email error');
    }
  }

  // 2d. Structured query on access_requests collection (detects if an admin approved an access request)
  if (normalizedEmail && !candidateProfiles.some((p) => p.status === 'approved')) {
    try {
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents:runQuery`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const queryResp = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'access_requests' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'email' },
                op: 'EQUAL',
                value: { stringValue: normalizedEmail },
              },
            },
            limit: 5,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (queryResp.ok) {
        const results = await queryResp.json();
        if (Array.isArray(results)) {
          for (const item of results) {
            if (item.document?.fields) {
              const fields = parseFirestoreFields(item.document.fields);
              if (fields.status === 'approved') {
                candidateProfiles.push({
                  uid,
                  email: normalizedEmail,
                  role: 'auditor', // access requests grant auditor by default
                  status: 'approved',
                  displayName: fields.displayName || undefined,
                  authMethod: 'firebase_token',
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, email: normalizedEmail }, 'Firestore runQuery access_requests error');
    }
  }

  // Evaluate final role and status across candidate profiles:
  // If ANY record says approved, prioritize approved!
  const approvedCandidate = candidateProfiles.find((p) => p.status === 'approved');
  let finalUser: AuthenticatedUser;

  if (approvedCandidate) {
    // Determine highest role among approved candidates: admin > auditor > viewer
    let highestRole: UserRole = 'viewer';
    for (const c of candidateProfiles) {
      if (c.status === 'approved') {
        if (c.role === 'admin') {
          highestRole = 'admin';
          break;
        } else if (c.role === 'auditor') {
          highestRole = 'auditor';
        }
      }
    }

    finalUser = {
      uid,
      email: normalizedEmail,
      role: highestRole,
      status: 'approved',
      displayName: approvedCandidate.displayName,
      authMethod: 'firebase_token',
    };

    // Cache approved profiles for full TTL
    profileCache.set(uid, { user: finalUser, expiresAt: Date.now() + CACHE_TTL_MS });

    // Sync to users/{uid} in background so future reads are instantaneous
    const syncUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents/users/${uid}`;
    fetch(syncUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: uid },
          email: { stringValue: normalizedEmail },
          role: { stringValue: highestRole },
          status: { stringValue: 'approved' },
          displayName: { stringValue: finalUser.displayName || normalizedEmail.split('@')[0] },
          lastLoginAt: { stringValue: new Date().toISOString() },
        },
      }),
    }).catch(() => {});

    return finalUser;
  }

  // Check if explicitly revoked
  const revokedCandidate = candidateProfiles.find((p) => p.status === 'revoked');
  if (revokedCandidate) {
    finalUser = {
      uid,
      email: normalizedEmail,
      role: 'viewer',
      status: 'revoked',
      displayName: revokedCandidate.displayName,
      authMethod: 'firebase_token',
    };
    profileCache.set(uid, { user: finalUser, expiresAt: Date.now() + 5000 });
    return finalUser;
  }

  // Default fallback for pending or unprovisioned user: viewer + pending (cache only for 3s to allow instant approval pickup)
  const defaultUser: AuthenticatedUser = {
    uid,
    email: normalizedEmail,
    role: 'viewer',
    status: 'pending',
    authMethod: 'firebase_token',
  };
  profileCache.set(uid, { user: defaultUser, expiresAt: Date.now() + 3000 });
  return defaultUser;
}

/**
 * Resolves whether API key authentication is mandatory.
 * Default is TRUE in production (fail-closed by default).
 * In non-production, defaults to false unless explicitly configured to 'true'.
 */
export function isRequireApiKey(): boolean {
  if (process.env.REQUIRE_API_KEY !== undefined && process.env.REQUIRE_API_KEY.trim() !== '') {
    return process.env.REQUIRE_API_KEY.trim() === 'true';
  }
  // Default to true in production (fail-closed)
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolves whether strict authentication mode is active.
 * Default is TRUE in production (fail-closed by default).
 */
export function isStrictAuth(): boolean {
  if (process.env.STRICT_AUTH !== undefined && process.env.STRICT_AUTH.trim() !== '') {
    return process.env.STRICT_AUTH.trim() === 'true';
  }
  // Default to true in production
  return process.env.NODE_ENV === 'production';
}

/**
 * Timing-safe constant-time string comparison preventing side-channel timing attacks
 * in secret authentication verification (OWASP compliance).
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validates whether a candidate API key matches any key in allowedKeys
 * using constant-time string comparisons.
 */
export function matchesAllowedApiKey(candidate: string, allowedKeys: string[]): boolean {
  if (!candidate || !allowedKeys || allowedKeys.length === 0) {
    return false;
  }
  let matched = false;
  for (const key of allowedKeys) {
    if (safeCompare(candidate, key)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Core RBAC Middleware enforcing minimum role ('viewer' | 'auditor' | 'admin')
 * and strict user approval status on the server.
 */
export function requireRole(minRole: UserRole = 'viewer') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization?.trim() || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerApiKey = ((req.headers['x-api-key'] || req.headers['api-key']) as string)?.trim() || '';

    // 1. Prioritize Firebase ID Token Verification (End-User Session)
    if (bearerToken && bearerToken.split('.').length === 3) {
      let decoded: any;
      try {
        decoded = await getAuth(adminApp).verifyIdToken(bearerToken);
      } catch (tokenErr: any) {
        logger.warn({ err: tokenErr.message, path: req.path }, 'Firebase ID token verification failed');
        return res.status(401).json({
          error: 'Authentication failed: Invalid, expired, or revoked Firebase ID token.',
          code: 'INVALID_TOKEN',
          details: tokenErr.message,
        });
      }

      let profile: AuthenticatedUser;
      try {
        profile = await fetchUserProfile(decoded.uid, bearerToken, decoded.email || '');
      } catch (profileErr: any) {
        logger.error({ err: profileErr.message, uid: decoded.uid }, 'Error fetching user profile from database');
        // Graceful fallback: do not fail authentication, treat as viewer pending
        profile = {
          uid: decoded.uid,
          email: (decoded.email || '').toLowerCase().trim(),
          role: 'viewer',
          status: 'pending',
          authMethod: 'firebase_token',
        };
      }

      // Strict Status Check: user must be 'approved'
      if (profile.status !== 'approved') {
        logger.warn(
          { uid: decoded.uid, email: decoded.email, status: profile.status, path: req.path },
          'Access denied: User account is not approved'
        );
        return res.status(403).json({
          error: `Access denied: Your account status is "${profile.status}". An administrator must approve your access before performing this action.`,
          code: 'ACCOUNT_NOT_APPROVED',
          status: profile.status,
        });
      }

      // Strict Role Rank Check: user's role must meet or exceed minRole
      const userRank = ROLE_RANK[profile.role] ?? -1;
      const requiredRank = ROLE_RANK[minRole] ?? 99;

      if (userRank < requiredRank) {
        logger.warn(
          {
            uid: decoded.uid,
            email: decoded.email,
            userRole: profile.role,
            requiredRole: minRole,
            path: req.path,
            method: req.method,
          },
          'Access denied: Insufficient role'
        );
        return res.status(403).json({
          error: `Insufficient permissions: Endpoint requires "${minRole}" role, but your account role is "${profile.role}".`,
          code: 'INSUFFICIENT_ROLE',
          requiredRole: minRole,
          userRole: profile.role,
        });
      }

      // Attach authenticated user to request context
      req.user = profile;
      return next();
    }

    // 2. Fallback: Machine Service Account API Key (For automated scripts & CI/CD pipelines)
    const secretKeyEnv = (process.env.YACHIRU_API_KEY || process.env.API_SECRET_KEY || '').trim();
    const allowedKeys = secretKeyEnv
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const candidateApiKey = headerApiKey || (bearerToken && bearerToken.split('.').length !== 3 ? bearerToken : '');

    if (candidateApiKey && matchesAllowedApiKey(candidateApiKey, allowedKeys)) {
      req.user = {
        uid: 'machine-service-account',
        email: 'system@yachiru.internal',
        role: 'admin',
        status: 'approved',
        displayName: 'Machine API Key',
        authMethod: 'api_key',
      };
      return next();
    }

    // 3. Open Development Mode (Only when no keys configured, strictly in non-production, and ONLY for viewer-level endpoints)
    const requireApiKey = isRequireApiKey();
    const strictAuth = isStrictAuth();

    if (
      allowedKeys.length === 0 &&
      !requireApiKey &&
      !strictAuth &&
      process.env.NODE_ENV !== 'production' &&
      minRole === 'viewer'
    ) {
      logger.debug({ path: req.path }, 'Development mode: Unauthenticated request granted viewer access');
      req.user = {
        uid: 'dev-anonymous',
        email: 'dev@localhost',
        role: 'viewer',
        status: 'approved',
        displayName: 'Local Dev Viewer',
        authMethod: 'anonymous_dev',
      };
      return next();
    }

    // 4. Unauthorized
    logger.warn({ ip: req.ip, path: req.path }, 'Unauthorized API access attempt');
    return res.status(401).json({
      error: 'Unauthorized: Authentication required. Provide a valid Firebase ID token in "Authorization: Bearer <token>" or a machine API key in "x-api-key".',
      code: 'AUTH_REQUIRED',
    });
  };
}
