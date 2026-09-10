import React, { useState, useEffect } from 'react';
import {
  Server,
  Shield,
  Trash2,
  Check,
  Plus,
  Lock,
  Terminal,
  RefreshCw,
  AlertTriangle,
  Bookmark,
  X,
} from 'lucide-react';
import { ScanTarget, SavedConnection } from '../types/yachiru';
import { authenticatedFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface SavedConnectionsManagerProps {
  onSelectConnection: (saved: SavedConnection) => void;
  currentTarget: ScanTarget;
  activeConnectionId?: string;
}

export const SavedConnectionsManager: React.FC<SavedConnectionsManagerProps> = ({
  onSelectConnection,
  currentTarget,
  activeConnectionId,
}) => {
  const { isAdmin } = useAuth();
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newConnName, setNewConnName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHostKeysModal, setShowHostKeysModal] = useState(false);
  const [hostKeys, setHostKeys] = useState<any[]>([]);

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/connections');
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch (err) {
      console.error('Failed to load connections', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConnName.trim()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await authenticatedFetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newConnName.trim(),
          target: currentTarget,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save connection');
      }

      const saved: SavedConnection = await res.json();
      setConnections((prev) => [saved, ...prev]);
      setShowSaveModal(false);
      setNewConnName('');
      onSelectConnection(saved);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConnection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this saved connection?')) return;

    try {
      const res = await authenticatedFetch(`/api/connections/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete connection', err);
    }
  };

  const loadHostKeys = async () => {
    try {
      const res = await authenticatedFetch('/api/ssh/host-keys');
      if (res.ok) {
        const data = await res.json();
        setHostKeys(data);
        setShowHostKeysModal(true);
      }
    } catch (err) {
      console.error('Failed to load host keys', err);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold text-slate-200">Saved Target Clusters</span>
          {connections.length > 0 && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
              {connections.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setShowSaveModal(true)}
                className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Save Current Cluster</span>
              </button>

              <button
                type="button"
                onClick={loadHostKeys}
                className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="View SSH Trusted Host Fingerprints"
              >
                <Shield className="h-3 w-3 text-slate-400" />
                <span>SSH Keys</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={fetchConnections}
            disabled={loading}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Refresh saved clusters"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {connections.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
          {connections.map((conn) => {
            const isSelected = activeConnectionId === conn.id;
            return (
              <div
                key={conn.id}
                onClick={() => onSelectConnection(conn)}
                className={`flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                  isSelected
                    ? 'border-amber-500/80 bg-amber-500/10 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950'
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-xs text-white truncate">{conn.name}</span>
                    {conn.target.sshTunnel?.enabled && (
                      <span className="rounded bg-amber-950/60 border border-amber-500/40 px-1 py-0.2 text-[9px] font-mono text-amber-300 shrink-0">
                        SSH
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">
                    {conn.target.host}:{conn.target.port} / {conn.target.database}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isSelected && <Check className="h-3.5 w-3.5 text-amber-400" />}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConnection(conn.id, e)}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="Delete connection"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-2.5 text-center text-[11px] text-slate-500">
          No saved clusters yet. Admins can save ClickHouse & SSH Bastion profiles with encrypted credentials.
        </div>
      )}

      {/* Save Connection Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="h-4 w-4 text-amber-400" />
                <h3 className="font-semibold text-sm text-white">Save Cluster Profile</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConnection} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Connection Friendly Name
                </label>
                <input
                  type="text"
                  required
                  value={newConnName}
                  onChange={(e) => setNewConnName(e.target.value)}
                  placeholder="e.g. Prod Analytics Cluster (VPC-East)"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-1 font-mono text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Target Host:</span>
                  <span>{currentTarget.host}:{currentTarget.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Database:</span>
                  <span>{currentTarget.database}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">SSH Tunnel:</span>
                  <span className={currentTarget.sshTunnel?.enabled ? 'text-amber-400' : 'text-slate-500'}>
                    {currentTarget.sshTunnel?.enabled ? `Enabled (${currentTarget.sshTunnel.host}:${currentTarget.sshTunnel.port})` : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Credentials are encrypted via AES-256-GCM before storage.</span>
              </div>

              {saveError && (
                <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 p-2 rounded-lg">
                  {saveError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {saving ? 'Saving Encrypted...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Host Keys Modal */}
      {showHostKeysModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" />
                <h3 className="font-semibold text-sm text-white">Trusted SSH Host Key Fingerprints</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHostKeysModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {hostKeys.length > 0 ? (
                hostKeys.map((hk, i) => (
                  <div key={i} className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 text-xs font-mono">
                    <div className="flex justify-between font-bold text-slate-200 mb-1">
                      <span>{hk.host}:{hk.port}</span>
                      <span className="text-[10px] text-slate-500 font-sans">
                        Trusted: {new Date(hk.trustedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-400 break-all select-all">
                      {hk.fingerprint}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-slate-500">
                  No SSH host keys registered yet. Host keys are recorded on first trust (TOFU).
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowHostKeysModal(false)}
                className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
