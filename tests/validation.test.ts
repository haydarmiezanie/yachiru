import { describe, it, expect } from 'vitest';
import { ScanRequestSchema, TestConnectionRequestSchema } from '../server/validation/scanSchemas.js';

describe('Zod API Request Validation Schemas', () => {
  describe('TestConnectionRequestSchema', () => {
    it('validates direct target payload', () => {
      const result = TestConnectionRequestSchema.safeParse({
        host: 'ch-prod.internal',
        port: 8123,
        database: 'analytics',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('ch-prod.internal');
        expect(result.data.port).toBe(8123);
      }
    });

    it('validates wrapped { target: { ... } } payload', () => {
      const result = TestConnectionRequestSchema.safeParse({
        target: {
          host: '10.0.0.5',
          port: '8443',
          protocol: 'https',
          database: 'default',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8443);
        expect(result.data.protocol).toBe('https');
      }
    });

    it('rejects invalid ports or dangerous database names', () => {
      const badPort = TestConnectionRequestSchema.safeParse({
        host: 'localhost',
        port: 999999,
      });
      expect(badPort.success).toBe(false);

      const badDb = TestConnectionRequestSchema.safeParse({
        host: 'localhost',
        port: 8123,
        database: "default' OR 1=1;--",
      });
      expect(badDb.success).toBe(false);
    });
  });

  describe('ScanRequestSchema', () => {
    it('validates complete scan request with defaults', () => {
      const result = ScanRequestSchema.safeParse({
        target: {
          host: 'localhost',
          port: 8123,
          isDemoCluster: true,
          demoClusterId: 'apex_ecommerce',
        },
        aiEnabled: true,
        aiProvider: 'gemini',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aiModel).toBe('gemini-3.7-flash');
      }
    });
  });
});
