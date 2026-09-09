import React, { useState } from 'react';
import { ShieldCheck, Download, Copy, Check, Sparkles, FileCode, Cpu, Layers, Terminal, CheckCircle2 } from 'lucide-react';
import { ScanReport } from '../types/yachiru';

interface MigrationGeneratorProps {
  report: ScanReport;
}

export const MigrationGenerator: React.FC<MigrationGeneratorProps> = ({ report }) => {
  const hasAiScript = Boolean(report.aiMigrationScript);
  const hasDeterministicScript = Boolean(report.deterministicMigrationScript);
  
  // Default to AI script if available, otherwise deterministic
  const [selectedMode, setSelectedMode] = useState<'ai' | 'deterministic'>(
    hasAiScript || report.isAiMigration ? 'ai' : 'deterministic'
  );
  const [copied, setCopied] = useState(false);

  const activeScript =
    selectedMode === 'ai' && report.aiMigrationScript
      ? report.aiMigrationScript
      : (report.deterministicMigrationScript || report.migrationScript);

  const isCurrentAi = selectedMode === 'ai' && Boolean(report.aiMigrationScript || report.isAiMigration);

  const handleCopy = () => {
    navigator.clipboard.writeText(activeScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([activeScript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    const prefix = isCurrentAi ? 'yachiru_ai_migration' : 'yachiru_deterministic_migration';
    element.download = `${prefix}_${report.target.database}_${new Date().toISOString().split('T')[0]}.sql`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const ddlCount = isCurrentAi
    ? report.findings.filter((f) => f.aiSqlFix || f.recommendationSql).length
    : report.findings.filter((f) => f.recommendationSql).length;

  return (
    <div className="space-y-6">
      {/* Script Mode Selector & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            isCurrentAi ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          }`}>
            {isCurrentAi ? <Sparkles className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-slate-100">
                {isCurrentAi ? 'AI-Synthesized DDL Migration Plan' : 'Deterministic Baseline DDL Plan'}
              </h3>
              {isCurrentAi && (
                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/40">
                  {report.executiveSummary?.modelUsed || (report.aiProvider === 'openai' ? 'OpenAI GPT-4o' : 'Google Gemini')}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {isCurrentAi
                ? 'Customized by AI engine incorporating table schemas, partition strategies, and non-blocking rollout phases.'
                : 'Rule-based heuristic templates generated from static threshold diagnostics.'}
            </p>
          </div>
        </div>

        {/* Toggle Mode Pills */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 self-start sm:self-auto">
          <button
            onClick={() => setSelectedMode('ai')}
            disabled={!hasAiScript && !report.isAiMigration}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              selectedMode === 'ai'
                ? 'bg-purple-600 text-white shadow-md'
                : hasAiScript || report.isAiMigration
                ? 'text-slate-400 hover:text-purple-300'
                : 'text-slate-600 cursor-not-allowed opacity-50'
            }`}
            title={!hasAiScript && !report.isAiMigration ? 'AI synthesis was not enabled for this scan' : 'View AI-synthesized migration script'}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Synthesized</span>
          </button>
          <button
            onClick={() => setSelectedMode('deterministic')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              selectedMode === 'deterministic'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-amber-300'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Baseline Heuristic</span>
          </button>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-amber-300">
              Safe Rollout Protocol (Read-Only dry-run execution)
            </h3>
            <p className="mt-1 text-xs text-slate-300 leading-relaxed">
              Yachiru operates strictly in <strong>read-only mode</strong>. All SQL statements below are generated for manual inspection and dry-run testing. Always test schema conversions in staging or a development replica before executing on production!
            </p>
          </div>
        </div>
      </div>

      {/* Migration Script Viewer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3 gap-3">
          <div className="flex items-center gap-2">
            <FileCode className={`h-4 w-4 ${isCurrentAi ? 'text-purple-400' : 'text-amber-400'}`} />
            <span className="font-mono text-xs font-semibold text-slate-200">
              {isCurrentAi ? `yachiru_ai_migration_${report.target.database}.sql` : `yachiru_migration_${report.target.database}.sql`}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
              {ddlCount} DDL recommendations
            </span>
            {isCurrentAi && (
              <span className="flex items-center gap-1 rounded bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                <Sparkles className="h-3 w-3" />
                AI Phased Plan
              </span>
            )}
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
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                isCurrentAi
                  ? 'bg-purple-600 text-white hover:bg-purple-500'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download .sql</span>
            </button>
          </div>
        </div>

        {/* Code Preview */}
        <pre className="p-4 sm:p-6 font-mono text-xs text-amber-200/90 leading-relaxed overflow-x-auto bg-slate-950 max-h-[600px] selection:bg-amber-500/30 selection:text-white">
          <code>{activeScript}</code>
        </pre>
      </div>

      {/* Suggested Staging Execution Order */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            Recommended Safe Rollout Order
          </h4>
          {isCurrentAi && (
            <span className="text-xs text-purple-400 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Structured for zero downtime
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-emerald-400">Phase 1: Online Non-Blocking</span>
            <p className="text-slate-400 leading-relaxed">
              Apply <code className="text-amber-300">MODIFY COLUMN ... LowCardinality</code>, Codecs, and skip indexes with <code className="text-amber-300">ADD INDEX</code>. Minimal locking.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-blue-400">Phase 2: Redundant Compute</span>
            <p className="text-slate-400 leading-relaxed">
              Deploy <code className="text-amber-300">Materialized Views</code> and Target tables to pre-aggregate high-frequency analytical queries.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-amber-400">Phase 3: Structural Key Rewrites</span>
            <p className="text-slate-400 leading-relaxed">
              For table engine conversions or partition key redesigns, create a <code className="text-amber-300">_v2</code> shadow table, stream data, and use <code className="text-amber-300">EXCHANGE TABLES</code>.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
            <span className="font-bold text-purple-400">Phase 4: Retention & Verification</span>
            <p className="text-slate-400 leading-relaxed">
              Configure <code className="text-amber-300">TTL</code> policies and monitor <code className="text-amber-300">system.parts</code> & <code className="text-amber-300">system.mutations</code> to confirm progress.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

