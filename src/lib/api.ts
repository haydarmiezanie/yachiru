import { auth } from './firebase';

/**
 * Helper to make API requests with appropriate auth headers attached:
 * - x-api-key: from localStorage ('yachiru_api_key') or import.meta.env.VITE_YACHIRU_API_KEY
 * - Authorization: Bearer <token> from Firebase Auth user session if signed in
 */
export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});

  // 1. Attach configured API key if present
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  const storedApiKey =
    (typeof window !== 'undefined' ? localStorage.getItem('yachiru_api_key') : null) ||
    metaEnv?.VITE_YACHIRU_API_KEY ||
    '';

  if (storedApiKey && !headers.has('x-api-key')) {
    headers.set('x-api-key', storedApiKey.trim());
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

  return fetch(input, {
    ...init,
    headers,
  });
}
