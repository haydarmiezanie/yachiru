import { describe, it, expect } from 'vitest';
import { ScanRequestSchema, TestConnectionRequestSchema } from '../server/validation/scanSchemas.js';

describe('Zod API Request Validation Schemas', () => {
  describe('TestConnectionRequestSchema', () => {
    it('validates direct target payload', () => {
      const result = TestConnectionRequestSchema.safeParse({
        host: 'ch-prod.example.com',
        port: 8123,
        database: 'analytics',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('ch-prod.example.com');
        expect(result.data.port).toBe(8123);
      }
    });

    it('validates wrapped { target: { ... } } payload', () => {
      const result = TestConnectionRequestSchema.safeParse({
        target: {
          host: 'clickhouse.cloud.provider.com',
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

    it('blocks SSRF targets by default', () => {
      const internalTarget = TestConnectionRequestSchema.safeParse({
        host: 'ch-prod.internal',
        port: 8123,
      });
      expect(internalTarget.success).toBe(false);

      const privateIpTarget = TestConnectionRequestSchema.safeParse({
        target: {
          host: '10.0.0.5',
          port: 8123,
        },
      });
      expect(privateIpTarget.success).toBe(false);
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

    it('validates target with password-based SSH tunnel configuration', () => {
      const result = ScanRequestSchema.safeParse({
        target: {
          host: '10.0.1.50', // Private IP allowed because sshTunnel is enabled
          port: 8123,
          database: 'default',
          sshTunnel: {
            enabled: true,
            host: 'bastion.example.com',
            port: 22,
            username: 'ec2-user',
            authMethod: 'password',
            password: 'secret-ssh-password',
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('validates target with privateKey-based SSH tunnel configuration', () => {
      const result = ScanRequestSchema.safeParse({
        target: {
          host: 'clickhouse-internal.vpc',
          port: 8123,
          database: 'telemetry',
          sshTunnel: {
            enabled: true,
            host: 'jump.example.com',
            port: 2222,
            username: 'admin',
            authMethod: 'privateKey',
            privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
            passphrase: 'optional-passphrase',
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects SSH tunnel when required authentication credentials are missing', () => {
      // password auth without password
      const missingPassword = ScanRequestSchema.safeParse({
        target: {
          host: '10.0.1.50',
          port: 8123,
          sshTunnel: {
            enabled: true,
            host: 'bastion.example.com',
            port: 22,
            username: 'user',
            authMethod: 'password',
          },
        },
      });
      expect(missingPassword.success).toBe(false);

      // privateKey auth without privateKey
      const missingKey = ScanRequestSchema.safeParse({
        target: {
          host: '10.0.1.50',
          port: 8123,
          sshTunnel: {
            enabled: true,
            host: 'bastion.example.com',
            port: 22,
            username: 'user',
            authMethod: 'privateKey',
          },
        },
      });
      expect(missingKey.success).toBe(false);
    });

    it('rejects invalid SSH ports', () => {
      const badPort = ScanRequestSchema.safeParse({
        target: {
          host: '10.0.1.50',
          port: 8123,
          sshTunnel: {
            enabled: true,
            host: 'bastion.example.com',
            port: 999999,
            username: 'user',
            authMethod: 'password',
            password: 'pass',
          },
        },
      });
      expect(badPort.success).toBe(false);
    });
  });
});
