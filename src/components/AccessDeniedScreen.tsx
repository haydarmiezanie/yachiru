import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ShieldAlert, Clock, Send, LogOut, CheckCircle2, RefreshCw } from 'lucide-react';

export const AccessDeniedScreen: React.FC = () => {
  const { user, profile, signOut, submitAccessRequest } = useAuth();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isRevoked = profile?.status === 'revoked';

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await submitAccessRequest(reason);
      setSubmitted(true);
    } catch (e: any) {
      setErr(e.message || 'Failed to submit access request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-inner">
            {isRevoked ? <ShieldAlert className="h-7 w-7 text-red-400" /> : <Clock className="h-7 w-7 text-amber-400 animate-pulse" />}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white font-mono">
            {isRevoked ? 'Access Denied / Revoked' : 'Awaiting Administrator Approval'}
          </h2>
          <p className="mt-1.5 text-xs text-slate-400">
            {isRevoked
              ? 'Your account does not have permission to access Yachiru ClickHouse Auditor.'
              : 'Your account is registered, but pending approval in the system access whitelist.'}
          </p>
        </div>

        {/* User Card */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Account Email</span>
            <span className="font-mono font-medium text-amber-300">{user?.email}</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
            <span className="text-slate-400">Authorization Status</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                isRevoked
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              {isRevoked ? 'Revoked' : 'Pending Approval'}
            </span>
          </div>
        </div>

        {/* Request Form */}
        {!isRevoked && (
          <div className="mb-6">
            {submitted ? (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-300">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-200">Access Request Submitted!</p>
                  <p className="mt-1 text-emerald-400/90">
                    System administrators have received your request. This page will automatically update once access is granted.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRequestSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Submit Access Request to Administrator
                  </label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="State your team, role, or purpose for auditing ClickHouse..."
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                {err && <p className="text-xs text-red-400">{err}</p>}
                <button
                  type="submit"
                  disabled={submitting || !reason.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500/20 py-2.5 text-xs font-semibold text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Submit Access Request'}</span>
                </button>
              </form>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
            <span>Awaiting administrator approval...</span>
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out / Switch Account</span>
          </button>
        </div>
      </div>
    </div>
  );
};
