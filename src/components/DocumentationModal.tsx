import React, { useState, useEffect } from 'react';
import { X, Shield, ShieldCheck, BookOpen, Layers, Check, Copy, Container, Terminal, Code, Globe, Key, ArrowRight, Database, History, RefreshCw, Sparkles, Bot, Cpu, CheckCircle2 } from 'lucide-react';

interface DocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'overview' | 'api' | 'docker';
}

export const DocumentationModal: React.FC<DocumentationModalProps> = ({ isOpen, onClose, initialTab = 'overview' }) => {
  const [modalTab, setModalTab] = useState<'overview' | 'api' | 'docker'>(initialTab);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedDockerRun, setCopiedDockerRun] = useState(false);
  const [copiedCompose, setCopiedCompose] = useState(false);
  const [copiedApiTest, setCopiedApiTest] = useState(false);
  const [copiedApiDemo, setCopiedApiDemo] = useState(false);
  const [copiedApiScanGemini, setCopiedApiScanGemini] = useState(false);
  const [copiedApiScanOpenAi, setCopiedApiScanOpenAi] = useState(false);
  const [copiedApiScanHeaders, setCopiedApiScanHeaders] = useState(false);
  const [copiedApiScanOffline, setCopiedApiScanOffline] = useState(false);
  const [copiedApiHistory, setCopiedApiHistory] = useState(false);
  const [copiedApiDatabases, setCopiedApiDatabases] = useState(false);
  const [copiedApiHealth, setCopiedApiHealth] = useState(false);
  const [apiSnippetLang, setApiSnippetLang] = useState<'curl' | 'powershell' | 'node' | 'python'>('curl');
  const [aiScanTab, setAiScanTab] = useState<'gemini' | 'openai' | 'headers' | 'offline'>('gemini');
  const [customAiKey, setCustomAiKey] = useState('');

  useEffect(() => {
    // Purge legacy client localStorage API key if present
    if (typeof window !== 'undefined' && localStorage.getItem('yachiru_api_key')) {
      localStorage.removeItem('yachiru_api_key');
    }
    if (isOpen && initialTab) {
      setModalTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const apiBaseUrl = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '${apiBaseUrl}';
  const activeKey = '<ADMIN_PROVIDED_YACHIRU_API_KEY>';

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
curl -X POST ${apiBaseUrl}/api/clickhouse/test-connection \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
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
curl -X POST ${apiBaseUrl}/api/clickhouse/test-connection \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -d '{
    "isDemoCluster": true,
    "demoClusterId": "apex_ecommerce"
  }'
`.trim();

  const apiScanGeminiCurl = `
# 3A. Run Full Audit with Google Gemini 3.7 Flash Agentic Synthesis
curl -X POST ${apiBaseUrl}/api/clickhouse/scan \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -d '{
    "target": {
      "host": "clickhouse.internal.company.com",
      "port": 8123,
      "protocol": "http",
      "user": "yachiru_readonly",
      "password": "StrongPassword123!",
      "database": "analytics",
      "lookbackDays": 7
    },
    "aiEnabled": true,
    "aiProvider": "gemini",
    "aiModel": "gemini-3.7-flash",
    "aiApiKey": "${customAiKey.trim() || 'AIzaSy_YOUR_GEMINI_KEY (or omit if set in VM .env)'}"
  }'
`.trim();

  const apiScanOpenAiCurl = `
# 3B. Run Full Audit with OpenAI GPT-4o Agentic Synthesis
curl -X POST ${apiBaseUrl}/api/clickhouse/scan \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -d '{
    "target": {
      "host": "clickhouse.internal.company.com",
      "port": 8123,
      "protocol": "http",
      "user": "yachiru_readonly",
      "password": "StrongPassword123!",
      "database": "analytics",
      "lookbackDays": 7
    },
    "aiEnabled": true,
    "aiProvider": "openai",
    "aiModel": "gpt-4o",
    "aiApiKey": "${customAiKey.trim() || 'sk-proj_YOUR_OPENAI_KEY (or omit if set in VM .env)'}"
  }'
`.trim();

  const apiScanHeadersCurl = `
