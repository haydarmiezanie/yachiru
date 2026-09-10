import { z } from 'zod';

/**
 * Helper to convert Zod schema to an OpenAPI-compatible JSON Schema component
 * by stripping the root $schema property.
 */
function toOpenApiSchema(schema: z.ZodType): Record<string, any> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, any>;
  delete jsonSchema['$schema'];
  return jsonSchema;
}

// -------------------------------------------------------------
// 1. Zod Schemas for OpenAPI Specification
// -------------------------------------------------------------

export const OpenApiScanTargetInput = z.object({
  host: z
    .string()
    .max(255)
    .default('localhost')
    .describe('Target ClickHouse server hostname or IP address (e.g. clickhouse.internal or 198.51.100.24)'),
  port: z
    .union([z.number().int().min(1).max(65535), z.string()])
    .default(8123)
    .describe('ClickHouse HTTP interface port (default: 8123)'),
  protocol: z
    .enum(['http', 'https'])
    .default('http')
    .describe('Connection protocol (http or https)'),
  user: z
    .string()
    .max(255)
    .default('default')
    .describe('ClickHouse user with read-only access to system.* tables'),
  password: z
    .string()
    .max(1000)
    .default('')
    .describe('ClickHouse user password'),
  database: z
    .string()
    .max(256)
    .default('default')
    .describe('Target database to inspect and correlate with queries'),
  isDemoCluster: z
    .boolean()
    .default(false)
    .describe('When true, uses simulated in-memory benchmark data and bypasses network requests'),
  demoClusterId: z
    .string()
    .max(100)
    .optional()
    .describe('Pre-packaged demo dataset identifier (e.g. apex_ecommerce, nexus_iot, finpulse_ledger, cloudtrace_logs)'),
  lookbackDays: z
    .union([z.number().int().min(1).max(365), z.string()])
    .default(7)
    .describe('Number of days of system.query_log history to inspect for query bottleneck correlation'),
});

export const OpenApiScanRequestInput = z.object({
  target: OpenApiScanTargetInput.describe('ClickHouse cluster connection target specifications'),
  aiEnabled: z
    .boolean()
    .default(true)
    .describe('Enable AI diagnostic synthesis for root-cause narratives and priority guidance'),
  aiProvider: z
    .enum(['gemini', 'openai'])
    .default('gemini')
    .describe('AI synthesis engine provider'),
  aiModel: z
    .string()
    .max(100)
    .optional()
    .describe('Specific model identifier (e.g. gemini-3.7-flash, gpt-4o, gpt-4o-mini)'),
  aiApiKey: z
    .string()
    .max(500)
    .optional()
    .describe('Optional custom API key. If omitted, uses server environment variable'),
});

export const OpenApiTestConnectionInput = z.union([
  z.object({ target: OpenApiScanTargetInput }),
  OpenApiScanTargetInput,
]);

export const OpenApiTestConnectionResponse = z.object({
  success: z.boolean().describe('Indicates whether probe and authentication succeeded'),
  version: z.string().optional().describe('ClickHouse server version string'),
  uptime: z.number().optional().describe('ClickHouse server uptime in seconds'),
  clusterName: z.string().optional().describe('Detected cluster or host name'),
  accessibleDatabases: z.array(z.string()).optional().describe('List of accessible databases'),
  latencyMs: z.number().optional().describe('Round-trip HTTP probe latency in milliseconds'),
  message: z.string().optional().describe('Diagnostic or error message'),
  error: z.string().optional().describe('Detailed error description if probe failed'),
});

export const OpenApiDimensionId = z.enum([
  'table_engines_partitioning',
  'parts_and_merges',
  'primary_key_and_query_patterns',
  'skip_indexes',
  'data_types_and_storage',
  'ttl_and_tiering',
  'materialized_views_redundant_compute',
  'resource_and_config',
  'general_query_performance',
]);

export const OpenApiFindingSeverity = z.enum(['critical', 'warning', 'info', 'optimal']);

