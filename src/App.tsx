import React, { useState } from 'react';
import { Navbar } from './components/Navbar.js';
import { ClusterSelector } from './components/ClusterSelector.js';
import { HealthOverview } from './components/HealthOverview.js';
import { FindingsList } from './components/FindingsList.js';
import { MigrationGenerator } from './components/MigrationGenerator.js';
import { DeepDiveInspector } from './components/DeepDiveInspector.js';
import { ScanHistoryView } from './components/ScanHistoryView.js';
import { CliSimulator } from './components/CliSimulator.js';
import { DocumentationModal } from './components/DocumentationModal.js';
import { DimensionId, ScanReport, ScanTarget } from './types/yachiru.js';
import { RotateCw, AlertCircle, Database, Play, Activity } from 'lucide-react';

export function App() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [target, setTarget] = useState<ScanTarget>({
    protocol: 'http',
    host: 'localhost',
    port: 8123,
    database: 'default',
    user: 'default',
    password: '',
    isDemoCluster: false,
    lookbackDays: 7,
  });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>('gemini');
  const [aiModel, setAiModel] = useState('gemini-3.1-pro-preview');
  const [aiApiKey, setAiApiKey] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedDimension, setSelectedDimension] = useState<DimensionId | 'all'>('all');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

  const executeScan = async (currentTarget: ScanTarget = target) => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/clickhouse/scan', {
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
        const errData = await res.json();
        throw new Error(errData.error || 'Scan execution failed');
      }

      const data: ScanReport = await res.json();
      setReport(data);
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
      const res = await fetch(`/api/history/${scanId}`);
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-amber-500/30 selection:text-white font-sans antialiased">
      {/* Top Navbar */}
      <Navbar
        report={report}
        scanning={scanning}
        onScan={() => executeScan(target)}
        onOpenDocs={() => setDocsOpen(true)}
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

        {/* Global Error Banner */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 flex items-center justify-between gap-3 text-xs text-rose-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="rounded px-2 py-1 bg-rose-900/60 hover:bg-rose-800 text-white font-medium cursor-pointer"
            >
              Dismiss
            </button>
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

            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Health Score</span>
                <span className="rounded-lg px-2.5 py-0.5 text-xs font-mono font-bold border border-slate-700 bg-slate-800 text-slate-400">
                  Default (0/100)
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">Ready to Audit ClickHouse Database</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Connect your live ClickHouse instance above and click <span className="text-amber-400 font-semibold">Execute Database Scan</span> to analyze system tables, table engines, codecs, query logs, and part fragmentation.
              </p>
            </div>

            <div className="pt-2 flex justify-center">
              <button
                onClick={() => executeScan(target)}
                disabled={scanning}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-orange-400 active:scale-95 transition-all cursor-pointer"
              >
                <Play className="h-4 w-4 fill-slate-950" />
                <span>Execute Database Scan (Score Target)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-4 border-t border-slate-800/80 text-left text-xs text-slate-400">
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
              <CliSimulator report={report} onScanTarget={(noAi) => executeScan({ ...target })} />
            )}
          </div>
        )}
      </main>

      {/* Docs & Setup Grants Modal */}
      <DocumentationModal isOpen={docsOpen} onClose={() => setDocsOpen(false)} />
    </div>
  );
}

export default App;
