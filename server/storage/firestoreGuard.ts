import { logger } from '../logger.js';

let firestoreBlocked = false;

/**
 * Manually marks Firestore access as blocked for the process lifecycle.
 * Used as a circuit-breaker when credential errors or permission denied occurs.
 */
export function setFirestoreBlocked(blocked = true): void {
  firestoreBlocked = blocked;
}

/**
 * Evaluates whether Cloud Firestore operations should be executed.
 *
 * Gating Rules:
 * 1. Circuit breaker: if previously blocked by ADC / permission failure, returns false.
 * 2. Test/CI gating: during vitest / test / CI environments, returns false unless FORCE_FIRESTORE_TEST === 'true'.
 * 3. Explicit opt-in: requires USE_FIRESTORE === 'true' or feature-specific flag.
 *
 * In self-hosted or Docker deployments where Firebase Admin credentials are not configured,
 * this prevents unhandled promise rejections, 5-second credential resolution timeouts,
 * and allows subsystems (scan history, connections, host keys) to degrade gracefully to local file storage.
 */
export function isFirestoreEnabled(
  feature?: 'history' | 'connections' | 'host_keys',
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (firestoreBlocked) {
    return false;
  }

  // Always disable Firestore network calls during automated test suites unless explicitly forced
  if (
    (env.NODE_ENV === 'test' || Boolean(env.VITEST) || Boolean(env.CI)) &&
    env.FORCE_FIRESTORE_TEST !== 'true'
  ) {
    return false;
  }

  // Global opt-in
  if (env.USE_FIRESTORE === 'true' || env.USE_FIRESTORE_STORAGE === 'true') {
    return true;
  }

  // Subsystem specific opt-ins
  if ((feature === 'history' || !feature) && env.USE_FIRESTORE_HISTORY === 'true') {
    return true;
  }
  if (feature === 'connections' && env.USE_FIRESTORE_CONNECTIONS === 'true') {
    return true;
  }
  if (feature === 'host_keys' && env.USE_FIRESTORE_HOST_KEYS === 'true') {
    return true;
  }

  return false;
}
