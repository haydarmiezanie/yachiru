import { auth } from './firebase';

/**
 * Helper to make API requests with appropriate auth headers attached:
 * - Authorization: Bearer <token> from Firebase Auth user session if signed in
 * - x-api-key: only if explicitly built into environment (VITE_YACHIRU_API_KEY)
 *
 * Security Note:
 * Client browsers do NOT store machine API keys in localStorage.
 * Machine API keys are governed exclusively by administrators for CI/CD runners.
 *
 * Resilience features:
 * - Proactive ID token resolution from Firebase Auth
 * - Automatic 401 interceptor: forces token refresh via getIdToken(true) and transparently retries request
 * - Transient 502/503/504 retry: auto-recovers from container cold-starts or momentary proxy timeouts
 */
export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});

  // Remove any legacy insecure localStorage API keys if present
  if (typeof window !== 'undefined' && localStorage.getItem('yachiru_api_key')) {
    localStorage.removeItem('yachiru_api_key');
  }

  // 1. Attach configured machine environment API key if explicitly defined at build time
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  const envApiKey = metaEnv?.VITE_YACHIRU_API_KEY || '';

  if (envApiKey && !headers.has('x-api-key')) {
    headers.set('x-api-key', envApiKey.trim());
  }

  // 2. Attach Firebase ID token if user is signed in
  if (auth.currentUser && !headers.has('Authorization')) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers.set('Authorization', `Bearer ${idToken}`);
      }
    } catch {
      // ignore token retrieval error if offline
    }
  }

  let response = await fetch(input, {
    ...init,
    headers,
  });

  // 3. Intercept 401 Unauthorized (Expired or Revoked Token Recovery)
  // When an ID token expires or is invalidated (e.g. after switching accounts or >60m idle),
  // force-refresh a brand-new token from Google and seamlessly retry once before throwing.
  if (response.status === 401 && auth.currentUser) {
    try {
      const freshToken = await auth.currentUser.getIdToken(true);
      if (freshToken) {
        headers.set('Authorization', `Bearer ${freshToken}`);
        response = await fetch(input, {
          ...init,
          headers,
        });
      }
    } catch (refreshErr) {
      console.warn('[Yachiru Auth] Automatic token refresh failed:', refreshErr);
    }
  }

  // 4. Intercept Transient Gateway Errors (502 Bad Gateway / 503 Service Unavailable / 504 Timeout)
  // Auto-retries once after a brief 1.2s delay to absorb container cold-starts or proxy renegotiation
  if ((response.status === 502 || response.status === 503 || response.status === 504)) {
    const isSafeToRetry = !init.method || ['GET', 'POST'].includes(init.method.toUpperCase());
    if (isSafeToRetry) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        response = await fetch(input, {
          ...init,
          headers,
        });
      } catch (retryErr) {
        console.warn('[Yachiru API] Transient gateway error retry failed:', retryErr);
      }
    }
  }

  return response;
}
