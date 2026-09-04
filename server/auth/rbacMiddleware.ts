import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../logger.js';

export type UserRole = 'admin' | 'auditor' | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'rejected';

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

// Read Firebase applet configuration
let firebaseConfig: {
  projectId?: string;
  firestoreDatabaseId?: string;
  [key: string]: any;
} = {};

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (err) {
  logger.warn({ err }, 'Could not load firebase-applet-config.json');
}

const projectId = firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || 'nifty-art-czp2g';
const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? firebaseConfig.firestoreDatabaseId
  : undefined;

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

/**
 * Retrieves the user profile, role, and approval status from Firestore.
 * Supports:
 * 1. Super Admin instant override
 * 2. In-memory TTL cache
 * 3. Firestore Admin SDK (when service account / ADC has IAM permissions)
 * 4. Firestore REST API fallback (authenticated via the user's verified ID token)
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

  // 1. Try Firestore Admin SDK
  try {
    const adminDb = firestoreDatabaseId ? getFirestore(adminApp, firestoreDatabaseId) : getFirestore(adminApp);
    const docSnap = await adminDb.collection('users').doc(uid).get();

    if (docSnap.exists) {
      const data = docSnap.data() as any;
      const user: AuthenticatedUser = {
        uid,
        email: (data.email || normalizedEmail).toLowerCase().trim(),
        role: (data.role as UserRole) || 'viewer',
        status: (data.status as UserStatus) || 'pending',
        displayName: data.displayName || undefined,
        authMethod: 'firebase_token',
      };
      profileCache.set(uid, { user, expiresAt: Date.now() + CACHE_TTL_MS });
      return user;
    }
  } catch (adminErr: any) {
    // Expected in container environments where service account IAM does not grant direct Firestore access
    logger.debug({ err: adminErr.message, uid }, 'Firestore Admin SDK read bypassed, using REST API with ID token');
  }

  // 2. Fallback to Firestore REST API with the user's verified ID token
  try {
    const dbSegment = firestoreDatabaseId ? firestoreDatabaseId : '(default)';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbSegment}/documents/users/${uid}`;

    const resp = await fetch(firestoreUrl, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: 'application/json',
      },
    });

    if (resp.ok) {
      const json = await resp.json();
      const fields = parseFirestoreFields(json.fields || {});
      const user: AuthenticatedUser = {
        uid,
        email: (fields.email || normalizedEmail).toLowerCase().trim(),
        role: (fields.role as UserRole) || 'viewer',
        status: (fields.status as UserStatus) || 'pending',
        displayName: fields.displayName || undefined,
        authMethod: 'firebase_token',
      };
      profileCache.set(uid, { user, expiresAt: Date.now() + CACHE_TTL_MS });
      return user;
    }
  } catch (restErr: any) {
    logger.warn({ err: restErr.message, uid }, 'Firestore REST API fallback request failed');
  }

  // Default fallback for newly registered or unprovisioned user: viewer + pending
  const defaultUser: AuthenticatedUser = {
    uid,
    email: normalizedEmail,
    role: 'viewer',
    status: 'pending',
    authMethod: 'firebase_token',
  };
  return defaultUser;
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
      try {
        const decoded = await getAuth(adminApp).verifyIdToken(bearerToken);
        const profile = await fetchUserProfile(decoded.uid, bearerToken, decoded.email || '');

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
      } catch (tokenErr: any) {
        logger.warn({ err: tokenErr.message, path: req.path }, 'Firebase ID token verification failed');
        return res.status(401).json({
          error: 'Authentication failed: Invalid, expired, or revoked Firebase ID token.',
          code: 'INVALID_TOKEN',
          details: tokenErr.message,
        });
      }
    }

    // 2. Fallback: Machine Service Account API Key (For automated scripts & CI/CD pipelines)
    const secretKeyEnv = (process.env.YACHIRU_API_KEY || process.env.API_SECRET_KEY || '').trim();
    const allowedKeys = secretKeyEnv
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const candidateApiKey = headerApiKey || (bearerToken && bearerToken.split('.').length !== 3 ? bearerToken : '');

    if (candidateApiKey && allowedKeys.length > 0 && allowedKeys.includes(candidateApiKey)) {
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
    if (
      allowedKeys.length === 0 &&
      process.env.REQUIRE_API_KEY !== 'true' &&
      process.env.STRICT_AUTH !== 'true' &&
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