export const OpenApiFinding = z.object({
  id: z.string().describe('Unique identifier for this diagnostic finding'),
  dimension: OpenApiDimensionId.describe('Audit dimension category'),
  dimensionName: z.string().describe('Human-readable dimension title'),
  severity: OpenApiFindingSeverity.describe('Severity level determining scorecard weighting'),
  title: z.string().describe('Concise finding headline'),
  tableName: z.string().optional().describe('Associated ClickHouse table name if applicable'),
  what: z.string().describe('Factual telemetry evidence collected from ClickHouse system.* tables'),
  whyTechnical: z.string().describe('Technical mechanics explaining the performance impact or bottleneck'),
  whyNarrative: z.string().optional().describe('AI or contextual narrative explaining operational impact'),
  recommendationSql: z.string().optional().describe('Actionable SQL or DDL migration script for manual verification'),
  recommendationSummary: z.string().describe('Short prescriptive summary of remediation steps'),
  estimatedImpact: z.object({
    metric: z.string().describe('Primary metric impacted (e.g. Memory, Disk I/O, Query Latency)'),
    magnitude: z.string().describe('Expected magnitude of improvement (e.g. 3x - 10x, 40% - 60%)'),
    description: z.string().describe('Contextual justification for the estimated impact'),
  }),
  metrics: z.record(z.string(), z.any()).describe('Raw key-value telemetry metrics supporting this finding'),
  aiInsight: z.string().optional().describe('AI diagnostic commentary tailored to this finding'),
  aiSqlFix: z.string().optional().describe('AI-refined custom remediation query or DDL'),
  aiRiskLevel: z.enum(['Low', 'Medium', 'High', 'Critical']).optional().describe('Assessed execution risk level'),
  relativePriority: z
    .object({
      rank: z.number().int().describe('Order of priority relative to other findings'),
      effort: z.enum(['Low', 'Medium', 'High']).describe('Estimated implementation effort'),
      impact: z.enum(['Low', 'Medium', 'High', 'Critical']).describe('Expected business/performance impact'),
      justification: z.string().describe('Rationale for assigned priority rank'),
    })
    .optional(),
});

export const OpenApiDimensionScore = z.object({
  dimension: OpenApiDimensionId,
  name: z.string().describe('Display name of dimension'),
  description: z.string().describe('Scope and criteria evaluated in this dimension'),
  score: z.number().min(0).max(100).describe('Health score between 0 (failing) and 100 (optimal)'),
  criticalCount: z.number().int().describe('Number of critical findings in this dimension'),
  warningCount: z.number().int().describe('Number of warning findings in this dimension'),
  infoCount: z.number().int().describe('Number of informational observations'),
  optimalCount: z.number().int().describe('Number of audited checks passing optimal standards'),
  summary: z.string().describe('Executive evaluation summary for this dimension'),
});

export const OpenApiExecutiveSummary = z.object({
  overview: z.string().describe('Holistic evaluation of cluster performance and stability'),
  overallHealthGrade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']).describe('Aggregate letter grade'),
  topRisk: z.string().describe('Single most urgent risk identified across all dimensions'),
  quickWins: z.array(z.string()).describe('High-impact, low-effort remediation actions'),
  strategicFixes: z.array(z.string()).describe('Long-term architectural improvements'),
  aiGenerated: z.boolean().describe('True if synthesized via LLM, false if generated deterministically'),
  modelUsed: z.string().optional().describe('LLM model identifier used for synthesis'),
  provider: z.enum(['gemini', 'openai']).optional().describe('AI provider name'),
  aiNote: z.string().optional().describe('Advisory notes or caveats regarding AI output'),
});

export const OpenApiClusterMetadata = z.object({
  version: z.string().describe('ClickHouse server version string'),
  clusterName: z.string().describe('Resolved cluster or host identifier'),
  totalDatabases: z.number().int().describe('Total accessible databases'),
  totalTables: z.number().int().describe('Total tables inspected'),
  totalParts: z.number().int().describe('Total data parts across target tables'),
  totalRows: z.number().int().describe('Total row count across target tables'),
  totalDiskSizeBytes: z.number().describe('Total compressed size in bytes on disk'),
  totalDiskSizeFormatted: z.string().describe('Human-formatted disk size (e.g. 42.5 GB)'),
  queriesAnalyzed: z.number().int().describe('Total queries evaluated from system.query_log'),
  timeWindow: z.string().describe('Lookback time window examined'),
  uptimeSeconds: z.number().describe('Uptime of the ClickHouse service in seconds'),
});

