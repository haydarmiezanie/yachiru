import React, { useState } from 'react';
import { X, Copy, Check, Download, ShieldCheck, KeyRound, AlertTriangle, Info } from 'lucide-react';

interface ClickHouseUserSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClickHouseUserSetupModal: React.FC<ClickHouseUserSetupModalProps> = ({ isOpen, onClose }) => {
  const [username, setUsername] = useState('yachiru_readonly');
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const effectiveUsername = username.trim() || 'yachiru_readonly';
  const hasCustomPassword = password.length > 0;
  const effectivePassword = hasCustomPassword
    ? password.replace(/'/g, "\\'")
    : '<CHANGE_ME_STRONG_PASSWORD>';

  const generatedSql = `-- ============================================================
-- Yachiru — Read-Only ClickHouse User Setup
-- Run this as a ClickHouse admin (via clickhouse-client, HTTP admin
-- session, or your provider's SQL console). Yachiru itself never
-- executes this script — it only ever runs read-only SELECT queries.
-- ============================================================

CREATE USER IF NOT EXISTS ${effectiveUsername}
IDENTIFIED WITH sha256_password BY '${effectivePassword}';

-- Required: metadata Yachiru reads to compute every check category.
GRANT SELECT ON system.tables TO ${effectiveUsername};
GRANT SELECT ON system.parts TO ${effectiveUsername};
GRANT SELECT ON system.columns TO ${effectiveUsername};
GRANT SELECT ON system.data_skipping_indices TO ${effectiveUsername};
GRANT SELECT ON system.settings TO ${effectiveUsername};

-- Recommended, optional: Yachiru degrades gracefully and simply skips
-- these checks if the grants below are missing (no crash, no failed scan).
-- Grant them if you want Query Performance and Replication/Distributed checks.
GRANT SELECT ON system.query_log TO ${effectiveUsername};
GRANT SELECT ON system.replicas TO ${effectiveUsername};
GRANT SELECT ON system.distribution_queue TO ${effectiveUsername};

-- Recommended: enforce read-only at the ClickHouse server level too, as a
-- second layer of defense in addition to Yachiru's own client-side guard.
-- Use readonly = 2, NOT readonly = 1: Yachiru sets per-query settings such
-- as max_execution_time on every request, and readonly = 1 would reject
-- those setting overrides and break every scan. readonly = 2 still blocks
-- all INSERT/ALTER/DROP/etc. while allowing per-query setting overrides.
ALTER USER ${effectiveUsername} SETTINGS readonly = 2, max_execution_time = 30;
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = `yachiru-clickhouse-${effectiveUsername}-setup.sql`;
    const blob = new Blob([generatedSql], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      id="modal-clickhouse-user-setup"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Generate Read-Only ClickHouse User SQL</span>
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Zero Data Access
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Generate a least-privilege script to execute as ClickHouse administrator
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close setup modal"
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* User Parameters Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/80 p-4 rounded-xl border border-zinc-800">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Username to Create
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yachiru_readonly"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Name of the read-only user in your ClickHouse instance.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Password (Plain text input)
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="<CHANGE_ME_STRONG_PASSWORD>"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Held only in local component state; never transmitted or saved.
              </p>
            </div>
          </div>

          {/* Password Empty Notice */}
          {!hasCustomPassword && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong className="font-semibold text-amber-200">Password placeholder active: </strong>
                The script currently specifies <code className="bg-zinc-900 px-1 py-0.5 rounded text-amber-100 font-mono">&apos;&lt;CHANGE_ME_STRONG_PASSWORD&gt;&apos;</code>. Fill in a password above or replace the placeholder in your SQL editor with a strong password before running.
              </div>
            </div>
          )}

          {/* SQL Editor / Code Block Box */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
            <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                <span>setup_yachiru_user.sql</span>
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Copy to Clipboard</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .sql</span>
                </button>
              </div>
            </div>

            <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed max-h-[280px] select-all">
              {generatedSql}
            </pre>
          </div>

          {/* Mandatory Disclaimer: Cross-Database Metadata Scope */}
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Info className="w-4 h-4 text-rose-400 shrink-0" />
              <span>ClickHouse System Metadata Scope &amp; Security Boundary</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This user can see table names, sizes, and schema across all databases on this server, but cannot read table contents and cannot modify anything. If you need to hide the existence of other databases entirely, ClickHouse&apos;s per-table GRANT model can&apos;t do that — you&apos;d need a separate ClickHouse user/role scoped through your own infrastructure instead.
            </p>
            <div className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/80 flex flex-wrap gap-x-4 gap-y-1">
              <span>🔒 <strong>No Table Grants:</strong> Zero grants to application table contents (<code className="font-mono text-zinc-400">&lt;database&gt;.*</code> is never queried or requested).</span>
              <span>⚡ <strong>readonly = 2:</strong> Server-enforced read-only mode allowing per-query client timeouts while blocking all mutations.</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
