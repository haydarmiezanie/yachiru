import React, { useState, useMemo } from 'react';
import { TableMetadata, CheckFinding } from '../types.js';
import {
  Table as TableIcon,
  ChevronDown,
  ChevronUp,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Copy,
  Check,
} from 'lucide-react';

interface TableDrilldownProps {
  tables: TableMetadata[];
  findings: CheckFinding[];
}

export const TableDrilldown: React.FC<TableDrilldownProps> = ({ tables, findings }) => {
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'rows' | 'size' | 'parts' | 'ratio' | 'issues'>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopySql = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const sortedTables = useMemo(() => {
    return [...tables].sort((a, b) => {
      let valA = 0;
      let valB = 0;
      if (sortField === 'rows') {
        valA = a.total_rows;
        valB = b.total_rows;
      } else if (sortField === 'size') {
        valA = a.total_bytes_compressed;
        valB = b.total_bytes_compressed;
      } else if (sortField === 'parts') {
        valA = a.active_parts;
        valB = b.active_parts;
      } else if (sortField === 'ratio') {
        valA = a.compression_ratio;
        valB = b.compression_ratio;
      } else if (sortField === 'issues') {
        valA = a.findings_count.critical * 3 + a.findings_count.warning;
        valB = b.findings_count.critical * 3 + b.findings_count.warning;
      }
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [tables, sortField, sortAsc]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-5 border-b border-zinc-800">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            Per-Table Diagnostics & Schema Analysis
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
              {tables.length} tables
            </span>
          </h3>
          <p className="text-xs text-zinc-400">
            Columnar storage footprints, part compactions, and primary index structures per table
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Sort by:</span>
          <button
            onClick={() => toggleSort('size')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition ${
              sortField === 'size'
                ? 'bg-zinc-800 text-white border-zinc-700'
                : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
            }`}
          >
            Size {sortField === 'size' && (sortAsc ? '↑' : '↓')}
          </button>
          <button
            onClick={() => toggleSort('parts')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition ${
              sortField === 'parts'
                ? 'bg-zinc-800 text-white border-zinc-700'
                : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
            }`}
          >
            Parts {sortField === 'parts' && (sortAsc ? '↑' : '↓')}
          </button>
          <button
            onClick={() => toggleSort('issues')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition ${
              sortField === 'issues'
                ? 'bg-zinc-800 text-white border-zinc-700'
                : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
            }`}
          >
            Issues {sortField === 'issues' && (sortAsc ? '↑' : '↓')}
          </button>
        </div>
      </div>

      {/* Tables Grid */}
      <div className="space-y-3">
        {sortedTables.map((table) => {
          const isExpanded = expandedTable === table.name;
          const tableFindings = findings.filter((f) => f.table === table.name);
          const hasCritical = table.findings_count.critical > 0;
          const hasWarning = table.findings_count.warning > 0;

          return (
            <div
              key={table.name}
              className={`rounded-xl border transition-all ${
                hasCritical
                  ? 'border-rose-500/30 bg-zinc-950/50'
                  : hasWarning
                  ? 'border-amber-500/30 bg-zinc-950/30'
                  : 'border-zinc-800/80 bg-zinc-950/20'
              }`}
            >
              {/* Table Header Row */}
              <div
                onClick={() => setExpandedTable(isExpanded ? null : table.name)}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-zinc-900/40 rounded-xl transition"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300">
                    <TableIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white font-mono">{table.name}</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                        {table.engine}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-3">
                      <span>ORDER BY: <code className="text-zinc-300 font-mono">{table.order_by_key}</code></span>
                      {table.partition_key !== 'None' && (
                        <span>PARTITION: <code className="text-zinc-300 font-mono">{table.partition_key}</code></span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Metrics Pill Row */}
                <div className="flex items-center gap-3 sm:gap-4 flex-wrap text-xs">
                  <div>
                    <span className="text-[10px] uppercase text-zinc-500 block">Rows</span>
                    <span className="font-mono font-bold text-zinc-200">{table.total_rows.toLocaleString()}</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase text-zinc-500 block">Size (Comp)</span>
                    <span className="font-mono font-bold text-zinc-200">{formatBytes(table.total_bytes_compressed)}</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase text-zinc-500 block">Ratio</span>
                    <span className="font-mono font-bold text-emerald-400">{table.compression_ratio}x</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase text-zinc-500 block">Parts</span>
                    <span className={`font-mono font-bold ${table.active_parts > 150 ? 'text-rose-400' : 'text-zinc-200'}`}>
                      {table.active_parts}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase text-zinc-500 block">Partitions</span>
                    <span className={`font-mono font-bold ${table.partition_count > 500 ? 'text-rose-400' : 'text-zinc-200'}`}>
                      {table.partition_count}
                    </span>
                  </div>

                  {/* Issues Badges */}
                  <div className="flex items-center gap-1.5 pl-2 border-l border-zinc-800">
                    {table.findings_count.critical > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30">
                        <AlertOctagon className="w-3 h-3" />
                        {table.findings_count.critical}
                      </span>
                    )}
                    {table.findings_count.warning > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        {table.findings_count.warning}
                      </span>
                    )}
                    {table.findings_count.critical === 0 && table.findings_count.warning === 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        Optimal
                      </span>
                    )}
                  </div>

                  <div className="text-zinc-500">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </div>

              {/* Expanded Table Findings Details */}
              {isExpanded && (
                <div className="p-4 pt-0 border-t border-zinc-850 space-y-3 mt-1">
                  <div className="text-xs font-semibold text-zinc-400 pt-3">
                    Diagnostic Checks for Table <span className="font-mono text-white">'{table.name}'</span>:
                  </div>

                  {tableFindings.length === 0 ? (
                    <div className="text-xs text-zinc-400 italic py-2">
                      No specific issues identified for this table. Schema and storage parameters are optimal.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tableFindings.map((f) => (
                        <div
                          key={f.id}
                          className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-white flex items-center gap-2">
                              {f.status === 'critical' ? (
                                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                              ) : f.status === 'warning' ? (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              )}
                              <span>{f.title}</span>
                            </span>
                            <span className="text-[11px] font-mono text-zinc-400">{f.category_name}</span>
                          </div>

                          <p className="text-zinc-300 font-mono text-[11px]">{f.evidence}</p>

                          {f.recommendation_sql_or_text && (
                            <div className="pt-2 border-t border-zinc-800">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-zinc-400">Recommendation:</span>
                                {f.is_sql_recommendation && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopySql(f.id, f.recommendation_sql_or_text);
                                    }}
                                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white bg-zinc-800 px-2 py-0.5 rounded cursor-pointer"
                                  >
                                    {copiedId === f.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span className="text-emerald-400">Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3 text-zinc-400" />
                                        <span>Copy SQL</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>

                              {f.is_sql_recommendation ? (
                                <pre className="p-2 rounded bg-zinc-950 font-mono text-[11px] text-rose-300 overflow-x-auto">
                                  <code>{f.recommendation_sql_or_text}</code>
                                </pre>
                              ) : (
                                <p className="text-zinc-300 text-xs">{f.recommendation_sql_or_text}</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
