import React from 'react';
import { ShieldCheck, BookOpen, Download, RotateCcw, Sparkles } from 'lucide-react';

interface HeaderProps {
  hasReport: boolean;
  onNewScan: () => void;
  onOpenThresholds: () => void;
  onOpenExport: () => void;
  isDemo?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  hasReport,
  onNewScan,
  onOpenThresholds,
  onOpenExport,
  isDemo,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 via-rose-500 to-amber-400 p-[1px] shadow-lg shadow-rose-950/30">
            <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center font-black text-rose-400 text-lg tracking-wider">
              八
            </div>
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-1.5">
                Yachiru
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  ClickHouse Analyzer
                </span>
              </h1>
              {isDemo && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Demo Cluster
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 hidden sm:block">
              Evidence-based columnar database optimization & diagnostics
            </p>
          </div>
        </div>

        {/* Read-Only Safety Pill */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>100% Read-Only SQL • SELECT Only</span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            id="btn-thresholds-guide"
            onClick={onOpenThresholds}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
            title="View operational thresholds and mechanics"
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Thresholds & Mechanics</span>
          </button>

          {hasReport && (
            <>
              <button
                id="btn-export-report"
                onClick={onOpenExport}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-200 hover:text-white px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 transition"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                <span>Export Report</span>
              </button>

              <button
                id="btn-new-scan"
                onClick={onNewScan}
                className="flex items-center gap-1.5 text-xs font-semibold text-white px-3.5 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-sm transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>New Scan</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
