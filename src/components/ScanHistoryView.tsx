import React, { useEffect, useState } from 'react';
import { History, Trash2, ArrowUpRight, TrendingUp, Calendar, Database, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { ScanReport } from '../types/yachiru';
import { authenticatedFetch } from '../lib/api';

interface ScanHistoryViewProps {
  currentReportId: string | null;
  onLoadScan: (scanId: string) => void;
}

export const ScanHistoryView: React.FC<ScanHistoryViewProps> = ({ currentReportId, onLoadScan }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.warn('Failed to fetch history', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleClear = async () => {
    if (window.confirm('Are you sure you want to clear all historical scan records?')) {
      await authenticatedFetch('/api/history', { method: 'DELETE' });
      fetchHistory();
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-amber-400" />
          <h3 className="font-semibold text-white">Historical Scan Audit Trail & Score Evolution</h3>
        </div>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading audit history...</div>
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <History className="mx-auto h-10 w-10 text-slate-600 mb-3" />
          <h4 className="text-sm font-medium text-slate-300">No previous scan history recorded</h4>
          <p className="mt-1 text-xs text-slate-500">
            Run an audit scan to automatically benchmark and persist health trends over time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {history.map((scan) => {
            const isCurrent = scan.id === currentReportId;
            return (
              <div
                key={scan.id}
                onClick={() => onLoadScan(scan.id)}
                className={`rounded-xl border p-4 transition-all cursor-pointer space-y-3 ${
                  isCurrent
                    ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-xs text-amber-300">
                    <Database className="h-3.5 w-3.5" />
                    <span>{scan.target?.database || 'default'}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-white px-2 py-0.5 rounded bg-slate-800">
                    Score: {scan.overallScore}/100 ({scan.overallGrade})
                  </span>
                </div>

                <div className="text-xs text-slate-400 line-clamp-1 font-medium">
                  {scan.target?.clusterName || scan.target?.host}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-slate-500" />
                    <span>{new Date(scan.timestamp).toLocaleString()}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-rose-400 font-bold">{scan.criticalCount} crit</span>
                    <span className="text-amber-400">{scan.warningCount} warn</span>
                  </div>
                </div>

                {isCurrent && (
                  <div className="rounded bg-amber-500/20 text-center py-1 text-[11px] font-semibold text-amber-300">
                    Active Report
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
