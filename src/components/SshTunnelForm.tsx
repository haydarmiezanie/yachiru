import React, { useState } from 'react';
import { Shield, Key, Lock, Terminal, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { SshTunnelConfig } from '../types/yachiru';

interface SshTunnelFormProps {
  config?: SshTunnelConfig;
  onChange: (config: SshTunnelConfig | undefined) => void;
}

export const SshTunnelForm: React.FC<SshTunnelFormProps> = ({ config, onChange }) => {
  const isEnabled = Boolean(config?.enabled);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      onChange({
        enabled: true,
        host: config?.host || '',
        port: config?.port || 22,
        username: config?.username || '',
        authMethod: config?.authMethod || 'password',
        password: config?.password || '',
        privateKey: config?.privateKey || '',
        passphrase: config?.passphrase || '',
      });
    } else {
      onChange(undefined);
    }
  };

  const updateField = <K extends keyof SshTunnelConfig>(key: K, value: SshTunnelConfig[K]) => {
    if (!config) return;
    onChange({
      ...config,
      [key]: value,
    });
  };

  const handleKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        updateField('privateKey', content.trim());
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg border ${isEnabled ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-200">SSH Bastion Tunnel</span>
              {isEnabled && (
                <span className="rounded bg-emerald-950/60 border border-emerald-500/40 px-1.5 py-0.2 text-[10px] font-medium text-emerald-300">
                  Active
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Forward through a jump host to reach isolated VPC ClickHouse clusters
            </p>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
        </label>
      </div>

      {isEnabled && config && (
        <div className="mt-4 pt-3.5 border-t border-slate-800/80 space-y-3.5">
          {/* SSH Server Coordinates */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                SSH Bastion Host / Public IP
              </label>
              <input
                type="text"
                value={config.host}
                onChange={(e) => updateField('host', e.target.value.trim())}
                placeholder="e.g. bastion.company.com or 198.51.100.4"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">SSH Port</label>
              <input
                type="number"
                value={config.port || 22}
                onChange={(e) => updateField('port', parseInt(e.target.value) || 22)}
                placeholder="22"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* SSH Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">SSH Username</label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => updateField('username', e.target.value.trim())}
                placeholder="e.g. ec2-user, ubuntu, root"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-300 mb-1">Authentication Method</label>
              <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => updateField('authMethod', 'password')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md transition-all cursor-pointer ${
                    config.authMethod === 'password'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span>Password</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateField('authMethod', 'privateKey')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md transition-all cursor-pointer ${
                    config.authMethod === 'privateKey'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Key className="h-3 w-3" />
                  <span>SSH Private Key</span>
                </button>
              </div>
            </div>
          </div>

          {/* Conditional Auth Input: Password vs Private Key */}
          {config.authMethod === 'password' ? (
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">SSH Bastion Password</label>
              <input
                type="password"
                value={config.password || ''}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-medium text-slate-300">
                  Private Key (PEM, OpenSSH, RSA, Ed25519)
                </label>
                <label className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer font-medium">
                  <Upload className="h-3 w-3" />
                  <span>Upload Key File</span>
                  <input
                    type="file"
                    accept=".pem,.key,.id_rsa,.id_ed25519,text/plain"
                    onChange={handleKeyFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <textarea
                rows={4}
                value={config.privateKey || ''}
                onChange={(e) => updateField('privateKey', e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-200 focus:border-amber-500 focus:outline-none font-mono resize-none leading-relaxed"
              />

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Key Passphrase (Optional - if key is encrypted)
                </label>
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={config.passphrase || ''}
                  onChange={(e) => updateField('passphrase', e.target.value)}
                  placeholder="Passphrase to decrypt private key"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* Security & Network Guidance Callout */}
          <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 p-2.5 flex items-start gap-2 text-[11px] text-slate-400">
            <Shield className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <span className="font-semibold text-slate-300 block">
                Network Perspective & Security Guarantees:
              </span>
              <p>
                When SSH tunnel is enabled, ClickHouse Host & Port above are resolved
                <strong> from the perspective of the SSH bastion</strong>. You can safely enter private subnet
                addresses like <code className="text-amber-300 font-mono text-[10px]">10.0.1.50</code> or{' '}
                <code className="text-amber-300 font-mono text-[10px]">clickhouse.vpc.internal</code>.
              </p>
              <p className="text-slate-500 text-[10px]">
                TOFU host key verification, AES-256-GCM write-only credential storage, and ephemeral local port binding are enforced.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
