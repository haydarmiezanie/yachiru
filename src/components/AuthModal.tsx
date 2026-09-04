import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Lock, Mail, Key, User, ArrowRight, AlertCircle, Sparkles, CheckCircle2, Eye, EyeOff } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { signInWithGoogle, signInWithGoogleRedirect, signInWithEmail, signUpWithEmail, authError, clearError, loading } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    clearError();
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    clearError();
    try {
      await signInWithGoogle();
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleRedirectSignIn = async () => {
    setSubmitting(true);
    clearError();
    try {
      await signInWithGoogleRedirect();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/80">
        {/* Subtle decorative gradient top bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400" />

        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
              <span className="font-mono text-2xl font-black text-slate-950">Y</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-xl font-bold tracking-tight text-white">YACHIRU</h2>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                  Access Gate
                </span>
              </div>
              <p className="text-xs text-slate-400">Restricted ClickHouse Auditor Portal</p>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-300 flex items-start gap-2.5">
            <Shield className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              Access to this platform is restricted to authorized team members and verified auditors. Please authenticate using your Google account or email credentials.
            </p>
          </div>

          {authError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">{authError}</p>
              </div>
            </div>
          )}

          {/* Recommended Sign-In option: Google */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-slate-400">Recommended for fastest access</span>
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                <Sparkles className="h-2.5 w-2.5" /> Instant
              </span>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={submitting || loading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-800/95 py-2.5 px-4 text-sm font-semibold text-white transition-all hover:bg-slate-700 hover:border-slate-600 active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-md shadow-black/40"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 12s.7 2.3 1.9 4.7l3.7-1.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.3-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <div className="mt-2 flex items-center justify-center">
              <button
                type="button"
                onClick={handleGoogleRedirectSignIn}
                disabled={submitting || loading}
                className="text-[11px] text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
              >
                Popup issue? <span className="underline">Use Full-Page Redirect</span>
              </button>
            </div>
          </div>

          <div className="relative my-5 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <span className="relative bg-slate-900 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              or authenticate with email
            </span>
          </div>

          {/* Form Tabs */}
          <div className="mb-4 flex rounded-lg bg-slate-950/70 p-1 text-xs border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                clearError();
              }}
              className={`flex-1 rounded-md py-1.5 font-medium transition-all ${
                mode === 'signin'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                clearError();
              }}
              className={`flex-1 rounded-md py-1.5 font-medium transition-all ${
                mode === 'signup'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Rivera"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="auditor@company.com"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-9 text-sm text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300 focus:outline-none cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 text-sm font-semibold text-slate-950 shadow-md shadow-amber-500/20 hover:from-amber-400 hover:to-orange-400 active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
            >
              <span>{submitting ? 'Processing...' : mode === 'signin' ? 'Sign In to Dashboard' : 'Create Account'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
