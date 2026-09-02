import { z } from 'zod';
import { isValidClickHouseIdentifier } from '../scanner/clickhouseClient.js';

export const ScanTargetSchema = z.object({
  host: z.string().trim().max(255).default('localhost'),
  port: z.union([z.number().int().min(1).max(65535), z.string().transform((val, ctx) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Port must be a valid integer between 1 and 65535',
      });
      return z.NEVER;
    }
    return parsed;
  })]).default(8123),
  protocol: z.enum(['http', 'https']).optional().default('http'),
  user: z.string().max(255).optional().default('default'),
  password: z.string().max(1000).optional().default(''),
  database: z.string().trim().max(256).refine(
    (db) => !db || isValidClickHouseIdentifier(db),
    { message: 'Database name must be a valid identifier (alphanumeric, dots, dashes, underscores)' }
  ).optional().default('default'),
  isDemoCluster: z.boolean().optional().default(false),
  demoClusterId: z.string().max(100).optional(),
  lookbackDays: z.union([z.number().int().min(1).max(365), z.string().transform((val, ctx) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 365) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Lookback days must be an integer between 1 and 365',
      });
      return z.NEVER;
    }
    return parsed;
  })]).optional().default(7),
});

export const ScanRequestSchema = z.object({
  target: ScanTargetSchema,
  aiEnabled: z.boolean().optional().default(true),
  aiProvider: z.enum(['gemini', 'openai']).optional().default('gemini'),
  aiModel: z.string().max(100).optional().default('gemini-3.7-flash'),
  aiApiKey: z.string().max(500).optional(),
});

export const TestConnectionRequestSchema = z.union([
  z.object({ target: ScanTargetSchema }).transform((data) => data.target),
  ScanTargetSchema,
]);

export type ValidatedScanTarget = z.infer<typeof ScanTargetSchema>;
export type ValidatedScanRequest = z.infer<typeof ScanRequestSchema>;