export const OpenApiScanReportSummary = z.object({
  id: z.string().describe('Unique scan report ID (scan-<timestamp>-<hash>)'),
  timestamp: z.string().describe('ISO 8601 timestamp when audit was completed'),
  target: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    isDemoCluster: z.boolean(),
    clusterName: z.string().optional(),
    sshTunnel: z.object({
      enabled: z.boolean(),
      host: z.string(),
      port: z.number().int(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
    }).optional(),
  }),
  overallScore: z.number().min(0).max(100).describe('Weighted cluster health score'),
  overallGrade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']).describe('Aggregate letter grade'),
  criticalFindingsCount: z.number().int().describe('Total critical severity findings'),
  warningFindingsCount: z.number().int().describe('Total warning severity findings'),
  totalFindingsCount: z.number().int().describe('Total findings across all severities'),
  clusterName: z.string().describe('Target cluster name or hostname'),
  durationMs: z.number().describe('Audit execution latency in milliseconds'),
  aiStatus: z.enum(['success', 'fallback', 'disabled', 'error']).describe('AI synthesis outcome'),
  aiProvider: z.string().optional().describe('AI provider utilized'),
});

export const OpenApiScanReport = z.object({
  id: z.string().describe('Unique scan report identifier'),
  timestamp: z.string().describe('ISO 8601 audit completion timestamp'),
  target: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    isDemoCluster: z.boolean(),
    clusterName: z.string().optional(),
    sshTunnel: z.object({
      enabled: z.boolean(),
      host: z.string(),
      port: z.number().int(),
      username: z.string(),
      authMethod: z.enum(['password', 'privateKey']),
    }).optional(),
  }),
  overallScore: z.number().min(0).max(100),
  overallGrade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']),
  dimensionScores: z.array(OpenApiDimensionScore),
  findings: z.array(OpenApiFinding),
  executiveSummary: OpenApiExecutiveSummary,
  clusterMetadata: OpenApiClusterMetadata,
  rawStats: z.record(z.string(), z.any()).describe('Telemetry statistics and query log samples (PII-masked)'),
  migrationScript: z.string().describe('Ready-to-review composite SQL DDL script for remediation'),
  scanDurationMs: z.number().describe('Total duration of scan in milliseconds'),
  aiStatus: z.enum(['success', 'fallback', 'disabled', 'error']),
  aiProvider: z.string().optional(),
  aiErrorMessage: z.string().optional(),
});

export const OpenApiUserAuthProfile = z.object({
  uid: z.string().describe('Firebase user unique ID or local dev identifier'),
  email: z.string().email().describe('User email address'),
  role: z.enum(['viewer', 'auditor', 'admin']).describe('Assigned RBAC role'),
  status: z.enum(['pending', 'approved', 'rejected']).describe('Access approval status'),
  displayName: z.string().optional().describe('User display name'),
  photoURL: z.string().optional().describe('User avatar URL'),
});

export const OpenApiDemoCluster = z.object({
  id: z.string().describe('Unique demo profile ID'),
  name: z.string().describe('Human-friendly dataset name'),
  tagline: z.string().describe('Short architectural scenario summary'),
  industry: z.string().describe('Domain sector (E-commerce, IoT, FinTech, Observability)'),
  database: z.string().describe('Simulated database name'),
  tableCount: z.number().int().describe('Number of tables in demo schema'),
  rowCount: z.string().describe('Formatted row count (e.g. 50.0M rows)'),
  typicalIssues: z.array(z.string()).describe('List of intentional performance anti-patterns demonstrated'),
});

export const OpenApiErrorResponse = z.object({
  error: z.string().describe('Error message or summary'),
  details: z.any().optional().describe('Detailed validation or stack trace context'),
  code: z.string().optional().describe('Machine-readable error classification code'),
});

// -------------------------------------------------------------
// 2. Complete OpenAPI 3.1 Document Builder
// -------------------------------------------------------------