# 3C. Configure AI Agent Brain & Keys via HTTP Headers
curl -X POST ${apiBaseUrl}/api/clickhouse/scan \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -H "x-ai-provider: openai" \\
  -H "x-ai-model: gpt-4o" \\
  -H "x-ai-api-key: ${customAiKey.trim() || 'sk-proj_YOUR_OPENAI_KEY'}" \\
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

  const apiScanOfflineCurl = `
# 3D. 100% Deterministic Engine Only (Offline / Zero AI Keys Needed)
curl -X POST ${apiBaseUrl}/api/clickhouse/scan \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -d '{
    "target": {
      "host": "clickhouse.internal.company.com",
      "port": 8123,
      "protocol": "http",
      "user": "yachiru_readonly",
      "password": "StrongPassword123!",
      "database": "analytics"
    },
    "aiEnabled": false
  }'
`.trim();

  const apiDatabasesCurl = `
# 4. Discover databases on a ClickHouse cluster
curl -X POST ${apiBaseUrl}/api/clickhouse/databases \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeKey}" \\
  -d '{
    "host": "clickhouse.internal.company.com",
    "port": 8123,
    "protocol": "http",
    "user": "yachiru_readonly",
    "password": "StrongPassword123!"
  }'
`.trim();

  const apiHistoryCurl = `
# 5. Retrieve saved audit scan history
curl -X GET ${apiBaseUrl}/api/history \\
  -H "x-api-key: ${activeKey}"
`.trim();

  const apiHealthCurl = `
# 6. Service Health Check endpoint (Public, probe)
curl -X GET ${apiBaseUrl}/api/health
`.trim();

  const apiNodeSnippet = `
// Node.js (v18+) Triggering ClickHouse Audit with OpenAI / Gemini Agentic Synthesis
const runAuditScan = async () => {
  const response = await fetch('${apiBaseUrl}/api/clickhouse/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': '${activeKey}'
    },
    body: JSON.stringify({
      target: {
        host: 'clickhouse.internal.company.com',
        port: 8123,
        protocol: 'http',
        user: 'yachiru_readonly',
        password: 'StrongPassword123!',
        database: 'analytics',
        lookbackDays: 7
      },
      // Agentic AI synthesis options:
      aiEnabled: true,
      aiProvider: 'openai',       // 'gemini' | 'openai'
      aiModel: 'gpt-4o',          // or 'gemini-3.7-flash'
      aiApiKey: '${customAiKey.trim() || 'sk-proj_YOUR_OPENAI_KEY'}' // Optional if set on VM server .env
    })
  });

  const report = await response.json();
  console.log('Overall Grade:', report.overallGrade, \`(\${report.overallScore}/100)\`);
  console.log('Executive Summary:', report.executiveSummary);
  console.log('Automated DDL Migrations:', report.findings.map(f => f.suggestedDdl).filter(Boolean));
};

runAuditScan();
`.trim();

  const apiPythonSnippet = `
# Python (requests) ClickHouse Audit with OpenAI / Gemini Agentic Synthesis
import requests

url = "${apiBaseUrl}/api/clickhouse/scan"
headers = {
    "Content-Type": "application/json",
    "x-api-key": "${activeKey}"
}
payload = {
    "target": {
        "host": "clickhouse.internal.company.com",
        "port": 8123,
        "protocol": "http",
        "user": "yachiru_readonly",
        "password": "StrongPassword123!",
        "database": "analytics",
        "lookbackDays": 7
    },
    # Agentic AI synthesis options:
    "aiEnabled": True,
    "aiProvider": "openai",      # 'gemini' | 'openai'
    "aiModel": "gpt-4o",         # or 'gemini-3.7-flash'
    "aiApiKey": "${customAiKey.trim() || 'sk-proj_YOUR_OPENAI_KEY'}" # Optional if set in VM .env
}

response = requests.post(url, json=payload, headers=headers)
report = response.json()

print(f"Overall Grade: {report.get('overallGrade')} ({report.get('overallScore')}/100)")
print("Executive Summary:", report.get("executiveSummary", {}).get("summary"))
print("AI Findings Count:", len(report.get("findings", [])))
`.trim();

  const apiPowerShellSnippet = `
# Windows PowerShell (Invoke-RestMethod) ClickHouse Audit
$headers = @{
  "Content-Type" = "application/json"
  "x-api-key"    = "${activeKey}"
}

$body = @{
  target = @{
    host         = "clickhouse.internal.company.com"
    port         = 8123
    protocol     = "http"
    user         = "yachiru_readonly"
    password     = "StrongPassword123!"
    database     = "analytics"
    lookbackDays = 7
  }
  aiEnabled = $false
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod -Uri "${apiBaseUrl}/api/clickhouse/scan" -Method Post -Headers $headers -Body $body
Write-Host "Score: $($response.overallScore)/100 (Grade $($response.overallGrade))"
Write-Host "Findings: $($response.findings.Count)"
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <Key className="h-4 w-4" />
                    <span>API Authentication & Request Headers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="/api/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
                    >
                      <Globe className="h-3 w-3" />
                      <span>Interactive Swagger UI</span>
                    </a>
                    <a
                      href="/api/openapi.json"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <Code className="h-3 w-3" />
                      <span>OpenAPI Spec</span>
                    </a>
                  </div>
                </div>

                <p className="text-[12px] text-slate-300 leading-relaxed">
                  Every programmatic request to Yachiru endpoints is verified on the server. You can authenticate either with an end-user session token or with a machine service account API key:
                </p>

                {/* Headers required & RBAC Matrix */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-200">Accepted Authentication & RBAC Headers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      <span className="text-amber-400">Authorization:</span> Bearer &lt;firebase_id_token&gt;
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">Verified by Firebase Admin. Enforces User Role (Admin / Auditor / Viewer) and Approval Status.</p>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      <span className="text-amber-400">x-api-key:</span> &lt;your_secret_api_key&gt;
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">Machine Service Account key for CI/CD automation & headless scripts.</p>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 space-y-1">
                    <span className="font-semibold text-slate-300">Server-Side Enforced Endpoint Permissions:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
                      <li><strong className="text-slate-200">Viewer (Rank 0):</strong> Read-only access to history (<code className="text-amber-300">GET /api/history</code>) and report scorecards.</li>
                      <li><strong className="text-slate-200">Auditor (Rank 1):</strong> Can execute cluster audits (<code className="text-amber-300">POST /api/clickhouse/scan</code>) and test connections.</li>
                      <li><strong className="text-slate-200">Admin (Rank 2):</strong> Full control, user management, and history purging (<code className="text-amber-300">DELETE /api/history</code>).</li>
                    </ul>
                  </div>
                </div>

                {/* Admin-Provisioned API Key Notice */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-2 text-slate-200">
                    <Shield className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-semibold">
                      API Key Governance & Machine Authentication:
                    </span>
                  </div>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-slate-300 space-y-1.5">
                    <p className="font-semibold text-amber-300">
                      Machine API keys cannot be generated or stored by client browsers.
                    </p>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      To prevent unauthorized key exposure and maintain non-repudiation, API keys (<code className="text-amber-400">x-api-key</code>) are provisioned exclusively by System Administrators via server environment variables (<code className="text-amber-400">YACHIRU_API_KEY</code>). Client web sessions use signed-in Firebase Auth tokens with real-time Role-Based Access Control (RBAC).
                    </p>
                  </div>
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

              {/* Endpoint 3: Run Full Scan & Agentic AI Synthesis */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 uppercase">
                      POST
                    </span>
                    <span className="font-mono text-xs">/api/clickhouse/scan</span>
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
                      <Sparkles className="h-2.5 w-2.5" /> Agentic AI Synthesis
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {aiScanTab === 'gemini' && (
                      <button
                        onClick={() => handleCopy(apiScanGeminiCurl, setCopiedApiScanGemini)}
                        className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                      >
                        {copiedApiScanGemini ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedApiScanGemini ? 'Copied' : 'Copy Gemini cURL'}</span>
                      </button>
                    )}
                    {aiScanTab === 'openai' && (
                      <button
                        onClick={() => handleCopy(apiScanOpenAiCurl, setCopiedApiScanOpenAi)}
                        className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                      >
                        {copiedApiScanOpenAi ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedApiScanOpenAi ? 'Copied' : 'Copy OpenAI cURL'}</span>
                      </button>
                    )}
                    {aiScanTab === 'headers' && (
                      <button
                        onClick={() => handleCopy(apiScanHeadersCurl, setCopiedApiScanHeaders)}
                        className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                      >
                        {copiedApiScanHeaders ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedApiScanHeaders ? 'Copied' : 'Copy Headers cURL'}</span>
                      </button>
                    )}
                    {aiScanTab === 'offline' && (
                      <button
                        onClick={() => handleCopy(apiScanOfflineCurl, setCopiedApiScanOffline)}
                        className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                      >
                        {copiedApiScanOffline ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedApiScanOffline ? 'Copied' : 'Copy Offline cURL'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-slate-300 text-[11px]">
                  Executes the full 9-dimension health audit, computes efficiency scores, and runs an autonomous AI synthesis agent (powered by <strong>Google Gemini</strong> or <strong>OpenAI ChatGPT</strong>) to diagnose root causes and output automated ClickHouse DDL migrations.
                </p>

                {/* AI Provider & Engine Selector Tabs */}
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                    <button
                      onClick={() => setAiScanTab('gemini')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        aiScanTab === 'gemini'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                      <span>Google Gemini 3.7 Flash</span>
                    </button>
                    <button
                      onClick={() => setAiScanTab('openai')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        aiScanTab === 'openai'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Bot className="h-3.5 w-3.5 text-emerald-400" />
                      <span>OpenAI GPT-4o</span>
                    </button>
                    <button
                      onClick={() => setAiScanTab('headers')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        aiScanTab === 'headers'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Cpu className="h-3.5 w-3.5 text-purple-400" />
                      <span>HTTP Headers Config</span>
                    </button>
                    <button
                      onClick={() => setAiScanTab('offline')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        aiScanTab === 'offline'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5 text-amber-400" />
                      <span>Deterministic Only (Zero AI)</span>
                    </button>
                  </div>

                  {/* Optional Key Injection Field */}
                  {aiScanTab !== 'offline' && (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-900/80 border border-slate-800/80 p-2 text-[11px]">
                      <span className="text-slate-400 whitespace-nowrap">Inject Custom AI Key:</span>
                      <input
                        type="password"
                        placeholder={aiScanTab === 'gemini' ? 'AIzaSy... (leave blank to use VM .env GEMINI_API_KEY)' : 'sk-proj... (leave blank to use VM .env OPENAI_API_KEY)'}
                        value={customAiKey}
                        onChange={(e) => setCustomAiKey(e.target.value)}
                        className="flex-1 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                  )}

                  {/* Code Display */}
                  <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-emerald-200 overflow-x-auto border border-slate-800">
                    <code>
                      {aiScanTab === 'gemini' && apiScanGeminiCurl}
                      {aiScanTab === 'openai' && apiScanOpenAiCurl}
                      {aiScanTab === 'headers' && apiScanHeadersCurl}
                      {aiScanTab === 'offline' && apiScanOfflineCurl}
                    </code>
                  </pre>
                </div>

                {/* API Request Parameters & Schema Guide */}
                <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-3 space-y-2 text-[11px]">
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Scan & Agentic AI Parameters:</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 font-mono">
                    <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
                      <span className="text-amber-400 font-bold">aiEnabled</span>: <span className="text-emerald-400">true | false</span>
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">Toggles AI agentic analysis. When false, runs 100% offline deterministic audit.</p>
                    </div>
                    <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
                      <span className="text-amber-400 font-bold">aiProvider</span>: <span className="text-emerald-400">"gemini" | "openai"</span>
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">Selects the agent brain: Google Gemini or OpenAI ChatGPT.</p>
                    </div>
                    <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
                      <span className="text-amber-400 font-bold">aiModel</span>: <span className="text-emerald-400">string</span>
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">e.g. <code>gemini-3.7-flash</code>, <code>gemini-2.5-pro</code>, <code>gpt-4o</code>, <code>gpt-4o-mini</code>.</p>
                    </div>
                    <div className="p-2 rounded bg-slate-950 border border-slate-800/70">
                      <span className="text-amber-400 font-bold">aiApiKey</span>: <span className="text-emerald-400">string (optional)</span>
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">Custom key per request. If omitted, uses <code>GEMINI_API_KEY</code> or <code>OPENAI_API_KEY</code> from VM server <code>.env</code>.</p>
                    </div>
                  </div>
                </div>

                {/* Response Structure */}
                <div className="space-y-1.5 text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-300">AI Agentic Response Payload Highlights:</span>
                  <pre className="p-2.5 rounded bg-slate-950 text-emerald-400 font-mono text-[10px] border border-slate-800/80 overflow-x-auto">
{`{
  "id": "scan-1725408000-xyz",
  "overallScore": 88,
  "overallGrade": "B+",
  "executiveSummary": {
    "summary": "Cluster health is generally solid, but write amplification detected on events_v2.",
    "criticalBottlenecks": ["Over-partitioned time-series table events_v2 (1,420 active parts)"],
    "immediateWins": ["Convert Nullable(tenant_id) to LowCardinality(String) saving ~32% RAM"],
    "systemicRisks": ["Background merge pool contention during peak ingestion hours"]
  },
  "findings": [
    {
      "id": "nullable-tenant-id",
      "dimension": "Column Types & Encodings",
      "severity": "MEDIUM",
      "title": "Unnecessary Nullable wrapper on high-cardinality column",
      "aiDiagnosis": "Nullable adds an extra uint8 mask byte per row and breaks vectorization.",
      "suggestedDdl": "ALTER TABLE analytics.events_v2 MODIFY COLUMN tenant_id LowCardinality(String);",
      "remediationRollbackDdl": "ALTER TABLE analytics.events_v2 MODIFY COLUMN tenant_id Nullable(String);"
    }
  ]
}`}
                  </pre>
                </div>
              </div>

              {/* Endpoint 4: Discover Databases */}
              <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-purple-400">
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-mono text-[10px] text-purple-300 uppercase">
                      POST
                    </span>
                    <span className="font-mono text-xs">/api/clickhouse/databases</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiDatabasesCurl, setCopiedApiDatabases)}
                    className="flex items-center gap-1 rounded bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/30 transition-colors cursor-pointer"
                  >
                    {copiedApiDatabases ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiDatabases ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Lists accessible databases and non-system schemas on the target ClickHouse server:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-purple-200 overflow-x-auto border border-slate-800">
                  <code>{apiDatabasesCurl}</code>
                </pre>
              </div>

              {/* Endpoint 5: Scan History */}
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-cyan-400">
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 uppercase">
                      GET
                    </span>
                    <span className="font-mono text-xs">/api/history</span>
                  </div>
                  <button
                    onClick={() => handleCopy(apiHistoryCurl, setCopiedApiHistory)}
                    className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-0.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/30 transition-colors cursor-pointer"
                  >
                    {copiedApiHistory ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedApiHistory ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Retrieves chronological audit scan history and executive score summaries:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-cyan-200 overflow-x-auto border border-slate-800">
                  <code>{apiHistoryCurl}</code>
                </pre>
              </div>

              {/* Multi-language Code Examples */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="font-bold text-sm text-slate-100">Programmatic Code Snippets</h4>
                    <p className="text-[11px] text-slate-400">
                      Pre-filled with your active key: <code className="text-amber-300 font-mono">{activeKey}</code>
                    </p>
                  </div>
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
                      onClick={() => setApiSnippetLang('powershell')}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        apiSnippetLang === 'powershell' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      PowerShell
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

                {apiSnippetLang === 'curl' && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-slate-300 flex items-start gap-2">
                    <span className="font-bold text-amber-400 shrink-0">Windows Note:</span>
                    <span className="text-slate-400">
                      In Windows CMD (<code className="text-amber-300">cmd.exe</code>), backslashes and single quotes cause <em className="text-amber-200">"The filename, directory name, or volume label syntax is incorrect"</em>. Use the <strong>PowerShell</strong> tab above or pass your JSON payload via <code className="text-amber-300">-d @body.json</code>.
                    </span>
                  </div>
                )}

                <div className="relative">
                  <pre className="p-4 rounded-xl bg-slate-950 font-mono text-[11px] text-amber-200 overflow-x-auto border border-slate-800">
                    <code>
                      {apiSnippetLang === 'curl' && apiTestCurl}
                      {apiSnippetLang === 'powershell' && apiPowerShellSnippet}
                      {apiSnippetLang === 'node' && apiNodeSnippet}
                      {apiSnippetLang === 'python' && apiPythonSnippet}
                    </code>
                  </pre>
                </div>
              </div>

              {/* Endpoint 6: Health Check */}
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
