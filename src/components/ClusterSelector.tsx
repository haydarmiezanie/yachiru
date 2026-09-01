import React, { useState } from 'react';
import { Database, Sparkles, CheckCircle2, AlertCircle, RefreshCw, Cpu, Activity, Clock } from 'lucide-react';
import { ScanTarget } from '../types/yachiru.js';

interface ClusterSelectorProps {
  target: ScanTarget;
  setTarget: React.Dispatch<React.SetStateAction<ScanTarget>>;
  aiEnabled: boolean;
  setAiEnabled: (val: boolean) => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  onScan: () => void;
  scanning: boolean;
}

export const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  target,
  setTarget,
  aiEnabled,
  setAiEnabled,
  aiModel,
  setAiModel,
  onScan,
  scanning,
}) => {
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/clickhouse/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? 'Connected successfully!' : 'Connection failed'),
      });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'Network error' });
    } finally {
      setTestingConn(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 backdrop-blur-sm shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-amber-400" />
          <h2 className="font-semibold text-slate-100">ClickHouse Server Connection</h2>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
          <Activity className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
          <span>Live Database Audit Target</span>
        </div>
      </div>

      {/* Connection Form */}
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Protocol</label>
            <select
              value={target.protocol || (target.port === 8443 || target.port === 443 ? 'https' : 'http')}
              onChange={(e) =>
                setTarget({
                  ...target,
                  protocol: e.target.value as 'http' | 'https',
                  port: e.target.value === 'https' && target.port === 8123 ? 8443 : target.port,
                })
              }
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS (SSL)</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Host / IP / Endpoint</label>
            <input
              type="text"
              value={target.host}
              onChange={(e) => setTarget({ ...target, host: e.target.value.trim() })}
              placeholder="e.g. 192.168.1.50 or db.mycompany.internal"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">HTTP Port</label>
            <input
              type="number"
              value={target.port}
              onChange={(e) => setTarget({ ...target, port: parseInt(e.target.value) || 8123 })}
              placeholder="8123"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Database</label>
            <input
              type="text"
              value={target.database}
              onChange={(e) => setTarget({ ...target, database: e.target.value.trim() })}
              placeholder="default"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Username</label>
            <input
              type="text"
              value={target.user}
              onChange={(e) => setTarget({ ...target, user: e.target.value.trim() })}
              placeholder="default"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <label className="block text-xs font-medium text-slate-400 mb-1">Password (Leave blank if none)</label>
            <input
              type="password"
              value={target.password || ''}
              onChange={(e) => setTarget({ ...target, password: e.target.value })}
              placeholder="••••••••"
              className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            onClick={handleTestConnection}
            disabled={testingConn}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testingConn ? 'animate-spin' : ''}`} />
            <span>{testingConn ? 'Testing Connection...' : 'Test Connection (Read-Only)'}</span>
          </button>

          {testResult && (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium max-w-xl ${
                testResult.success ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              <span className="break-words">{testResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Scan Options (AI Synthesis, Lookback Window) */}
      <div className="mt-4 pt-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {/* Query Log Lookback */}
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">query_log window:</span>
            <select
              value={target.lookbackDays || 7}
              onChange={(e) => setTarget({ ...target, lookbackDays: parseInt(e.target.value) || 7 })}
              className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="1">Last 24 Hours</option>
              <option value="7">Last 7 Days (Standard)</option>
              <option value="30">Last 30 Days (Deep Audit)</option>
            </select>
          </div>

          {/* AI Toggle */}
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="rounded border-slate-700 text-amber-500 focus:ring-amber-500/20"
              />
              <span className="text-slate-300 font-medium">Gemini AI Synthesis Layer</span>
            </label>
          </div>

          {/* AI Model Selection */}
          {aiEnabled && (
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 focus:border-amber-500 focus:outline-none font-mono text-[11px]"
              >
                <option value="gemini-3.7-flash">gemini-3.7-flash (Deep Synthesis)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast / Low-Latency)</option>
              </select>
            </div>
          )}
        </div>

        <button
          onClick={onScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 active:scale-95 transition-all shadow-md shadow-amber-500/20 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          <span>{scanning ? 'Auditing 9 Dimensions...' : 'Execute Database Scan'}</span>
        </button>
      </div>
    </div>
  );
};