export function buildOpenApiSpec(): Record<string, any> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Yachiru: ClickHouse Optimization & Health Advisor API',
      version: '1.0.0',
      description:
        'Formal OpenAPI 3.1 specification for Yachiru. Provides programmatic endpoints to audit ClickHouse clusters across 9 critical performance dimensions, inspect system query telemetry, test cluster connectivity, and retrieve historical audit scorecards.',
      contact: {
        name: 'Yachiru Engineering Team',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment / Local Server',
      },
    ],
    tags: [
      { name: 'System', description: 'Service health, metadata, and available demo datasets' },
      { name: 'Auth', description: 'Authentication context and current user profile' },
      { name: 'Scanner', description: 'Connection testing and 9-dimension health audits' },
      { name: 'History', description: 'Audit report persistence and historical scorecard retrieval' },
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Service Health & Configuration Status',
          description: 'Returns operational health status, service version, and AI provider availability.',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Service operational status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      service: { type: 'string', example: 'Yachiru ClickHouse Optimization Scanner' },
                      version: { type: 'string', example: '1.0.0' },
                      aiConfigured: { type: 'boolean', example: true },
                    },
                    required: ['status', 'service', 'version', 'aiConfigured'],
                  },
                },
              },
            },
          },
        },
      },
      '/api/demo-clusters': {
        get: {
          tags: ['System'],
          summary: 'List Available Pre-Packaged Demo Datasets',
          description: 'Returns metadata for built-in benchmark clusters (Apex E-Commerce, Nexus IoT, FinPulse Ledger, CloudTrace Logs) for testing without external ClickHouse credentials.',
          operationId: 'getDemoClusters',
          responses: {
            '200': {
              description: 'List of demo cluster profiles',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/DemoCluster' },
                  },
                },
              },
            },
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get Current Authenticated User Profile',
          description: 'Returns profile, approval state, and role rank for the calling identity (Firebase token or API Key). In local dev mode without keys, returns a local viewer profile.',
          operationId: 'getCurrentUser',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Current user profile and role',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: { $ref: '#/components/schemas/UserAuthProfile' },
                    },
                    required: ['user'],
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized - Invalid or missing token/API key',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '403': {
              description: 'Forbidden - User account is pending administrator approval',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/clickhouse/test-connection': {
        post: {
          tags: ['Scanner'],
          summary: 'Probe ClickHouse Connectivity & Permissions',
          description: 'Validates host reachability, verifies user credentials, checks read permissions on system.* tables, and returns detected server version and latency. Requires `auditor` role or API Key.',
          operationId: 'testClickHouseConnection',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TestConnectionInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Probe results',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TestConnectionResponse' },
                },
              },
            },
            '400': {
              description: 'Invalid connection parameters or blocked SSRF host',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role (Auditor required)' },
            '500': {
              description: 'Connection failure or network error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TestConnectionResponse' },
                },
              },
            },
          },
        },
      },
      '/api/clickhouse/databases': {
        post: {
          tags: ['Scanner'],
          summary: 'Discover Accessible Databases on Cluster',
          description: 'Connects to the ClickHouse target and executes SHOW DATABASES to retrieve all databases accessible by the specified user credentials. Requires `auditor` role or API Key.',
          operationId: 'discoverClickHouseDatabases',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TestConnectionInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Accessible databases list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      databases: { type: 'array', items: { type: 'string' }, example: ['default', 'analytics', 'system'] },
                      total: { type: 'number', example: 3 },
                      version: { type: 'string', example: '24.3.2.10' },
                      message: { type: 'string', example: 'Connected successfully' },
                    },
                  },
                },
              },
            },
            '400': { description: 'Connection failed or invalid parameters' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role' },
          },
        },
      },
      '/api/clickhouse/scan': {
        post: {
          tags: ['Scanner'],
          summary: 'Execute 9-Dimension Health Scan & AI Synthesis',
          description: 'Runs an in-depth, zero-mutation diagnostic scan against the target ClickHouse database. Correlates table schemas with system.query_log telemetry, executes 9 deterministic analyzers, applies heuristic/zero-raw PII masking, generates remediation DDL, and synthesizes executive insights. Requires `auditor` role or API Key.',
          operationId: 'executeScan',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScanRequestInput' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Complete audit scorecard and remediation recommendations',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ScanReport' },
                },
              },
            },
            '400': {
              description: 'Invalid scan configuration, invalid database name, or query timeout',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role (Auditor required)' },
            '429': {
              description: 'Rate limit exceeded (too many concurrent scan requests)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/history': {
        get: {
          tags: ['History'],
          summary: 'List Historical Scan Summaries',
          description: 'Returns compact metadata summaries of previous audit runs sorted newest first. Requires `viewer` role or API Key.',
          operationId: 'getHistorySummaries',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'List of historical audit runs',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ScanReportSummary' },
                  },
                },
              },
            },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role' },
          },
        },
        delete: {
          tags: ['History'],
          summary: 'Clear Historical Scan Reports',
          description: 'Permanently removes all saved audit history reports. Destructive operation requiring `admin` role or API Key.',
          operationId: 'clearHistory',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'History cleared confirmation',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Scan history cleared' },
                    },
                    required: ['success', 'message'],
                  },
                },
              },
            },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role (Admin required)' },
          },
        },
      },
      '/api/history/{id}': {
        get: {
          tags: ['History'],
          summary: 'Retrieve Full Scan Report by ID',
          description: 'Fetches the complete audit report including all 9 dimension scores, full findings, raw telemetry stats, and generated DDL migration scripts. Requires `viewer` role or API Key.',
          operationId: 'getScanReportById',
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'Unique scan report identifier (e.g. scan-1741249000-abcde)',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Complete audit report document',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ScanReport' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden - Insufficient role' },
            '404': {
              description: 'Scan report not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/openapi.json': {
        get: {
          tags: ['System'],
          summary: 'Download OpenAPI 3.1 Specification (JSON)',
          description: 'Returns the machine-readable OpenAPI 3.1 JSON document for third-party tooling, SDK generation, or API gateways.',
          operationId: 'getOpenApiJson',
          responses: {
            '200': {
              description: 'OpenAPI 3.1 JSON Document',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/api/openapi.yaml': {
        get: {
          tags: ['System'],
          summary: 'Download OpenAPI 3.1 Specification (YAML)',
          description: 'Returns the machine-readable OpenAPI 3.1 YAML document.',
          operationId: 'getOpenApiYaml',
          responses: {
            '200': {
              description: 'OpenAPI 3.1 YAML Document',
              content: {
                'application/yaml': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
      '/api/docs': {
        get: {
          tags: ['System'],
          summary: 'Interactive Swagger UI Documentation',
          description: 'Serves interactive Swagger UI exploring all request/response models and test execution directly in browser.',
          operationId: 'getSwaggerDocs',
          responses: {
            '200': {
              description: 'HTML Swagger UI interface',
              content: {
                'text/html': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Firebase Auth ID Token. Pass as `Authorization: Bearer <ID_TOKEN>`. Enforces user approval and RBAC role rank.',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description:
            'Secret machine API key for CI/CD runners and automated audits (`YACHIRU_API_KEY`). Grants full service privileges.',
        },
      },
      schemas: {
        ScanTargetInput: toOpenApiSchema(OpenApiScanTargetInput),
        ScanRequestInput: toOpenApiSchema(OpenApiScanRequestInput),
        TestConnectionInput: toOpenApiSchema(OpenApiTestConnectionInput),
        TestConnectionResponse: toOpenApiSchema(OpenApiTestConnectionResponse),
        DimensionId: toOpenApiSchema(OpenApiDimensionId),
        FindingSeverity: toOpenApiSchema(OpenApiFindingSeverity),
        Finding: toOpenApiSchema(OpenApiFinding),
        DimensionScore: toOpenApiSchema(OpenApiDimensionScore),
        ExecutiveSummary: toOpenApiSchema(OpenApiExecutiveSummary),
        ClusterMetadata: toOpenApiSchema(OpenApiClusterMetadata),
        ScanReportSummary: toOpenApiSchema(OpenApiScanReportSummary),
        ScanReport: toOpenApiSchema(OpenApiScanReport),
        UserAuthProfile: toOpenApiSchema(OpenApiUserAuthProfile),
        DemoCluster: toOpenApiSchema(OpenApiDemoCluster),
        ErrorResponse: toOpenApiSchema(OpenApiErrorResponse),
      },
    },
  };
}
