import React, { useState } from 'react';
import { AnalysisReport } from '../types.js';
import { generateMarkdownReport } from '../utils/markdownExporter.js';
import { X, Download, Copy, Check, FileJson, FileText } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: AnalysisReport;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, report }) => {
  const [activeTab, setActiveTab] = useState<'markdown' | 'json'>('markdown');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const markdownContent = generateMarkdownReport(report);
  const jsonContent = JSON.stringify(report, null, 2);
  const currentContent = activeTab === 'markdown' ? markdownContent : jsonContent;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = `yachiru-clickhouse-audit-${report.database_name}-${Date.now()}.${
      activeTab === 'markdown' ? 'md' : 'json'
    }`;
    const blob = new Blob([currentContent], {
      type: activeTab === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Export Audit Report</h3>
              <p className="text-xs text-zinc-400">
                Download formatted technical audit for engineers or JSON data for CI/CD integration
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector & Actions Bar */}
        <div className="px-6 py-3 bg-zinc-950/60 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('markdown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'markdown'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Readable Markdown Summary (.md)</span>
            </button>

            <button
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'json'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Full Structured Data (.json)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        {/* Content Preview */}
        <div className="p-6 overflow-y-auto font-mono text-xs text-zinc-300 bg-zinc-950">
          <pre className="whitespace-pre-wrap select-all leading-relaxed">
            {currentContent}
          </pre>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end bg-zinc-900">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
