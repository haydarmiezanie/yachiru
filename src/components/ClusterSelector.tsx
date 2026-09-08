import React, { useState } from 'react';
import {
  Database,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Activity,
  Clock,
  Server,
  Zap,
  HardDrive,
} from 'lucide-react';
import { ScanTarget } from '../types/yachiru';
import { authenticatedFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ClusterSelectorProps {
  target: ScanTarget;
  setTarget: React.Dispatch<React.SetStateAction<ScanTarget>>;
  aiEnabled: boolean;
  setAiEnabled: (val: boolean) => void;
  aiProvider: 'gemini' | 'openai';
  setAiProvider: (provider: 'gemini' | 'openai') => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  aiApiKey?: string;
  setAiApiKey?: (key: string) => void;
  onScan: () => void;
  scanning: boolean;
}

const DEMO_PRESETS = [
  {
    id: 'apex_ecommerce',
    name: 'Apex E-Commerce',
    badge: '142M Rows',
    industry: 'E-Commerce & Orders',
    database: 'ecommerce_analytics',
    description: 'Overused Nullable columns, unindexed tenant filters, missing projections & merge pressure.',
  },
  {
    id: 'nexus_iot',
    name: 'Nexus IoT Fleet',
    badge: '480M Rows',
    industry: 'IoT & Telemetry',
    database: 'iot_telemetry',
    description: 'Partition explosion (toYYYYMMDD), uncompressed timestamps missing Gorilla codec.',
  },
  {
    id: 'finpulse_ledger',
    name: 'FinPulse Ledger',
    badge: '65M Rows',
    industry: 'Fintech & Payments',
    database: 'ledger_prod',
    description: 'Heavy ReplacingMergeTree deduplication lag & missing Bloom Filter indexes.',
  },
  {
    id: 'cloudtrace_logs',
    name: 'CloudTrace Logs',
    badge: '310M Rows',
    industry: 'Cloud Observability',
    database: 'telemetry_logs',
    description: 'High cardinality LowCardinality candidates, stuck merges, unbounded tables without TTL.',
  },
];

export const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  target,
  setTarget,
  aiEnabled,
  setAiEnabled,
  aiProvider,
  setAiProvider,
  aiModel,
  setAiModel,
  aiApiKey = '',
  setAiApiKey,
  onScan,
  scanning,
}) => {
  const { isAuditor } = useAuth();
  const [activeMode, setActiveMode] = useState<'demo' | 'custom'>(target.isDemoCluster ? 'demo' : 'custom');
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);

  const handleProviderChange = (newProvider: 'gemini' | 'openai') => {
    setAiProvider(newProvider);
    if (newProvider === 'openai') {
      setAiModel('gpt-4o');
    } else {
      setAiModel('gemini-3.7-flash');
    }
  };

  const selectDemoPreset = (preset: (typeof DEMO_PRESETS)[0]) => {
    setActiveMode('demo');
    setTestResult(null);
    setTarget((prev) => ({
      ...prev,
      isDemoCluster: true,
      demoClusterId: preset.id,
      host: `${preset.id}.clickhouse.internal`,
      port: 8123,
      database: preset.database,
      user: 'default',
    }));
  };

  const selectCustomMode = () => {
    setActiveMode('custom');
    setTestResult(null);
    setTarget((prev) => ({
      ...prev,
      isDemoCluster: false,
      host: prev.host.includes('.internal') ? 'localhost' : prev.host,
    }));
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await authenticatedFetch('/api/clickhouse/test-connection', {
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
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 backdrop-blur-sm shadow-xl space-y-4">
      {/* Header with Mode Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-amber-400" />
          <h2 className="font-semibold text-slate-100">Audit Target Selection</h2>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
          <button
            type="button"
            onClick={() => selectDemoPreset(DEMO_PRESETS.find((p) => p.id === target.demoClusterId) || DEMO_PRESETS[0])}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-all cursor-pointer ${
              activeMode === 'demo'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span>Interactive Demo Clusters</span>
          </button>
          <button
            type="button"
            onClick={selectCustomMode}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-all cursor-pointer ${
              activeMode === 'custom'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="h-3.5 w-3.5 text-slate-400" />
            <span>Live ClickHouse Instance</span>
          </button>
        </div>
      </div>

      {/* Mode 1: Interactive Demo Cluster Presets */}
      {activeMode === 'demo' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Choose a Demo Workload Dataset:</span>
            <span className="text-[11px] text-amber-400/90 font-mono">Zero Setup Required • Instant Scan</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {DEMO_PRESETS.map((preset) => {
              const isSelected = target.isDemoCluster && target.demoClusterId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectDemoPreset(preset)}
                  className={`text-left rounded-xl p-3 border transition-all cursor-pointer relative flex flex-col justify-between ${
                    isSelected
                      ? 'border-amber-500/80 bg-amber-500/10 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/40'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-white">{preset.name}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-amber-400 border border-slate-700">
                        {preset.badge}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mb-1.5 font-medium">{preset.industry}</span>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{preset.description}</p>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>db: {preset.database}</span>
                    {isSelected && <span className="text-emerald-400 font-bold">Selected ✓</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mode 2: Live ClickHouse Connection Form */}
      {activeMode === 'custom' && (
        <div className="space-y-4">
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
                onChange={(e) => {
                  let val = e.target.value.trim();
                  let newProtocol = target.protocol;
                  let newPort = target.port;

                  if (val.startsWith('https://')) {
                    newProtocol = 'https';
                    val = val.replace(/^https:\/\//i, '');
                  } else if (val.startsWith('http://')) {
                    val = val.replace(/^http:\/\//i, '');
                  }

                  if (val.toLowerCase().includes('.clickhouse.cloud')) {
                    newProtocol = 'https';
                    if (newPort === 8123 || !newPort) {
                      newPort = 8443;
                    }
                  }

                  setTarget({
                    ...target,
                    host: val,
                    protocol: newProtocol,
                    port: newPort,
                  });
                }}
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
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
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span className="break-words">{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Advanced Scan Options (AI Synthesis, Lookback Window, Scan Action Button) */}
      <div className="pt-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
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
              <span className="text-slate-300 font-medium">AI Synthesis Layer</span>
            </label>
          </div>

          {/* AI Provider & Model Selection */}
          {aiEnabled && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Provider Selection */}
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Provider:</span>
                <select
                  value={aiProvider}
                  onChange={(e) => handleProviderChange(e.target.value as 'gemini' | 'openai')}
                  className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 focus:border-amber-500 focus:outline-none font-medium text-[11px]"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                </select>
              </div>

              {/* Model Selection */}
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200 focus:border-amber-500 focus:outline-none font-mono text-[11px]"
                >
                  {aiProvider === 'gemini' ? (
                    <>
                      <option value="gemini-3.7-flash">Gemini 3.7 Flash (Fast, Balanced & Low Latency)</option>
                      <option value="gemini-3.7-flash-thinking">Gemini 3.7 Flash Thinking (Deep Reasoning & Algorithmic Tuning)</option>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (Complex Architecture & Deep Reasoning)</option>
                      <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Ultra Low-Latency)</option>
                    </>
                  ) : (
                    <>
                      <option value="gpt-4o">GPT-4o (Flagship Multimodal & High-Speed Architecture)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (Fast & Cost-Efficient SQL Tuning)</option>
                      <option value="o3-mini">o3-mini (High-Reasoning STEM & Deep Query Optimization)</option>
                      <option value="o1">o1 (Ultra Deep Reasoning & System Architecture)</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo (High Context Database Analysis)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Optional Custom API Key Toggle */}
              {setAiApiKey && (
                <button
                  type="button"
                  onClick={() => setShowKeyInput(!showKeyInput)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium border transition-colors ${
                    aiApiKey
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                  }`}
                  title="Override environment variable with a custom API key for this scan"
                >
                  {aiApiKey ? 'Custom Key Set ✓' : '+ Custom Key'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Execute Scan Trigger */}
        <button
          onClick={onScan}
          disabled={scanning || !isAuditor}
          title={
            !isAuditor
              ? 'Your role is Viewer (read-only). Auditor or Admin role is required to run scans.'
              : undefined
          }
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all shadow-md shrink-0 ${
            !isAuditor
              ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-60'
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400 active:scale-95 shadow-amber-500/20 cursor-pointer'
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          <span>
            {scanning
              ? 'Auditing 9 Dimensions...'
              : !isAuditor
              ? 'Read-Only (Viewer)'
              : activeMode === 'demo'
              ? 'Execute Demo Cluster Scan'
              : 'Execute Database Scan'}
          </span>
        </button>
      </div>

      {/* Expandable Custom API Key Input */}
      {aiEnabled && showKeyInput && setAiApiKey && (
        <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center gap-2 text-xs">
          <span className="text-slate-400 whitespace-nowrap">
            {aiProvider === 'openai' ? 'OpenAI API Key:' : 'Gemini API Key:'}
          </span>
          <input
            type="password"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value.trim())}
            placeholder={aiProvider === 'openai' ? 'sk-proj-...' : 'AIzaSy... (leave blank to use server environment)'}
            className="flex-1 max-w-md rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
          />
          {aiApiKey && (
            <button
              type="button"
              onClick={() => setAiApiKey('')}
              className="text-[11px] text-slate-500 hover:text-rose-400"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};
