import React from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Table,
  HardDrive,
  Activity,
  Layers,
  ArrowRight,
  ShieldAlert,
  Flame,
  Lightbulb,
  Compass,
} from 'lucide-react';
import { DimensionId, DimensionScore, ScanReport } from '../types/yachiru.js';

interface HealthOverviewProps {
  report: ScanReport;
  onSelectDimension: (dim: DimensionId) => void;
}

export const HealthOverview: React.FC<HealthOverviewProps> = ({ report, onSelectDimension }) => {
  const { overallScore, overallGrade, dimensionScores, executiveSummary, clusterMetadata, findings, aiStatus } = report;

  // Grade color scheme
  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-emerald-400 border-emerald-500/30 bg-emerald-950/40';
      case 'B':
        return 'text-blue-400 border-blue-500/30 bg-blue-950/40';
      case 'C':
        return 'text-amber-400 border-amber-500/30 bg-amber-950/40';
      case 'D':
        return 'text-orange-400 border-orange-500/30 bg-orange-950/40';
      default:
        return 'text-rose-400 border-rose-500/30 bg-rose-950/40';
    }
  };

  const getScoreStroke = (score: number) => {
    if (score >= 85) return '#10b981'; // emerald
    if (score >= 70) return '#3b82f6'; // blue
    if (score >= 55) return '#f59e0b'; // amber
    if (score >= 40) return '#f97316'; // orange
    return '#f43f5e'; // rose
  };

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  return (
    <div className="space-y-6">
      {/* Top Banner: Score Gauge + Key Cluster Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Score Gauge Card */}
        <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-slate-900/80 p-5 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Health Score</span>
              <span className={`rounded-lg px-2.5 py-0.5 text-xs font-black border ${getGradeColor(overallGrade)}`}>
                Grade {overallGrade}
              </span>
            </div>

            <div className="my-5 flex items-center justify-center">
              <div className="relative flex items-center justify-center">
                <svg className="h-36 w-36 -rotate-90 transform" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="8" className="text-slate-800" fill="transparent" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    stroke={getScoreStroke(overallScore)}
                    strokeWidth="8"
                    strokeDasharray={264}
                    strokeDashoffset={264 - (264 * overallScore) / 100}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-4xl font-black text-white font-mono">{overallScore}</span>
                  <span className="text-[11px] font-medium text-slate-400">out of 100</span>
                </div>
              </div>
            </div>
          </div>

          {/* Finding Counts */}
          <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-center">
            <div className="rounded-lg bg-rose-950/30 border border-rose-500/20 py-1.5">
              <div className="text-sm font-bold text-rose-400">{criticalCount}</div>
              <div className="text-[10px] text-rose-300/80">Critical</div>
            </div>
            <div className="rounded-lg bg-amber-950/30 border border-amber-500/20 py-1.5">
              <div className="text-sm font-bold text-amber-400">{warningCount}</div>
              <div className="text-[10px] text-amber-300/80">Warnings</div>
            </div>
            <div className="rounded-lg bg-blue-950/30 border border-blue-500/20 py-1.5">
              <div className="text-sm font-bold text-blue-400">{infoCount}</div>
              <div className="text-[10px] text-blue-300/80">Info</div>
            </div>
          </div>
        </div>

        {/* Cluster Stats & Metadata */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Total Tables</span>
              <Table className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-white">{clusterMetadata.totalTables}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{clusterMetadata.totalRows.toLocaleString()} rows</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Active Parts</span>
              <Layers className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-white">{clusterMetadata.totalParts}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Across all partitions</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Queries Analyzed</span>
              <Activity className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-white">{clusterMetadata.queriesAnalyzed}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">from system.query_log</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">Compressed Data</span>
              <HardDrive className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-white">{clusterMetadata.totalDiskSizeFormatted}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">ClickHouse version {clusterMetadata.version.split(' ')[0]}</div>
            </div>
          </div>

          {/* Top Risk Card */}
          <div className="col-span-2 sm:col-span-4 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 p-4 flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <Flame className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-400">Primary Stability Risk</span>
                <span className="rounded bg-rose-500/10 px-1.5 py-0.2 text-[10px] font-mono text-rose-300">Action Required</span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
                {executiveSummary.topRisk}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Executive Summary Card (AI Synthesized / Deterministic) */}
      <div className={`rounded-xl border p-5 shadow-xl transition-all ${
        aiStatus === 'success'
          ? executiveSummary.provider === 'openai'
            ? 'border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/20'
            : 'border-purple-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-purple-950/20'
          : aiStatus === 'fallback'
          ? 'border-amber-500/30 bg-slate-900/80'
          : 'border-slate-800 bg-slate-900/70'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5 mb-4">
          <div className="flex items-center gap-2">
            {aiStatus === 'success' ? (
              <Sparkles className={`h-5 w-5 ${executiveSummary.provider === 'openai' ? 'text-emerald-400' : 'text-purple-400'}`} />
            ) : (
              <Lightbulb className="h-5 w-5 text-amber-400" />
            )}
            <h3 className="font-semibold text-white">
              {aiStatus === 'success'
                ? executiveSummary.provider === 'openai'
                  ? 'OpenAI (ChatGPT) Architectural Synthesis'
                  : 'Google Gemini Architectural Synthesis'
                : 'Rule-Based Diagnostic Summary'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {aiStatus === 'success' ? (
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${
                executiveSummary.provider === 'openai'
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 shadow-emerald-500/10'
                  : 'bg-purple-500/10 border border-purple-500/30 text-purple-300 shadow-purple-500/10'
              }`}>
                <Sparkles className={`h-3.5 w-3.5 ${executiveSummary.provider === 'openai' ? 'text-emerald-400' : 'text-purple-400'} animate-pulse`} />
                {executiveSummary.provider === 'openai' ? 'OpenAI ChatGPT Active' : 'Gemini AI Active'} ({executiveSummary.modelUsed || 'AI Synthesis'})
              </span>
            ) : aiStatus === 'fallback' ? (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                Deterministic Fallback (API Key Inactive)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs font-medium text-slate-400">
                <span>🔒 AI Disabled (Static Heuristics)</span>
              </span>
            )}
          </div>
        </div>

        {/* Fallback explanation banner if API key is not active */}
        {aiStatus === 'fallback' && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-amber-300">
                {report.aiProvider === 'openai' ? 'OpenAI (ChatGPT)' : 'Google Gemini'} AI Synthesis is in Fallback Mode:
              </span>
              <span className="text-amber-200/90 leading-relaxed block mt-0.5">
                {report.aiErrorMessage || `${report.aiProvider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} environment variable is not configured or reached quota limit.`} The report below was generated using static threshold metrics.
              </span>
            </div>
          </div>
        )}

        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
          {executiveSummary.overview}
        </p>

        {/* Quick Wins & Strategic Fixes Columns */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800/80">
          <div className="rounded-lg border border-slate-800/90 bg-slate-950/60 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 mb-2">
              <Lightbulb className="h-4 w-4" />
              <span>{aiStatus === 'success' ? 'AI-Prioritized Quick Wins' : 'Rule-Based Quick Wins'}</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-300">
              {executiveSummary.quickWins.map((win, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{win}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-800/90 bg-slate-950/60 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-400 mb-2">
              <Compass className="h-4 w-4" />
              <span>Strategic Architecture Upgrades</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-300">
              {executiveSummary.strategicFixes.map((fix, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <ArrowRight className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{fix}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 9 Dimensions Health Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-slate-200 uppercase tracking-wider">
            9-Dimension Architectural Breakdown
          </h3>
          <span className="text-xs text-slate-400">Click any dimension to filter specific recommendations</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {(Object.values(dimensionScores) as DimensionScore[]).map((dim) => {
            const hasCritical = dim.criticalCount > 0;
            const hasWarning = dim.warningCount > 0;

            return (
              <div
                key={dim.dimension}
                onClick={() => onSelectDimension(dim.dimension)}
                className="group relative flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-amber-500/40 hover:bg-slate-900 transition-all cursor-pointer shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm text-slate-100 group-hover:text-amber-300 transition-colors">
                      {dim.name}
                    </h4>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-sm font-bold text-white">{dim.score}</span>
                      <span className="text-xs text-slate-500">/100</span>
                    </div>
                  </div>

                  {/* Score Progress Bar */}
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${dim.score}%`,
                        backgroundColor: getScoreStroke(dim.score),
                      }}
                    />
                  </div>

                  <p className="mt-2.5 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {dim.summary}
                  </p>
                </div>

                <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {hasCritical && (
                      <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400 border border-rose-500/20">
                        {dim.criticalCount} Critical
                      </span>
                    )}
                    {hasWarning && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                        {dim.warningCount} Warning
                      </span>
                    )}
                    {!hasCritical && !hasWarning && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                        Optimal
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500 group-hover:text-amber-300 flex items-center gap-1 transition-colors">
                    View Findings <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
