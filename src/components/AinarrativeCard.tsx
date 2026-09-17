import React, { useState, useEffect } from 'react';
import { AINarrative, AnalysisReport, AVAILABLE_AI_MODELS, AiProvider } from '../types.js';
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
  Bot,
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
  onGenerateNarrative: (
    model: string,
    apiKey?: string,
    enableAiNarrative?: boolean,
    provider?: AiProvider
  ) => Promise<void>;
  isLoadingNarrative: boolean;
}

export const AinarrativeCard: React.FC<AinarrativeCardProps> = ({
  narrative,
  report,
  onGenerateNarrative,
  isLoadingNarrative,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  // Detect initial provider from narrative or default to gemini
  const initialProvider: AiProvider =
    narrative?.model?.startsWith('gpt-') ? 'openai' :
    narrative?.model?.startsWith('claude-') ? 'claude' : 'gemini';
  const [aiProvider, setAiProvider] = useState<AiProvider>(initialProvider);

  const [geminiModel, setGeminiModel] = useState('gemini-3.8-flash');
  const [openaiModel, setOpenaiModel] = useState('gpt-5.4-mini');
  const [claudeModel, setClaudeModel] = useState('claude-haiku-4-5-20251001');

  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_gemini_api_key') || '';
  });
  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_openai_api_key') || '';
  });
  const [claudeApiKey, setClaudeApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_claude_api_key') || '';
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [showKeyInputForm, setShowKeyInputForm] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [copiedSqlId, setCopiedSqlId] = useState<string | null>(null);

  // Sync session storage
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

  useEffect(() => {
    if (claudeApiKey) {
      sessionStorage.setItem('yachiru_claude_api_key', claudeApiKey);
    }
  }, [claudeApiKey]);

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

  const handleProviderToggle = (newProvider: AiProvider) => {
    setAiProvider(newProvider);
    setApiKeyError(null);
  };

  const currentModel =
    aiProvider === 'openai' ? openaiModel :
    aiProvider === 'claude' ? claudeModel : geminiModel;
  const currentApiKey =
    aiProvider === 'openai' ? openaiApiKey :
    aiProvider === 'claude' ? claudeApiKey : geminiApiKey;

  const handleGenerateWithAi = () => {
    if (!currentApiKey.trim()) {
      const providerLabel =
        aiProvider === 'openai' ? 'OpenAI' :
        aiProvider === 'claude' ? 'Anthropic Claude' : 'Google Gemini';
      setApiKeyError(
        `A ${providerLabel} API Key is required for live AI synthesis. Please enter your API key below or select "Generate Without AI (Deterministic)".`
      );
      setShowKeyInputForm(true);
      return;
    }

    setApiKeyError(null);
    onGenerateNarrative(currentModel, currentApiKey.trim(), true, aiProvider);
  };

  const handleGenerateWithoutAi = () => {
    setApiKeyError(null);
    onGenerateNarrative(currentModel, undefined, false, aiProvider);
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
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-rose-400" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Executive Architectural Narrative</span>
                {isAiErrorState && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    AI Service Notice
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-300 leading-relaxed max-w-2xl">
                {narrative?.aiError ? (
                  <span className="text-amber-200/90">{narrative.aiError}</span>
                ) : (
                  'Generate an executive summary, workload risk evaluation, and concrete remediation steps powered by Google Gemini, OpenAI, or Claude.'
                )}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={() => setShowKeyInputForm(!showKeyInputForm)}
              className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Configure AI</span>
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

        {/* API Key & Provider Input Form for Narrative */}
        {(showKeyInputForm || apiKeyError) && (
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 animate-in fade-in">
            {apiKeyError && (
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{apiKeyError}</span>
              </div>
            )}

            {/* Provider Toggle */}
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">AI Provider</label>
              <div className="grid grid-cols-3 gap-2 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800 max-w-md">
                <button
                  type="button"
                  onClick={() => handleProviderToggle('gemini')}
                  className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    aiProvider === 'gemini'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Gemini</span>
                </button>

                <button
                  type="button"
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

                <button
                  type="button"
                  onClick={() => handleProviderToggle('claude')}
                  className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    aiProvider === 'claude'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Claude</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-8">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                    <span>{aiProvider === 'openai' ? 'OpenAI API Key' : aiProvider === 'claude' ? 'Anthropic Claude API Key' : 'Google Gemini API Key'}</span>
                  </label>
                  <a
                    href={
                      aiProvider === 'openai'
                        ? 'https://platform.openai.com/api-keys'
                        : aiProvider === 'claude'
                        ? 'https://console.anthropic.com/settings/keys'
                        : 'https://aistudio.google.com/app/apikey'
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 underline"
                  >
                    <span>{aiProvider === 'openai' ? 'Get OpenAI Key' : aiProvider === 'claude' ? 'Get Anthropic Key' : 'Get Free Key at AI Studio'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={aiProvider === 'openai' ? openaiApiKey : aiProvider === 'claude' ? claudeApiKey : geminiApiKey}
                    onChange={(e) => {
                      if (aiProvider === 'openai') {
                        setOpenaiApiKey(e.target.value);
                      } else if (aiProvider === 'claude') {
                        setClaudeApiKey(e.target.value);
                      } else {
                        setGeminiApiKey(e.target.value);
                      }
                      if (apiKeyError) setApiKeyError(null);
                    }}
                    placeholder={
                      aiProvider === 'openai'
                        ? 'Enter your OpenAI API Key (sk-...)'
                        : aiProvider === 'claude'
                        ? 'Enter your Anthropic Claude API Key (sk-ant-...)'
                        : 'Enter your Gemini API Key (AIzaSy...)'
                    }
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
                  value={currentModel}
                  onChange={(e) => {
                    if (aiProvider === 'openai') {
                      setOpenaiModel(e.target.value);
                    } else if (aiProvider === 'claude') {
                      setClaudeModel(e.target.value);
                    } else {
                      setGeminiModel(e.target.value);
                    }
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
                >
                  {AVAILABLE_AI_MODELS.filter((m) => m.provider === aiProvider).map((m) => (
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
                <span>Run with {aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'claude' ? 'Claude' : 'Gemini'}</span>
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
                ? `Synthesized via ${
                    narrative.model.startsWith('gpt-') ? 'OpenAI' :
                    narrative.model.startsWith('claude-') ? 'Anthropic Claude' : 'Google Gemini'
                  } AI using live diagnostic metrics`
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
              <span>Switch to AI</span>
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
            title="Change API Key, Provider, or Model"
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

          {/* Provider Selection */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">AI Provider</label>
            <div className="grid grid-cols-3 gap-2 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800 max-w-md">
              <button
                type="button"
                onClick={() => handleProviderToggle('gemini')}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  aiProvider === 'gemini'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Gemini</span>
              </button>

              <button
                type="button"
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

              <button
                type="button"
                onClick={() => handleProviderToggle('claude')}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  aiProvider === 'claude'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Claude</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                  <span>{aiProvider === 'openai' ? 'OpenAI API Key' : aiProvider === 'claude' ? 'Anthropic Claude API Key' : 'Google Gemini API Key'}</span>
                </label>
                <a
                  href={
                    aiProvider === 'openai'
                      ? 'https://platform.openai.com/api-keys'
                      : aiProvider === 'claude'
                      ? 'https://console.anthropic.com/settings/keys'
                      : 'https://aistudio.google.com/app/apikey'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-rose-400 hover:text-rose-300 underline flex items-center gap-1"
                >
                  <span>{aiProvider === 'openai' ? 'Get OpenAI Key' : aiProvider === 'claude' ? 'Get Anthropic Key' : 'Get Key at AI Studio'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={aiProvider === 'openai' ? openaiApiKey : aiProvider === 'claude' ? claudeApiKey : geminiApiKey}
                  onChange={(e) => {
                    if (aiProvider === 'openai') {
                      setOpenaiApiKey(e.target.value);
                    } else if (aiProvider === 'claude') {
                      setClaudeApiKey(e.target.value);
                    } else {
                      setGeminiApiKey(e.target.value);
                    }
                    if (apiKeyError) setApiKeyError(null);
                  }}
                  placeholder={
                    aiProvider === 'openai'
                      ? 'Enter your OpenAI API Key (sk-...)'
                      : aiProvider === 'claude'
                      ? 'Enter your Anthropic Claude API Key (sk-ant-...)'
                      : 'Enter your Gemini API Key (AIzaSy...)'
                  }
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
                value={currentModel}
                onChange={(e) => {
                  if (aiProvider === 'openai') {
                    setOpenaiModel(e.target.value);
                  } else if (aiProvider === 'claude') {
                    setClaudeModel(e.target.value);
                  } else {
                    setGeminiModel(e.target.value);
                  }
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
              >
                {AVAILABLE_AI_MODELS.filter((m) => m.provider === aiProvider).map((m) => (
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
              <span>{isLoadingNarrative ? 'Processing...' : `Run with ${aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'claude' ? 'Claude' : 'Gemini'}`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Collapsible Body */}
      {isOpen && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Executive Overview Section */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              1. Architectural State Assessment
            </h4>
            <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-sm text-zinc-200 leading-relaxed whitespace-pre-line font-sans">
              {narrative.executive_summary}
            </div>
          </div>

          {/* Workload Risk Analysis */}
          {narrative.workload_risk_analysis && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-rose-400" />
                <span>2. Sustained Ingestion &amp; Concurrency Stress Profile</span>
              </h4>
              <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
                {narrative.workload_risk_analysis}
              </div>
            </div>
          )}

          {/* Top Priorities List */}
          {narrative.top_priorities && narrative.top_priorities.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <ListOrdered className="w-3.5 h-3.5 text-rose-400" />
                <span>3. Highest-ROI Remediation Sequence</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {narrative.top_priorities.map((p) => (
                  <div
                    key={p.priority}
                    className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-5 h-5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                          {p.priority}
                        </span>
                        <h5 className="text-xs font-bold text-zinc-100">{p.title}</h5>
                      </div>
                      {p.target_table && (
                        <span className="inline-block font-mono text-[10px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 mb-2">
                          Table: {p.target_table}
                        </span>
                      )}
                      <p className="text-[11px] text-zinc-400 leading-normal mb-2">
                        <strong className="text-zinc-300 font-medium">Why: </strong>
                        {p.why}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-zinc-900 text-[11px] font-mono text-emerald-400 bg-emerald-950/20 px-2.5 py-1.5 rounded border border-emerald-900/40">
                      <strong className="font-sans font-medium text-emerald-300 mr-1">Action:</strong>
                      {p.action}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deep AI Diagnoses Accordion with Copyable SQL */}
          {narrative.ai_diagnoses && narrative.ai_diagnoses.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5 text-rose-400" />
                <span>4. Deep Diagnoses &amp; Production Remediation SQL ({narrative.ai_diagnoses.length} Found)</span>
              </h4>

              <div className="space-y-3">
                {narrative.ai_diagnoses.map((diag) => {
                  const sqlString = diag.remediation_sql || '';
                  const hasSql = Boolean(sqlString && sqlString.trim().length > 0);

                  return (
                    <div
                      key={diag.id}
                      className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/90 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold ${
                                diag.status === 'critical'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : diag.status === 'warning'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              }`}
                            >
                              {diag.status}
                            </span>
                            <span className="text-[11px] font-mono text-zinc-400">
                              {diag.category_name || diag.category}
                            </span>
                            {diag.table && (
                              <span className="text-[11px] font-mono text-rose-400 bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-900/40">
                                {diag.table}
                              </span>
                            )}
                          </div>
                          <h5 className="text-sm font-bold text-zinc-100">{diag.title}</h5>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/80">
                          <strong className="block text-zinc-400 text-[11px] font-semibold mb-1 uppercase tracking-wide">
                            Mechanics &amp; Assessment
                          </strong>
                          <p className="text-zinc-300 text-xs leading-relaxed">{diag.deep_assessment}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/80">
                          <strong className="block text-rose-400 text-[11px] font-semibold mb-1 uppercase tracking-wide">
                            Root Cause &amp; Risk Vector
                          </strong>
                          <p className="text-zinc-300 text-xs leading-relaxed mb-1.5">
                            <span className="text-zinc-400">Root Cause: </span>
                            {diag.root_cause}
                          </p>
                          <p className="text-zinc-400 text-xs leading-relaxed">
                            <span className="text-rose-300">Risk: </span>
                            {diag.risk_vector}
                          </p>
                        </div>
                      </div>

                      {/* Remediation Plan steps */}
                      {diag.remediation_plan && diag.remediation_plan.length > 0 && (
                        <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/60">
                          <strong className="block text-zinc-400 text-[11px] font-semibold mb-1.5 uppercase tracking-wide">
                            Remediation Plan
                          </strong>
                          <ol className="list-decimal list-inside space-y-1 text-xs text-zinc-300">
                            {diag.remediation_plan.map((step, sIdx) => (
                              <li key={sIdx} className="leading-relaxed">
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* Remediation SQL */}
                      {hasSql && (
                        <div className="relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-[11px] text-zinc-400 font-mono">
                            <span className="flex items-center gap-1.5">
                              <Code2 className="w-3.5 h-3.5 text-rose-400" />
                              <span>ClickHouse Remediation SQL</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopySql(diag.id, sqlString)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition cursor-pointer"
                            >
                              {copiedSqlId === diag.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 font-sans font-semibold">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span className="font-sans">Copy SQL</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="p-3 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                            {sqlString}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
