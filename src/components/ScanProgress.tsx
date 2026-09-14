import React, { useEffect, useState, useMemo } from 'react';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { AVAILABLE_AI_MODELS } from '../types.js';

interface ScanProgressProps {
  isDemo?: boolean;
  enableAiNarrative?: boolean;
  geminiModel?: string;
}

const BASE_CLICKHOUSE_STEPS = [
  { id: 'connect', title: 'Connecting to ClickHouse via official @clickhouse/client', systemTable: 'system.build_options' },
  { id: 'parts', title: 'Inspecting active parts & compaction health', systemTable: 'system.parts' },
  { id: 'sorting', title: 'Validating primary key and ORDER BY effectiveness', systemTable: 'system.tables' },
  { id: 'partitioning', title: 'Analyzing partition cardinality & volume distribution', systemTable: 'system.parts' },
  { id: 'codecs', title: 'Computing column-level compression ratios & codecs', systemTable: 'system.columns' },
  { id: 'engines', title: 'Evaluating MergeTree-family table engine sanity', systemTable: 'system.tables' },
  { id: 'skip_indices', title: 'Checking secondary data skipping indices (bloom/minmax)', systemTable: 'system.data_skipping_indices' },
  { id: 'query_log', title: 'Scanning query_log for read amplification & slow queries', systemTable: 'system.query_log' },
  { id: 'replicas', title: 'Auditing replication delays & distribution queues', systemTable: 'system.replicas' },
  { id: 'settings', title: 'Verifying server memory and merge settings sanity', systemTable: 'system.settings' },
];

export const ScanProgress: React.FC<ScanProgressProps> = ({
  isDemo,
  enableAiNarrative = false,
  geminiModel = 'gemini-3.8-flash',
}) => {
  const steps = useMemo(() => {
    const list = [...BASE_CLICKHOUSE_STEPS];
    if (enableAiNarrative) {
      const modelObj = AVAILABLE_AI_MODELS.find((m) => m.id === geminiModel);
      const modelLabel = modelObj ? modelObj.name : geminiModel;
      list.push({
        id: 'narrative',
        title: 'Synthesizing plain-language executive narrative',
        systemTable: modelLabel,
      });
    } else {
      list.push({
        id: 'synthesis',
        title: 'Compiling deterministic optimization report',
        systemTable: 'Deterministic Engine',
      });
    }
    return list;
  }, [enableAiNarrative, geminiModel]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    setCurrentStepIndex(0);
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 380);

    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 shadow-2xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4">
            <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
          </div>
          <h3 className="text-xl font-bold text-white mb-1">
            {isDemo ? 'Running Diagnostics on Production Demo Cluster...' : 'Executing Read-Only ClickHouse Inspection...'}
          </h3>
          <p className="text-xs text-zinc-400">
            {enableAiNarrative
              ? 'Issuing deterministic SELECT queries and synthesizing executive narrative via configured model'
              : 'Issuing deterministic read-only SELECT queries (pure local analysis without external AI calls)'}
          </p>
        </div>

        {/* Live Step Tracker */}
        <div className="space-y-3">
          {steps.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;

            return (
              <div
                key={step.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  isCurrent
                    ? 'bg-rose-950/20 border-rose-500/40 text-white'
                    : isCompleted
                    ? 'bg-zinc-950/40 border-zinc-800/80 text-zinc-300'
                    : 'opacity-40 bg-zinc-950/20 border-zinc-900 text-zinc-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 text-rose-400 animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-zinc-700 shrink-0" />
                  )}
                  <span className="text-xs font-medium">{step.title}</span>
                </div>

                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                  {step.systemTable}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center text-[11px] text-zinc-500 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Strict zero mutating statements policy enforced</span>
        </div>
      </div>
    </div>
  );
};
