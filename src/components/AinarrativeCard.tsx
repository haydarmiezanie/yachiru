import React, { useState, useEffect } from 'react';
import { AINarrative, AnalysisReport, AVAILABLE_GEMINI_MODELS } from '../types.js';
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  ExternalLink,
  Zap,
  RotateCcw,
  Activity,
  Code2,
  Copy,
  Check,
  ListOrdered,
} from 'lucide-react';

interface AinarrativeCardProps {
  narrative?: AINarrative | null;
  report: AnalysisReport;
  onGenerateNarrative: (model: string, apiKey?: string, enableAiNarrative?: boolean) => Promise<void>;
  isLoadingNarrative: boolean;
}

export const AinarrativeCard: React.FC<AinarrativeCardProps> = ({
  narrative,
  report,
  onGenerateNarrative,
  isLoadingNarrative,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [apiKey, setApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_gemini_api_key') || '';
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showKeyInputForm, setShowKeyInputForm] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [copiedSqlId, setCopiedSqlId] = useState<string | null>(null);

  const handleCopySql = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSqlId(id);
    setTimeout(() => setCopiedSqlId(null), 2500);
  };

  useEffect(() => {
    if (narrative?.isAiGenerated) {
      setShowKeyInputForm(false);
      setApiKeyError(null);
    }
  }, [narrative?.isAiGenerated]);

  const handleGenerateWithAi = () => {
    if (!apiKey.trim()) {
      setApiKeyError(
        'A Gemini API Key is required for live AI synthesis. Please enter your API key below or select "Generate Without AI (Deterministic)".'
      );
      setShowKeyInputForm(true);
      return;
    }

    setApiKeyError(null);
    sessionStorage.setItem('yachiru_gemini_api_key', apiKey.trim());
    onGenerateNarrative(selectedModel, apiKey.trim(), true);
  };

  const handleGenerateWithoutAi = () => {
    setApiKeyError(null);
    onGenerateNarrative(selectedModel, undefined, false);
  };

  // Case 1: No narrative yet, or AI synthesis failed (credit exhausted / invalid key) with empty narrative content
  const hasValidNarrativeContent = Boolean(
    narrative && narrative.executive_summary && narrative.executive_summary.trim().length > 0
  );

  if (!narrative || !hasValidNarrativeContent) {
    const isAiErrorState = Boolean(narrative?.aiError);

    return (
      <div
        className={`mb-8 p-6 rounded-2xl border transition-all ${
          isAiErrorState
            ? 'bg-amber-950/20 border-amber-500/40 shadow-lg'
            : 'bg-zinc-900/80 border-zinc-800'
        } space-y-4`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`p-2.5 rounded-xl border shrink-0 ${
                isAiErrorState
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}
            >
              {isAiErrorState ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>
            <div>
              <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <span>
                  {isAiErrorState
                    ? narrative?.aiErrorCategory === 'service_unavailable'
                      ? 'AI Synthesis Notice: Gemini Service High Demand'
                      : narrative?.aiErrorCategory === 'invalid_key'
                      ? 'AI Synthesis Notice: Gemini API Key Required / Invalid'
                      : narrative?.aiErrorCategory === 'model_not_found'
                      ? 'AI Synthesis Notice: Model Unavailable'
                      : 'AI Synthesis Notice: Gemini API Credit / Quota Notice'
                    : 'Executive Narrative & Action Prioritization'}
                </span>
                {isAiErrorState && (
                  <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {narrative?.aiErrorCategory === 'service_unavailable'
                      ? 'HTTP 503 / BUSY'
                      : narrative?.aiErrorCategory === 'invalid_key'
                      ? 'AUTH REQUIRED'
                      : narrative?.aiErrorCategory === 'model_not_found'
                      ? 'HTTP 404'
                      : 'HTTP 429 / LIMIT'}
                  </span>
                )}
              </h4>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
                {isAiErrorState
                  ? narrative?.aiError ||
                    'Google Gemini API rejected the request due to exhausted prepayment credits or rate limits. You can switch to the Deterministic Engine (free & instant) or provide an active API key.'
                  : 'Synthesize audit findings into an executive summary and prioritized remediation action plan. You can use Gemini AI with your API key, or use the built-in deterministic engine without an API key.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              onClick={() => setShowKeyInputForm(!showKeyInputForm)}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition cursor-pointer"
            >
              {showKeyInputForm ? 'Close Config' : 'Configure Gemini API'}
            </button>

            <button
              onClick={handleGenerateWithoutAi}
              disabled={isLoadingNarrative}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                isAiErrorState
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 shadow-sm'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Generate Without AI (Deterministic)</span>
            </button>

            <button
              onClick={handleGenerateWithAi}
              disabled={isLoadingNarrative}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isLoadingNarrative ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Retry with AI</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* API Key Input Form for Narrative */}
        {(showKeyInputForm || apiKeyError) && (
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 animate-in fade-in">
            {apiKeyError && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{apiKeyError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-8">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                    <span>Gemini API Key</span>
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 underline"
                  >
                    <span>Get Free Key at AI Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      if (apiKeyError) setApiKeyError(null);
                    }}
                    placeholder="Enter your Gemini API Key (AIzaSy...)"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-3 pr-10 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="sm:col-span-4">
                <label className="block text-xs font-medium text-zinc-300 mb-1">Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
                >
                  {AVAILABLE_GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.badge ? `(${m.badge})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-900">
              <button
                onClick={handleGenerateWithoutAi}
                disabled={isLoadingNarrative}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1.5"
              >
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Generate Without AI (Deterministic)</span>
              </button>

              <button
                onClick={handleGenerateWithAi}
                disabled={isLoadingNarrative}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3 h-3" />
                <span>Run with AI</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Case 2: We have actual narrative content (either from Live AI or from Deterministic Engine)
  const isDeterministic = !narrative.isAiGenerated;

  return (
    <div className="mb-8 bg-gradient-to-b from-zinc-900/90 to-zinc-900/60 border border-zinc-800/90 rounded-2xl p-6 sm:p-7 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl border ${
              narrative.isAiGenerated
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            }`}
          >
            {narrative.isAiGenerated ? (
              <Sparkles className="w-4 h-4" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 flex-wrap">
              Executive Narrative & Remediation Plan
              <span
                className={`text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  narrative.isAiGenerated
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800/90 text-zinc-300 border-zinc-700'
                }`}
              >
                {narrative.isAiGenerated ? (
                  <>
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                    <span>{narrative.model} (AI Generated)</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>Deterministic Rule Engine (Without AI)</span>
                  </>
                )}
              </span>
            </h3>
            <p className="text-xs text-zinc-400">
              {narrative.isAiGenerated
                ? 'Synthesized via Google Gemini AI using live diagnostic metrics'
                : 'Deterministic evidence synthesis (strictly computed from local ClickHouse metrics without external AI calls)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDeterministic ? (
            <button
              onClick={() => setShowKeyInputForm(true)}
              className="text-xs font-semibold text-rose-300 hover:text-rose-200 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
              <span>Switch to Gemini AI</span>
            </button>
          ) : (
            <button
              onClick={handleGenerateWithoutAi}
              disabled={isLoadingNarrative}
              className="text-xs font-medium text-zinc-300 hover:text-zinc-100 px-3 py-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-800 border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Use Without AI (Free)</span>
            </button>
          )}

          <button
            onClick={() => setShowKeyInputForm(!showKeyInputForm)}
            className="text-xs font-medium text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 transition flex items-center gap-1 cursor-pointer"
            title="Change API Key or Model"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Options</span>
          </button>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
            title={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Inline regenerate settings form */}
      {showKeyInputForm && (
        <div className="mb-5 p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 animate-in fade-in">
          {apiKeyError && (
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{apiKeyError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                  <span>Gemini API Key</span>
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-rose-400 hover:text-rose-300 underline flex items-center gap-1"
                >
                  <span>Get Key at AI Studio</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (apiKeyError) setApiKeyError(null);
                  }}
                  placeholder="Enter your Gemini API Key (AIzaSy...)"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-3 pr-10 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1">Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
              >
                {AVAILABLE_GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.badge ? `(${m.badge})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-900">
            <button
              onClick={handleGenerateWithoutAi}
              disabled={isLoadingNarrative}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Generate Without AI (Deterministic)</span>
            </button>

            <button
              onClick={handleGenerateWithAi}
              disabled={isLoadingNarrative}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition cursor-pointer flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3" />
              <span>{isLoadingNarrative ? 'Processing...' : 'Run with Gemini'}</span>
            </button>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="space-y-6">
          {/* Executive Summary Paragraph */}
          <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs sm:text-sm text-zinc-200 leading-relaxed">
            {narrative.executive_summary}
          </div>

          {/* Top Priorities List */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
              <span>Prioritized Remediation Tasks</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {narrative.top_priorities.map((item) => (
                <div
                  key={item.priority}
                  className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 hover:border-zinc-700/80 transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                        <span className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center text-[11px]">
                          {item.priority}
                        </span>
                        <span>{item.title}</span>
                      </span>

                      {item.target_table && (
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                          {item.target_table}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-zinc-300 mb-2 leading-relaxed">
                      <strong className="text-zinc-400">Why: </strong>
                      {item.why}
                    </p>
                  </div>

                  <div className="mt-2 pt-2 border-t border-zinc-900 text-xs text-emerald-400 flex items-start gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{item.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Deep Cluster Architectural Diagnoses (if present) */}
          {narrative.ai_diagnoses && narrative.ai_diagnoses.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                <span>AI Deep Architectural Diagnoses & Remediation Roadmaps</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono">
                  {narrative.ai_diagnoses.length} Assessment Findings
                </span>
              </h4>

              <div className="space-y-3.5">
                {narrative.ai_diagnoses.map((diag, index) => {
                  const isCrit = diag.status === 'critical';
                  const isWarn = diag.status === 'warning';

                  return (
                    <div
                      key={diag.id || index}
                      className={`p-4 rounded-xl border ${
                        isCrit
                          ? 'border-rose-500/40 bg-rose-950/15'
                          : isWarn
                          ? 'border-amber-500/40 bg-amber-950/15'
                          : 'border-zinc-800 bg-zinc-950/60'
                      } space-y-3`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isCrit
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : isWarn
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            }`}
                          >
                            {diag.status.toUpperCase()}
                          </span>
                          <h5 className="text-xs sm:text-sm font-bold text-white">{diag.title}</h5>
                        </div>

                        {diag.table && (
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                            {diag.table}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-zinc-300 leading-relaxed font-sans">
                        {diag.deep_assessment}
                      </p>

                      {/* Root cause and risk vector */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs">
                        <div>
                          <span className="font-semibold text-rose-300/90 flex items-center gap-1 mb-0.5">
                            <Activity className="w-3 h-3 text-rose-400" />
                            Root Cause
                          </span>
                          <p className="text-zinc-400 leading-relaxed">{diag.root_cause}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-amber-300/90 flex items-center gap-1 mb-0.5">
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            Risk Vector
                          </span>
                          <p className="text-zinc-400 leading-relaxed">{diag.risk_vector}</p>
                        </div>
                      </div>

                      {/* Multi-step Remediation Plan */}
                      {diag.remediation_plan && diag.remediation_plan.length > 0 && (
                        <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-850 text-xs">
                          <span className="font-semibold text-zinc-300 flex items-center gap-1.5 mb-1.5">
                            <ListOrdered className="w-3.5 h-3.5 text-rose-400" />
                            Remediation Roadmap
                          </span>
                          <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                            {diag.remediation_plan.map((step, sIdx) => (
                              <li key={sIdx} className="leading-relaxed">
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* Remediation SQL */}
                      {diag.remediation_sql && (
                        <div className="pt-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                              <Code2 className="w-3 h-3 text-zinc-400" />
                              <span>Remediation SQL:</span>
                            </span>
                            <button
                              onClick={() => handleCopySql(diag.id, diag.remediation_sql!)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs transition cursor-pointer"
                            >
                              {copiedSqlId === diag.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 text-[11px]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-zinc-400" />
                                  <span className="text-[11px]">Copy SQL</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-rose-300/90 overflow-x-auto whitespace-pre-wrap">
                            <code>{diag.remediation_sql}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Workload Risk Analysis */}
          <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/60 flex items-start gap-3 text-xs text-zinc-300">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300 block mb-0.5">Workload & High-Concurrency Risk</span>
              <p className="text-zinc-400 leading-relaxed">{narrative.workload_risk_analysis}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

