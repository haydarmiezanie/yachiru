import React from 'react';
import { AnalysisReport } from '../types.js';
import {
  Database,
  Layers,
  HardDrive,
  Cpu,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';

interface ScoreOverviewProps {
  report: AnalysisReport;
}

export const ScoreOverview: React.FC<ScoreOverviewProps> = ({ report }) => {
  const { summary, overall_score, overall_verdict } = report;

  // Determine score color theme
  let scoreColor = 'text-emerald-400';
  let scoreBorder = 'border-emerald-500/30';
  let scoreBg = 'bg-emerald-950/20';
  let verdictBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

  if (overall_score < 60) {
    scoreColor = 'text-rose-400';
    scoreBorder = 'border-rose-500/30';
    scoreBg = 'bg-rose-950/20';
    verdictBadge = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
  } else if (overall_score < 85) {
    scoreColor = 'text-amber-400';
    scoreBorder = 'border-amber-500/30';
    scoreBg = 'bg-amber-950/20';
    verdictBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur mb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left: Overall Score Dial & Verdict */}
        <div className="lg:col-span-4 flex flex-col items-center lg:items-start text-center lg:text-left border-b lg:border-b-0 lg:border-r border-zinc-800 pb-6 lg:pb-0 lg:pr-8">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            ClickHouse Health Index
          </span>

          <div className="flex items-baseline gap-2 my-1">
            <span className={`text-6xl sm:text-7xl font-black tracking-tight ${scoreColor}`}>
              {overall_score}
            </span>
            <span className="text-2xl font-bold text-zinc-500">/100</span>
          </div>

          <div className={`mt-2 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${verdictBadge}`}>
            {overall_verdict}
          </div>

          <div className="mt-4 flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1 text-rose-400 font-medium">
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>{summary.critical_count} Critical</span>
            </div>
            <div className="flex items-center gap-1 text-amber-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{summary.warning_count} Warnings</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{summary.good_count} Optimal</span>
            </div>
          </div>
        </div>

        {/* Right: Database Context & Metric Cards */}
        <div className="lg:col-span-8 space-y-5">
          {/* Header row: Database info */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-rose-400" />
              <span className="text-sm font-bold text-white">
                Database: <span className="text-rose-300 font-mono">{report.database_name}</span>
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                v{report.clickhouse_version}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Scanned {new Date(report.timestamp).toLocaleTimeString()}</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                {report.cluster_mode}
              </span>
            </div>
          </div>

          {/* Metric Badges Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Tables & Rows</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {summary.total_rows.toLocaleString()}
              </div>
              <div className="text-[11px] text-zinc-500">
                Across {summary.total_tables} table{summary.total_tables === 1 ? '' : 's'}
              </div>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                <span>Storage Footprint</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {summary.total_size_compressed}
              </div>
              <div className="text-[11px] text-zinc-500">
                Uncompressed: {summary.total_size_uncompressed}
              </div>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                <span>Avg Compression</span>
              </div>
              <div className="text-base font-bold text-emerald-400 font-mono">
                {summary.avg_compression_ratio}
              </div>
              <div className="text-[11px] text-zinc-500">Columnar efficiency</div>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Active Parts</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {summary.total_parts.toLocaleString()}
              </div>
              <div className="text-[11px] text-zinc-500">
                {summary.total_parts > 200 ? 'Compaction needed' : 'Compaction healthy'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
