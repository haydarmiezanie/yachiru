import React, { useState, useEffect, useMemo } from 'react';
import {
  AnalysisReport,
  ConnectionConfig,
  VerificationListResponse,
  VerificationSession,
  formatCurrency,
} from '../types.js';
import {
  CheckCircle2,
  Clock,
  Activity,
  Layers,
  ArrowRight,
  TrendingDown,
  RefreshCw,
  Search,
  Filter,
  PlusCircle,
  Database,
  Table as TableIcon,
  Sparkles,
  DollarSign,
  AlertOctagon,
  HelpCircle,
  ShieldCheck,
  ChevronRight,
  FileCheck2,
} from 'lucide-react';
import {
  getVerificationSessions,
  saveLocalVerifications,
} from '../utils/verificationClient.js';
import { VerificationDetailModal } from './VerificationDetailModal.js';

interface VerificationDashboardProps {
  report: AnalysisReport;
  config: ConnectionConfig | null;
  onNavigateToFindings: () => void;
  onRunReScan: () => Promise<AnalysisReport | null>;
}

export const VerificationDashboard: React.FC<VerificationDashboardProps> = ({
  report,
  config,
  onNavigateToFindings,
  onRunReScan,
}) => {
  const [data, setData] = useState<VerificationListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'verified' | 'in_progress' | 'issues'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<VerificationSession | null>(null);
  const [isVerifyingScan, setIsVerifyingScan] = useState(false);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const res = await getVerificationSessions(
        config?.host || 'demo.internal',
        report.database_name || config?.database || 'production',
        Boolean(config?.isDemo || report.is_demo)
      );
      setData(res);
    } catch (err) {
      console.warn('Failed to fetch verification sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.scan_id, config?.host, config?.database]);

  const sessions = data?.sessions || [];
  const summary = data?.summary || {
    totalSessions: 0,
    verifiedCount: 0,
    partiallyVerifiedCount: 0,
    inProgressCount: 0,
    inconclusiveCount: 0,
    regressedCount: 0,
    notImprovedCount: 0,
    totalConfirmedStorageReductionBytes: 0,
    avgQueryLatencyReductionPct: null,
    totalVerifiedMonthlySavings: 0,
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (activeTab === 'verified') {
        if (s.status !== 'verified' && s.status !== 'partially_verified') return false;
      } else if (activeTab === 'in_progress') {
        if (
          s.status !== 'pending_baseline' &&
          s.status !== 'baseline_captured' &&
          s.status !== 'remediation_in_progress' &&
          s.status !== 'awaiting_verification'
        )
          return false;
      } else if (activeTab === 'issues') {
        if (
          s.status !== 'regression_detected' &&
          s.status !== 'not_improved' &&
          s.status !== 'inconclusive'
        )
          return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = s.findingTitle.toLowerCase().includes(q);
        const matchTable = s.targetTable?.toLowerCase().includes(q) || false;
        const matchCol = s.targetColumn?.toLowerCase().includes(q) || false;
        const matchCat = s.findingCategory.toLowerCase().includes(q);
        if (!matchTitle && !matchTable && !matchCol && !matchCat) return false;
      }
      return true;
    });
  }, [sessions, activeTab, searchQuery]);

  const handleRunScanAndVerify = async (sessionToVerify: VerificationSession) => {
    setIsVerifyingScan(true);
    try {
      let updated: VerificationSession;
      if (config) {
        // Preferred production path: server securely runs the scan and computes the verdict
        const { verifySessionOnServer } = await import('../utils/verificationClient.js');
        updated = await verifySessionOnServer(sessionToVerify, config);
      } else {
        // Fallback for simulation / mock scans without active config
        const freshReport = await onRunReScan();
        if (!freshReport) {
          throw new Error('Fresh scan could not be completed.');
        }
        const { verifySessionWithScan } = await import('../utils/verificationClient.js');
        updated = await verifySessionWithScan(sessionToVerify, freshReport);
      }

      // Update state
      setSelectedSession(updated);
      await fetchSessions();
    } catch (err) {
      console.error('Scan and verify failed:', err);
    } finally {
      setIsVerifyingScan(false);
    }
  };

  return (
    <div id="verification-dashboard-container" className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Before / After Verification Engine</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                {summary.totalSessions} {summary.totalSessions === 1 ? 'Session' : 'Sessions'} Tracked
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Target: <code className="font-mono text-zinc-300">{report.database_name}</code> on{' '}
              <code className="font-mono text-zinc-300">{config?.host || 'demo.internal'}</code>
              {' • '}
              Defensible telemetry measurements proving database optimization impact.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            type="button"
            onClick={fetchSessions}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToFindings}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition shadow-sm cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Start from Finding</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Card 1: Verified Optimizations */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Verified Optimizations</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {summary.verifiedCount}
            <span className="text-xs font-normal text-zinc-400 ml-1.5">
              / {summary.totalSessions} total
            </span>
          </div>
          <div className="text-[11px] text-emerald-400 font-medium">
            {summary.partiallyVerifiedCount > 0
              ? `+${summary.partiallyVerifiedCount} partially verified`
              : 'Empirically proven on-disk'}
          </div>
        </div>

        {/* Card 2: Confirmed Storage Reduction */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Confirmed Storage Reduction</span>
            <Layers className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-300 font-mono">
            {summary.totalConfirmedStorageReductionBytes > 0
              ? `${(summary.totalConfirmedStorageReductionBytes / (1024 ** 3)).toFixed(1)} GB`
              : '0 GB'}
          </div>
          <div className="text-[11px] text-zinc-400">
            Measured physical footprint delta
          </div>
        </div>

        {/* Card 3: Query Latency Reduction */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Avg Query Latency Delta</span>
            <TrendingDown className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-300 font-mono">
            {summary.avgQueryLatencyReductionPct !== null
              ? `-${summary.avgQueryLatencyReductionPct}%`
              : '—'}
          </div>
          <div className="text-[11px] text-zinc-400">
            Observation window comparison
          </div>
        </div>

        {/* Card 4: Verified Financial Savings */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Verified Monthly Savings</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-300 font-mono">
            +{formatCurrency(summary.totalVerifiedMonthlySavings)}
            <span className="text-xs font-normal text-emerald-400/80 ml-1">/ mo</span>
          </div>
          <div className="text-[11px] text-zinc-400">
            Billed on verified compressed bytes
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All Sessions ({sessions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('verified')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'verified'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Verified ({summary.verifiedCount + summary.partiallyVerifiedCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('in_progress')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'in_progress'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            In Progress ({summary.inProgressCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('issues')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'issues'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Issues / Inconclusive ({summary.inconclusiveCount + summary.regressedCount + summary.notImprovedCount})
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter table, column, finding..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-rose-500/50"
          />
        </div>
      </div>

      {/* Verification Sessions List */}
      {filteredSessions.length > 0 ? (
        <div className="space-y-3">
          {filteredSessions.map((s) => {
            const isVerified = s.status === 'verified';
            const isPartiallyVerified = s.status === 'partially_verified';
            const isRegressed = s.status === 'regression_detected';
            const isInProgress =
              s.status === 'baseline_captured' ||
              s.status === 'remediation_in_progress' ||
              s.status === 'awaiting_verification';

            return (
              <div
                key={s.id}
                onClick={() => setSelectedSession(s)}
                className="p-5 rounded-2xl bg-zinc-900/90 hover:bg-zinc-850/80 border border-zinc-800 transition cursor-pointer space-y-3 shadow-md group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                          isVerified
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : isPartiallyVerified
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : isRegressed
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                            : isInProgress
                            ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                            : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}
                      >
                        {isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {isPartiallyVerified && <Activity className="w-3.5 h-3.5 text-amber-400" />}
                        {isRegressed && <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />}
                        {isInProgress && <Clock className="w-3.5 h-3.5 text-sky-400" />}
                        <span>{s.status.replace(/_/g, ' ').toUpperCase()}</span>
                      </span>

                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono border border-zinc-700">
                        {s.findingCategory.toUpperCase()}
                      </span>

                      {s.targetTable && (
                        <span className="text-xs font-mono text-zinc-300 flex items-center gap-1">
                          <TableIcon className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{s.targetTable}{s.targetColumn ? `.${s.targetColumn}` : ''}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white group-hover:text-rose-300 transition flex items-center gap-1.5">
                      <span>{s.findingTitle}</span>
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                    {s.financialImpact && s.financialImpact.estimatedMonthlySavings > 0 && (
                      <div className="text-right">
                        <span className="text-xs text-zinc-400 block font-mono">Monthly Savings</span>
                        <span className="text-base font-black text-emerald-300 font-mono">
                          +{formatCurrency(s.financialImpact.estimatedMonthlySavings)}
                          <span className="text-[11px] font-normal text-emerald-400/80 ml-0.5">/ mo</span>
                        </span>
                      </div>
                    )}

                    <div className="p-2 rounded-xl bg-zinc-800 text-zinc-400 group-hover:text-white group-hover:bg-zinc-700 transition">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Bottom Stats / Timeline */}
                <div className="pt-3 border-t border-zinc-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400 font-mono">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>Baseline: {s.baselineCapturedAt}</span>
                    {s.verifiedAt && (
                      <>
                        <span>•</span>
                        <span className="text-zinc-300">Verified: {s.verifiedAt}</span>
                      </>
                    )}
                  </div>

                  {s.measuredImpactSummary && (
                    <div className="text-zinc-300 font-sans">
                      {s.measuredImpactSummary.summaryText}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-center space-y-4">
          <FileCheck2 className="w-12 h-12 text-zinc-600 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">No Verification Sessions Found</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Start a verification session from any finding in the Findings Explorer to capture an
              immutable baseline, apply remediation SQL, and measure verified results.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateToFindings}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Go to Findings Explorer</span>
          </button>
        </div>
      )}

      {/* Verification Detail Modal */}
      {selectedSession && (
        <VerificationDetailModal
          session={selectedSession}
          isOpen={Boolean(selectedSession)}
          onClose={() => setSelectedSession(null)}
          onSessionUpdated={(updated) => {
            setSelectedSession(updated);
            fetchSessions();
          }}
          currentReport={report}
          config={config}
          onRunScanAndVerify={handleRunScanAndVerify}
          isVerifyingScan={isVerifyingScan}
        />
      )}
    </div>
  );
};
