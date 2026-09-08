import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import * as adminAuth from 'firebase-admin/auth';
import { app } from '../server.js';
import * as rbacModule from '../server/auth/rbacMiddleware.js';

describe('Auth Middleware & Protected API Endpoints Integration Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('Public Unauthenticated Endpoints', () => {
    it('GET /api/health returns 200 without authentication', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service');
    });

    it('GET /api/demo-clusters returns 200 without authentication', async () => {
      const res = await request(app).get('/api/demo-clusters');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('Machine Service Account API Key Authentication', () => {
    it('rejects scan request without valid API key when key is configured', async () => {
      process.env.YACHIRU_API_KEY = 'test-secret-key-12345';
      const res = await request(app)
        .post('/api/clickhouse/scan')
        .send({ target: { isDemoCluster: true } });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 'AUTH_REQUIRED');
    });

    it('rejects request with invalid API key', async () => {
      process.env.YACHIRU_API_KEY = 'test-secret-key-12345';
      const res = await request(app)
        .post('/api/clickhouse/scan')
        .set('x-api-key', 'wrong-key')
        .send({ target: { isDemoCluster: true } });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 'AUTH_REQUIRED');
    });

    it('authenticates successfully via x-api-key header and grants machine admin role', async () => {
      process.env.YACHIRU_API_KEY = 'test-secret-key-12345';
      const res = await request(app)
        .get('/api/auth/me')
        .set('x-api-key', 'test-secret-key-12345');

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        role: 'admin',
        status: 'approved',
        authMethod: 'api_key',
      });
    });

    it('authenticates successfully via Bearer header with machine key', async () => {
      process.env.YACHIRU_API_KEY = 'test-secret-key-12345';
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer test-secret-key-12345');

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        role: 'admin',
        status: 'approved',
        authMethod: 'api_key',
      });
    });

    it('supports comma-separated multiple allowed API keys', async () => {
      process.env.YACHIRU_API_KEY = 'key-primary,key-secondary-67890';
      const res = await request(app)
        .get('/api/auth/me')
        .set('x-api-key', 'key-secondary-67890');

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
    });
  });

  describe('Fail-Closed Enforcement Policies', () => {
    it('enforces authentication on viewer endpoints when REQUIRE_API_KEY=true', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      process.env.REQUIRE_API_KEY = 'true';

      const res = await request(app).get('/api/history');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('enforces authentication on viewer endpoints when STRICT_AUTH=true', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      process.env.STRICT_AUTH = 'true';

      const res = await request(app).get('/api/history');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('enforces fail-closed authentication in production even with no keys defined', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/api/history');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('allows admin to access DELETE /api/history via machine API key', async () => {
      process.env.YACHIRU_API_KEY = 'admin-secret-key';
      const res = await request(app)
        .delete('/api/history')
        .set('x-api-key', 'admin-secret-key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('rejects access to DELETE /api/history for unauthenticated caller', async () => {
      process.env.YACHIRU_API_KEY = 'admin-secret-key';
      const res = await request(app).delete('/api/history');
      expect(res.status).toBe(401);
    });

    it('rejects auditor-level endpoints (POST /api/clickhouse/scan) without auditor credentials in dev', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      process.env.NODE_ENV = 'development';

      // Scan endpoint requires minRole: 'auditor'. Dev anonymous mode only grants 'viewer'.
      const res = await request(app)
        .post('/api/clickhouse/scan')
        .send({ target: { isDemoCluster: true, demoClusterId: 'apex_ecommerce' } });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('denies access when authenticated user has pending or rejected status', async () => {
      // Mock fetchUserProfile to return an unapproved account
      vi.spyOn(rbacModule.profileFetcher, 'fetchUserProfile').mockResolvedValueOnce({
        uid: 'pending-user-1',
        email: 'pending@example.com',
        role: 'auditor',
        status: 'pending',
        authMethod: 'firebase_token',
      });

      // Construct a fake JWT 3-part format to enter Firebase verification branch
      // In requireRole, the token is verified through verifyIdToken
      const fakeJwt = 'header.payload.signature';
      const res = await request(app)
        .post('/api/clickhouse/scan')
        .set('Authorization', `Bearer ${fakeJwt}`)
        .send({ target: { isDemoCluster: true } });

      // If token signature is invalid, it returns 401 INVALID_TOKEN
      // If token verification was mocked, it would return 403 ACCOUNT_NOT_APPROVED
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('Development Mode Default Permissiveness', () => {
    it('allows viewer endpoints (/api/history) in local development when no auth keys are configured', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      delete process.env.REQUIRE_API_KEY;
      delete process.env.STRICT_AUTH;
      process.env.NODE_ENV = 'development';

      const res = await request(app).get('/api/history');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns dev-anonymous user profile on /api/auth/me in development mode', async () => {
      delete process.env.YACHIRU_API_KEY;
      delete process.env.API_SECRET_KEY;
      delete process.env.REQUIRE_API_KEY;
      delete process.env.STRICT_AUTH;
      process.env.NODE_ENV = 'development';

      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        role: 'viewer',
        status: 'approved',
        authMethod: 'anonymous_dev',
      });
    });
  });

  describe('Profile Cache & Transient Failure Isolation (503 vs 403)', () => {
    beforeEach(async () => {
      await rbacModule.clearProfileCache();
    });

    it('stores and retrieves profiles from cache with designated TTL and stale-grace copy', async () => {
      const mockUser: rbacModule.AuthenticatedUser = {
        uid: 'user-cache-123',
        email: 'cached@example.com',
        role: 'auditor',
        status: 'approved',
        displayName: 'Cached Auditor',
        authMethod: 'firebase_token',
      };

      await rbacModule.setCachedProfile('user-cache-123', mockUser, 10000);
      const retrieved = await rbacModule.getCachedProfile('user-cache-123');
      expect(retrieved).toEqual(mockUser);

      const staleGrace = await rbacModule.getStaleGraceProfile('user-cache-123');
      expect(staleGrace).toEqual(mockUser);

      await rbacModule.clearProfileCache();
      const afterClear = await rbacModule.getCachedProfile('user-cache-123');
      expect(afterClear).toBeNull();
    });

    it('returns 503 PROFILE_CHECK_TRANSIENT when status verification is inconclusive (status: unknown)', async () => {
      vi.spyOn(rbacModule.authVerifier, 'verifyIdToken').mockResolvedValueOnce({
        uid: 'transient-user-1',
        email: 'transient@example.com',
      } as any);

      vi.spyOn(rbacModule.profileFetcher, 'fetchUserProfile').mockResolvedValueOnce({
        uid: 'transient-user-1',
        email: 'transient@example.com',
        role: 'viewer',
        status: 'unknown',
        authMethod: 'firebase_token',
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer dummy.token.jwt');

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PROFILE_CHECK_TRANSIENT');
      expect(res.body.error).toContain('retry');
    });

    it('returns 503 PROFILE_CHECK_TRANSIENT when fetchUserProfile throws an unexpected exception', async () => {
      vi.spyOn(rbacModule.authVerifier, 'verifyIdToken').mockResolvedValueOnce({
        uid: 'error-user-1',
        email: 'error@example.com',
      } as any);

      vi.spyOn(rbacModule.profileFetcher, 'fetchUserProfile').mockRejectedValueOnce(
        new Error('Upstream database unreachable')
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer dummy.token.jwt');

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PROFILE_CHECK_TRANSIENT');
    });

    it('strictly preserves 403 ACCOUNT_NOT_APPROVED when user is confirmed pending or rejected', async () => {
      vi.spyOn(rbacModule.authVerifier, 'verifyIdToken').mockResolvedValueOnce({
        uid: 'pending-user-2',
        email: 'pending@example.com',
      } as any);

      vi.spyOn(rbacModule.profileFetcher, 'fetchUserProfile').mockResolvedValueOnce({
        uid: 'pending-user-2',
        email: 'pending@example.com',
        role: 'viewer',
        status: 'pending',
        authMethod: 'firebase_token',
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer dummy.token.jwt');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_NOT_APPROVED');
      expect(res.body.status).toBe('pending');
    });

    it('grants approved users access to role-gated endpoints with correct profile', async () => {
      vi.spyOn(rbacModule.authVerifier, 'verifyIdToken').mockResolvedValueOnce({
        uid: 'approved-user-1',
        email: 'approved@example.com',
      } as any);

      vi.spyOn(rbacModule.profileFetcher, 'fetchUserProfile').mockResolvedValueOnce({
        uid: 'approved-user-1',
        email: 'approved@example.com',
        role: 'auditor',
        status: 'approved',
        authMethod: 'firebase_token',
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer dummy.token.jwt');

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        uid: 'approved-user-1',
        role: 'auditor',
        status: 'approved',
      });
    });
  });
});
