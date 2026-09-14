import React, { useState, useRef, useEffect } from 'react';
import { ConnectionConfig, AiProvider, AVAILABLE_AI_MODELS } from '../types.js';
import { ClickHouseUserSetupModal } from './ClickHouseUserSetupModal.js';
import {
  Database,
  Lock,
  Server,
  Shield,
  Sliders,
  Sparkles,
  Zap,
  Globe,
  KeyRound,
  FileCode2,
  Eye,
  EyeOff,
  AlertTriangle,
  ExternalLink,
  Check,
  Activity,
  CheckCircle2,
} from 'lucide-react';

export function sanitizeHostInput(raw: string): {
  host: string;
  autoProtocol?: 'http' | 'https';
  autoPort?: number;
  wasCorrected: boolean;
} {
  let val = raw.trim();
  let wasCorrected = false;
  let autoProtocol: 'http' | 'https' | undefined;
  let autoPort: number | undefined;

  // Check if user copied/pasted a URL with http:// or https://
  if (/^https?:\/\//i.test(val)) {
    wasCorrected = true;
    try {
      const url = new URL(val);
      if (url.protocol === 'https:') autoProtocol = 'https';
      if (url.protocol === 'http:') autoProtocol = 'http';
      if (url.port) {
        const p = parseInt(url.port, 10);
        if (!isNaN(p)) autoPort = p;
      }
      val = url.hostname;
    } catch {
      if (/^https:\/\//i.test(val)) autoProtocol = 'https';
      if (/^http:\/\//i.test(val)) autoProtocol = 'http';
      val = val.replace(/^https?:\/\//i, '');
      val = val.replace(/\/.*$/, '');
      const colonMatch = val.match(/:(\d+)$/);
      if (colonMatch) {
        autoPort = parseInt(colonMatch[1], 10);
        val = val.replace(/:(\d+)$/, '');
      }
    }
  } else if (val.includes('/') || /:\d+$/.test(val)) {
    // If entered without protocol, e.g. "my-host.clickhouse.cloud:8443/" or "my-host.com/"
    wasCorrected = true;
    val = val.replace(/\/.*$/, ''); // strip path
    const colonMatch = val.match(/:(\d+)$/);
    if (colonMatch) {
      autoPort = parseInt(colonMatch[1], 10);
      val = val.replace(/:(\d+)$/, '');
    }
  }

  return {
    host: val,
    autoProtocol,
    autoPort,
    wasCorrected,
  };
}

interface ConnectionFormProps {
  onConnect: (config: ConnectionConfig) => void;
  isLoading: boolean;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ onConnect, isLoading }) => {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState<number>(8123);
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [username, setUsername] = useState('default');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('default');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [durationThreshold, setDurationThreshold] = useState<number>(3000);
  const [memoryThresholdMB, setMemoryThresholdMB] = useState<number>(1024);
  const [hostCorrectedNotice, setHostCorrectedNotice] = useState<string | null>(null);

  // Test Connection state
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  // User-provided AI state (Gemini & OpenAI)
  const [enableAiNarrative, setEnableAiNarrative] = useState(() => {
    return Boolean(
      sessionStorage.getItem('yachiru_gemini_api_key') ||
      sessionStorage.getItem('yachiru_openai_api_key')
    );
  });
  const [aiProvider, setAiProvider] = useState<AiProvider>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_gemini_api_key') || '';
  });
  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_openai_api_key') || '';
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  // Persist keys in session storage for current tab convenience
  useEffect(() => {
    if (geminiApiKey) {
      sessionStorage.setItem('yachiru_gemini_api_key', geminiApiKey);
    }
  }, [geminiApiKey]);

  useEffect(() => {
    if (openaiApiKey) {
      sessionStorage.setItem('yachiru_openai_api_key', openaiApiKey);
    }
  }, [openaiApiKey]);

  const handleProviderToggle = (newProvider: AiProvider) => {
    setAiProvider(newProvider);
    setApiKeyError(null);
    if (newProvider === 'gemini') {
      setSelectedModel('gemini-3.8-flash');
    } else {
      setSelectedModel('gpt-5.4-mini');
    }
  };

  const handleProtocolChange = (newProtocol: 'http' | 'https') => {
    setProtocol(newProtocol);
    if (newProtocol === 'https' && port === 8123) {
      setPort(8443);
    } else if (newProtocol === 'http' && port === 8443) {
      setPort(8123);
    }
  };

  const applyHostSanitization = (raw: string) => {
    const { host: cleanedHost, autoProtocol, autoPort, wasCorrected } = sanitizeHostInput(raw);
    setHost(cleanedHost);
    if (autoProtocol) {
      setProtocol(autoProtocol);
      if (!autoPort) {
        setPort(autoProtocol === 'https' ? 8443 : 8123);
      }
    }
    if (autoPort) {
      setPort(autoPort);
    }
    if (wasCorrected) {
      setHostCorrectedNotice(`Domain cleaned: ${cleanedHost}`);
      setTimeout(() => setHostCorrectedNotice(null), 4000);
    }
  };

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHost(e.target.value);
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteText = e.clipboardData.getData('text');
    if (pasteText && (/^https?:\/\//i.test(pasteText) || pasteText.includes('/') || /:\d+$/.test(pasteText))) {
      e.preventDefault();
      applyHostSanitization(pasteText);
    }
  };

  const handleHostBlur = () => {
    if (/^https?:\/\//i.test(host) || host.includes('/') || /:\d+$/.test(host)) {
      applyHostSanitization(host);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);

    const { host: cleanedHost, autoProtocol, autoPort } = sanitizeHostInput(host);
    const targetHost = cleanedHost || host.trim();
    const targetPort = autoPort || Number(port) || (protocol === 'https' ? 8443 : 8123);
    const targetProtocol = autoProtocol || protocol;

    try {
      const response = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: targetHost,
          port: targetPort,
          protocol: targetProtocol,
          username: username.trim(),
          password,
          database: database.trim(),
          isDemo: false,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || `Connected to ClickHouse v${data.version || 'OK'} successfully (${targetProtocol.toUpperCase()})`,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || `Test connection failed (Status ${response.status})`,
          hint: data.hint,
        });
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network failure testing connection',
        hint: 'Please ensure host is reachable and HTTP port is open (default 8123 HTTP / 8443 HTTPS).',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const validateAndProceed = (targetIsDemo: boolean, forceWithoutAi: boolean = false) => {
    const willUseAi = forceWithoutAi ? false : enableAiNarrative;
    const activeApiKey = aiProvider === 'openai' ? openaiApiKey : geminiApiKey;

    // Check if AI is enabled but user has not provided an API key for selected provider
    if (willUseAi && !activeApiKey.trim()) {
      const providerLabel = aiProvider === 'openai' ? 'OpenAI' : 'Gemini';
      setApiKeyError(
        `${providerLabel} API Key is required because AI Executive Narrative is enabled. Please enter your ${providerLabel} API key below or proceed with deterministic analysis without AI.`
      );
      setShowAdvanced(true);
      setTimeout(() => {
        apiKeyInputRef.current?.focus();
      }, 100);
      return;
    }

    setApiKeyError(null);

    if (forceWithoutAi) {
      setEnableAiNarrative(false);
    }

    if (targetIsDemo) {
      onConnect({
        host: 'demo.internal',
        port: 8443,
        protocol: 'https',
        username: 'default',
        password: '',
        database: 'production',
        enableAiNarrative: willUseAi,
        aiProvider,
        geminiModel: selectedModel.trim(),
        geminiApiKey: willUseAi && aiProvider === 'gemini' ? geminiApiKey.trim() : undefined,
        openaiApiKey: willUseAi && aiProvider === 'openai' ? openaiApiKey.trim() : undefined,
        isDemo: true,
      });
    } else {
      const { host: cleanedHost, autoProtocol, autoPort } = sanitizeHostInput(host);
      const finalHost = cleanedHost || host.trim();
      const finalPort = autoPort || Number(port);
      const finalProtocol = autoProtocol || protocol;

      onConnect({
        host: finalHost,
        port: finalPort,
        protocol: finalProtocol,
        username: username.trim(),
        password,
        database: database.trim(),
        queryDurationThresholdMs: Number(durationThreshold),
        queryMemoryThresholdBytes: Number(memoryThresholdMB) * 1024 * 1024,
        enableAiNarrative: willUseAi,
        aiProvider,
        geminiModel: selectedModel.trim(),
        geminiApiKey: willUseAi && aiProvider === 'gemini' ? geminiApiKey.trim() : undefined,
        openaiApiKey: willUseAi && aiProvider === 'openai' ? openaiApiKey.trim() : undefined,
        isDemo: false,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateAndProceed(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Hero Presentation */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Full-Spectrum ClickHouse Audit</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-3">
          Diagnose your ClickHouse cluster with pure evidence
        </h2>
        <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
          Connect to any live ClickHouse database to identify part merge bottlenecks, unpruned ORDER BY full scans, over-partitioning, and codec inefficiencies.
        </p>
      </div>

      {/* Safety & Read-Only Guarantee Banner */}
      <div className="mb-8 p-4 rounded-xl bg-zinc-900/90 border border-emerald-500/30 shadow-sm flex items-start gap-3.5">
        <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 shrink-0 mt-0.5">
          <Shield className="w-5 h-5" />
        </div>
        <div className="text-xs text-zinc-300 space-y-1">
          <p className="font-semibold text-emerald-400 text-sm flex items-center gap-1.5">
            Strict Read-Only SQL Architecture
          </p>
          <p className="text-zinc-400 leading-relaxed">
            Yachiru strictly issues read-only <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">SELECT</code> queries against ClickHouse system tables (<code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.parts</code>, <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.tables</code>, <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.query_log</code>). It will <strong className="text-zinc-200">never</strong> execute or expose mutating statements (no ALTER, DROP, TRUNCATE, INSERT, or KILL).
          </p>
          <p className="text-zinc-400">
            🔒 <strong className="text-zinc-300">Tab-Scoped Ephemeral Security:</strong> Connection credentials & API keys are held in server volatile memory during active scans and never written to database or persistent disk. For user convenience, the API key is cached in browser <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">sessionStorage</code> for this browser tab only and is automatically cleared when the tab closes.
          </p>
        </div>
      </div>

      {/* Main Connection Form Card */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-2 text-zinc-100 font-semibold text-base">
              <Server className="w-4 h-4 text-rose-400" />
              <span>ClickHouse Target Instance</span>
            </div>
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
              <button
                type="button"
                onClick={() => handleProtocolChange('http')}
                className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                  protocol === 'http'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                HTTP (8123)
              </button>
              <button
                type="button"
                onClick={() => handleProtocolChange('https')}
                className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                  protocol === 'https'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                HTTPS (8443 / Cloud)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Host */}
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Host or Endpoint</span>
                </label>
                {hostCorrectedNotice && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono animate-in fade-in">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>{hostCorrectedNotice}</span>
                  </span>
                )}
              </div>
              <input
                id="input-host"
                type="text"
                required
                value={host}
                onChange={handleHostChange}
                onPaste={handleHostPaste}
                onBlur={handleHostBlur}
                placeholder="example.clickhouse.cloud or my-node.internal"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
              {(host.trim().toLowerCase() === 'localhost' || host.trim() === '127.0.0.1') && (
                <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1">
                  <span>💡 In this cloud runtime, &apos;localhost&apos; points to the container. Use a public URL/tunnel or ClickHouse Cloud for live instances.</span>
                </p>
              )}
            </div>

            {/* Port */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Port</label>
              <input
                id="input-port"
                type="number"
                required
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Username */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
                <span>Username</span>
              </label>
              <input
                id="input-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="default"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Password */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Password</span>
              </label>
              <input
                id="input-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="(optional for local default)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Database */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-zinc-400" />
                <span>Database Name</span>
              </label>
              <input
                id="input-database"
                type="text"
                required
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="default"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Read-Only User Setup SQL Generator link */}
            <div className="sm:col-span-12 flex items-center justify-between pt-0.5">
              <button
                type="button"
                id="btn-open-user-setup-modal"
                onClick={() => setIsSetupModalOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer hover:underline"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Don&apos;t have a read-only ClickHouse user yet? Generate setup SQL &rarr;</span>
              </button>
            </div>
          </div>

          {/* AI Narrative Configuration Box (Directly visible in form) */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="toggle-ai-narrative"
                  checked={enableAiNarrative}
                  onChange={(e) => {
                    setEnableAiNarrative(e.target.checked);
                    if (e.target.checked) {
                      setApiKeyError(null);
                    }
                  }}
                  className="w-4 h-4 rounded border-zinc-700 text-rose-500 focus:ring-rose-500 focus:ring-offset-zinc-950 cursor-pointer"
                />
                <label htmlFor="toggle-ai-narrative" className="text-xs font-semibold text-zinc-200 cursor-pointer flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                  <span>Enable AI Executive Narrative</span>
                  <span className="text-[11px] font-normal text-zinc-400">(Optional)</span>
                </label>
              </div>

              <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${enableAiNarrative ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-500'}`}>
                {enableAiNarrative ? `${aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} AI Enabled` : 'Deterministic Only'}
              </span>
            </div>

            {/* If AI is enabled, user configures provider, API key, and model */}
            {enableAiNarrative && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-3 animate-in fade-in duration-150">
                {/* AI Provider Segmented Control */}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">AI Provider</label>
                  <div className="grid grid-cols-2 gap-2 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      id="btn-provider-gemini"
                      onClick={() => handleProviderToggle('gemini')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        aiProvider === 'gemini'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Google Gemini</span>
                    </button>

                    <button
                      type="button"
                      id="btn-provider-openai"
                      onClick={() => handleProviderToggle('openai')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        aiProvider === 'openai'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>OpenAI</span>
                    </button>
                  </div>
                </div>

                {/* API Key Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                      <span>{aiProvider === 'openai' ? 'OpenAI API Key' : 'Google Gemini API Key'}</span>
                      <span className="text-rose-400 text-xs">*</span>
                    </label>

                    <a
                      href={
                        aiProvider === 'openai'
                          ? 'https://platform.openai.com/api-keys'
                          : 'https://aistudio.google.com/app/apikey'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition underline decoration-rose-500/30"
                    >
                      <span>{aiProvider === 'openai' ? 'Get OpenAI Key' : 'Get Free Key at AI Studio'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="relative">
                    <input
                      ref={apiKeyInputRef}
                      id={aiProvider === 'openai' ? 'input-openai-api-key' : 'input-gemini-api-key'}
                      type={showApiKey ? 'text' : 'password'}
                      value={aiProvider === 'openai' ? openaiApiKey : geminiApiKey}
                      onChange={(e) => {
                        if (aiProvider === 'openai') {
                          setOpenaiApiKey(e.target.value);
                        } else {
                          setGeminiApiKey(e.target.value);
                        }
                        if (apiKeyError) setApiKeyError(null);
                      }}
                      placeholder={
                        aiProvider === 'openai'
                          ? 'Enter your OpenAI API Key (sk-...)'
                          : 'Enter your Gemini API Key (AIzaSy...)'
                      }
                      className={`w-full bg-zinc-900 border ${
                        apiKeyError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-zinc-800'
                      } rounded-lg pl-3.5 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono`}
                    />

                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                      title={showApiKey ? 'Hide Key' : 'Show Key'}
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {apiKeyError && (
                    <div className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{apiKeyError}</span>
                    </div>
                  )}

                  <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                    API key is provided directly in the UI (no .env setup required) and cached in <span className="text-zinc-300 font-mono">sessionStorage</span> for the current browser tab only. It is automatically cleared when this tab closes and is never saved to persistent disk.
                  </p>
                </div>

                {/* Model Selection Dropdown */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                  <span className="text-xs text-zinc-400 shrink-0">Model:</span>
                  <select
                    id="select-ai-model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 font-mono w-full sm:w-auto"
                  >
                    {AVAILABLE_AI_MODELS.filter((m) => m.provider === aiProvider).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.badge ? `(${m.badge})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Advanced Tunables Toggle */}
          <div className="pt-1">
            <button
              type="button"
              id="btn-toggle-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-500" />
              <span>{showAdvanced ? 'Hide Additional Threshold Tunables' : 'Show Additional Threshold Tunables'}</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 p-4 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Query Duration Flag Threshold (ms)
                    </label>
                    <input
                      type="number"
                      value={durationThreshold}
                      onChange={(e) => setDurationThreshold(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono"
                    />
                    <span className="text-[11px] text-zinc-500">Flags queries exceeding this duration in query_log</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Query Memory Flag Threshold (MB)
                    </label>
                    <input
                      type="number"
                      value={memoryThresholdMB}
                      onChange={(e) => setMemoryThresholdMB(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono"
                    />
                    <span className="text-[11px] text-zinc-500">Flags analytical queries with high peak memory consumption</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Reminder Banner when AI is enabled but API Key is missing */}
          {apiKeyError && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-amber-300 block mb-0.5">Notice: Gemini API Key Required</span>
                  <p className="text-zinc-300 leading-relaxed">{apiKeyError}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEnableAiNarrative(true);
                    setShowAdvanced(true);
                    apiKeyInputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  Enter API Key Now
                </button>

                <button
                  type="button"
                  onClick={() => validateAndProceed(false, true)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Continue Without AI (Deterministic Analysis)</span>
                </button>
              </div>
            </div>
          )}

          {/* Test Connection Result Alert */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-semibold">{testResult.message}</div>
                {testResult.hint && <div className="text-zinc-300 leading-relaxed text-[11px]">{testResult.hint}</div>}
              </div>
            </div>
          )}

          {/* Action CTAs */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              id="btn-submit-scan"
              type="submit"
              disabled={isLoading || isTestingConnection}
              className="w-full sm:flex-1 py-3 px-6 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 shadow-lg shadow-rose-950/40 disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Executing Read-Only Audit...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Run Live Optimization Analysis</span>
                </>
              )}
            </button>

            <button
              id="btn-test-connection"
              type="button"
              disabled={isLoading || isTestingConnection}
              onClick={handleTestConnection}
              className="w-full sm:w-auto py-3 px-4 rounded-xl font-medium text-sm text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isTestingConnection ? (
                <>
                  <div className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              id="btn-demo-cluster"
              type="button"
              disabled={isLoading || isTestingConnection}
              onClick={() => validateAndProceed(true)}
              className="w-full sm:w-auto py-3 px-4 rounded-xl font-medium text-sm text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileCode2 className="w-4 h-4 text-amber-400" />
              <span>Demo Cluster</span>
            </button>
          </div>
        </form>
      </div>

      {/* Audit Capabilities Grid */}
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-rose-400 mb-1">Part Compaction & Health</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Surveils active parts count per table/partition, flagging unmerged micro-batching and insert throttling risks.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-amber-400 mb-1">ORDER BY & Sparse Indices</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Analyzes sorting keys for empty tuples, low-cardinality flags, and data skipping index coverage.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-emerald-400 mb-1">Query Log Pruning & Memory</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Detects read amplification ratios, peak analytical query latencies, and Materialized View opportunities.
          </p>
        </div>
      </div>

      {/* ClickHouse Read-Only User Setup Modal */}
      <ClickHouseUserSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
      />
    </div>
  );
};
