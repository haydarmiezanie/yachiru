import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/AuthModal';
import { AccessDeniedScreen } from './components/AccessDeniedScreen';
import { UserManagementModal } from './components/UserManagementModal';
import { Navbar } from './components/Navbar';
import { ClusterSelector } from './components/ClusterSelector';
import { HealthOverview } from './components/HealthOverview';
import { FindingsList } from './components/FindingsList';
import { MigrationGenerator } from './components/MigrationGenerator';
import { DeepDiveInspector } from './components/DeepDiveInspector';
import { ScanHistoryView } from './components/ScanHistoryView';
import { CliSimulator } from './components/CliSimulator';
import { DocumentationModal } from './components/DocumentationModal';
import { DimensionId, ScanReport, ScanTarget } from './types/yachiru';
import { RotateCw, AlertCircle, Database, Play, Zap, ArrowRight, Shield } from 'lucide-react';
import { authenticatedFetch } from './lib/api';

function AuditorApp() {
  const { user, profile, loading: authLoading, isAuthorized, isAdmin } = useAuth();
  const [report, setReport] = useState<ScanReport | null>(null);
  const [target, setTarget] = useState<ScanTarget>({
    protocol: 'http',
    host: 'apex.clickhouse.internal',
    port: 8123,
    database: 'ecommerce_analytics',
    user: 'default',
    password: '',
    isDemoCluster: true,
    demoClusterId: 'apex_ecommerce',
    lookbackDays: 7,
  });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>('gemini');
  const [aiModel, setAiModel] = useState('gemini-3.7-flash');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiAlert, setAiAlert] = useState<{
    provider: 'gemini' | 'openai';
    model: string;
    message: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedDimension, setSelectedDimension] = useState<DimensionId | 'all'>('all');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsInitialTab, setDocsInitialTab] = useState<'overview' | 'api' | 'docker'>('overview');
  const [userManagementOpen, setUserManagementOpen] = useState(false);

  const handleOpenDocs = (tab: 'overview' | 'api' | 'docker' = 'overview') => {
    setDocsInitialTab(tab);
    setDocsOpen(true);
  };

  // If Auth is loading initial state
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20 animate-pulse">
            <span className="font-mono text-2xl font-black text-slate-950">Y</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <RotateCw className="h-3.5 w-3.5 animate-spin text-amber-500" />
            <span>Verifying security credentials & whitelist...</span>
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated, prompt Login
  if (!user) {
    return <AuthModal />;
  }

  // If authenticated but pending admin approval or revoked
  if (!isAuthorized) {
    return <AccessDeniedScreen />;
  }

  const executeScan = async (currentTarget: ScanTarget = target) => {
    setScanning(true);
    setError(null);
    try {
      const res = await authenticatedFetch('/api/clickhouse/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: currentTarget,
          aiEnabled,
          aiProvider,
          aiModel,
          aiApiKey: aiApiKey ? aiApiKey.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        let message = errData.error || errData.message;
        if (!message) {
          if (res.status === 502) {
            message = 'Gateway connection timeout or server restarting (502). Please retry your scan in a moment.';
          } else if (res.status === 503) {
            message = 'Service temporarily unavailable (503). Please try again shortly.';
          } else {
            message = `Scan failed with status ${res.status}`;
          }
        }
        throw new Error(message);
      }

      const data: ScanReport = await res.json();
      setReport(data);

      // Check if AI was requested but returned in fallback mode due to API key / provider error
      if (aiEnabled && data.aiStatus === 'fallback') {
        setAiAlert({
          provider: aiProvider,
          model: aiModel,
          message: data.aiErrorMessage || `API key could not be used with ${aiProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'} model "${aiModel}". Running in deterministic rule-based mode.`,
        });
      } else {
        setAiAlert(null);
      }
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to complete cluster scan');
    } finally {
      setScanning(false);
    }
  };

  const handleSelectDimension = (dim: DimensionId) => {
    setSelectedDimension(dim);
    setActiveTab('findings');
  };

  const handleLoadPastScan = async (scanId: string) => {
    setScanning(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/history/${scanId}`);
      if (!res.ok) throw new Error('Could not fetch scan report');
      const data: ScanReport = await res.json();
      setReport(data);
      setActiveTab('overview');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const switchToDemoAndScan = (demoId: string = 'apex_ecommerce') => {
    const demoTarget: ScanTarget = {
      protocol: 'http',
      host: `${demoId}.clickhouse.internal`,
      port: 8123,
      database: demoId === 'apex_ecommerce' ? 'ecommerce_analytics' : demoId === 'nexus_iot' ? 'iot_telemetry' : 'default',
      user: 'default',
      password: '',
      isDemoCluster: true,
      demoClusterId: demoId,
      lookbackDays: 7,
    };
    setTarget(demoTarget);
    setError(null);
    executeScan(demoTarget);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-amber-500/30 selection:text-white font-sans antialiased">
      {/* Top Navbar */}
      <Navbar
        report={report}
        scanning={scanning}
        onScan={() => executeScan(target)}
        onOpenDocs={handleOpenDocs}
        onOpenUserManagement={() => setUserManagementOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        {/* Cluster / Target Selector Box */}
        <ClusterSelector
          target={target}
          setTarget={setTarget}
          aiEnabled={aiEnabled}
          setAiEnabled={setAiEnabled}
          aiProvider={aiProvider}
          setAiProvider={setAiProvider}
          aiModel={aiModel}
          setAiModel={setAiModel}
          aiApiKey={aiApiKey}
          setAiApiKey={setAiApiKey}
          onScan={() => executeScan(target)}
          scanning={scanning}
        />

        {/* Global Error Banner with Instant Recovery Action */}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-200 shadow-lg">
            <div className="flex items-start gap-2.5 max-w-3xl">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-medium text-rose-200 block">{error}</span>
                {!target.isDemoCluster && (
                  <span className="text-[11px] text-rose-300/80 block">
                    Tip: If you do not have a live ClickHouse instance running locally, you can switch to an interactive Demo Cluster to explore all 9 optimization dimensions and AI recommendations.
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!target.isDemoCluster && (
                <button
                  onClick={() => switchToDemoAndScan('apex_ecommerce')}
                  className="rounded-lg px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all flex items-center gap-1 cursor-pointer shadow-sm"
                >
                  <Zap className="h-3.5 w-3.5 fill-slate-950" />
                  <span>Switch to Demo Cluster</span>
                </button>
              )}
              <button
                onClick={() => setError(null)}
                className="rounded-lg px-2.5 py-1.5 bg-rose-900/70 hover:bg-rose-800 text-white font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* AI Synthesis Notification Banner (when API key is inactive/invalid or quota exceeded) */}
        {aiAlert && (
          <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/60 via-slate-900/80 to-amber-950/40 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200 shadow-lg animate-fade-in">
            <div className="flex items-start gap-3 max-w-3xl">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 mt-0.5">
                <AlertCircle className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-amber-300 uppercase tracking-wider text-[11px]">
                    AI Provider Notification ({aiAlert.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'})
                  </span>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                    Model: {aiAlert.model}
                  </span>
                </div>
                <p className="text-amber-100/90 leading-relaxed text-xs">
                  {aiAlert.message}
                </p>
                <p className="text-[11px] text-amber-300/75">
                  The health scan completed using 100% deterministic ClickHouse rules. You can provide a custom API key in the top bar or test another model to enable AI architectural synthesis.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setAiAlert(null)}
                className="rounded-lg px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold cursor-pointer transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {scanning && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <RotateCw className="h-10 w-10 animate-spin text-amber-500" />
            <div className="text-center">
              <h3 className="font-bold text-base text-white">Running 9-Dimension Health Scan</h3>
              <p className="text-xs text-slate-400 mt-1">
                Auditing system.tables, system.parts, system.query_log, system.columns, and system.settings...
              </p>
            </div>
          </div>
        )}

        {/* Unscanned Default State (Score 0 / Ready to Execute) */}
        {!report && !scanning && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 sm:p-12 text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-lg shadow-amber-500/5">
              <Database className="h-8 w-8" />
            </div>

            <div className="max-w-xl mx-auto space-y-2">
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Health Score</span>
                <span className="rounded-lg px-2.5 py-0.5 text-xs font-mono font-bold border border-slate-700 bg-slate-800 text-slate-400">
                  Ready to Audit
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">ClickHouse 9-Dimension Architecture & Performance Auditor</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Run deterministic deep analysis on primary keys, part fragmentation, sorting keys, codecs, query logs, TTL, and materialized views with automated DDL migration scripts and AI architectural synthesis.
              </p>
            </div>

            <div className="pt-2 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => executeScan(target)}
                disabled={scanning}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-orange-400 active:scale-95 transition-all cursor-pointer"
              >
                <Play className="h-4 w-4 fill-slate-950" />
                <span>
                  {target.isDemoCluster ? 'Execute Demo Cluster Scan' : 'Execute Database Scan'}
                </span>
              </button>
            </div>

            {/* Quick Demo Presets */}
            <div className="pt-4 max-w-2xl mx-auto">
              <div className="text-xs text-slate-400 mb-2 font-medium">Or run an instant audit on a sample workload:</div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {[
                  { id: 'apex_ecommerce', name: 'Apex E-commerce (142M rows)' },
                  { id: 'nexus_iot', name: 'Nexus IoT Fleet (480M rows)' },
                  { id: 'finpulse_ledger', name: 'FinPulse Ledger (65M rows)' },
                  { id: 'cloudtrace_logs', name: 'CloudTrace Logs (310M rows)' },
                ].map((demo) => (
                  <button
                    key={demo.id}
                    onClick={() => switchToDemoAndScan(demo.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950/80 hover:border-amber-500/40 hover:bg-slate-900 text-xs font-mono text-slate-300 transition-colors cursor-pointer"
                  >
                    <Zap className="h-3 w-3 text-amber-400" />
                    <span>{demo.name}</span>
                    <ArrowRight className="h-3 w-3 text-slate-500" />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-6 border-t border-slate-800/80 text-left text-xs text-slate-400">
              <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                <span className="font-semibold text-slate-200 block mb-1">1. Read-Only Queries</span>
                <span>Scans <code className="text-amber-400 font-mono text-[10px]">system.*</code> tables only. Zero DML or table write footprint.</span>
              </div>
              <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                <span className="font-semibold text-slate-200 block mb-1">2. 9 Dimensions Evaluated</span>
                <span>Primary keys, part count, codecs, settings, query logs, mutations, and TTL.</span>
              </div>
              <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                <span className="font-semibold text-slate-200 block mb-1">3. Automated Fixes</span>
                <span>Produces executable SQL DDL, optimal partition keys, and AI synthesis.</span>
              </div>
            </div>
          </div>
        )}

        {/* Loaded Report Content Tabs */}
        {report && !scanning && (
          <div>
            {activeTab === 'overview' && (
              <HealthOverview report={report} onSelectDimension={handleSelectDimension} />
            )}

            {activeTab === 'findings' && (
              <FindingsList
                findings={report.findings}
                selectedDimension={selectedDimension}
                onSelectDimension={setSelectedDimension}
              />
            )}

            {activeTab === 'migration' && <MigrationGenerator report={report} />}

            {activeTab === 'deepdive' && <DeepDiveInspector report={report} />}

            {activeTab === 'history' && (
              <ScanHistoryView currentReportId={report.id} onLoadScan={handleLoadPastScan} />
            )}

            {activeTab === 'cli' && (
              <CliSimulator report={report} onScanTarget={() => executeScan({ ...target })} />
            )}
          </div>
        )}
      </main>

      {/* Docs & Setup Grants Modal */}
      <DocumentationModal
        isOpen={docsOpen}
        onClose={() => setDocsOpen(false)}
        initialTab={docsInitialTab}
      />

      {/* Admin User Management Modal */}
      {isAdmin && (
        <UserManagementModal
          isOpen={userManagementOpen}
          onClose={() => setUserManagementOpen(false)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuditorApp />
    </AuthProvider>
  );
}

export default App;
