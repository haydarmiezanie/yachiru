import React, { useState } from 'react';
import { X, DollarSign, Calculator, HelpCircle, CheckCircle2, ShieldCheck, Sparkles, AlertOctagon, AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import { CheckFinding, CostImpact, formatCurrency } from '../types.js';

interface FindingCostDetailModalProps {
  finding: CheckFinding | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenPricingSettings?: () => void;
}

export const FindingCostDetailModal: React.FC<FindingCostDetailModalProps> = ({
  finding,
  isOpen,
  onClose,
  onOpenPricingSettings,
}) => {
  const [copied, setCopied] = useState(false);
  if (!isOpen || !finding || !finding.cost_impact) return null;

  const impact: CostImpact = finding.cost_impact;
  const isStorage = impact.category === 'storage';
  const isQuery = impact.category === 'query';
  const isCompute = impact.category === 'compute';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cost-detail-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 font-mono">
                  {impact.category.toUpperCase()} OPTIMIZATION ROI
                </span>
                <span className="text-zinc-600">•</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                    impact.confidence === 'high'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : impact.confidence === 'medium'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {impact.confidence} Confidence
                </span>
              </div>
              <h2 id="cost-detail-title" className="text-base font-bold text-white tracking-tight mt-0.5">
                {finding.title}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Financial KPI Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
            <div>
              <span className="text-[11px] font-semibold text-emerald-400/80 uppercase block">
                Potential Savings
              </span>
              <div className="text-2xl font-black text-emerald-300 font-mono mt-0.5">
                {formatCurrency(impact.estimatedMonthlySavings)}
                <span className="text-xs font-normal text-emerald-400/80 ml-1">/ month</span>
              </div>
              {impact.savingsRange && (
                <span className="text-[10px] text-emerald-400/60 block mt-0.5">
                  Est. range: {formatCurrency(impact.savingsRange.minMonthlySavings)}–{formatCurrency(impact.savingsRange.maxMonthlySavings)}
                </span>
              )}
            </div>

            <div>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase block">
                Projected Annual ROI
              </span>
              <div className="text-2xl font-black text-white font-mono mt-0.5">
                {formatCurrency(impact.annualProjectedSavings)}
                <span className="text-xs font-normal text-zinc-400 ml-1">/ year</span>
              </div>
              <span className="text-[10px] text-zinc-500 block mt-0.5">
                Current workload run-rate (×12)
              </span>
            </div>

            <div>
              <span className="text-[11px] font-semibold text-zinc-400 uppercase block">
                Resource Reduction
              </span>
              <div className="text-xl font-bold text-zinc-100 font-mono mt-1">
                {impact.resourceReduction.bytesFormatted || impact.resourceReduction.queryBytesScannedFormatted || (impact.resourceReduction.percentage ? `${impact.resourceReduction.percentage}% smaller` : 'Optimized')}
              </div>
              {impact.savingsPercentage !== undefined && (
                <span className="text-[11px] text-emerald-400 font-semibold block mt-0.5">
                  ~{impact.savingsPercentage}% reduction
                </span>
              )}
            </div>
          </div>

          {/* Step-by-Step Calculation Breakdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                <span>How This Was Calculated (Step-by-Step)</span>
              </h3>
              {onOpenPricingSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPricingSettings();
                  }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 underline transition cursor-pointer"
                >
                  Adjust pricing assumptions
                </button>
              )}
            </div>

            <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40 divide-y divide-zinc-800/80">
              {impact.calculationSteps.map((step, idx) => (
                <div key={idx} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span className="text-zinc-400 font-medium">{step.label}</span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-zinc-100">{step.value}</span>
                    {step.detail && (
                      <span className="text-[10px] text-zinc-500 block">{step.detail}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] font-mono text-zinc-400 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/60">
              <strong>Methodology:</strong> {impact.methodology}
            </p>
          </div>

          {/* Stated Assumptions & Confidence Reason */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Assumptions &amp; Confidence Model</span>
            </h3>

            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800 space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">•</span>
                <span className="text-zinc-300">
                  <strong className="text-zinc-200">Confidence rationale ({impact.confidence}):</strong> {impact.confidenceReason}
                </span>
              </div>

              {impact.assumptions.map((assump, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-zinc-500 font-bold">•</span>
                  <span className="text-zinc-400">{assump}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action Required */}
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white block uppercase tracking-wider">
                Recommended Action
              </span>
              {finding.recommendation_sql_or_text && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(finding.recommendation_sql_or_text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-semibold text-zinc-300 transition flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Remediation'}</span>
                </button>
              )}
            </div>
            {impact.calculationBasis && (
              <p className="text-[11px] text-zinc-400 mb-1.5 font-medium">
                <strong>Basis:</strong> {impact.calculationBasis}
              </p>
            )}
            <pre className="text-xs text-zinc-300 leading-relaxed font-mono whitespace-pre-wrap bg-zinc-950 p-3 rounded-lg border border-zinc-800/80 overflow-x-auto">
              {finding.recommendation_sql_or_text}
            </pre>
          </div>

          <div className="text-[11px] text-zinc-500 italic text-center">
            * This calculation is a projected estimate based on observed ClickHouse metrics and configured unit rates, not an official cloud provider invoice.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/40">
          <span className="text-[11px] text-zinc-500 font-mono">
            Optimization Group: {impact.optimizationGroup}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
