import React, { useState } from 'react';
import {
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  Check,
  Zap,
  Search,
  Filter,
  Layers,
  ArrowUpRight,
  Sparkles,
  Database,
  Flame,
} from 'lucide-react';
import { DimensionId, Finding, FindingSeverity } from '../types/yachiru';

interface FindingsListProps {
  findings: Finding[];
  selectedDimension: DimensionId | 'all';
  onSelectDimension: (dim: DimensionId | 'all') => void;
}

export const FindingsList: React.FC<FindingsListProps> = ({
  findings,
  selectedDimension,
  onSelectDimension,
}) => {
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');
  const [onlyAiFilter, setOnlyAiFilter] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const aiAnalyzedCount = findings.filter((f) => Boolean(f.aiInsight)).length;

  const handleCopySql = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter findings
  const filteredFindings = findings.filter((f) => {
    if (selectedDimension !== 'all' && f.dimension !== selectedDimension) return false;
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (onlyAiFilter && !f.aiInsight) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchTitle = f.title.toLowerCase().includes(q);
      const matchTable = f.tableName?.toLowerCase().includes(q) || false;
      const matchWhat = f.what.toLowerCase().includes(q);
      const matchSql = f.recommendationSql?.toLowerCase().includes(q) || false;
      return matchTitle || matchTable || matchWhat || matchSql;
    }
    return true;
  });

  const getSeverityBadge = (severity: FindingSeverity) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="flex items-center gap-1 rounded-md bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
            <Flame className="h-3.5 w-3.5" /> CRITICAL
          </span>
        );
      case 'warning':
        return (
          <span className="flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> WARNING
          </span>
        );
      case 'info':
        return (
          <span className="flex items-center gap-1 rounded-md bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-400">
            <Info className="h-3.5 w-3.5" /> INFO
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> OPTIMAL
          </span>
        );
    }
  };

  const getPriorityPill = (priority?: Finding['relativePriority']) => {
    if (!priority) return null;
    const effortColor =
      priority.effort === 'Low' ? 'text-emerald-400' : priority.effort === 'Medium' ? 'text-amber-400' : 'text-rose-400';
    const impactColor =
      priority.impact === 'Critical'
        ? 'text-rose-400 font-bold'
        : priority.impact === 'High'
        ? 'text-amber-400 font-semibold'
        : 'text-blue-400';

    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/80 border border-slate-800 px-2.5 py-1 text-xs">
        <span className="font-mono font-bold text-amber-400">Priority #{priority.rank}</span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-400">
          Effort: <strong className={effortColor}>{priority.effort}</strong>
        </span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-400">
          Impact: <strong className={impactColor}>{priority.impact}</strong>
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 shadow-md">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search findings by table, keyword, or SQL..."
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        {/* Severity Filter */}
        <div className="flex items-center gap-1 overflow-x-auto text-xs">
          {(['all', 'critical', 'warning', 'info'] as const).map((sev) => {
            const count =
              sev === 'all'
                ? findings.length
                : findings.filter((f) => f.severity === sev).length;
            const isSelected = severityFilter === sev;
            return (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`rounded-lg px-2.5 py-1.5 font-medium uppercase tracking-wider transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-950/60 border border-slate-800'
                }`}
              >
                {sev} ({count})
              </button>
            );
          })}

          {/* AI Insights Filter Toggle */}
          {aiAnalyzedCount > 0 && (
            <button
              onClick={() => setOnlyAiFilter(!onlyAiFilter)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium transition-all whitespace-nowrap ${
                onlyAiFilter
                  ? 'bg-purple-600 text-white font-bold shadow'
                  : 'text-purple-300 hover:text-purple-100 bg-purple-950/40 border border-purple-500/30'
              }`}
              title="Filter findings analyzed with deep AI reasoning"
            >
              <Sparkles className="h-3 w-3 text-purple-400" />
              <span>AI Enriched ({aiAnalyzedCount}/{findings.length})</span>
            </button>
          )}
        </div>

        {/* Dimension Filter Dropdown */}
        <div className="flex items-center gap-1.5 text-xs">
          <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <select
            value={selectedDimension}
            onChange={(e) => onSelectDimension(e.target.value as any)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">All 9 Dimensions</option>
            <option value="table_engines_partitioning">1. Table Engines & Partitioning</option>
            <option value="parts_and_merges">2. Parts & Merge Health</option>
            <option value="primary_key_and_query_patterns">3. Primary Key & query_log</option>
            <option value="skip_indexes">4. Skip Indexes</option>
            <option value="data_types_and_storage">5. Data Types & Storage</option>
            <option value="ttl_and_tiering">6. TTL & Retention</option>
            <option value="materialized_views_redundant_compute">7. Materialized Views</option>
            <option value="resource_and_config">8. Resource & Config</option>
            <option value="general_query_performance">9. General Query Performance</option>
          </select>
        </div>
      </div>

      {/* Findings List */}
      {filteredFindings.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400/80 mb-3" />
          <h3 className="text-sm font-semibold text-slate-200">No matching issues found</h3>
          <p className="mt-1 text-xs text-slate-400">
            Try adjusting your search criteria or switching dimension filters.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFindings.map((finding) => (
            <div
              key={finding.id}
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg hover:border-slate-700 transition-all space-y-4"
            >
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3.5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {getSeverityBadge(finding.severity)}
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      {finding.dimensionName}
                    </span>
                    {finding.tableName && (
                      <span className="flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-mono text-amber-300">
                        <Database className="h-3 w-3" />
                        {finding.tableName}
                      </span>
                    )}
                    {finding.aiInsight && (
                      <span className="flex items-center gap-1 rounded bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-[11px] font-medium text-purple-300">
                        <Sparkles className="h-3 w-3 text-purple-400" />
                        AI Enhanced
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-slate-100 mt-1">{finding.title}</h3>
                </div>

                {/* Priority / Estimated Impact Badge */}
                <div className="flex flex-col sm:items-end gap-1.5">
                  {getPriorityPill(finding.relativePriority)}
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>Est. Impact: <strong>{finding.estimatedImpact.magnitude}</strong></span>
                  </div>
                </div>
              </div>

              {/* What / Evidence Box */}
              <div className="rounded-lg border border-slate-800/90 bg-slate-950/70 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <Database className="h-3.5 w-3.5 text-amber-400" />
                  <span>Evidence from ClickHouse System Tables</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-mono">
                  {finding.what}
                </p>
              </div>

              {/* Why It Matters (Technical & AI Insights) */}
              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
                  <span className="font-semibold text-slate-400 block mb-1">Technical Architecture Impact (System Tables):</span>
                  <p className="text-slate-300 leading-relaxed">{finding.whyTechnical}</p>
                </div>

                {/* AI Deep Reasoning (Shown when AI successfully synthesized insight) */}
                {finding.aiInsight ? (
                  <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-3.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="flex items-center gap-1.5 font-bold text-purple-300">
                        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                        AI Architectural Insight & Context:
                      </span>
                      {finding.aiRiskLevel && (
                        <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-200 uppercase">
                          AI Risk: {finding.aiRiskLevel}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-200 leading-relaxed">{finding.aiInsight}</p>
                  </div>
                ) : finding.whyNarrative && (
                  <div className="rounded-lg border border-slate-800/80 bg-slate-950/30 p-3">
                    <span className="font-semibold text-slate-400 block mb-1">
                      Rule-Based Diagnostic Rationale:
                    </span>
                    <p className="text-slate-400 leading-relaxed">{finding.whyNarrative}</p>
                  </div>
                )}
              </div>

              {/* Recommendation Summary */}
              <div className="text-xs text-slate-300 font-medium">
                <span className="text-amber-400 font-semibold">Recommended Action: </span>
                {finding.recommendationSummary}
              </div>

              {/* AI Generated Custom SQL (if available) */}
              {finding.aiSqlFix && (
                <div className="rounded-lg border border-purple-500/30 bg-slate-950 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-purple-500/20 px-3.5 py-1.5 bg-purple-950/30 text-xs">
                    <span className="flex items-center gap-1.5 font-mono text-purple-300 font-semibold">
                      <Sparkles className="h-3 w-3 text-purple-400" />
                      AI Recommended Custom SQL Remediation
                    </span>
                    <button
                      onClick={() => handleCopySql(`${finding.id}-ai`, finding.aiSqlFix!)}
                      className="flex items-center gap-1 rounded bg-purple-900/60 px-2 py-0.5 text-[11px] font-medium text-purple-200 hover:bg-purple-800 transition-colors cursor-pointer"
                    >
                      {copiedId === `${finding.id}-ai` ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-purple-300" />
                          <span>Copy AI SQL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3.5 font-mono text-xs text-purple-200 overflow-x-auto leading-relaxed bg-slate-950">
                    <code>{finding.aiSqlFix}</code>
                  </pre>
                </div>
              )}

              {/* Executable DDL / SQL Code Block (Deterministic Base Fix) */}
              {finding.recommendationSql && !finding.aiSqlFix && (
                <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-1.5 bg-slate-900/60 text-xs">
                    <span className="font-mono text-slate-400">Deterministic Migration DDL</span>
                    <button
                      onClick={() => handleCopySql(finding.id, finding.recommendationSql!)}
                      className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                    >
                      {copiedId === finding.id ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-slate-400" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3.5 font-mono text-xs text-amber-200/90 overflow-x-auto leading-relaxed bg-slate-950">
                    <code>{finding.recommendationSql}</code>
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
