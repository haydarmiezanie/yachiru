import React, { useState } from 'react';
import { X, ShieldCheck, Database, BookOpen, Layers, Check, Copy, Container, Terminal } from 'lucide-react';

interface DocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentationModal: React.FC<DocumentationModalProps> = ({ isOpen, onClose }) => {
  const [modalTab, setModalTab] = useState<'overview' | 'docker'>('overview');
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedDockerRun, setCopiedDockerRun] = useState(false);
  const [copiedCompose, setCopiedCompose] = useState(false);

  if (!isOpen) return null;

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

  const dockerRunCmd = `
# 1. Build the lightweight production container
docker build -t yachiru-clickhouse-advisor:latest .

# 2. Run Yachiru container with persistent history volume
docker run -d \\
  --name yachiru \\
  -p 3000:3000 \\
  -e NODE_ENV=production \\
  -e GEMINI_API_KEY=your_gemini_api_key_here \\
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
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Modal Header & Tabs */}
        <div className="border-b border-slate-800 bg-slate-950/80 px-6 pt-4 pb-0">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold text-white">Yachiru Documentation & Deployment</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setModalTab('overview')}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                modalTab === 'overview'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Architecture & Grants
            </button>
            <button
              onClick={() => setModalTab('docker')}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
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
          {modalTab === 'overview' ? (
            <div className="space-y-6">
              {/* Philosophy Section */}
              <div className="space-y-2">
                <h3 className="font-bold text-sm text-amber-400">Core Philosophy: Dynamic Query-Log Correlation</h3>
                <p>
                  Yachiru is <strong>not a static linter</strong>. Optimal ClickHouse table schemas (especially <code className="text-amber-300">ORDER BY</code> primary keys, partition expressions, and skip indexes) depend on actual workload filter patterns. Yachiru correlates <code className="text-amber-300">system.query_log</code> execution data with table definitions to detect unindexed column scans, partition pruning failures, and memory bloat.
                </p>
              </div>

              {/* Read-Only Safety Protocol */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Zero-Mutation Read-Only Setup</span>
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
          ) : (
            <div className="space-y-6">
              {/* Docker Overview */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Container className="h-4 w-4 text-amber-400" />
                  <h3 className="font-bold text-sm text-white">Docker & Containerization Guide</h3>
                </div>
                <p className="text-slate-300">
                  Yachiru includes a production-ready, multi-stage Alpine Docker build (`Dockerfile`) and Docker Compose specification (`docker-compose.yml`) with automated scan history persistence and container health checks.
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
                  <strong className="text-emerald-400">Multi-Stage Alpine Build:</strong>
                  <p className="text-slate-400">Compiles Vite assets and esbuild server into a lightweight, secured runner image under a non-root `node` user.</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                  <strong className="text-emerald-400">Healthcheck & Restart Policy:</strong>
                  <p className="text-slate-400">Built-in container healthcheck pinging `/api/health` with `unless-stopped` auto-recovery.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 px-6 py-3 bg-slate-950/90 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
