import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { buildOpenApiSpec } from './openApiSpec.js';

export function generateOpenApiFiles(rootDir = process.cwd()): { jsonPath: string; yamlPath: string } {
  const spec = buildOpenApiSpec();

  const jsonContent = JSON.stringify(spec, null, 2);
  const yamlContent = YAML.stringify(spec, { indent: 2 });

  const jsonPath = path.join(rootDir, 'openapi.json');
  const yamlPath = path.join(rootDir, 'openapi.yaml');

  fs.writeFileSync(jsonPath, jsonContent, 'utf-8');
  fs.writeFileSync(yamlPath, yamlContent, 'utf-8');

  console.log(`[OpenAPI Generator] Successfully wrote:`);
  console.log(`  - ${jsonPath} (${(Buffer.byteLength(jsonContent) / 1024).toFixed(1)} KB)`);
  console.log(`  - ${yamlPath} (${(Buffer.byteLength(yamlContent) / 1024).toFixed(1)} KB)`);

  return { jsonPath, yamlPath };
}

// Execute if run directly from CLI
if (process.argv[1] && process.argv[1].includes('generateOpenApi')) {
  try {
    generateOpenApiFiles();
  } catch (err) {
    console.error('[OpenAPI Generator] Error generating files:', err);
    process.exit(1);
  }
}
