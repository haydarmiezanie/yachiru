import React, { useState } from 'react';
import { ShieldCheck, Download, Copy, Check, AlertCircle, FileCode, Play, Terminal } from 'lucide-react';
import { ScanReport } from '../types/yachiru.js';

interface MigrationGeneratorProps {
  report: ScanReport;
}

export const MigrationGenerator: React.FC<MigrationGeneratorProps> = ({ report }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(report.migrationScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([report.migrationScript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `yachiru_migration_${report.target.database}_${new Date().toISOString().split('T')[0]}.sql`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-6">
      {/* Safety Notice & Execution Header */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-amber-300">
              Deterministic DDL Migration Plan (Dry-Run & Manual Review Protocol)
            </h3>
            <p className="mt-1 text-xs text-slate-300 leading-relaxed">
              Yachiru operates strictly in <strong>read-only mode</strong>. The SQL migration script below is synthesized from deterministic scan findings and must be manually tested in your development or staging environment before applying to production.
            </p>
          </div>
        </div>
      </div>

      {/* Migration Script Viewer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3 gap-3">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-xs font-semibold text-slate-200">
              yachiru_migration_{report.target.database}.sql
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
              {report.findings.filter((f) => f.recommendationSql).length} DDL statements
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                  <span>Copy SQL</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download .sql</span>
            </button>
          </div>
        </div>

        {/* Code Preview */}
        <pre className="p-4 sm:p-6 font-mono text-xs text-amber-200/90 leading-relaxed overflow-x-auto bg-slate-950 max-h-[600px] selection:bg-amber-500/30 selection:text-white">
          <code>{report.migrationScript}</code>
        </pre>
      </div>

      {/* Suggested Staging Execution Order */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
        <h4 className="font-semibold text-sm text-slate-200 uppercase tracking-wider">
          Recommended Safe Rollout Order
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-emerald-400">Phase 1: Online Non-Blocking</span>
            <p className="text-slate-400 leading-relaxed">
              Apply <code className="text-amber-300">MODIFY COLUMN ... LowCardinality</code> and skip indexes with <code className="text-amber-300">ADD INDEX</code>. These execute without table locks.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-blue-400">Phase 2: Redundant Compute</span>
            <p className="text-slate-400 leading-relaxed">
              Create <code className="text-amber-300">Materialized Views</code> and Target tables to pre-aggregate high-frequency queries.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-amber-400">Phase 3: Structural Key Rewrites</span>
            <p className="text-slate-400 leading-relaxed">
              For table engine conversions or partition key redesigns, create a <code className="text-amber-300">_v2</code> table and use <code className="text-amber-300">RENAME TABLE</code> swap.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
