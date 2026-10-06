import React, { useState, useMemo, useEffect } from 'react';
import { CheckCategory, CheckFinding, CheckSeverity, formatCurrency } from '../types.js';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  Search,
  Filter,
  Code2,
  Table as TableIcon,
  ChevronDown,
  Sparkles,
  Zap,
  ListOrdered,
  Activity,
  DollarSign,
  Calculator,
  TrendingDown,
} from 'lucide-react';
import { FindingCostDetailModal } from './FindingCostDetailModal.js';

interface FindingsListProps {
  findings: CheckFinding[];
  selectedCategory: CheckCategory | 'all';
  onCategoryChange: (cat: CheckCategory | 'all') => void;
  tables: string[];
  scanId?: string;
  isAiGenerated?: boolean;
  narrativeIdentity?: string;
  initialSavingsOnly?: boolean;
}

export const FindingsList: React.FC<FindingsListProps> = ({
  findings,
  selectedCategory,
  onCategoryChange,
  tables,
  scanId,
  isAiGenerated,
  narrativeIdentity,
  initialSavingsOnly,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | CheckSeverity>('all');

  // Derive whether AI-diagnosed findings are present in the current report
  const hasAiFindings = useMemo(() => findings.some((f) => f.is_ai_diagnosed), [findings]);

  // Initial sourceFilter state: if AI findings are present, default to 'ai', otherwise 'all'
  const [sourceFilter, setSourceFilter] = useState<'all' | 'ai' | 'deterministic'>(() =>
    findings.some((f) => f.is_ai_diagnosed) ? 'ai' : 'all'
  );
  const [savingsOnlyFilter, setSavingsOnlyFilter] = useState(Boolean(initialSavingsOnly));

  useEffect(() => {
    if (initialSavingsOnly !== undefined) {
      setSavingsOnlyFilter(initialSavingsOnly);
    }
  }, [initialSavingsOnly]);
  const [sortBy, setSortBy] = useState<'default' | 'savings_desc' | 'storage_desc'>('default');
  const [costDetailFinding, setCostDetailFinding] = useState<CheckFinding | null>(null);
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Automatically select 'ai' on a fresh scan or narrative regeneration whenever AI findings are present, otherwise 'all'.
  // Keyed on the stable identity of the current report and narrative generation.
  // The user remains able to manually switch the toggle afterward without this effect overriding their choice.
  useEffect(() => {
    if (hasAiFindings) {
      setSourceFilter('ai');
    } else {
      setSourceFilter('all');
    }
  }, [scanId, isAiGenerated, narrativeIdentity, hasAiFindings]);

  const handleCopySql = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filter, deduplicate by ID, and sort
  const filteredFindings = useMemo(() => {
    const seenIds = new Set<string>();
    return findings
      .filter((f) => {
        if (seenIds.has(f.id)) return false;
        seenIds.add(f.id);

        if (selectedCategory !== 'all' && f.category !== selectedCategory) return false;
        if (severityFilter !== 'all' && f.status !== severityFilter) return false;
        if (tableFilter !== 'all' && f.table !== tableFilter) return false;
        if (sourceFilter === 'ai' && !f.is_ai_diagnosed) return false;
        if (sourceFilter === 'deterministic' && f.is_ai_diagnosed) return false;
        if (savingsOnlyFilter && (!f.cost_impact || f.cost_impact.estimatedMonthlySavings <= 0)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = f.title.toLowerCase().includes(q);
          const matchTable = f.table?.toLowerCase().includes(q) || false;
          const matchEvidence = f.evidence.toLowerCase().includes(q);
          const matchImpact = f.impact.toLowerCase().includes(q);
          const matchRootCause = f.ai_root_cause?.toLowerCase().includes(q) || false;
          if (!matchTitle && !matchTable && !matchEvidence && !matchImpact && !matchRootCause) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'savings_desc') {
          return (b.cost_impact?.estimatedMonthlySavings || 0) - (a.cost_impact?.estimatedMonthlySavings || 0);
        }
        if (sortBy === 'storage_desc') {
          return (b.cost_impact?.resourceReduction?.bytes || 0) - (a.cost_impact?.resourceReduction?.bytes || 0);
        }
        // AI findings priority if same severity
        const order: Record<CheckSeverity, number> = { critical: 0, warning: 1, good: 2 };
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status];
        }
        if (a.is_ai_diagnosed && !b.is_ai_diagnosed) return -1;
        if (!a.is_ai_diagnosed && b.is_ai_diagnosed) return 1;
        return 0;
      });
  }, [findings, selectedCategory, severityFilter, sourceFilter, tableFilter, savingsOnlyFilter, sortBy, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: findings.length,
      ai: findings.filter((f) => f.is_ai_diagnosed).length,
      deterministic: findings.filter((f) => !f.is_ai_diagnosed).length,
      critical: findings.filter((f) => f.status === 'critical').length,
      warning: findings.filter((f) => f.status === 'warning').length,
      good: findings.filter((f) => f.status === 'good').length,
      withSavings: findings.filter((f) => f.cost_impact && f.cost_impact.estimatedMonthlySavings > 0).length,
    };
  }, [findings]);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl">
      {/* Title & Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-5 border-b border-zinc-800">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            Detailed Diagnostic Findings & Remediations
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
              {filteredFindings.length} of {findings.length}
            </span>
          </h3>
          <p className="text-xs text-zinc-400">
            ClickHouse architectural evaluations, root cause diagnoses, and executable remediation scripts
          </p>
        </div>

        {/* Source Switcher (All vs AI vs Deterministic) & Severity */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Engine Source Filter */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                sourceFilter === 'all'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All Sources ({counts.all})
            </button>
            {counts.ai > 0 && (
              <button
                onClick={() => setSourceFilter('ai')}
                className={`px-2.5 py-1.5 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                  sourceFilter === 'ai'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-rose-400" />
                <span>AI Diagnosed ({counts.ai})</span>
              </button>
            )}
            <button
              onClick={() => setSourceFilter('deterministic')}
              className={`px-2.5 py-1.5 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                sourceFilter === 'deterministic'
                  ? 'bg-zinc-800 text-amber-300 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Rule Engine ({counts.deterministic})</span>
            </button>
          </div>

          {/* Severity Tabs */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs overflow-x-auto">
            <button
              onClick={() => setSeverityFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                severityFilter === 'all'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All Severities
            </button>
            <button
              onClick={() => setSeverityFilter('critical')}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                severityFilter === 'critical'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-rose-400/80 hover:text-rose-300'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>Critical ({counts.critical})</span>
            </button>
            <button
              onClick={() => setSeverityFilter('warning')}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                severityFilter === 'warning'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-amber-400/80 hover:text-amber-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Warning ({counts.warning})</span>
            </button>
            <button
              onClick={() => setSeverityFilter('good')}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                severityFilter === 'good'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-emerald-400/80 hover:text-emerald-300'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Optimal ({counts.good})</span>
            </button>
          </div>

          {/* With Cost Savings Filter Toggle */}
          <button
            type="button"
            onClick={() => setSavingsOnlyFilter(!savingsOnlyFilter)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
              savingsOnlyFilter
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span>Has Potential Savings ({counts.withSavings})</span>
          </button>
        </div>
      </div>

      {/* Filter Row: Search & Dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-6">
        <div className="sm:col-span-4 relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search diagnosis, root cause, evidence metrics, or table..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition"
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-rose-500 transition"
          >
            <option value="all">All Tables ({tables.length})</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                Table: {t}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-3">
          <select
            value={selectedCategory}
            onChange={(e) => onCategoryChange(e.target.value as CheckCategory | 'all')}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-rose-500 transition"
          >
            <option value="all">All Categories</option>
            <option value="part_health">Part Health & Compaction</option>
            <option value="primary_key">Primary Key & ORDER BY</option>
            <option value="partitioning">Partitioning Strategy</option>
            <option value="compression">Compression & Codecs</option>
            <option value="table_engine">Table Engine Sanity</option>
            <option value="skip_indices">Data Skipping Indices</option>
            <option value="query_performance">Query Performance & Pruning</option>
            <option value="replication_distributed">Replication & Distributed</option>
            <option value="server_settings">Server & MergeTree Settings</option>
            <option value="mutations">Table Mutations</option>
            <option value="disk_space">Disk Space & Storage</option>
            <option value="system_errors">System Errors & Stability</option>
            <option value="replication_queue">Replication Queue & Retries</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 font-mono transition"
          >
            <option value="default">Sort: Default</option>
            <option value="savings_desc">Sort: Savings ($)</option>
            <option value="storage_desc">Sort: Storage (GB)</option>
          </select>
        </div>
      </div>

      {/* Findings List Items */}
      {filteredFindings.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-zinc-800 rounded-xl">
          <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-sm font-medium text-zinc-400">No findings match your current filters</p>
          <button
            onClick={() => {
              setSeverityFilter('all');
              setSourceFilter('all');
              setTableFilter('all');
              setSearchQuery('');
              onCategoryChange('all');
            }}
            className="mt-3 text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
          >
            Reset all filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFindings.map((f) => {
            const isCritical = f.status === 'critical';
            const isWarning = f.status === 'warning';
            const isAi = Boolean(f.is_ai_diagnosed);

            let statusBadge = (
              <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                OPTIMAL
              </span>
            );

            let cardBorder = isAi ? 'border-rose-500/30 bg-zinc-950/70 shadow-md' : 'border-zinc-800 bg-zinc-900/40';

            if (isCritical) {
              statusBadge = (
                <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertOctagon className="w-3.5 h-3.5" />
                  CRITICAL
                </span>
              );
              cardBorder = isAi
                ? 'border-rose-500/50 bg-rose-950/15 shadow-lg'
                : 'border-rose-500/40 bg-zinc-950/60';
            } else if (isWarning) {
              statusBadge = (
                <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  WARNING
                </span>
              );
              cardBorder = isAi
                ? 'border-amber-500/40 bg-amber-950/15 shadow-md'
                : 'border-amber-500/30 bg-zinc-950/40';
            }

            return (
              <div
                key={f.id}
                className={`p-5 rounded-xl border ${cardBorder} transition-all duration-150 hover:border-zinc-700 space-y-4`}
              >
                {/* Header: Status, Title, Category & Table Tag */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {statusBadge}
                    {isAi && (
                      <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        <Sparkles className="w-3 h-3 text-rose-400" />
                        AI DIAGNOSED
                      </span>
                    )}
                    <h4 className="text-sm font-bold text-white">{f.title}</h4>
                  </div>

                  <div className="flex items-center gap-2">
                    {f.table && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center gap-1">
                        <TableIcon className="w-3 h-3 text-zinc-500" />
                        <span>{f.table}</span>
                      </span>
                    )}
                    <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-medium">
                      {f.category_name}
                    </span>
                  </div>
                </div>

                {/* Evidence & Assessment Box */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-lg bg-zinc-900/90 border border-zinc-800/80">
                  <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-zinc-800 pb-2 md:pb-0 md:pr-3">
                    <span className="text-[11px] font-semibold text-zinc-500 uppercase block mb-1">
                      {isAi ? 'Assessment Vector' : 'Observed Metric'}
                    </span>
                    <span className="text-xs font-mono font-bold text-zinc-100 block">
                      {f.metric_value}
                    </span>
                    <span className="text-[11px] text-zinc-400 mt-1 block">
                      {f.threshold}
                    </span>
                  </div>

                  <div className="md:col-span-8">
                    <span className="text-[11px] font-semibold text-zinc-500 uppercase block mb-1">
                      {isAi ? 'Deep Architectural Evaluation' : 'Evidence Extracted from ClickHouse'}
                    </span>
                    <p className="text-xs text-zinc-300 leading-relaxed font-sans whitespace-pre-wrap">
                      {f.evidence}
                    </p>
                  </div>
                </div>

                {/* Potential Cost Savings Callout Card */}
                {f.cost_impact && (f.cost_impact.estimatedMonthlySavings > 0 || f.cost_impact.technicalReductionOnlyText) && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-zinc-950/70 to-zinc-900 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 font-mono flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          <span>POTENTIAL SAVINGS</span>
                        </span>
                        <span className="text-zinc-600">•</span>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                            f.cost_impact.confidence === 'high'
                              ? 'text-emerald-300 bg-emerald-500/20 border border-emerald-500/30'
                              : f.cost_impact.confidence === 'medium'
                              ? 'text-amber-300 bg-amber-500/20 border border-amber-500/30'
                              : 'text-zinc-400 bg-zinc-800 border border-zinc-700'
                          }`}
                        >
                          CONFIDENCE: {f.cost_impact.confidence.toUpperCase()}
                        </span>
                      </div>

                      {f.cost_impact.estimatedMonthlySavings > 0 ? (
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className="text-xl font-black text-emerald-300 font-mono tracking-tight">
                            +{formatCurrency(f.cost_impact.estimatedMonthlySavings)}
                            <span className="text-xs font-normal text-emerald-400/80 ml-1">/ month</span>
                          </span>

                          <span className="text-xs text-zinc-300 font-medium">
                            {f.cost_impact.resourceReduction.bytesFormatted && `${f.cost_impact.resourceReduction.bytesFormatted} storage reduction`}
                            {f.cost_impact.resourceReduction.queryBytesScannedFormatted && `${f.cost_impact.resourceReduction.queryBytesScannedFormatted} query scan reduction`}
                            {f.cost_impact.savingsPercentage !== undefined && (
                              <span className="text-emerald-400 font-semibold ml-1.5 font-mono">
                                ({f.cost_impact.savingsPercentage}% smaller)
                              </span>
                            )}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-300 font-mono">
                          {f.cost_impact.technicalReductionOnlyText || 'Technical workload reduction available'}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setCostDetailFinding(f)}
                      className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      <span>View Calculation</span>
                    </button>
                  </div>
                )}

                {/* AI Root Cause & Risk Vector (if available) */}
                {f.ai_root_cause && (
                  <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-semibold text-rose-300/90 flex items-center gap-1 mb-1">
                        <Activity className="w-3.5 h-3.5 text-rose-400" />
                        Root Cause
                      </span>
                      <p className="text-zinc-400 leading-relaxed">{f.ai_root_cause}</p>
                    </div>
                    {f.ai_risk_vector && (
                      <div>
                        <span className="font-semibold text-amber-300/90 flex items-center gap-1 mb-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          Risk Vector
                        </span>
                        <p className="text-zinc-400 leading-relaxed">{f.ai_risk_vector}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* AI Multi-Step Remediation Plan */}
                {f.ai_remediation_steps && f.ai_remediation_steps.length > 0 && (
                  <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-800/60 text-xs">
                    <span className="font-semibold text-zinc-300 flex items-center gap-1.5 mb-2">
                      <ListOrdered className="w-3.5 h-3.5 text-rose-400" />
                      Remediation Plan Steps
                    </span>
                    <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                      {f.ai_remediation_steps.map((step, idx) => (
                        <li key={idx} className="leading-relaxed">
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Technical Impact (if deterministic) */}
                {!f.ai_root_cause && f.impact && (
                  <div className="text-xs text-zinc-400 leading-relaxed">
                    <strong className="text-zinc-300">ClickHouse Mechanics: </strong>
                    {f.impact}
                  </div>
                )}

                {/* Copyable SQL or Action Recommendation */}
                {f.recommendation_sql_or_text && (
                  <div className="pt-2 border-t border-zinc-800/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5 text-zinc-400" />
                        <span>
                          {f.is_sql_recommendation ? 'Recommended Remediation SQL / Tuning Command:' : 'Recommendation:'}
                        </span>
                      </span>

                      {f.is_sql_recommendation && (
                        <button
                          onClick={() => handleCopySql(f.id, f.recommendation_sql_or_text)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                        >
                          {copiedId === f.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied SQL</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-zinc-400" />
                              <span>Copy SQL</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {f.is_sql_recommendation ? (
                      <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-rose-300/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                        <code>{f.recommendation_sql_or_text}</code>
                      </pre>
                    ) : (
                      <p className="text-xs text-zinc-300 bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-850 whitespace-pre-wrap">
                        {f.recommendation_sql_or_text}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finding Cost Calculation Breakdown Modal */}
      {costDetailFinding && (
        <FindingCostDetailModal
          finding={costDetailFinding}
          isOpen={Boolean(costDetailFinding)}
          onClose={() => setCostDetailFinding(null)}
        />
      )}
    </div>
  );
};
