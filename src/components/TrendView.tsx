import React, { useState, useEffect } from 'react';
import {
  ScanHistoryRecord,
  ScanHistoryResponse,
  ConnectionConfig,
  AnalysisReport,
} from '../types.js';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  History,
  ShieldAlert,
  Server,
  KeyRound,
  Sparkles,
  ArrowRight,
  Info,
  Calendar,
} from 'lucide-react';

interface TrendViewProps {
  report: AnalysisReport;
  config: ConnectionConfig | null;
  onOpenSetupModal: () => void;
  apiKeyRequired?: boolean;
}

const CATEGORY_NAMES: Record<string, string> = {
  part_health: 'Part Health & Sizing',
  primary_key: 'ORDER BY & Primary Keys',
  partitioning: 'Partition Granularity',
  compression: 'Compression & Codecs',
  table_engine: 'Table Engines & Schemas',
  skip_indices: 'Data Skipping Indices',
  query_performance: 'Query Performance & Log',
  replication_distributed: 'Replication & Distributed',
  server_settings: 'Server Configuration',
  mutations: 'Background Mutations',
  disk_space: 'Disk Space & Volumes',
  system_errors: 'System Error Rates',
  replication_queue: 'Replication Queue & Retries',
};

export const TrendView: React.FC<TrendViewProps> = ({
  report,
  config,
  onOpenSetupModal,
  apiKeyRequired = false,
}) => {
  const [historyData, setHistoryData] = useState<ScanHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedScanIndex, setSelectedScanIndex] = useState<number>(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!config) return;
    setIsLoading(true);
    setErrorNotice(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key =
        config.yachiruApiKey ||
        (typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem('yachiru_server_api_key')
          : null);
      if (apiKeyRequired && key && key.trim()) {
        headers['Authorization'] = `Bearer ${key.trim()}`;
      }

      const response = await fetch('/api/history', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...config,
          historyDatabase: config.historyDatabase || config.database,
          historyTableName: config.historyTableName || 'yachiru_scan_history',
          targetHost: config.host,
          targetDatabase: config.database,
        }),
      });

      const data: ScanHistoryResponse = await response.json().catch(() => ({
        success: false,
        history: [],
        error: 'Failed to parse history response',
      }));

      setHistoryData(data);
      if (!data.success && data.error) {
        setErrorNotice(data.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve scan history';
      setErrorNotice(msg);
      setHistoryData({
        success: false,
        history: [],
        error: msg,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.scan_id]);

  const history = historyData?.history || [];
  const comparison = historyData?.comparison;

  // Selected scan for detail comparison
  const selectedScan = history[selectedScanIndex] || history[0];
  const previousScan = history[selectedScanIndex + 1];

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 70) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 90) return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
    if (score >= 70) return 'bg-amber-500/10 border-amber-500/20 text-amber-300';
    return 'bg-rose-500/10 border-rose-500/20 text-rose-300';
  };

  const getDeltaBadge = (delta: number) => {
    if (delta > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <TrendingUp className="w-3 h-3" />
          <span>+{delta} pts</span>
        </span>
      );
    }
    if (delta < 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
          <TrendingDown className="w-3 h-3" />
          <span>{delta} pts</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
        <Minus className="w-3 h-3" />
        <span>Unchanged</span>
      </span>
    );
  };

  return (
    <div id="trend-view-container" className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Cluster Scan History &amp; Trend Analytics</h2>
              {history.length > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {history.length} {history.length === 1 ? 'Scan' : 'Scans'} Recorded
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Target: <code className="font-mono text-zinc-300">{report.database_name}</code> on{' '}
              <code className="font-mono text-zinc-300">{config?.host || 'cluster'}</code>
              {' • '}
              Stored in-cluster table: <code className="font-mono text-zinc-300">{config?.historyTableName || 'yachiru_scan_history'}</code>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            type="button"
            onClick={fetchHistory}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Fetching...' : 'Refresh Trends'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSetupModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-rose-400 border border-rose-500/30 transition cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Setup SQL &amp; Grants</span>
          </button>
        </div>
      </div>

      {/* History Write Status Banner for the latest scan */}
      {report.historyWriteStatus && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            report.historyWriteStatus.written
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
          }`}
        >
          {report.historyWriteStatus.written ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-emerald-200">Latest Scan Recorded: </span>
                Written directly to ClickHouse table <code className="font-mono text-emerald-100">{report.historyWriteStatus.table}</code>.
              </div>
            </>
          ) : (
            <>
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-zinc-300">History recording inactive for this scan: </span>
                {report.historyWriteStatus.error || 'Enable History Tracking on the connection form to record future runs.'}
              </div>
            </>
          )}
        </div>
      )}

      {/* Error or Missing Table Guidance */}
      {historyData && !historyData.success && (
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-rose-500/30 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-rose-300">
                {historyData.errorType === 'TABLE_NOT_FOUND'
                  ? 'History Table Not Yet Created in ClickHouse'
                  : historyData.errorType === 'PERMISSION_DENIED'
                  ? 'Missing SELECT Grant for Scan User'
                  : 'Unable to Query Scan History'}
              </h3>
              <p className="text-xs text-zinc-300 leading-relaxed">{historyData.error}</p>
              {historyData.hint && (
                <p className="text-xs text-zinc-400 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 font-mono mt-2">
                  {historyData.hint}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onOpenSetupModal}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition cursor-pointer"
            >
              Open SQL Setup Generator
            </button>
            <button
              type="button"
              onClick={fetchHistory}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer"
            >
              Retry Query
            </button>
          </div>
        </div>
      )}

      {/* Main Content when history exists */}
      {history.length > 0 && (
        <>
          {/* Timeline / Progression Card */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-400" />
                <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                  Overall Health Score Progression
                </h3>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                {history.length} data points (most recent first)
              </span>
            </div>

            {/* Visual Score Step Bars */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {history.slice(0, 6).map((item, idx) => {
                const nextItem = history[idx + 1];
                const delta = nextItem ? item.overall_score - nextItem.overall_score : 0;
                const isSelected = selectedScanIndex === idx;

                return (
                  <button
                    key={item.scan_id || idx}
                    type="button"
                    onClick={() => setSelectedScanIndex(idx)}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-zinc-800/90 border-rose-500 shadow-md ring-1 ring-rose-500/30'
                        : 'bg-zinc-950/60 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        <span>{item.scanned_at ? item.scanned_at.substring(0, 10) : 'Recent'}</span>
                      </span>
                      {idx === 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase">
                          Latest
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-2xl font-black ${getScoreColor(item.overall_score)}`}>
                          {item.overall_score}
                        </span>
                        <span className="text-xs text-zinc-500">/ 100</span>
                      </div>
                      <div className="text-[11px] font-medium text-zinc-300 truncate">
                        {item.overall_verdict}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px]">
                      {nextItem ? (
                        getDeltaBadge(delta)
                      ) : (
                        <span className="text-[10px] text-zinc-500">Baseline run</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Finding Comparison between Recent Scans */}
          {comparison && (
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-rose-400" />
                  <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                    Findings Delta vs Previous Scan
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {getDeltaBadge(comparison.scoreDelta)}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Resolved Findings */}
                <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Resolved Findings ({comparison.resolvedFindings.length})</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">Fixed since previous run</span>
                  </div>

                  {comparison.resolvedFindings.length === 0 ? (
                    <div className="text-xs text-zinc-500 py-3 text-center">
                      No previously active findings resolved in this run.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {comparison.resolvedFindings.map((f, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/20 text-xs flex items-start gap-2"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="text-emerald-300 font-medium">{f.title}</span>
                            <div className="text-[10px] text-emerald-500 font-mono">
                              Category: {CATEGORY_NAMES[f.category] || f.category}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* New Findings / Regressions */}
                <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      <span>New Findings ({comparison.newFindings.length})</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">Introduced or detected now</span>
                  </div>

                  {comparison.newFindings.length === 0 ? (
                    <div className="text-xs text-emerald-400 py-3 text-center flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Zero new regressions detected compared to previous scan!</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {comparison.newFindings.map((f, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-500/20 text-xs flex items-start gap-2"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="text-rose-300 font-medium">{f.title}</span>
                            <div className="text-[10px] text-rose-500 font-mono">
                              Category: {CATEGORY_NAMES[f.category] || f.category} • Severity: {f.severity}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Category Scores Comparison Breakdown */}
          {selectedScan && (
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-rose-400" />
                    <span>Category Breakdown Comparison</span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Comparing scan from <code className="font-mono text-zinc-300">{selectedScan.scanned_at || 'Recent'}</code>
                    {previousScan ? ` with prior scan from ${previousScan.scanned_at || 'Prior'}` : ' (baseline)'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${getScoreBg(selectedScan.overall_score)}`}>
                    Score: {selectedScan.overall_score}/100
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="py-2.5 px-3 font-semibold">Category</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Selected Scan</th>
                      {previousScan && (
                        <>
                          <th className="py-2.5 px-3 font-semibold text-right">Previous Scan</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Delta</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {Object.entries(CATEGORY_NAMES).map(([catKey, catName]) => {
                      const currentScore = selectedScan.category_scores?.[catKey] ?? 100;
                      const priorScore = previousScan?.category_scores?.[catKey];
                      const hasPrior = typeof priorScore === 'number';
                      const delta = hasPrior ? currentScore - priorScore : 0;

                      return (
                        <tr key={catKey} className="hover:bg-zinc-800/30 transition">
                          <td className="py-2.5 px-3 font-sans text-zinc-300 font-medium">
                            {catName}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className={`font-bold ${getScoreColor(currentScore)}`}>
                              {currentScore}
                            </span>
                            <span className="text-zinc-600 text-[10px]">/100</span>
                          </td>
                          {previousScan && (
                            <>
                              <td className="py-2.5 px-3 text-right text-zinc-400">
                                {hasPrior ? (
                                  <>
                                    <span>{priorScore}</span>
                                    <span className="text-zinc-600 text-[10px]">/100</span>
                                  </>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {hasPrior ? getDeltaBadge(delta) : <span className="text-zinc-600">—</span>}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Historical Scans List */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <Calendar className="w-4 h-4 text-rose-400" />
                <span>All Recorded Cluster Scans</span>
              </h3>
              <span className="text-xs text-zinc-400 font-mono">
                Click row to inspect category snapshot
              </span>
            </div>

            <div className="border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800 font-mono text-[11px]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                    <th className="py-3 px-4 font-semibold">Overall Score</th>
                    <th className="py-3 px-4 font-semibold">Verdict</th>
                    <th className="py-3 px-4 font-semibold">Findings</th>
                    <th className="py-3 px-4 font-semibold">ClickHouse Version</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80 font-mono">
                  {history.map((record, index) => {
                    const isCurrent = selectedScanIndex === index;
                    return (
                      <tr
                        key={record.scan_id || index}
                        onClick={() => setSelectedScanIndex(index)}
                        className={`transition cursor-pointer ${
                          isCurrent
                            ? 'bg-rose-500/10 text-white'
                            : 'hover:bg-zinc-800/40 text-zinc-300'
                        }`}
                      >
                        <td className="py-3 px-4 flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          <span>{record.scanned_at || 'Recent'}</span>
                          {index === 0 && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase font-sans font-bold">
                              Latest
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-black ${getScoreColor(record.overall_score)}`}>
                            {record.overall_score}
                          </span>
                          <span className="text-zinc-600 text-[10px]">/100</span>
                        </td>
                        <td className="py-3 px-4 font-sans">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getScoreBg(record.overall_score)}`}>
                            {record.overall_verdict}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 font-sans">
                          {record.finding_summary?.length || 0} flagged
                        </td>
                        <td className="py-3 px-4 text-zinc-400">
                          {record.clickhouse_version || '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-sans">
                          <span className="text-rose-400 text-xs font-semibold flex items-center justify-end gap-1">
                            <span>{isCurrent ? 'Viewing' : 'Inspect'}</span>
                            <ArrowRight className="w-3 h-3" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Zero Scans Notice */}
      {historyData && historyData.success && history.length === 0 && (
        <div className="p-8 rounded-2xl bg-zinc-900 border border-zinc-800 text-center space-y-3">
          <History className="w-8 h-8 text-zinc-500 mx-auto" />
          <h3 className="text-base font-bold text-white">No historical scans found yet</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
            The history table exists, but no previous scans have been recorded for{' '}
            <code className="font-mono text-zinc-300">{report.database_name}</code> on{' '}
            <code className="font-mono text-zinc-300">{config?.host}</code>. As you perform scans with history tracking enabled, progression trends will display here.
          </p>
        </div>
      )}
    </div>
  );
};
