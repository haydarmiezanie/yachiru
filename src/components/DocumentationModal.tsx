import React, { useState } from 'react';
import { X, ShieldCheck, BookOpen, Layers, Check, Copy, Container, Terminal, Code, Globe, Key, ArrowRight } from 'lucide-react';

interface DocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentationModal: React.FC<DocumentationModalProps> = ({ isOpen, onClose }) => {
  const [modalTab, setModalTab] = useState<'overview' | 'api' | 'docker'>('overview');
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedDockerRun, setCopiedDockerRun] = useState(false);
  const [copiedCompose, setCopiedCompose] = useState(false);
  const [copiedApiTest, setCopiedApiTest] = useState(false);
  const [copiedApiDemo, setCopiedApiDemo] = useState(false);
  const [copiedApiScan, setCopiedApiScan] = useState(false);
  const [copiedApiHealth, setCopiedApiHealth] = useState(false);
  const [copiedEnvSnippet, setCopiedEnvSnippet] = useState(false);
  const [apiSnippetLang, setApiSnippetLang] = useState<'curl' | 'node' | 'python'>('curl');
  const [clientApiKey, setClientApiKey] = useState(() => {
    return (typeof window !== 'undefined' ? localStorage.getItem('yachiru_api_key') : '') || '';
  });
  const [apiKeySaved, setApiKeySaved] = useState(false);

  if (!isOpen) return null;

  const handleSaveClientApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== 'undefined') {
      const trimmed = clientApiKey.trim();
      if (trimmed) {
        localStorage.setItem('yachiru_api_key', trimmed);
      } else {
        localStorage.removeItem('yachiru_api_key');
      }
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 2500);
    }
  };

  const vmEnvSnippet = `
# On your VM: nano .env
# 1. Define your strong secret API key
YACHIRU_API_KEY="your_strong_secret_api_key_here"

# 2. Enforce API key authentication for all requests
REQUIRE_API_KEY=true

# 3. Optional: AI Provider Keys
GEMINI_API_KEY=your_gemini_key_here
OPENAI_API_KEY=your_openai_key_here
`.trim();

  const grantSql = `
-- Create read-only auditing user for Yachiru
CREATE USER yachiru_readonly IDENTIFIED WITH sha256_password BY 'StrongPassword123!';

-- Grant SELECT access to system monitoring tables
GRANT SELECT ON system.tables TO yachiru_readonly;
GRANT SELECT ON system.columns TO yachiru_readonly;
GRANT SELECT ON system.parts TO yachiru_readonly;
GRANT SELECT ON system.merges TO yachiru_readonly;
GRANT SELECT ON system.query_log TO yachiru_readonly;
GRANT SELECT ON system.settings TO yachiru_readonly;
GRANT SELECT ON system.part_log TO yachiru_readonly;

-- Grant SELECT on the target database to inspect schema & sample cardinality
GRANT SELECT ON target_db.* TO yachiru_readonly;
`.trim();

  const apiTestCurl = `
# 1. Test connection to a live ClickHouse instance
curl -X POST https://yachiru.id/api/clickhouse/test-connection \\
  -H "Content-Type: application/json" \\
  -d '{
    "host": "clickhouse.internal.company.com",
    "port": 8123,
    "protocol": "http",
    "user": "yachiru_readonly",
    "password": "StrongPassword123!",
    "database": "default"
  }'
`.trim();

  const apiTestDemoCurl = `
# 2. Test connection with built-in Mock Demo Cluster
curl -X POST https://yachiru.id/api/clickhouse/test-connection \\
  -H "Content-Type: application/json" \\
  -d '{
    "isDemoCluster": true,
    "demoClusterId": "apex_ecommerce"
  }'
`.trim();

  const apiScanCurl = `
# 3. Trigger full 9-dimension audit scan & AI analysis
curl -X POST https://yachiru.id/api/clickhouse/scan \\
  -H "Content-Type: application/json" \\
  -d '{
    "target": {
      "host": "clickhouse.internal.company.com",
      "port": 8123,
      "protocol": "http",
      "user": "yachiru_readonly",
      "password": "StrongPassword123!",
      "database": "analytics"
    },
    "aiEnabled": true
  }'
`.trim();

  const apiHealthCurl = `
# 4. Service Health Check endpoint
curl -X GET https://yachiru.id/api/health
`.trim();

  const apiNodeSnippet = `
// Node.js (v18+) Testing ClickHouse Connection
const testConnection = async () => {
  const response = await fetch('https://yachiru.id/api/clickhouse/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: 'clickhouse.internal.company.com',
      port: 8123,
      protocol: 'http',
      user: 'yachiru_readonly',
      password: 'StrongPassword123!',
      database: 'default'
    })
  });
  const data = await response.json();
  console.log('Result:', data);
};

testConnection();
`.trim();

  const apiPythonSnippet = `
# Python (requests) Testing ClickHouse Connection
import requests

url = "https://yachiru.id/api/clickhouse/test-connection"
payload = {
    "host": "clickhouse.internal.company.com",
    "port": 8123,
    "protocol": "http",
    "user": "yachiru_readonly",
    "password": "StrongPassword123!",
    "database": "default"
}

response = requests.post(url, json=payload)
print("Status:", response.status_code)
print("Result:", response.json())
`.trim();

  const dockerRunCmd = `
# 1. Build the lightweight production container
docker build -t yachiru-clickhouse-advisor:latest .

# 2. Run Yachiru container with persistent history volume & AI keys
docker run -d \\
  --name yachiru \\
  -p 3000:3000 \\
  -e NODE_ENV=production \\
  -e GEMINI_API_KEY=your_gemini_api_key_here \\
  -e OPENAI_API_KEY=your_openai_api_key_here \\
  -v yachiru_data:/app/data \\
  --restart unless-stopped \\
  yachiru-clickhouse-advisor:latest
`.trim();

  const dockerComposeCmd = `
# Start Yachiru Advisor
docker compose up -d
`.trim();

  const handleCopy = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Modal Header & Tabs */}
        <div className="border-b border-slate-800 bg-slate-950/80 px-6 pt-4 pb-0">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold text-white">Yachiru Documentation & Integration</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 overflow-x-auto">
            <button
              onClick={() => setModalTab('overview')}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                modalTab === 'overview'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Architecture & Grants
            </button>
            <button
              onClick={() => setModalTab('api')}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                modalTab === 'api'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="h-3.5 w-3.5" />
              Connect by API (REST)
            </button>
            <button
              onClick={() => setModalTab('docker')}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                modalTab === 'docker'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Container className="h-3.5 w-3.5" />
              Dockerization & Deployment
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[72vh] overflow-y-auto text-xs text-slate-300 leading-relaxed">
          {modalTab === 'overview' && (
            <div className="space-y-6">
              {/* Philosophy Section */}
              <div className="space-y-2">
                <h3 className="font-bold text-sm text-amber-400">Core Philosophy: Dynamic Query-Log Correlation</h3>
                <p>
                  Yachiru is <strong>not a static linter</strong>. Optimal ClickHouse table schemas (especially <code className="text-amber-300">ORDER BY</code> primary keys, partition expressions, and skip indexes) depend on actual workload filter patterns. Yachiru correlates <code className="text-amber-300">system.query_log</code> execution data with table definitions to detect unindexed column scans, partition pruning failures, and memory bloat.
                </p>
              </div>

              {/* API Integration Callout */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <Globe className="h-4 w-4" />
                    <span>Connect & Automate via REST API</span>
                  </div>
                  <p className="text-slate-300 text-[11px]">
                    Need to test connections from CLI scripts, CI/CD pipelines, or microservices? Yachiru provides full REST endpoints.
                  </p>
                </div>
                <button
                  onClick={() => setModalTab('api')}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer shadow-md"
                >
                  <span>View API Guide</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Read-Only Safety Protocol */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Zero-Mutation Read-Only Setup (ClickHouse SQL)</span>
                  </div>
                  <button
                    onClick={() => handleCopy(grantSql, setCopiedSql)}
                    className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                  >
                    {copiedSql ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedSql ? 'Copied SQL' : 'Copy Grant Script'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Run this in your ClickHouse client to configure a least-privilege auditing role:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-amber-200 overflow-x-auto border border-slate-800">
                  <code>{grantSql}</code>
                </pre>
              </div>

              {/* 9 Dimensions Explanation */}
              <div className="space-y-3">
                <h3 className="font-bold text-sm text-slate-100 uppercase tracking-wider">
                  The 9 Optimization Dimensions
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">1. Table Engines & Partitioning:</strong>
                    <p className="text-slate-400">Checks for non-standard engines, oversized partitions, and high active parts per table.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">2. Parts & Merges:</strong>
                    <p className="text-slate-400">Detects write-amplification, small batch inserts, and background merge pool bottlenecks.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">3. Primary Key & query_log:</strong>
                    <p className="text-slate-400">Correlates high-frequency WHERE filters against ORDER BY to flag full-table scans.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">4. Skip Indexes:</strong>
                    <p className="text-slate-400">Identifies minmax and set index candidates for secondary filter predicates.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">5. Data Types & Storage:</strong>
                    <p className="text-slate-400">Audits Nullable() penalty, LowCardinality(String) candidates, and compression codecs.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">6. TTL & Retention:</strong>
                    <p className="text-slate-400">Flags unbounded growth on timeseries tables without automated TTL partition deletion.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">7. Materialized Views:</strong>
                    <p className="text-slate-400">Detects recurring GROUP BY compute that should be incrementally pre-aggregated.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                    <strong className="text-amber-300">8. Resource & Config:</strong>
                    <p className="text-slate-400">Audits server settings like async_insert, max_threads, and background_pool_size.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1 md:col-span-2">
                    <strong className="text-amber-300">9. General Query Performance:</strong>
                    <p className="text-slate-400">Extracts slow queries with high scan-to-result ratios, memory pressure, and timeouts.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {modalTab === 'api' && (
            <div className="space-y-6">
              {/* API Header Overview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-white">Connect & Test by REST API</h3>
                </div>
                <p className="text-slate-300">
                  Yachiru exposes clean JSON REST endpoints to programmatically test connectivity, inspect databases, and trigger autonomous health scans from your terminal, CI/CD runners, or backend microservices.
                </p>
              </div>

              {/* Authentication & Headers */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <Key className="h-4 w-4" />
                    <span>Authentication & VM .env Setup</span>
                  </div>
                  <button
                    onClick={() => handleCopy(vmEnvSnippet, setCopiedEnvSnippet)}
                    className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer"
                  >
                    {copiedEnvSnippet ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedEnvSnippet ? 'Copied' : 'Copy .env Config'}</span>
                  </button>
                </div>

                <div className="space-y-2 text-[11px] text-slate-300">
                  <p>
                    To require that <strong>every request MUST provide your secret API Key</strong>, add these two environment variables to your VM server's <code className="text-amber-300 font-mono">.env</code> file:
                  </p>
                  <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-amber-200 overflow-x-auto">
                    <code>{vmEnvSnippet}</code>
                  </pre>
                  <p className="text-slate-400">
                    When <code className="text-amber-300 font-mono">REQUIRE_API_KEY=true</code> is active, the server immediately rejects with <strong>401 Unauthorized</strong> any requests to <code className="text-amber-300 font-mono">/api/clickhouse/*</code> and <code className="text-amber-300 font-mono">/api/history/*</code> that lack a matching key.
                  </p>
                </div>

                {/* Headers required */}
                <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-200">Accepted Request Headers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      <span className="text-amber-400">x-api-key:</span> &lt;your_secret_api_key&gt;
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      <span className="text-amber-400">Authorization:</span> Bearer &lt;your_secret_api_key&gt;
                    </div>
                  </div>
                </div>

                {/* Browser Session API Key Manager */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-200">
                      Client API Key (This Browser Session):
                    </span>
                    {apiKeySaved && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Saved to Browser
                      </span>
                    )}
                  </div>
                  <form onSubmit={handleSaveClientApiKey} className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Enter your API key for this browser session..."
                      value={clientApiKey}
                      onChange={(e) => setClientApiKey(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none font-mono"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors cursor-pointer"
                    >
                      Save Key
                    </button>
                  </form>
                  <p className="text-[10px] text-slate-500">
                    This key is stored locally in your browser's <code className="text-slate-400">localStorage</code> and will be sent automatically with each scan and connection test.
                  </p>
                </div>
              </div>

              {/* Endpoint 1: Test Connection */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-blue-400">
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[10px] text-blue-300 uppercase">
                      POST
                    </span>
                    <span className="font-mono text-xs">/api/clickhouse/test-connection</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiTestCurl, setCopiedApiTest)}
                    className="flex items-center gap-1 rounded bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
                  >
                    {copiedApiTest ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiTest ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Pings your ClickHouse instance, validates credentials, and retrieves the ClickHouse build version and accessible database list:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-blue-200 overflow-x-auto border border-slate-800">
                  <code>{apiTestCurl}</code>
                </pre>
                <div className="text-[11px] text-slate-400">
                  <strong>Expected 200 OK Response:</strong>
                  <pre className="mt-1 p-2.5 rounded bg-slate-950 text-emerald-400 font-mono text-[10px] border border-slate-800/80">
{`{
  "success": true,
  "version": "24.3.2.31",
  "message": "Successfully connected to ClickHouse 24.3.2.31",
  "databases": ["default", "system", "analytics"]
}`}
                  </pre>
                </div>
              </div>

              {/* Endpoint 2: Test Demo Cluster */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 uppercase">
                      POST
                    </span>
                    <span className="font-mono text-xs">Testing via Mock Demo Cluster</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiTestDemoCurl, setCopiedApiDemo)}
                    className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer"
                  >
                    {copiedApiDemo ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiDemo ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Use the built-in demo cluster ID (<code className="text-amber-300">apex_ecommerce</code>) to test API consumers without exposing real database credentials:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-amber-200 overflow-x-auto border border-slate-800">
                  <code>{apiTestDemoCurl}</code>
                </pre>
              </div>

              {/* Endpoint 3: Run Full Scan */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 uppercase">
                      POST
                    </span>
                    <span className="font-mono text-xs">/api/clickhouse/scan</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiScanCurl, setCopiedApiScan)}
                    className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                  >
                    {copiedApiScan ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiScan ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Executes the full 9-dimension health audit, computes efficiency scores, generates automated DDL migrations, and returns structured findings:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-emerald-200 overflow-x-auto border border-slate-800">
                  <code>{apiScanCurl}</code>
                </pre>
              </div>

              {/* Multi-language Code Examples */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-slate-100">Programmatic Code Snippets</h4>
                  <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
                    <button
                      onClick={() => setApiSnippetLang('curl')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        apiSnippetLang === 'curl' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      cURL
                    </button>
                    <button
                      onClick={() => setApiSnippetLang('node')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        apiSnippetLang === 'node' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Node.js
                    </button>
                    <button
                      onClick={() => setApiSnippetLang('python')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        apiSnippetLang === 'python' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Python
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <pre className="p-4 rounded-xl bg-slate-950 font-mono text-[11px] text-amber-200 overflow-x-auto border border-slate-800">
                    <code>
                      {apiSnippetLang === 'curl' && apiTestCurl}
                      {apiSnippetLang === 'node' && apiNodeSnippet}
                      {apiSnippetLang === 'python' && apiPythonSnippet}
                    </code>
                  </pre>
                </div>
              </div>

              {/* Endpoint 4: Health Check */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-slate-300">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 uppercase">
                      GET
                    </span>
                    <span className="font-mono text-xs">/api/health</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiHealthCurl, setCopiedApiHealth)}
                    className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    {copiedApiHealth ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiHealth ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Returns status 200 with service health, system version, and AI configuration status for load-balancers or uptime monitors.
                </p>
              </div>
            </div>
          )}

          {modalTab === 'docker' && (
            <div className="space-y-6">
              {/* Docker Overview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Container className="h-4 w-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-white">Docker & Containerization Guide</h3>
                </div>
                <p className="text-slate-300">
                  Yachiru includes a production-ready, multi-stage Debian Slim Docker build (<code className="text-amber-300">Dockerfile</code>) and Docker Compose specification (<code className="text-amber-300">docker-compose.yml</code>) with automated scan history persistence and container health checks.
                </p>
              </div>

              {/* Docker Compose Box */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-blue-400">
                    <Terminal className="h-4 w-4" />
                    <span>Option A: Docker Compose (Recommended)</span>
                  </div>
                  <button
                    onClick={() => handleCopy(dockerComposeCmd, setCopiedCompose)}
                    className="flex items-center gap-1 rounded bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
                  >
                    {copiedCompose ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCompose ? 'Copied' : 'Copy Command'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Launches Yachiru on port 3000 with volume persistence for past analysis histories:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-blue-200 overflow-x-auto border border-slate-800">
                  <code>{dockerComposeCmd}</code>
                </pre>
              </div>

              {/* Standalone Docker Run Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <Terminal className="h-4 w-4" />
                    <span>Option B: Standalone Docker Build & Run</span>
                  </div>
                  <button
                    onClick={() => handleCopy(dockerRunCmd, setCopiedDockerRun)}
                    className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer"
                  >
                    {copiedDockerRun ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedDockerRun ? 'Copied' : 'Copy Command'}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-amber-200 overflow-x-auto border border-slate-800">
                  <code>{dockerRunCmd}</code>
                </pre>
              </div>

              {/* Docker Features Checklist */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                  <strong className="text-emerald-400">Multi-Stage Slim Build:</strong>
                  <p className="text-slate-400">Compiles Vite assets and esbuild server into a lightweight, glibc-compatible runner image under a non-root <code className="text-amber-300">node</code> user.</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                  <strong className="text-emerald-400">Healthcheck & Restart Policy:</strong>
                  <p className="text-slate-400">Built-in container healthcheck pinging <code className="text-amber-300">/api/health</code> with <code className="text-amber-300">unless-stopped</code> auto-recovery.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 px-6 py-3 bg-slate-950/90 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
