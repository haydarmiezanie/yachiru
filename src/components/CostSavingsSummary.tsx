import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  TrendingDown,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  ArrowUpRight,
  Sliders,
  ChevronRight,
  HelpCircle,
  Filter,
  CheckCircle2,
  Table as TableIcon,
  Search,
} from 'lucide-react';
import { AnalysisReport, CheckFinding, CostModel, formatCurrency } from '../types.js';
import { ReportCostSummary, RankedOpportunity, calculateReportCostSummary, loadCostModel } from '../utils/costModel.js';
import { FindingCostDetailModal } from './FindingCostDetailModal.js';

interface CostSavingsSummaryProps {
  report: AnalysisReport;
  onOpenPricingSettings: () => void;
  onSelectFinding?: (findingId: string) => void;
}

export const CostSavingsSummary: React.FC<CostSavingsSummaryProps> = ({
  report,
  onOpenPricingSettings,
  onSelectFinding,
}) => {
  const [selectedOpportunity, setSelectedOpportunity] = useState<CheckFinding | null>(null);
  const [sortBy, setSortBy] = useState<'savings' | 'storage' | 'confidence' | 'severity' | 'table'>('savings');
  const [filterCategory, setFilterCategory] = useState<'all' | 'storage' | 'query' | 'compute'>('all');

  // Compute live summary using active costModel
  const costSummary: ReportCostSummary = useMemo(() => {
    const activeModel = loadCostModel();
    return calculateReportCostSummary(report.findings, report.tables, activeModel);
  }, [report.findings, report.tables]);

  // Sort and filter top opportunities
  const displayedOpportunities = useMemo(() => {
    let list = [...costSummary.topOpportunities];

    if (filterCategory !== 'all') {
      list = list.filter((item) => item.costImpact.category === filterCategory);
    }

    list.sort((a, b) => {
      if (sortBy === 'savings') {
        return b.costImpact.estimatedMonthlySavings - a.costImpact.estimatedMonthlySavings;
      }
      if (sortBy === 'storage') {
        return (b.costImpact.resourceReduction.bytes || 0) - (a.costImpact.resourceReduction.bytes || 0);
      }
      if (sortBy === 'confidence') {
        const score = { high: 3, medium: 2, low: 1 };
        return score[b.costImpact.confidence] - score[a.costImpact.confidence];
      }
      if (sortBy === 'severity') {
        const score = { critical: 3, warning: 2, good: 1 };
        return (score[b.severity as keyof typeof score] || 0) - (score[a.severity as keyof typeof score] || 0);
      }
      if (sortBy === 'table') {
        return (a.table || '').localeCompare(b.table || '');
      }
      return 0;
    });

    return list;
  }, [costSummary.topOpportunities, sortBy, filterCategory]);

  const hasSavings = costSummary.totalMonthlySavings > 0;

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Cost Optimization
            </h3>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
              Deduplicated Model
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1 flex-wrap">
            <span>
              Storage price: <strong className="text-zinc-200 font-mono">${costSummary.costModelUsed.storagePricePerGBMonth}/GB-mo</strong>
            </span>
            <span>•</span>
            <span className="text-zinc-400">
              Source: <span className="text-zinc-300 font-medium">{costSummary.costModelUsed.isCustomPricing ? 'User configured' : 'Default assumption'}</span>
            </span>
            <button
              type="button"
              onClick={onOpenPricingSettings}
              className="text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer ml-1"
            >
              [Change pricing]
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('ranked-opportunities-list');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else if (onSelectFinding) onSelectFinding('savings');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>View Opportunities ({costSummary.totalOpportunitiesCount})</span>
          </button>

          <button
            type="button"
            onClick={onOpenPricingSettings}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Pricing Settings</span>
          </button>
        </div>
      </div>

      {/* Main KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Monthly Savings */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/30 to-zinc-900 border border-emerald-500/30 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Total Potential Savings
            </span>
            <TrendingDown className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-emerald-300 font-mono mt-2 tracking-tight">
            {formatCurrency(costSummary.totalMonthlySavings, costSummary.costModelUsed.currency)}
            <span className="text-xs font-normal text-emerald-400/80 ml-1">/ month</span>
          </div>
          <div className="text-xs text-zinc-400 mt-1.5 flex items-center gap-1.5">
            <span>Run-rate:</span>
            <strong className="text-zinc-200 font-mono">
              {formatCurrency(costSummary.totalAnnualSavings, costSummary.costModelUsed.currency)} / year
            </strong>
          </div>
        </div>

        {/* Storage Savings */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Storage Savings
            </span>
            <HardDrive className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {formatCurrency(costSummary.storageMonthlySavings, costSummary.costModelUsed.currency)}
            <span className="text-xs font-normal text-zinc-400 ml-1">/ month</span>
          </div>
          <div className="text-xs text-zinc-400 mt-1.5 flex items-center gap-1.5">
            <span>Reduction:</span>
            <strong className="text-emerald-400 font-mono">{costSummary.storageBytesReducedFormatted}</strong>
          </div>
        </div>

        {/* Query / Compute Savings */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Query &amp; Compute
            </span>
            <Cpu className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {formatCurrency(costSummary.queryComputeMonthlySavings, costSummary.costModelUsed.currency)}
            <span className="text-xs font-normal text-zinc-400 ml-1">/ month</span>
          </div>
          <div className="text-xs text-zinc-400 mt-1.5 flex items-center gap-1.5">
            <span>Pruned:</span>
            <strong className="text-emerald-400 font-mono">
              {costSummary.queryBytesScannedDailyReducedFormatted}
            </strong>
          </div>
        </div>

        {/* Opportunities Count */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 relative">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Opportunities
            </span>
            <Layers className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {costSummary.totalOpportunitiesCount}
            <span className="text-xs font-normal text-zinc-400 ml-1">identified</span>
          </div>
          <div className="text-xs text-zinc-400 mt-1.5 flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">{costSummary.highImpactCount}</span>
            <span>high-impact (≥ $25/mo)</span>
          </div>
        </div>
      </div>

      {/* Top Optimization Opportunities Section */}
      <div id="ranked-opportunities-list" className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
              Top Ranked Optimization Opportunities
            </h4>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              Deduplicated (No Double-Counting)
            </span>
          </div>

          {/* Sort & Filter controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <span className="text-[11px] text-zinc-500 px-1.5">Category:</span>
              {(['all', 'storage', 'query', 'compute'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition cursor-pointer ${
                    filterCategory === cat ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <span className="text-[11px] text-zinc-500 px-1.5">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-[11px] text-zinc-200 font-mono focus:outline-none cursor-pointer"
              >
                <option value="savings">Monthly Savings ($)</option>
                <option value="storage">Storage Reduction (GB)</option>
                <option value="confidence">Confidence Level</option>
                <option value="severity">Severity</option>
                <option value="table">Table Name</option>
              </select>
            </div>
          </div>
        </div>

        {/* Opportunity List Table */}
        {displayedOpportunities.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-zinc-800 text-center text-xs text-zinc-400">
            No optimization opportunities matching the selected filter.
          </div>
        ) : (
          <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/80 bg-zinc-950/40">
            {displayedOpportunities.map((item, index) => {
              const fullFinding = report.findings.find((f) => f.id === item.findingId);
              return (
                <div
                  key={item.findingId}
                  className="p-3.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-900/60 transition group cursor-pointer"
                  onClick={() => fullFinding && setSelectedOpportunity(fullFinding)}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-xs font-mono font-bold text-zinc-500 w-5 shrink-0 pt-0.5">
                      #{index + 1}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white group-hover:text-emerald-300 transition truncate">
                          {item.title}
                        </span>
                        {item.table && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center gap-1 shrink-0">
                            <TableIcon className="w-2.5 h-2.5 text-zinc-500" />
                            <span>{item.table}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
                        <span className="capitalize text-zinc-500">{item.categoryName}</span>
                        <span>•</span>
                        <span className="text-zinc-300">
                          {item.costImpact.resourceReduction.bytesFormatted || item.costImpact.resourceReduction.queryBytesScannedFormatted || `${item.costImpact.resourceReduction.percentage}% reduction`}
                        </span>
                        <span>•</span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                            item.costImpact.confidence === 'high'
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : item.costImpact.confidence === 'medium'
                              ? 'text-amber-400 bg-amber-500/10'
                              : 'text-zinc-400 bg-zinc-800'
                          }`}
                        >
                          {item.costImpact.confidence} confidence
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-8 sm:pl-0">
                    <div className="text-right">
                      <span className="text-base font-black text-emerald-400 font-mono block">
                        +{formatCurrency(item.costImpact.estimatedMonthlySavings, costSummary.costModelUsed.currency)}
                        <span className="text-[10px] font-normal text-emerald-500/80 ml-0.5">/mo</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono block">
                        {formatCurrency(item.costImpact.annualProjectedSavings, costSummary.costModelUsed.currency)}/yr run-rate
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (fullFinding) setSelectedOpportunity(fullFinding);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>Calculation</span>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disclaimers & Methodology Note */}
      <div className="pt-2 border-t border-zinc-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span>
          * Projected savings are calculated from observed ClickHouse bytes, compression ratios, and query scanning metrics. They represent potential optimization run-rate reductions, not an official cloud bill.
        </span>
        <button
          type="button"
          onClick={onOpenPricingSettings}
          className="text-zinc-400 hover:text-emerald-400 transition cursor-pointer whitespace-nowrap"
        >
          Configure Cloud Unit Pricing →
        </button>
      </div>

      {/* Finding Cost Calculation Modal */}
      {selectedOpportunity && (
        <FindingCostDetailModal
          finding={selectedOpportunity}
          isOpen={Boolean(selectedOpportunity)}
          onClose={() => setSelectedOpportunity(null)}
          onOpenPricingSettings={onOpenPricingSettings}
        />
      )}
    </div>
  );
};
