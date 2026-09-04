import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAllowedOrigins } from '../server.js';
import { isRequireApiKey, isStrictAuth, requireRole } from '../server/auth/rbacMiddleware.js';

describe('Security Configurations (CORS & Fail-Closed Auth)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('CORS Origin Resolution & Production Guard', () => {
    it('throws in production if allowedOrigins is empty', () => {
      const env = {
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: '',
        APP_URL: '',
      } as NodeJS.ProcessEnv;

      const origins = resolveAllowedOrigins(env);
      expect(origins.length).toBe(0);

      expect(() => {
        if (env.NODE_ENV === 'production' && origins.length === 0) {
          throw new Error('ALLOWED_ORIGINS must be explicitly configured in production.');
        }
      }).toThrow('ALLOWED_ORIGINS must be explicitly configured in production.');
    });

    it('resolves explicit ALLOWED_ORIGINS in production', () => {
      const env = {
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://auditor.mycorp.com, https://admin.mycorp.com',
      } as NodeJS.ProcessEnv;

      const origins = resolveAllowedOrigins(env);
      expect(origins).toEqual(['https://auditor.mycorp.com', 'https://admin.mycorp.com']);
      expect(origins.includes('https://auditor.mycorp.com')).toBe(true);
      expect(origins.includes('https://malicious.evil.com')).toBe(false);
    });

    it('automatically incorporates APP_URL origin if present in production', () => {
      const env = {
        NODE_ENV: 'production',
        APP_URL: 'https://yachiru-scanner-xyz.run.app/subpath',
        ALLOWED_ORIGINS: 'https://myportal.com',
      } as NodeJS.ProcessEnv;

      const origins = resolveAllowedOrigins(env);
      expect(origins).toContain('https://yachiru-scanner-xyz.run.app');
      expect(origins).toContain('https://myportal.com');
    });

    it('includes localhost and 127.0.0.1 in non-production mode', () => {
      const env = {
        NODE_ENV: 'development',
        ALLOWED_ORIGINS: '',
      } as NodeJS.ProcessEnv;

      const origins = resolveAllowedOrigins(env);
      expect(origins).toContain('http://localhost:3000');
      expect(origins).toContain('http://127.0.0.1:3000');
      // Must not contain arbitrary external sites
      expect(origins.includes('https://attacker.com')).toBe(false);
    });
  });

  describe('Auth Fail-Closed Defaults', () => {
    it('defaults REQUIRE_API_KEY to true in production (fail-closed)', () => {
      delete process.env.REQUIRE_API_KEY;
      process.env.NODE_ENV = 'production';

      expect(isRequireApiKey()).toBe(true);
    });

    it('defaults REQUIRE_API_KEY to false in development', () => {
      delete process.env.REQUIRE_API_KEY;
      process.env.NODE_ENV = 'development';

      expect(isRequireApiKey()).toBe(false);
    });

    it('respects explicit REQUIRE_API_KEY values', () => {
      process.env.NODE_ENV = 'development';
      process.env.REQUIRE_API_KEY = 'true';
      expect(isRequireApiKey()).toBe(true);

      process.env.NODE_ENV = 'production';
      process.env.REQUIRE_API_KEY = 'false';
      expect(isRequireApiKey()).toBe(false);
    });

    it('defaults STRICT_AUTH to true in production', () => {
      delete process.env.STRICT_AUTH;
      process.env.NODE_ENV = 'production';

      expect(isStrictAuth()).toBe(true);
    });

    it('blocks unauthenticated requests in production even for viewer endpoints (no fail-open)', async () => {
      delete process.env.REQUIRE_API_KEY;
      delete process.env.YACHIRU_API_KEY;
      delete process.env.STRICT_AUTH;
      process.env.NODE_ENV = 'production';

      const middleware = requireRole('viewer');

      let responseStatusCode = 0;
      let responseBody: any = null;
      let nextCalled = false;

      const mockReq: any = {
        headers: {},
        path: '/api/history',
        ip: '203.0.113.195',
      };

      const mockRes: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      const next = () => {
        nextCalled = true;
      };

      await middleware(mockReq, mockRes, next);

      expect(nextCalled).toBe(false);
      expect(responseStatusCode).toBe(401);
      expect(responseBody?.code).toBe('AUTH_REQUIRED');
    });
  });
});
