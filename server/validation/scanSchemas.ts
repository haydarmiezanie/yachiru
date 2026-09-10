import { z } from 'zod';
import { isValidClickHouseIdentifier } from '../scanner/clickhouseClient.js';
import { checkStaticHostSafety } from '../security/ssrfValidator.js';
import { validatePrivateKeyFormat } from '../security/keyValidator.js';

export const SshTunnelSchema = z
  .object({
    enabled: z.boolean().default(false),
    host: z.string().trim().max(255).default(''),
    port: z
      .union([
        z.number().int().min(1).max(65535),
        z.string().transform((val, ctx) => {
          const parsed = parseInt(val, 10);
          if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'SSH Port must be an integer between 1 and 65535',
            });
            return z.NEVER;
          }
          return parsed;
        }),
      ])
      .default(22),
    username: z.string().trim().max(128).default(''),
    authMethod: z.enum(['password', 'privateKey']).default('password'),
    password: z.string().max(1000).optional(),
    privateKey: z.string().max(10000).optional(),
    passphrase: z.string().max(500).optional(),
  })
  .optional();

export const ScanTargetSchema = z
  .object({
    host: z.string().trim().max(255).default('localhost'),
    port: z
      .union([
        z.number().int().min(1).max(65535),
        z.string().transform((val, ctx) => {
          const parsed = parseInt(val, 10);
          if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Port must be a valid integer between 1 and 65535',
            });
            return z.NEVER;
          }
          return parsed;
        }),
      ])
      .default(8123),
    protocol: z.enum(['http', 'https']).optional().default('http'),
    user: z.string().max(255).optional().default('default'),
    password: z.string().max(1000).optional().default(''),
    database: z
      .string()
      .trim()
      .max(256)
      .refine((db) => !db || isValidClickHouseIdentifier(db), {
        message: 'Database name must be a valid identifier (alphanumeric, dots, dashes, underscores)',
      })
      .optional()
      .default('default'),
    isDemoCluster: z.boolean().optional().default(false),
    demoClusterId: z.string().max(100).optional(),
    lookbackDays: z
      .union([
        z.number().int().min(1).max(365),
        z.string().transform((val, ctx) => {
          const parsed = parseInt(val, 10);
          if (isNaN(parsed) || parsed < 1 || parsed > 365) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Lookback days must be an integer between 1 and 365',
            });
            return z.NEVER;
          }
          return parsed;
        }),
      ])
      .optional()
      .default(7),
    sshTunnel: SshTunnelSchema,
  })
  .superRefine((data, ctx) => {
    // 1. SSH Tunnel Mode
    if (data.sshTunnel?.enabled) {
      if (!data.sshTunnel.host || data.sshTunnel.host.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SSH tunnel host is required when SSH tunnel is enabled',
          path: ['sshTunnel', 'host'],
        });
      } else {
        // SSRF validation strictly applies to the SSH bastion host (Node connects directly to SSH server)
        const sshHostSafety = checkStaticHostSafety(data.sshTunnel.host, false);
        if (!sshHostSafety.safe) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: sshHostSafety.error || `SSH host '${data.sshTunnel.host}' is not permitted.`,
            path: ['sshTunnel', 'host'],
          });
        }
      }

      if (!data.sshTunnel.username || data.sshTunnel.username.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SSH username is required when SSH tunnel is enabled',
          path: ['sshTunnel', 'username'],
        });
      }

      if (data.sshTunnel.authMethod === 'password') {
        if (!data.sshTunnel.password || data.sshTunnel.password.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'SSH password is required when authMethod is "password"',
            path: ['sshTunnel', 'password'],
          });
        }
      } else if (data.sshTunnel.authMethod === 'privateKey') {
        if (!data.sshTunnel.privateKey || data.sshTunnel.privateKey.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'SSH private key is required when authMethod is "privateKey"',
            path: ['sshTunnel', 'privateKey'],
          });
        } else {
          const keyCheck = validatePrivateKeyFormat(data.sshTunnel.privateKey, data.sshTunnel.passphrase);
          if (!keyCheck.valid) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: keyCheck.error || 'Invalid SSH private key format (must be valid PEM or OpenSSH format)',
              path: ['sshTunnel', 'privateKey'],
            });
          }
        }
      }

      // NOTE: When sshTunnel.enabled === true, the ClickHouse target host/port represent
      // the destination as seen from the remote SSH server in the private VPC.
      // Resolving and connecting to this destination is performed exclusively by the remote SSH server,
      // NOT by the Yachiru Node.js scanner process. Therefore, private/internal IP addresses
      // (e.g. 10.x.x.x, 172.16-31.x.x, 192.168.x.x, *.internal) are legitimate and expected here.
      // We do NOT assert safe host on data.host when sshTunnel.enabled is true.
      if (!data.host || data.host.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ClickHouse target host is required',
          path: ['host'],
        });
      }
      return;
    }

    // 2. Direct Connection Mode
    const hostSafety = checkStaticHostSafety(data.host, data.isDemoCluster);
    if (!hostSafety.safe) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hostSafety.error || `Host '${data.host}' is not permitted.`,
        path: ['host'],
      });
    }
  });

export const SavedConnectionInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Connection name is required').max(100),
  target: ScanTargetSchema,
});

export const SavedConnectionCreateSchema = SavedConnectionInputSchema;

export const SavedConnectionUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required').max(100),
  target: ScanTargetSchema,
});

export const RetrustHostKeySchema = z.object({
  host: z.string().trim().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).default(22),
  newFingerprint: z.string().trim().optional(),
});

export const ScanRequestSchema = z
  .object({
    target: ScanTargetSchema,
    aiEnabled: z.boolean().optional().default(true),
    aiProvider: z.enum(['gemini', 'openai']).optional().default('gemini'),
    aiModel: z.string().max(100).optional(),
    aiApiKey: z.string().max(500).optional(),
  })
  .transform((data) => ({
    ...data,
    aiModel: data.aiModel || (data.aiProvider === 'gemini' ? 'gemini-3.7-flash' : 'gpt-4o-mini'),
  }));

export const TestConnectionRequestSchema = z.union([
  z.object({ target: ScanTargetSchema }).transform((data) => data.target),
  ScanTargetSchema,
]);

export type ValidatedScanTarget = z.infer<typeof ScanTargetSchema>;
export type ValidatedScanRequest = z.infer<typeof ScanRequestSchema>;
