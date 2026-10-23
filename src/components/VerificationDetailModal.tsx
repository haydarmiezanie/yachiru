import React, { useState } from 'react';
import {
  AnalysisReport,
  ConnectionConfig,
  VerificationChecklistItem,
  VerificationSession,
  formatCurrency,
} from '../types.js';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  Clock,
  Database,
  Table as TableIcon,
  Code2,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
  FileDown,
  X,
  Sparkles,
  Info,
  DollarSign,
  Layers,
  Activity,
} from 'lucide-react';
import { updateVerificationSession, verifySessionWithScan } from '../utils/verificationClient.js';

interface VerificationDetailModalProps {
  session: VerificationSession;
  isOpen: boolean;
  onClose: () => void;
  onSessionUpdated: (updated: VerificationSession) => void;
  currentReport: AnalysisReport | null;
  config: ConnectionConfig | null;
  onRunScanAndVerify: (session: VerificationSession) => Promise<void>;
  isVerifyingScan?: boolean;
}

export const VerificationDetailModal: React.FC<VerificationDetailModalProps> = ({
  session,
  isOpen,
  onClose,
  onSessionUpdated,
  currentReport,
  config,
  onRunScanAndVerify,
  isVerifyingScan = false,
}) => {
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [isUpdatingChecklist, setIsUpdatingChecklist] = useState(false);

  if (!isOpen) return null;

  const handleCopySql = () => {
    navigator.clipboard.writeText(session.recommendationSqlOrText);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleToggleChecklist = async (item: VerificationChecklistItem) => {
    if (isUpdatingChecklist) return;
    setIsUpdatingChecklist(true);
    try {
      const updatedChecklist = session.checklist.map((c) => {
        if (c.id === item.id) {
          const nextCompleted = !c.completed;
          return {
            ...c,
            completed: nextCompleted,
            completedAt: nextCompleted ? new Date().toISOString() : undefined,
          };
        }
        return c;
      });

      // Update state if all user remediation steps are done
      let nextStatus = session.status;
      const allRemediationDone = updatedChecklist
        .filter((c) => c.id !== 'step_run_rescan')
        .every((c) => c.completed);

      if (
        allRemediationDone &&
        (session.status === 'baseline_captured' || session.status === 'remediation_in_progress')
      ) {
        nextStatus = 'awaiting_verification';
      } else if (!allRemediationDone && session.status === 'awaiting_verification') {
        nextStatus = 'remediation_in_progress';
      }

      const updated = await updateVerificationSession({
        ...session,
        status: nextStatus,
        checklist: updatedChecklist,
      });
      onSessionUpdated(updated);
    } catch (err) {
      console.warn('Failed to toggle checklist item:', err);
    } finally {
      setIsUpdatingChecklist(false);
    }
  };

  const handleExportMarkdown = () => {
    const lines = [
      `# Yachiru.id — Optimization Verification Report`,
      ``,
      `**Verification ID:** \`${session.id}\``,
      `**Target:** \`${session.targetDatabase}.${session.targetTable || '*'}${session.targetColumn ? `.${session.targetColumn}` : ''}\``,
      `**Cluster/Host:** \`${session.targetHost}\``,
      `**Optimization Category:** ${session.findingCategory.toUpperCase()}`,
      `**Status:** ${session.status.toUpperCase()}`,
      `**Baseline Captured:** ${session.baselineCapturedAt} (Scan: \`${session.baselineScanId}\`)`,
      session.verifiedAt ? `**Verified At:** ${session.verifiedAt} (Scan: \`${session.afterScanId}\`)` : '',
      ``,
      `## Finding Diagnostics`,
      `**Title:** ${session.findingTitle}`,
      `**Severity:** ${session.findingSeverity.toUpperCase()}`,
      `**Risk Level:** ${session.riskLevel.toUpperCase()}`,
      ``,
      `## Measured Before vs After Metrics`,
      `| Monitored Metric | Before | After | Absolute Delta | Pct Change | Status |`,
      `|---|---|---|---|---|---|`,
    ];

    for (const c of session.metricComparisons) {
      lines.push(
        `| ${c.label} | ${c.formattedBefore} | ${c.formattedAfter} | ${c.absoluteChange !== null ? c.absoluteChange : '—'} | ${c.percentageChange !== null ? `${c.percentageChange}%` : '—'} | ${c.status.toUpperCase()} |`
      );
    }

    if (session.expectedImpact) {
      lines.push(``);
      lines.push(`## Expected vs Actual Outcome`);
      lines.push(`- **Expected Impact:** ${session.expectedImpact.description}`);
      lines.push(
        `- **Actual Result:** ${session.expectedImpact.targetAchievedStatus?.replace(/_/g, ' ').toUpperCase() || 'EVALUATED'}`
      );
    }

    if (session.measuredImpactSummary) {
      lines.push(``);
      lines.push(`## Measured Technical Impact`);
      lines.push(`- ${session.measuredImpactSummary.summaryText}`);
    }

    if (session.financialImpact) {
      lines.push(``);
      lines.push(`## Estimated Financial Impact`);
      lines.push(
        `- **Estimated Monthly Savings:** ${formatCurrency(session.financialImpact.estimatedMonthlySavings)} / month`
      );
      lines.push(`- **Note:** ${session.financialImpact.caveat}`);
    }

    lines.push(``);
    lines.push(`## Comparability & Reliability`);
    lines.push(`- **Confidence Rating:** ${session.comparability.confidence.toUpperCase()}`);
    for (const r of session.comparability.confidenceReasons) {
      lines.push(`  - ✓ ${r}`);
    }
    for (const f of session.comparability.confoundingFactors) {
      lines.push(`  - ⚠ ${f}`);
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by Yachiru.id — ClickHouse Optimization Platform*`);

    const mdText = lines.join('\n');
    navigator.clipboard.writeText(mdText);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2500);
  };

  const getStatusBadge = () => {
    switch (session.status) {
      case 'verified':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
          label: 'Verified Optimization',
          bg: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
        };
      case 'partially_verified':
        return {
          icon: <Activity className="w-4 h-4 text-amber-400" />,
          label: 'Partially Verified',
          bg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
        };
      case 'remediation_in_progress':
        return {
          icon: <Clock className="w-4 h-4 text-sky-400" />,
          label: 'Remediation In Progress',
          bg: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
        };
      case 'awaiting_verification':
        return {
          icon: <RefreshCw className="w-4 h-4 text-purple-400" />,
          label: 'Awaiting Re-Scan Verification',
          bg: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
        };
      case 'regression_detected':
        return {
          icon: <AlertOctagon className="w-4 h-4 text-rose-400" />,
          label: 'Regression Detected',
          bg: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
        };
      case 'not_improved':
        return {
          icon: <Minus className="w-4 h-4 text-zinc-400" />,
          label: 'No Measurable Improvement',
          bg: 'bg-zinc-800 text-zinc-300 border-zinc-700',
        };
      case 'inconclusive':
        return {
          icon: <HelpCircle className="w-4 h-4 text-amber-400" />,
          label: 'Inconclusive Telemetry',
          bg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
        };
      case 'cancelled':
        return {
          icon: <X className="w-4 h-4 text-zinc-400" />,
          label: 'Verification Cancelled',
          bg: 'bg-zinc-800 text-zinc-400 border-zinc-700',
        };
      case 'baseline_captured':
      default:
        return {
          icon: <Clock className="w-4 h-4 text-indigo-400" />,
          label: 'Baseline Captured & Locked',
          bg: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
        };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-800/80 bg-zinc-950/60 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusBadge.bg}`}
              >
                {statusBadge.icon}
                <span>{statusBadge.label}</span>
              </span>

              <span className="text-xs px-2.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono border border-zinc-700">
                {session.findingCategory.toUpperCase()}
              </span>

              <span
                className={`text-xs px-2.5 py-0.5 rounded font-semibold border ${
                  session.riskLevel === 'high'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                    : session.riskLevel === 'medium'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                }`}
              >
                RISK: {session.riskLevel.toUpperCase()}
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <span>{session.findingTitle}</span>
            </h2>

            <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono flex-wrap">
              <span className="flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-zinc-200">{session.targetDatabase}</span>
              </span>
              {session.targetTable && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <TableIcon className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-200">
                      {session.targetTable}
                      {session.targetColumn ? `.${session.targetColumn}` : ''}
                    </span>
                  </span>
                </>
              )}
              <span>•</span>
              <span className="text-zinc-400">ID: {session.id}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-zinc-200">
          {/* Baseline vs Verification Timeline Bar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 p-4 rounded-xl bg-zinc-950/70 border border-zinc-800">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Baseline Snapshot (Locked)</span>
              </div>
              <div className="text-sm font-semibold text-white font-mono">
                {session.baselineCapturedAt}
              </div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Scan ID: <code className="text-zinc-300">{session.baselineScanId}</code>
              </div>
            </div>

            <div className="space-y-1 border-t md:border-t-0 md:border-l border-zinc-800 pt-3 md:pt-0 md:pl-4">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verification Re-Scan</span>
              </div>
              <div className="text-sm font-semibold text-white font-mono">
                {session.verifiedAt || 'Awaiting Verification Scan'}
              </div>
              <div className="text-[11px] text-zinc-400 font-mono">
                {session.afterScanId ? (
                  <>Scan ID: <code className="text-zinc-300">{session.afterScanId}</code></>
                ) : (
                  <span className="text-amber-400/90">Apply change, then execute verification scan</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 1: Measured Before vs After Telemetry */}
          {session.metricComparisons && session.metricComparisons.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-rose-400" />
                  <span>Telemetry Measurements: Before vs After</span>
                </h3>
                <span className="text-xs text-zinc-400 font-mono">
                  {session.metricComparisons.length} Monitored Metrics
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {session.metricComparisons.map((c) => {
                  const isImproved = c.status === 'improved';
                  const isRegressed = c.status === 'regressed';
                  const isUnchanged = c.status === 'unchanged';

                  return (
                    <div
                      key={c.metricKey}
                      className="p-4 rounded-xl bg-zinc-950/50 border border-zinc-800/80 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-zinc-200">{c.label}</div>
                          <div className="text-[11px] text-zinc-400 font-mono">
                            {c.higherIsBetter ? 'Higher is better' : 'Lower is better'}
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${
                            isImproved
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : isRegressed
                              ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                              : isUnchanged
                              ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                              : 'bg-zinc-850 text-zinc-400 border-zinc-700'
                          }`}
                        >
                          {isImproved && <TrendingDown className="w-3 h-3 text-emerald-400" />}
                          {isRegressed && <TrendingUp className="w-3 h-3 text-rose-400" />}
                          {isUnchanged && <Minus className="w-3 h-3 text-zinc-400" />}
                          <span>{c.status.toUpperCase()}</span>
                        </span>
                      </div>

                      {/* Before / After side-by-side */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800/60 font-mono text-xs">
                        <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800">
                          <span className="text-[10px] text-zinc-400 block uppercase">Before</span>
                          <span className="text-sm font-bold text-zinc-300">{c.formattedBefore}</span>
                        </div>
                        <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800">
                          <span className="text-[10px] text-zinc-400 block uppercase">After</span>
                          <span className="text-sm font-bold text-white">{c.formattedAfter}</span>
                        </div>
                      </div>

                      {/* Measured Change */}
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-zinc-400">Measured Delta:</span>
                        <span
                          className={`font-bold ${
                            isImproved
                              ? 'text-emerald-400'
                              : isRegressed
                              ? 'text-rose-400'
                              : 'text-zinc-300'
                          }`}
                        >
                          {c.formattedChange}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl bg-zinc-950/40 border border-zinc-800 text-center space-y-2">
              <Clock className="w-8 h-8 text-indigo-400 mx-auto opacity-80" />
              <div className="text-sm font-bold text-white">Baseline Telemetry Captured</div>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Initial measurements are locked in the baseline. Apply the recommended remediation in
                your ClickHouse database, then click <strong>Run Verification Scan</strong> below to compare.
              </p>
            </div>
          )}

          {/* Section 2: Expected vs Actual Target Achievement */}
          {session.expectedImpact && (
            <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Target Expectation vs Actual Outcome
                </span>

                {session.expectedImpact.targetAchievedStatus && (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded font-bold border ${
                      session.expectedImpact.targetAchievedStatus === 'target_achieved' ||
                      session.expectedImpact.targetAchievedStatus === 'within_expected_range'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : session.expectedImpact.targetAchievedStatus === 'below_expected_improvement'
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : session.expectedImpact.targetAchievedStatus === 'regression_detected'
                        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                        : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}
                  >
                    {session.expectedImpact.targetAchievedStatus.replace(/_/g, ' ').toUpperCase()}
                  </span>
                )}
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                {session.expectedImpact.description}
              </p>

              {session.measuredImpactSummary && (
                <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-200 font-mono">
                  {session.measuredImpactSummary.summaryText}
                </div>
              )}
            </div>
          )}

          {/* Section 3: Distinct Technical vs Financial Impact */}
          {session.financialImpact && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-2">
                <div className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Estimated Financial Savings</span>
                </div>
                <div className="text-2xl font-black text-emerald-300 font-mono">
                  +{formatCurrency(session.financialImpact.estimatedMonthlySavings)}
                  <span className="text-xs font-normal text-emerald-400/80 ml-1">/ month</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {session.financialImpact.caveat}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-2">
                <div className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-rose-400" />
                  <span>Measured Technical Footprint</span>
                </div>
                <div className="text-sm font-semibold text-white font-mono">
                  {session.measuredImpactSummary?.storageReductionBytes
                    ? `${(session.measuredImpactSummary.storageReductionBytes / (1024 ** 3)).toFixed(2)} GB on-disk storage reduction`
                    : 'Query and compression latency optimization'}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Technical optimizations reduce disk IOPS, background compaction merges, and cache pressure
                  independently of financial billing models.
                </p>
              </div>
            </div>
          )}

          {/* Section 4: Remediation Plan & Interactive Checklist */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Remediation Execution Checklist</span>
              </h3>
              <span className="text-xs text-zinc-400 font-mono">
                {session.checklist.filter((c) => c.completed).length}/{session.checklist.length} Completed
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-2.5">
              {session.checklist.map((item, idx) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-zinc-900/60 transition cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => handleToggleChecklist(item)}
                    disabled={isUpdatingChecklist}
                    className="mt-0.5 rounded border-zinc-700 text-rose-500 focus:ring-rose-500/40 bg-zinc-800"
                  />
                  <div className="text-xs space-y-0.5 flex-1">
                    <span
                      className={`font-medium ${
                        item.completed ? 'text-zinc-400 line-through' : 'text-zinc-200'
                      }`}
                    >
                      {idx + 1}. {item.label}
                    </span>
                    {item.completedAt && (
                      <span className="block text-[10px] text-zinc-400 font-mono">
                        Completed at {item.completedAt.replace('T', ' ').substring(0, 19)}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {/* Read-Only Safety Banner */}
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Read-Only Safety Enforced: </strong>
                Yachiru never modifies your ClickHouse cluster directly. Apply the SQL remediation
                manually using <code>clickhouse-client</code> or your deployment pipeline, then run a
                verification scan to measure results.
              </div>
            </div>

            {/* Recommended SQL */}
            {session.recommendationSqlOrText && (
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Recommended Remediation SQL:</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                  >
                    {copiedSql ? (
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
                </div>

                <pre className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-rose-300/90 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  <code>{session.recommendationSqlOrText}</code>
                </pre>
              </div>
            )}

            {/* Rollback Guidance */}
            {session.rollbackGuidance && (
              <div className="p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/80 text-xs space-y-1 text-zinc-400">
                <strong className="text-zinc-300 block">Rollback Strategy:</strong>
                <p className="leading-relaxed">{session.rollbackGuidance}</p>
              </div>
            )}
          </div>

          {/* Section 5: Comparability & Confounding Factors */}
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-sky-400" />
                Fair Comparison &amp; Confounding Factors
              </span>

              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                  session.comparability.confidence === 'high'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : session.comparability.confidence === 'medium'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                }`}
              >
                CONFIDENCE: {session.comparability.confidence.toUpperCase()}
              </span>
            </div>

            <ul className="text-xs space-y-1 text-zinc-400 list-disc list-inside">
              {session.comparability.confidenceReasons.map((r, i) => (
                <li key={i} className="text-emerald-400/90 leading-relaxed">
                  {r}
                </li>
              ))}
              {session.comparability.confoundingFactors.map((f, i) => (
                <li key={i} className="text-amber-400 leading-relaxed">
                  ⚠ {f}
                </li>
              ))}
              {session.comparability.caveats.map((c, i) => (
                <li key={i} className="text-zinc-400 leading-relaxed">
                  • {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-800 bg-zinc-950/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer border border-zinc-700"
            >
              {copiedMarkdown ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied Markdown</span>
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Export Report</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={() => onRunScanAndVerify(session)}
              disabled={isVerifyingScan}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-950/50 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingScan ? 'animate-spin' : ''}`} />
              <span>{isVerifyingScan ? 'Scanning & Verifying...' : 'Run Verification Scan'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
