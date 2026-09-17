/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AnalysisReport, CheckCategory, ConnectionConfig, AiProvider } from './types.js';
import { Header } from './components/Header.js';
import { ConnectionForm } from './components/ConnectionForm.js';
import { ScanProgress } from './components/ScanProgress.js';
import { ScoreOverview } from './components/ScoreOverview.js';
import { CategoryGrid } from './components/CategoryGrid.js';
import { AinarrativeCard } from './components/AinarrativeCard.js';
import { FindingsList } from './components/FindingsList.js';
import { TableDrilldown } from './components/TableDrilldown.js';
import { ThresholdsModal } from './components/ThresholdsModal.js';
import { ExportModal } from './components/ExportModal.js';
import { AlertCircle, FileSearch, LayoutGrid, Table } from 'lucide-react';

export default function App() {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [currentScanConfig, setCurrentScanConfig] = useState<ConnectionConfig | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CheckCategory | 'all'>('all');
  const [activeViewTab, setActiveViewTab] = useState<'findings' | 'tables'>('findings');
  const [isThresholdsOpen, setIsThresholdsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLoadingNarrative, setIsLoadingNarrative] = useState(false);
  const [apiKeyRequired, setApiKeyRequired] = useState(false);

  // Check server health and whether API key authentication is required
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.apiKeyRequired === 'boolean') {
          setApiKeyRequired(data.apiKeyRequired);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch server health status:', err);
      });
  }, []);

  const getAuthHeaders = (configKey?: string): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = configKey || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('yachiru_server_api_key') : null);
    if (apiKeyRequired && key && key.trim()) {
      headers['Authorization'] = `Bearer ${key.trim()}`;
    }
    return headers;
  };

  const handleConnect = async (config: ConnectionConfig) => {
    setIsLoading(true);
    setError(null);
    setIsDemo(Boolean(config.isDemo));
    setCurrentScanConfig(config);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: getAuthHeaders(config.yachiruApiKey),
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error || `Server responded with status ${response.status}`);
        (err as unknown as { hint?: string }).hint = errorData.hint;
        throw err;
      }

      const reportData: AnalysisReport = await response.json();
      setReport(reportData);
      setSelectedCategory('all');
      setActiveViewTab('findings');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to ClickHouse cluster';
      const hint =
        (err as unknown as { hint?: string })?.hint ||
        'Please verify that the host is accessible from this environment, the port (8123 HTTP or 8443 HTTPS) matches your protocol, and credentials have SELECT permissions on system.* tables.';
      setError({
        message: msg,
        hint,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateNarrative = async (
    model: string,
    apiKey?: string,
    enableAiNarrative: boolean = true,
    provider?: AiProvider
  ) => {
    if (!report) return;
    setIsLoadingNarrative(true);
    try {
      const targetProvider = provider || (
        model.startsWith('gpt-') ? 'openai' :
        model.startsWith('claude-') ? 'claude' : 'gemini'
      );
      const response = await fetch('/api/narrate', {
        method: 'POST',
        headers: getAuthHeaders(currentScanConfig?.yachiruApiKey),
        body: JSON.stringify({
          report,
          provider: targetProvider,
          model,
          geminiApiKey: targetProvider === 'gemini' ? apiKey : undefined,
          openaiApiKey: targetProvider === 'openai' ? apiKey : undefined,
          claudeApiKey: targetProvider === 'claude' ? apiKey : undefined,
          enableAiNarrative,
          allowSystemKeyFallback: enableAiNarrative,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to synthesize AI narrative');
      }

      const narrative = await response.json();

      let updatedFindings = report.findings;
      if (narrative.isAiGenerated && narrative.ai_diagnoses && narrative.ai_diagnoses.length > 0) {
        const deterministicFindings = report.findings.filter((f) => !f.is_ai_diagnosed);
        const aiFindings = narrative.ai_diagnoses.map((diag: any, idx: number) => ({
          id: `ai_${diag.category || 'finding'}_${idx}_${diag.id ? String(diag.id).replace(/[^a-zA-Z0-9_]/g, '_') : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9))}`,
          category: diag.category,
          category_name: diag.category_name || (diag.category ? diag.category.replace(/_/g, ' ').toUpperCase() : 'AI ARCHITECTURAL FINDING'),
          title: diag.title,
          table: diag.table,
          status: diag.status,
          metric_value: 'AI Architectural Assessment',
          threshold: 'Best Practice Standard',
          evidence: diag.deep_assessment,
          impact: diag.risk_vector,
          recommendation_sql_or_text: diag.remediation_sql || (diag.remediation_plan ? diag.remediation_plan.join('\n') : ''),
          is_sql_recommendation: Boolean(diag.remediation_sql && diag.remediation_sql.trim().length > 0),
          is_ai_diagnosed: true,
          ai_root_cause: diag.root_cause,
          ai_remediation_steps: diag.remediation_plan,
          ai_risk_vector: diag.risk_vector,
        }));
        updatedFindings = [...aiFindings, ...deterministicFindings];
      } else if (!enableAiNarrative) {
        updatedFindings = report.findings.filter((f) => !f.is_ai_diagnosed);
      }

      setReport({
        ...report,
        ai_narrative: narrative,
        ai_diagnoses: narrative.ai_diagnoses || [],
        findings: updatedFindings,
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'AI Narrative synthesis failed.');
    } finally {
      setIsLoadingNarrative(false);
    }
  };

  const handleNewScan = () => {
    setReport(null);
    setError(null);
    setSelectedCategory('all');
  };

  // Distinct table names in findings or table metadata
  const tableNames = React.useMemo(() => {
    if (!report) return [];
    return report.tables.map((t) => t.name);
  }, [report]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-rose-500/30 selection:text-rose-200">
      <Header
        hasReport={Boolean(report)}
        onNewScan={handleNewScan}
        onOpenThresholds={() => setIsThresholdsOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        isDemo={report?.is_demo}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Error Alert Box */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 flex flex-col sm:flex-row items-start justify-between gap-4 shadow-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="font-bold text-rose-300 block text-sm">Analysis Connection Failed</strong>
                <p className="font-mono text-zinc-300 text-xs leading-relaxed">{error.message}</p>
                {error.hint && <p className="text-zinc-400 text-xs leading-relaxed">{error.hint}</p>}
              </div>
            </div>
            <button
              onClick={() =>
                handleConnect({
                  host: 'demo.internal',
                  port: 8443,
                  protocol: 'https',
                  username: 'default',
                  password: '',
                  database: 'production',
                  enableAiNarrative: false,
                  isDemo: true,
                })
              }
              className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-semibold text-xs transition cursor-pointer whitespace-nowrap shrink-0 self-start"
            >
              Run Realistic Simulation Audit
            </button>
          </div>
        )}

        {/* State 1: Scanning In Progress */}
        {isLoading && (
          <ScanProgress
            isDemo={isDemo}
            enableAiNarrative={currentScanConfig?.enableAiNarrative}
            geminiModel={currentScanConfig?.geminiModel}
          />
        )}

        {/* State 2: Connect Form (No report active and not loading) */}
        {!isLoading && !report && (
          <ConnectionForm
            onConnect={handleConnect}
            isLoading={isLoading}
            apiKeyRequired={apiKeyRequired}
          />
        )}

        {/* State 3: Active Optimization Report Dashboard */}
        {!isLoading && report && (
          <div className="space-y-6">
            {/* Top Score & Cluster Overview */}
            <ScoreOverview report={report} />

            {/* Optional AI Narrative Card */}
            <AinarrativeCard
              narrative={report.ai_narrative}
              report={report}
              onGenerateNarrative={handleGenerateNarrative}
              isLoadingNarrative={isLoadingNarrative}
            />

            {/* 9 Category Scorecards Grid */}
            <CategoryGrid
              categories={report.categories}
              selectedCategory={selectedCategory}
              onSelectCategory={(cat) => setSelectedCategory(cat)}
            />

            {/* Tab Switcher: Findings by Category vs Table Diagnostics */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <button
                  id="tab-findings"
                  onClick={() => setActiveViewTab('findings')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                    activeViewTab === 'findings'
                      ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileSearch className="w-4 h-4 text-rose-400" />
                  <span>Findings Explorer ({report.findings.length})</span>
                </button>

                <button
                  id="tab-tables"
                  onClick={() => setActiveViewTab('tables')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                    activeViewTab === 'tables'
                      ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Table className="w-4 h-4 text-amber-400" />
                  <span>Per-Table Diagnostics ({report.tables.length})</span>
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500 font-mono">
                <span>Database:</span>
                <span className="text-zinc-300 font-bold">{report.database_name}</span>
              </div>
            </div>

            {/* Tab 1: Findings Explorer */}
            {activeViewTab === 'findings' && (
              <FindingsList
                findings={report.findings}
                selectedCategory={selectedCategory}
                onCategoryChange={(cat) => setSelectedCategory(cat)}
                tables={tableNames}
                scanId={report.scan_id}
                isAiGenerated={Boolean(report.ai_narrative?.isAiGenerated)}
                narrativeIdentity={`${report.scan_id}_${report.ai_narrative?.isAiGenerated ? 'ai' : 'noai'}_${report.ai_narrative?.model || ''}_${report.ai_narrative?.executive_summary?.slice(0, 40) || ''}`}
              />
            )}

            {/* Tab 2: Per-Table Diagnostics */}
            {activeViewTab === 'tables' && (
              <TableDrilldown tables={report.tables} findings={report.findings} />
            )}
          </div>
        )}
      </main>

      {/* Thresholds & Mechanics Modal */}
      <ThresholdsModal
        isOpen={isThresholdsOpen}
        onClose={() => setIsThresholdsOpen(false)}
      />

      {/* Export Modal */}
      {report && (
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          report={report}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-zinc-900 mt-16 py-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-400">Yachiru</span>
            <span>•</span>
            <span>ClickHouse Database Optimization Analyzer</span>
          </div>

          <div className="text-[11px] text-zinc-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>Read-Only SQL Safety Enforced</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
