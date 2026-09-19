import React, { useState } from 'react';
import { AnalysisReport } from '../types.js';
import {
  X,
  Copy,
  Check,
  Mail,
  Linkedin,
  Bug,
  Lightbulb,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  DEVELOPER_EMAIL,
  DEVELOPER_LINKEDIN,
  generateFeedbackReport,
  buildMailtoUrl,
  MAILTO_BODY_LIMIT,
} from '../utils/feedback.js';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  report?: AnalysisReport | null;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  report,
}) => {
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature'>('bug');
  const [description, setDescription] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const generatedReportText = generateFeedbackReport(
    feedbackType,
    description,
    includeDiagnostics,
    report
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedReportText);
    setCopied(true);
    setCopiedNotice('Report copied to clipboard');
    setTimeout(() => {
      setCopied(false);
      setCopiedNotice(null);
    }, 2500);
  };

  const handleOpenEmail = () => {
    const { url, isLong } = buildMailtoUrl(
      feedbackType,
      generatedReportText,
      description
    );

    if (isLong) {
      try {
        navigator.clipboard.writeText(generatedReportText);
        setCopied(true);
        setCopiedNotice('Full report copied to clipboard for email draft');
        setTimeout(() => {
          setCopied(false);
          setCopiedNotice(null);
        }, 3500);
      } catch {
        // ignore clipboard error in strict sandbox
      }
    }

    // Launch default email client
    window.location.href = url;
  };

  const handleConnectLinkedIn = () => {
    window.open(DEVELOPER_LINKEDIN, '_blank', 'noopener,noreferrer');
  };

  const isLongReport = generatedReportText.length > MAILTO_BODY_LIMIT;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              {feedbackType === 'bug' ? (
                <Bug className="w-5 h-5" />
              ) : (
                <Lightbulb className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Report a Bug / Request a Feature
              </h3>
              <p className="text-xs text-zinc-400">
                Send feedback directly to the maintainer (<span className="text-zinc-300 font-mono">{DEVELOPER_EMAIL}</span>)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Segmented Type Toggle */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Feedback Category
            </label>
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs w-full sm:w-auto inline-flex">
              <button
                type="button"
                id="btn-feedback-type-bug"
                onClick={() => setFeedbackType('bug')}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                  feedbackType === 'bug'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Bug className="w-3.5 h-3.5" />
                <span>Bug Report</span>
              </button>
              <button
                type="button"
                id="btn-feedback-type-feature"
                onClick={() => setFeedbackType('feature')}
                className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                  feedbackType === 'feature'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span>Feature Request</span>
              </button>
            </div>
          </div>

          {/* Description Textarea */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              {feedbackType === 'bug' ? 'Describe the Issue' : 'Describe the Requested Feature'}
            </label>
            <textarea
              id="textarea-feedback-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                feedbackType === 'bug'
                  ? 'What happened? What did you expect instead? Steps to reproduce...'
                  : 'What feature or check would you like to see added to Yachiru?'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition resize-y font-sans"
            />
          </div>

          {/* Include Diagnostic Info Checkbox */}
          <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-start gap-3">
            <input
              type="checkbox"
              id="checkbox-include-diagnostics"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
              className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/20 w-4 h-4 cursor-pointer"
            />
            <label htmlFor="checkbox-include-diagnostics" className="text-xs text-zinc-300 cursor-pointer space-y-0.5">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Include diagnostic info to help debug this</span>
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Appends strict allowlisted metadata: app name, browser user agent, and high-level check titles. <strong>Never</strong> includes passwords, API keys, SSH credentials, hostnames, usernames, or database queries.
              </p>
            </label>
          </div>

          {/* Live Preview Box */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Live Report Preview
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                {generatedReportText.length} characters
              </span>
            </div>
            <pre className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-xs text-zinc-300 font-mono overflow-x-auto max-h-48 whitespace-pre-wrap leading-relaxed select-all">
              {generatedReportText || '(Enter a description above to preview report)'}
            </pre>
            {isLongReport && (
              <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Report is long (&gt; 1,500 chars). Copying to clipboard is recommended to avoid mail client URL truncation.</span>
              </p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-zinc-800 bg-zinc-950/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Secondary: Connect on LinkedIn */}
          <button
            type="button"
            id="btn-feedback-linkedin"
            onClick={handleConnectLinkedIn}
            className="flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl font-medium text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition cursor-pointer"
            title="Connect with developer on LinkedIn (opens profile in new tab)"
          >
            <Linkedin className="w-3.5 h-3.5 text-sky-400" />
            <span>Connect on LinkedIn</span>
            <ExternalLink className="w-3 h-3 text-zinc-500" />
          </button>

          {/* Primary Actions: Copy & Mailto */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              id="btn-feedback-copy"
              onClick={handleCopy}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-semibold text-xs text-zinc-100 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Copy Report to Clipboard</span>
                </>
              )}
            </button>

            <button
              type="button"
              id="btn-feedback-email"
              onClick={handleOpenEmail}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-sm transition cursor-pointer"
              title="Open pre-filled draft in your default email client"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Open in Email Client</span>
            </button>
          </div>
        </div>

        {/* Copy Toast Alert */}
        {copiedNotice && (
          <div className="bg-emerald-950/80 border-t border-emerald-500/30 px-4 py-2 text-center text-xs text-emerald-300 font-medium">
            ✓ {copiedNotice}
          </div>
        )}
      </div>
    </div>
  );
};
