import React, { useState } from 'react';
import { Activity, Layers, Table, Settings, HardDrive, Clock, Search, Database } from 'lucide-react';
import { ScanReport } from '../types/yachiru';
import { formatBytes, formatRows } from '../lib/utils';

interface DeepDiveInspectorProps {
  report: ScanReport;
}

export const DeepDiveInspector: React.FC<DeepDiveInspectorProps> = ({ report }) => {
  const [subTab, setSubTab] = useState<'queries' | 'parts' | 'columns' | 'settings'>('queries');
  const { rawStats } = report;

  return (
    <div className="space-y-5">
      {/* Sub-tab switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3 text-xs">
        <button
          onClick={() => setSubTab('queries')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all ${
            subTab === 'queries'
              ? 'bg-amber-500 text-slate-950 font-bold shadow'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          query_log Analysis ({rawStats.slowQueries?.length || 0})
        </button>

        <button
          onClick={() => setSubTab('parts')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all ${
            subTab === 'parts'
              ? 'bg-amber-500 text-slate-950 font-bold shadow'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Parts & Merges Health ({rawStats.partsSummary?.totalParts || 0})
        </button>

        <button
          onClick={() => setSubTab('columns')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all ${
            subTab === 'columns'
              ? 'bg-amber-500 text-slate-950 font-bold shadow'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800'
          }`}
        >
          <Table className="h-3.5 w-3.5" />
          Columns & Codecs ({rawStats.columnsWithIssues?.length || 0})
        </button>

        <button
          onClick={() => setSubTab('settings')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all ${
            subTab === 'settings'
              ? 'bg-amber-500 text-slate-950 font-bold shadow'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800'
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
          System Settings & Tuning ({rawStats.configSettings?.length || 0})
        </button>
      </div>

      {/* 1. Query Log Viewer */}
      {subTab === 'queries' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Slow and high-scan query samples extracted from <code className="text-amber-400">system.query_log</code> during the lookback window:
          </p>

          <div className="space-y-3">
            {rawStats.slowQueries?.map((q: any) => {
              const scanRatio = q.result_rows > 0 ? Math.round(q.read_rows / q.result_rows) : q.read_rows;
              return (
                <div key={q.query_id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3 shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-amber-400">{q.query_id}</span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-400">User: <strong>{q.user}</strong></span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-400">{q.event_time}</span>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-rose-400">Duration: {q.query_duration_ms}ms</span>
                      <span className="text-amber-300">Read: {formatRows(q.read_rows)} rows</span>
                      <span className="text-slate-400">Result: {q.result_rows} rows</span>
                    </div>
                  </div>

                  {/* Scan to Result Ratio Banner */}
                  {scanRatio > 500 && (
                    <div className="rounded bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-300 flex items-center justify-between">
                      <span>Full Scan Inefficiency: Scanned <strong>{scanRatio.toLocaleString()}x</strong> more rows than returned</span>
                      <span className="font-bold">Missing ORDER BY or Skip Index</span>
                    </div>
                  )}

                  {/* SQL Statement */}
                  <pre className="p-3 rounded-lg bg-slate-950 font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed border border-slate-800">
                    <code>{q.query}</code>
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Parts & Merges Viewer */}
      {subTab === 'parts' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-300 mb-3">
                Active Parts Distribution
              </h4>
              <div className="space-y-2 text-xs">
                {rawStats.tables?.map((table: any) => (
                  <div key={table.name} className="flex items-center justify-between rounded-lg bg-slate-950 p-2.5 border border-slate-800">
                    <span className="font-mono text-slate-200">{table.name}</span>
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-slate-400">{table.engine}</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        (table.parts_count || 1) > 50 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {table.parts_count || 1} parts
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-300 mb-3">
                Active Background Merges (system.merges)
              </h4>
              {rawStats.mergesSummary?.sample?.length > 0 ? (
                <div className="space-y-2 text-xs">
                  {rawStats.mergesSummary.sample.map((m: any, idx: number) => (
                    <div key={idx} className="rounded-lg bg-slate-950 p-2.5 border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between font-mono">
                        <span className="text-amber-400">{m.table}</span>
                        <span className="text-rose-400">Elapsed: {m.elapsed}s</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Combining {m.num_parts} parts</span>
                        <span>Progress: {Math.round(m.progress * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-xs text-slate-500">
                  No active merges stuck in background pool.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Columns & Codecs Matrix */}
      {subTab === 'columns' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
          <div className="p-3 bg-slate-950 border-b border-slate-800 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>Columns flagged with optimization opportunities (Nullable overuse, LowCardinality candidates, Codec missing):</span>
            <span className="text-[11px] text-slate-500">Note: Column cardinality is not queried on live scans to prevent expensive table scans.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="p-3">Table</th>
                  <th className="p-3">Column</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Est. Cardinality</th>
                  <th className="p-3">Uncompressed</th>
                  <th className="p-3">Optimization Suggestion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300 font-mono">
                {rawStats.columnsWithIssues?.map((col: any, idx: number) => {
                  const isColNullable = Boolean(col.is_nullable) || String(col.type || '').startsWith('Nullable(');
                  return (
                    <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 text-slate-200">{col.table}</td>
                      <td className="p-3 text-amber-300 font-semibold">{col.name}</td>
                      <td className="p-3 text-slate-400">{col.type}</td>
                      <td className="p-3 text-slate-400">
                        {typeof col.cardinality_approx === 'number' ? (
                          col.cardinality_approx
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Not computed (live)</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400">{formatBytes(col.data_uncompressed_bytes || 0)}</td>
                      <td className="p-3 text-emerald-400 font-sans font-medium">
                        {isColNullable
                          ? 'Remove Nullable -> Default'
                          : col.cardinality_approx && col.cardinality_approx < 100
                          ? 'Convert to LowCardinality(String)'
                          : 'Apply CODEC(ZSTD)'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Settings & Limits */}
      {subTab === 'settings' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="p-3">Setting Name</th>
                  <th className="p-3">Current Value</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {rawStats.configSettings?.map((setting: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 font-mono text-amber-300">{setting.name}</td>
                    <td className="p-3 font-mono font-bold text-white">{setting.value}</td>
                    <td className="p-3">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        {setting.changed ? 'Customized' : 'Default'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400 font-sans">{setting.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
