import React, { useState } from 'react';
import { X, Copy, Check, Download, ShieldCheck, KeyRound, AlertTriangle, Info, History, Database } from 'lucide-react';

interface ClickHouseUserSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDatabase?: string;
}

export const ClickHouseUserSetupModal: React.FC<ClickHouseUserSetupModalProps> = ({
  isOpen,
  onClose,
  defaultDatabase = 'default',
}) => {
  const [activeTab, setActiveTab] = useState<'readonly' | 'history'>('readonly');

  // Read-only user state
  const [username, setUsername] = useState('yachiru_readonly');
  const [password, setPassword] = useState('');
  const [copiedReadonly, setCopiedReadonly] = useState(false);

  // History table & write user state
  const [historyDb, setHistoryDb] = useState(defaultDatabase || 'default');
  const [historyTable, setHistoryTable] = useState('yachiru_scan_history');
  const [writeUsername, setWriteUsername] = useState('yachiru_history_writer');
  const [writePassword, setWritePassword] = useState('');
  const [copiedHistory, setCopiedHistory] = useState(false);

  if (!isOpen) return null;

  const effectiveUsername = username.trim() || 'yachiru_readonly';
  const hasCustomPassword = password.length > 0;
  const effectivePassword = hasCustomPassword
    ? password.replace(/'/g, "\\'")
    : '<CHANGE_ME_STRONG_PASSWORD>';

  const generatedReadonlySql = `-- ============================================================
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
-- Grant them if you want Query Performance, Replication/Distributed, Mutations,
-- Disk Space, Error Rates, and Replication Queue checks.
GRANT SELECT ON system.query_log TO ${effectiveUsername};
GRANT SELECT ON system.replicas TO ${effectiveUsername};
GRANT SELECT ON system.distribution_queue TO ${effectiveUsername};
GRANT SELECT ON system.mutations TO ${effectiveUsername};
GRANT SELECT ON system.disks TO ${effectiveUsername};
GRANT SELECT ON system.errors TO ${effectiveUsername};
GRANT SELECT ON system.replication_queue TO ${effectiveUsername};

-- Recommended: enforce read-only at the ClickHouse server level too, as a
-- second layer of defense in addition to Yachiru's own client-side guard.
-- Use readonly = 2, NOT readonly = 1: Yachiru sets per-query settings such
-- as max_execution_time on every request, and readonly = 1 would reject
-- those setting overrides and break every scan. readonly = 2 still blocks
-- all INSERT/ALTER/DROP/etc. while allowing per-query setting overrides.
ALTER USER ${effectiveUsername} SETTINGS readonly = 2, max_execution_time = 30;
`;

  const effectiveHistoryDb = historyDb.trim() || 'default';
  const effectiveHistoryTable = historyTable.trim() || 'yachiru_scan_history';
  const effectiveWriteUsername = writeUsername.trim() || 'yachiru_history_writer';
  const hasCustomWritePassword = writePassword.length > 0;
  const effectiveWritePassword = hasCustomWritePassword
    ? writePassword.replace(/'/g, "\\'")
    : '<CHANGE_ME_STRONG_PASSWORD>';

  const generatedHistorySql = `-- ============================================================
-- Yachiru — Optional Scan History & Trend Tracking Setup
-- Run this as a ClickHouse admin (via clickhouse-client, HTTP admin
-- session, or your provider's SQL console).
--
-- Security Model (Strict Separation of Privileges):
-- 1. Dedicated Write User: Holds ONLY INSERT privilege on this history
--    table. Cannot read, modify, or delete any other data on the cluster.
-- 2. Read-Only Scan User: Receives SELECT privilege on this table to
--    query historical trends and score progression over time.
-- ============================================================

-- Step 1: Create the history table in your chosen database
CREATE TABLE IF NOT EXISTS ${effectiveHistoryDb}.${effectiveHistoryTable}
(
    scan_id String,
    scanned_at DateTime,
    target_host String,
    target_database String,
    overall_score UInt8,
    overall_verdict String,
    category_scores String,   -- JSON map: { "part_health": 82, "compression": 91, ... }
    finding_summary String,   -- JSON array of { category, title, severity } only
    clickhouse_version String
)
ENGINE = MergeTree()
ORDER BY (target_host, target_database, scanned_at);

-- Step 2: Create a dedicated write-only user (never reuse your scan user)
CREATE USER IF NOT EXISTS ${effectiveWriteUsername}
IDENTIFIED WITH sha256_password BY '${effectiveWritePassword}';

-- Step 3: Grant ONLY INSERT on the history table to the write user
GRANT INSERT ON ${effectiveHistoryDb}.${effectiveHistoryTable} TO ${effectiveWriteUsername};

-- Step 4: Grant SELECT to your existing read-only scan user for trend views
GRANT SELECT ON ${effectiveHistoryDb}.${effectiveHistoryTable} TO ${effectiveUsername};
`;

  const handleCopyReadonly = () => {
    navigator.clipboard.writeText(generatedReadonlySql);
    setCopiedReadonly(true);
    setTimeout(() => setCopiedReadonly(false), 2000);
  };

  const handleDownloadReadonly = () => {
    const filename = `yachiru-clickhouse-${effectiveUsername}-setup.sql`;
    const blob = new Blob([generatedReadonlySql], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyHistory = () => {
    navigator.clipboard.writeText(generatedHistorySql);
    setCopiedHistory(true);
    setTimeout(() => setCopiedHistory(false), 2000);
  };

  const handleDownloadHistory = () => {
    const filename = `yachiru-history-table-setup.sql`;
    const blob = new Blob([generatedHistorySql], { type: 'application/sql;charset=utf-8' });
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
                <span>ClickHouse Security &amp; Permissions Setup</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Generate least-privilege SQL scripts for your ClickHouse administrator
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

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/60 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('readonly')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition cursor-pointer ${
              activeTab === 'readonly'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>1. Read-Only Scan User (Core)</span>
            <span className="text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Zero Data Access
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition cursor-pointer ${
              activeTab === 'history'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>2. Optional: Scan History &amp; Trends Setup</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              In-Cluster Table
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {activeTab === 'readonly' ? (
            <>
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
                      onClick={handleCopyReadonly}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
                    >
                      {copiedReadonly ? (
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
                      onClick={handleDownloadReadonly}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .sql</span>
                    </button>
                  </div>
                </div>

                <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed max-h-[280px] select-all">
                  {generatedReadonlySql}
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
            </>
          ) : (
            <>
              {/* History Parameters Form */}
              <div className="bg-zinc-950/80 p-4 rounded-xl border border-zinc-800 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Target Database for History Table</span>
                    </label>
                    <input
                      type="text"
                      value={historyDb}
                      onChange={(e) => setHistoryDb(e.target.value)}
                      placeholder="default"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      The database where `yachiru_scan_history` will reside.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Table Name
                    </label>
                    <input
                      type="text"
                      value={historyTable}
                      onChange={(e) => setHistoryTable(e.target.value)}
                      placeholder="yachiru_scan_history"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Default: <code className="font-mono text-zinc-400">yachiru_scan_history</code>.
                    </p>
                  </div>
                </div>

                <div className="border-t border-zinc-800/80 pt-3">
                  <div className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                    <span>Dedicated Write User Credentials (Separate from Read-Only Scan User)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Write Username
                      </label>
                      <input
                        type="text"
                        value={writeUsername}
                        onChange={(e) => setWriteUsername(e.target.value)}
                        placeholder="yachiru_history_writer"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                      />
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Dedicated account that only receives INSERT on this history table.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Write Password (Plain text input)
                      </label>
                      <input
                        type="text"
                        value={writePassword}
                        onChange={(e) => setWritePassword(e.target.value)}
                        placeholder="<CHANGE_ME_STRONG_PASSWORD>"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                      />
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Held only in component memory; never saved to disk.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Password notice for write user */}
              {!hasCustomWritePassword && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <strong className="font-semibold text-amber-200">Password placeholder active: </strong>
                    The write user creation statement uses <code className="bg-zinc-900 px-1 py-0.5 rounded text-amber-100 font-mono">&apos;&lt;CHANGE_ME_STRONG_PASSWORD&gt;&apos;</code>. Update it above or in your SQL client prior to executing.
                  </div>
                </div>
              )}

              {/* SQL Block for History Setup */}
              <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-rose-400" />
                    <span>setup_yachiru_history.sql</span>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyHistory}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
                    >
                      {copiedHistory ? (
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
                      onClick={handleDownloadHistory}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .sql</span>
                    </button>
                  </div>
                </div>

                <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed max-h-[300px] select-all">
                  {generatedHistorySql}
                </pre>
              </div>

              {/* Explicit Plain-Language Security Disclaimer */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                  <Info className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Security &amp; Privacy Scope of Scan History</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  The dedicated write user is granted <strong>ONLY</strong> <code className="font-mono text-zinc-300">INSERT</code> on <code className="font-mono text-zinc-300">{effectiveHistoryDb}.{effectiveHistoryTable}</code> and cannot read, modify, or delete anything else on this server or any other database.
                </p>
                <div className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/80 space-y-1">
                  <p>
                    🔒 <strong>Zero State in Yachiru:</strong> Yachiru holds zero persistent state in its own container. All history rows are saved directly into your ClickHouse cluster.
                  </p>
                  <p>
                    👁️ <strong>Read Visibility:</strong> Scan summaries (overall score, category scores, finding titles, and ClickHouse version) stored in this table are readable by anyone granted <code className="font-mono text-zinc-400">SELECT</code> on it. Remediation SQL scripts, raw sample data, and server diagnostic narrative text are <strong>never</strong> recorded in this table.
                  </p>
                </div>
              </div>
            </>
          )}
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
