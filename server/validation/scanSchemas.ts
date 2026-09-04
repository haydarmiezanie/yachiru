import { z } from 'zod';
import { isValidClickHouseIdentifier } from '../scanner/clickhouseClient.js';
import { extractCleanHost, isRestrictedIpAddress } from '../security/ssrfValidator.js';

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
  })
  .superRefine((data, ctx) => {
    // Demo clusters are simulated in-memory and do not issue network requests
    if (data.isDemoCluster) return;

    // Explicit developer override for local testing environments
    if (process.env.ALLOW_INTERNAL_CLUSTERS === 'true') return;

    const clean = extractCleanHost(data.host);
    if (!clean) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Target host is required',
        path: ['host'],
      });
      return;
    }

    const lower = clean.toLowerCase();
    if (
      lower === 'localhost' ||
      lower === 'metadata' ||
      lower === 'metadata.google.internal' ||
      lower === 'metadata.goog' ||
      lower === 'instance-data' ||
      lower.endsWith('.internal') ||
      lower.endsWith('.local') ||
      lower.endsWith('.localhost')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Connection to internal, loopback, or cloud-metadata host '${clean}' is not permitted. Please specify a public ClickHouse cluster or select a Demo Cluster.`,
        path: ['host'],
      });
      return;
    }

    const { isRestricted, range } = isRestrictedIpAddress(clean);
    if (isRestricted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Target IP '${clean}' belongs to restricted network range (${range || 'private'}). Connecting to internal VPC, loopback, or metadata services is blocked for security.`,
        path: ['host'],
      });
    }
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
