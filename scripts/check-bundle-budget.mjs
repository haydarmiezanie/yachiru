import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_INDEX = path.join(process.cwd(), 'dist', 'index.html');
const DIST_ASSETS = path.join(process.cwd(), 'dist', 'assets');

// Budget for initial JS loaded directly by index.html (<script type="module"> + <link rel="modulepreload">)
const MAX_INITIAL_JS_RAW_BYTES = 460 * 1024; // 460 KB (down from 578 KB single bundle)
const MAX_INITIAL_JS_GZIP_BYTES = 145 * 1024; // 145 KB gzipped
const MAX_ANY_CHUNK_RAW_BYTES = 260 * 1024; // 260 KB max per chunk

if (!fs.existsSync(DIST_INDEX)) {
  console.error(`[check-bundle-budget] Missing ${DIST_INDEX}. Run "npm run build" first.`);
  process.exit(1);
}

const indexHtml = fs.readFileSync(DIST_INDEX, 'utf-8');
const initialScripts = new Set();

for (const match of indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)) {
  initialScripts.add(path.basename(match[1]));
}

let totalInitialRaw = 0;
let totalInitialGzip = 0;
const failures = [];

for (const fileName of initialScripts) {
  const fullPath = path.join(DIST_ASSETS, fileName);
  if (!fs.existsSync(fullPath)) continue;
  const buf = fs.readFileSync(fullPath);
  const gz = zlib.gzipSync(buf);
  totalInitialRaw += buf.length;
  totalInitialGzip += gz.length;
  console.log(
    `[bundle] initial: ${fileName} — ${(buf.length / 1024).toFixed(1)} kB raw / ${(gz.length / 1024).toFixed(1)} kB gzip`
  );
}

for (const fileName of fs.readdirSync(DIST_ASSETS)) {
  if (!fileName.endsWith('.js')) continue;
  const fullPath = path.join(DIST_ASSETS, fileName);
  const buf = fs.readFileSync(fullPath);
  if (buf.length > MAX_ANY_CHUNK_RAW_BYTES) {
    failures.push(
      `Chunk ${fileName} is ${(buf.length / 1024).toFixed(1)} kB raw (limit ${(MAX_ANY_CHUNK_RAW_BYTES / 1024).toFixed(1)} kB)`
    );
  }
}

console.log(
  `[bundle] total initial JS: ${(totalInitialRaw / 1024).toFixed(1)} kB raw / ${(totalInitialGzip / 1024).toFixed(1)} kB gzip`
);

if (totalInitialRaw > MAX_INITIAL_JS_RAW_BYTES) {
  failures.push(
    `Total initial JS ${(totalInitialRaw / 1024).toFixed(1)} kB exceeds budget ${(MAX_INITIAL_JS_RAW_BYTES / 1024).toFixed(1)} kB`
  );
}
if (totalInitialGzip > MAX_INITIAL_JS_GZIP_BYTES) {
  failures.push(
    `Total initial JS gzip ${(totalInitialGzip / 1024).toFixed(1)} kB exceeds budget ${(MAX_INITIAL_JS_GZIP_BYTES / 1024).toFixed(1)} kB`
  );
}

if (failures.length > 0) {
  console.error('[check-bundle-budget] FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('[check-bundle-budget] PASSED');
