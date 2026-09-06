import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { app } from '../server.js';
import { buildOpenApiSpec } from '../server/openapi/openApiSpec.js';
import { generateOpenApiFiles } from '../server/openapi/generateOpenApi.js';

describe('OpenAPI 3.1 Specification & Documentation', () => {
  it('generates a structurally valid OpenAPI 3.1.0 specification object', () => {
    const spec = buildOpenApiSpec();

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toContain('Yachiru');
    expect(spec.info.version).toBe('1.0.0');

    // Security Schemes
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.BearerAuth.type).toBe('http');
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined();
    expect(spec.components.securitySchemes.ApiKeyAuth.type).toBe('apiKey');

    // Documented Paths
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/api/demo-clusters');
    expect(paths).toContain('/api/auth/me');
    expect(paths).toContain('/api/clickhouse/test-connection');
    expect(paths).toContain('/api/clickhouse/scan');
    expect(paths).toContain('/api/history');
    expect(paths).toContain('/api/history/{id}');
    expect(paths).toContain('/api/openapi.json');
    expect(paths).toContain('/api/openapi.yaml');
    expect(paths).toContain('/api/docs');

    // Schemas
    const schemas = spec.components.schemas;
    expect(schemas).toBeDefined();
    expect(schemas.ScanTargetInput).toBeDefined();
    expect(schemas.ScanRequestInput).toBeDefined();
    expect(schemas.TestConnectionInput).toBeDefined();
    expect(schemas.TestConnectionResponse).toBeDefined();
    expect(schemas.Finding).toBeDefined();
    expect(schemas.DimensionScore).toBeDefined();
    expect(schemas.ScanReport).toBeDefined();
    expect(schemas.ScanReportSummary).toBeDefined();
    expect(schemas.UserAuthProfile).toBeDefined();
    expect(schemas.DemoCluster).toBeDefined();
    expect(schemas.ErrorResponse).toBeDefined();

    // Verify sub-components do not leak root $schema property
    for (const [name, schema] of Object.entries(schemas)) {
      expect((schema as any)['$schema'], `Schema ${name} should not contain $schema property`).toBeUndefined();
    }
  });

  it('serves /api/openapi.json with 200 OK and valid JSON document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/api/clickhouse/scan']).toBeDefined();
  });

  it('serves /api/openapi.yaml with 200 OK and valid YAML document', async () => {
    const res = await request(app).get('/api/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    expect(res.text).toContain('openapi: 3.1.0');

    // Parse YAML to verify validity
    const parsed = YAML.parse(res.text);
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toContain('Yachiru');
  });

  it('serves /api/docs with 200 OK and Swagger UI HTML', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('SwaggerUIBundle');
    expect(res.text).toContain('/api/openapi.json');
    expect(res.text).toContain('Yachiru API Documentation');
  });

  it('generates physical openapi.json and openapi.yaml files via generator script', () => {
    const tmpDir = path.join(process.cwd(), 'tests', 'fixtures');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const { jsonPath, yamlPath } = generateOpenApiFiles(tmpDir);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(yamlPath)).toBe(true);

    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonContent.openapi).toBe('3.1.0');

    const yamlContent = YAML.parse(fs.readFileSync(yamlPath, 'utf-8'));
    expect(yamlContent.openapi).toBe('3.1.0');

    // Cleanup test artifacts
    fs.unlinkSync(jsonPath);
    fs.unlinkSync(yamlPath);
  });
});
