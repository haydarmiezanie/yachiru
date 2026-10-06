import React, { useState, useEffect } from 'react';
import { X, DollarSign, RotateCcw, Check, Info, ShieldCheck, Sparkles } from 'lucide-react';
import { CostModel, DEFAULT_COST_MODEL, loadCostModel, saveCostModel, resetCostModel } from '../utils/costModel.js';

interface PricingSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCostModelUpdated?: (model: CostModel) => void;
}

export const PricingSettingsModal: React.FC<PricingSettingsModalProps> = ({
  isOpen,
  onClose,
  onCostModelUpdated,
}) => {
  const [model, setModel] = useState<CostModel>(loadCostModel);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModel(loadCostModel());
      setIsSaved(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = saveCostModel(model);
    setModel(updated);
    setIsSaved(true);
    if (onCostModelUpdated) {
      onCostModelUpdated(updated);
    }
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 600);
  };

  const handleReset = () => {
    const defaultModel = resetCostModel();
    setModel(defaultModel);
    if (onCostModelUpdated) {
      onCostModelUpdated(defaultModel);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h2 id="pricing-modal-title" className="text-base font-bold text-white tracking-tight">
                Cost Savings Model &amp; Cloud Pricing
              </h2>
              <p className="text-xs text-zinc-400">
                Configure cloud infrastructure rates to calibrate estimated monthly ROI
              </p>
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

        {/* Content Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 flex items-start gap-2.5 leading-relaxed">
            <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span>
                Yachiru calculates potential savings directly from observed database bytes, compression ratios, and query scanning metrics. Rates are configurable so numbers reflect your organization’s negotiated cloud contract or managed database tier.
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {/* Storage Rate */}
            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-200">
                  Compressed Storage Rate
                </label>
                <span className="text-[11px] font-mono text-zinc-500">
                  Default: $0.12 / GB-month
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">$</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={model.storagePricePerGBMonth}
                  onChange={(e) =>
                    setModel({ ...model, storagePricePerGBMonth: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-28 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">
                  / GB-month
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Standard AWS EBS gp3 ($0.08–$0.12/GB-mo) or ClickHouse Cloud tiered storage baseline.
              </p>
            </div>

            {/* Query Scan Rate */}
            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-200">
                  Analytical Query Scanning Rate
                </label>
                <span className="text-[11px] font-mono text-zinc-500">
                  Default: $5.00 / TB scanned
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">$</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={model.queryCostPerTBScanned}
                  onChange={(e) =>
                    setModel({ ...model, queryCostPerTBScanned: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-24 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">
                  / TB scanned
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Applies to query scan amplification reduction (industry standard cloud query pricing).
              </p>
            </div>

            {/* Compute CPU Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">
                    Compute CPU Rate
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">$</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={model.computePricePerCPUHour}
                    onChange={(e) =>
                      setModel({ ...model, computePricePerCPUHour: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-24 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">
                    / vCPU-hr
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  AWS c6i/c7g analytical compute instance rate (~$0.048/hr).
                </p>
              </div>

              {/* Host RAM Rate */}
              <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-200">
                    Compute RAM Rate
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">$</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={model.computePricePerGBHour}
                    onChange={(e) =>
                      setModel({ ...model, computePricePerGBHour: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-24 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 transition"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">
                    / GB-RAM-hr
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Host memory tier allocation rate (~$0.006/GB-hr).
                </p>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition py-1.5 px-2 rounded-lg hover:bg-zinc-800/60"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Defaults</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition flex items-center gap-1.5 shadow-md shadow-emerald-950 cursor-pointer"
              >
                {isSaved ? <Check className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>{isSaved ? 'Saved!' : 'Save Pricing Model'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
