import React, { useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  BookOpen,
  Terminal,
  RotateCw,
  History,
  Layers,
  Users,
  LogOut,
  UserCheck,
  ChevronDown,
  Code,
} from 'lucide-react';
import { ScanReport } from '../types/yachiru';
import { useAuth } from '../contexts/AuthContext';

interface NavbarProps {
  report: ScanReport | null;
  scanning: boolean;
  onScan: () => void;
  onOpenDocs: (tab?: 'overview' | 'api' | 'docker') => void;
  onOpenUserManagement: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  report,
  scanning,
  onScan,
  onOpenDocs,
  onOpenUserManagement,
  activeTab,
  setActiveTab,
}) => {
  const { user, profile, isAdmin, isAuditor, signOut } = useAuth();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <span className="font-mono text-xl font-black text-slate-950">Y</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-bold tracking-tight text-white">YACHIRU</h1>
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                ClickHouse Advisor
              </span>
            </div>
            <p className="text-xs text-slate-400">Deterministic Scanner & AI Synthesis</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1 text-sm">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'overview'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('findings')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'findings'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Findings
            {report && (
              <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.2 text-xs text-amber-400">
                {report.findings.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('migration')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'migration'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            Migration DDL
          </button>
          <button
            onClick={() => setActiveTab('deepdive')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'deepdive'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCw className="h-4 w-4" />
            Deep Dive
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="h-4 w-4" />
            History
          </button>
          <button
            onClick={() => setActiveTab('cli')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              activeTab === 'cli'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="h-4 w-4" />
            CLI Mode
          </button>
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Read-Only Safety Shield */}
          <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Read-Only Mode</span>
          </div>

          <button
            onClick={() => onOpenDocs('api')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 transition-colors cursor-pointer"
            title="View REST API documentation, endpoints, and cURL commands"
          >
            <Code className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">REST API</span>
          </button>

          <button
            onClick={() => onOpenDocs('overview')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 transition-colors cursor-pointer"
            title="ClickHouse grants, architecture, and Docker guide"
          >
            <BookOpen className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline">Docs & Grants</span>
          </button>

          {isAdmin && (
            <button
              onClick={onOpenUserManagement}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
              title="Manage User Whitelist & Access Permissions"
            >
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Manage Access</span>
            </button>
          )}

          <button
            onClick={onScan}
            disabled={scanning || !isAuditor}
            title={
              !isAuditor
                ? 'Your role is Viewer (read-only). Auditor or Admin role is required to run audits.'
                : 'Execute 9-dimension health audit'
            }
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all shadow-md ${
              !isAuditor
                ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-60'
                : 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-amber-500/20 hover:from-amber-400 hover:to-orange-400 active:scale-95 disabled:opacity-50 cursor-pointer'
            }`}
          >
            <RotateCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? 'Scanning...' : !isAuditor ? 'Read-Only' : 'Run Audit'}</span>
          </button>

          {/* User Profile Pill & Dropdown */}
          {user && (
            <div className="relative ml-1">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 pr-2.5 text-xs hover:border-slate-700 cursor-pointer"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 font-mono text-[11px] font-bold text-slate-950">
                  {profile?.displayName
                    ? profile.displayName.slice(0, 2).toUpperCase()
                    : user.email?.slice(0, 2).toUpperCase() || 'U'}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-[11px] font-medium text-slate-200 truncate max-w-[100px]">
                    {profile?.displayName || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider">
                    {profile?.role || 'Viewer'}
                  </div>
                </div>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>

              {userDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setUserDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 z-40 w-56 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl">
                    <div className="border-b border-slate-800/80 px-3 py-2 text-xs">
                      <p className="font-semibold text-white truncate">{profile?.displayName || 'Auditor'}</p>
                      <p className="font-mono text-[11px] text-slate-400 truncate">{user.email}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                          {profile?.status?.toUpperCase()}
                        </span>
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
                          {profile?.role?.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {isAdmin && (
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          onOpenUserManagement();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer mt-1"
                      >
                        <Users className="h-3.5 w-3.5 text-amber-400" />
                        <span>Manage Team Access</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setUserDropdownOpen(false);
                        signOut();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/40 hover:text-red-300 transition-colors cursor-pointer mt-1"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile nav row */}
      <div className="flex md:hidden overflow-x-auto border-t border-slate-800/80 px-2 py-1 gap-1 text-xs">
        {['overview', 'findings', 'migration', 'deepdive', 'history', 'cli'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-3 py-1 rounded capitalize font-medium ${
              activeTab === tab ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </header>
  );
};
