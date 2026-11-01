import React, { useState, useRef, useEffect } from 'react';
import { ConnectionConfig, AiProvider, AVAILABLE_AI_MODELS, SavedConnectionProfile } from '../types.js';
import { ClickHouseUserSetupModal } from './ClickHouseUserSetupModal.js';
import {
  listSavedProfiles,
  saveProfile,
  deleteProfile,
  touchProfileLastUsed,
  extractProfileFromFormState,
} from '../utils/savedProfiles.js';
import {
  Database,
  Lock,
  Server,
  Shield,
  Sliders,
  Sparkles,
  Zap,
  Bot,
  Globe,
  KeyRound,
  FileCode2,
  Eye,
  EyeOff,
  AlertTriangle,
  ExternalLink,
  Check,
  Activity,
  CheckCircle2,
  Bookmark,
  FolderOpen,
  Save,
  Trash2,
  History,
} from 'lucide-react';

export function sanitizeHostInput(raw: string): {
  host: string;
  autoProtocol?: 'http' | 'https';
  autoPort?: number;
  wasCorrected: boolean;
} {
  let val = raw.trim();
  let wasCorrected = false;
  let autoProtocol: 'http' | 'https' | undefined;
  let autoPort: number | undefined;

  // Check if user copied/pasted a URL with http:// or https://
  if (/^https?:\/\//i.test(val)) {
    wasCorrected = true;
    try {
      const url = new URL(val);
      if (url.protocol === 'https:') autoProtocol = 'https';
      if (url.protocol === 'http:') autoProtocol = 'http';
      if (url.port) {
        const p = parseInt(url.port, 10);
        if (!isNaN(p)) autoPort = p;
      }
      val = url.hostname;
    } catch {
      if (/^https:\/\//i.test(val)) autoProtocol = 'https';
      if (/^http:\/\//i.test(val)) autoProtocol = 'http';
      val = val.replace(/^https?:\/\//i, '');
      val = val.replace(/\/.*$/, '');
      const colonMatch = val.match(/:(\d+)$/);
      if (colonMatch) {
        autoPort = parseInt(colonMatch[1], 10);
        val = val.replace(/:(\d+)$/, '');
      }
    }
  } else if (val.includes('/') || /:\d+$/.test(val)) {
    // If entered without protocol, e.g. "my-host.clickhouse.cloud:8443/" or "my-host.com/"
    wasCorrected = true;
    val = val.replace(/\/.*$/, ''); // strip path
    const colonMatch = val.match(/:(\d+)$/);
    if (colonMatch) {
      autoPort = parseInt(colonMatch[1], 10);
      val = val.replace(/:(\d+)$/, '');
    }
  }

  return {
    host: val,
    autoProtocol,
    autoPort,
    wasCorrected,
  };
}

interface ConnectionFormProps {
  onConnect: (config: ConnectionConfig) => void;
  isLoading: boolean;
  apiKeyRequired?: boolean;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ onConnect, isLoading, apiKeyRequired = false }) => {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState<number>(8123);
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [username, setUsername] = useState('default');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('default');
  const [yachiruApiKey, setYachiruApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_server_api_key') || '';
  });
  const [showYachiruApiKey, setShowYachiruApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [durationThreshold, setDurationThreshold] = useState<number>(3000);
  const [memoryThresholdMB, setMemoryThresholdMB] = useState<number>(1024);
  const [hostCorrectedNotice, setHostCorrectedNotice] = useState<string | null>(null);

  // Saved Connection Profiles (strictly non-secret fields persisted in localStorage)
  const [profiles, setProfiles] = useState<SavedConnectionProfile[]>(() => listSavedProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    const list = listSavedProfiles();
    if (list.length === 0) return '';
    const sorted = [...list].sort((a, b) => {
      const timeA = new Date(a.lastUsedAt || a.createdAt).getTime();
      const timeB = new Date(b.lastUsedAt || b.createdAt).getTime();
      return timeB - timeA;
    });
    return sorted[0]?.id || '';
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [overwriteCandidate, setOverwriteCandidate] = useState<SavedConnectionProfile | null>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileFeedbackNotice, setProfileFeedbackNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // SSH Tunnel state
  const [useSshTunnel, setUseSshTunnel] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState<number>(22);
  const [sshUsername, setSshUsername] = useState('');
  const [sshAuthMethod, setSshAuthMethod] = useState<'password' | 'privateKey'>('password');
  const [sshPassword, setSshPassword] = useState(() => {
    return sessionStorage.getItem('yachiru_ssh_password') || '';
  });
  const [sshPrivateKey, setSshPrivateKey] = useState(() => {
    return sessionStorage.getItem('yachiru_ssh_private_key') || '';
  });
  const [sshPrivateKeyPassphrase, setSshPrivateKeyPassphrase] = useState(() => {
    return sessionStorage.getItem('yachiru_ssh_private_key_passphrase') || '';
  });
  const [sshHostKeyFingerprint, setSshHostKeyFingerprint] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showSshPassphrase, setShowSshPassphrase] = useState(false);
  const [sshHostCorrectedNotice, setSshHostCorrectedNotice] = useState<string | null>(null);
  const [sshValidationError, setSshValidationError] = useState<string | null>(null);

  // Scan History & Trend Tracking state
  const [enableHistoryTracking, setEnableHistoryTracking] = useState(false);
  const [historyDatabase, setHistoryDatabase] = useState('');
  const [historyTableName, setHistoryTableName] = useState('yachiru_scan_history');
  const [historyWriteUsername, setHistoryWriteUsername] = useState('yachiru_history_writer');
  const [historyWritePassword, setHistoryWritePassword] = useState(() => {
    return sessionStorage.getItem('yachiru_history_write_password') || '';
  });
  const [showHistoryWritePassword, setShowHistoryWritePassword] = useState(false);
  const [historyValidationError, setHistoryValidationError] = useState<string | null>(null);

  // Test Connection state
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    hint?: string;
    pinMatches?: boolean;
    serverHostKey?: {
      type: string;
      fingerprintSha256: string;
      fingerprintMd5: string;
      rawBase64: string;
    };
  } | null>(null);

  // User-provided AI state (Gemini, OpenAI & Claude)
  const [enableAiNarrative, setEnableAiNarrative] = useState(() => {
    return Boolean(
      sessionStorage.getItem('yachiru_gemini_api_key') ||
      sessionStorage.getItem('yachiru_openai_api_key') ||
      sessionStorage.getItem('yachiru_claude_api_key')
    );
  });
  const [aiProvider, setAiProvider] = useState<AiProvider>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_gemini_api_key') || '';
  });
  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_openai_api_key') || '';
  });
  const [claudeApiKey, setClaudeApiKey] = useState(() => {
    return sessionStorage.getItem('yachiru_claude_api_key') || '';
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  // Persist keys in session storage for current tab convenience
  useEffect(() => {
    if (yachiruApiKey) {
      sessionStorage.setItem('yachiru_server_api_key', yachiruApiKey);
    } else {
      sessionStorage.removeItem('yachiru_server_api_key');
    }
  }, [yachiruApiKey]);

  useEffect(() => {
    if (geminiApiKey) {
      sessionStorage.setItem('yachiru_gemini_api_key', geminiApiKey);
    }
  }, [geminiApiKey]);

  useEffect(() => {
    if (openaiApiKey) {
      sessionStorage.setItem('yachiru_openai_api_key', openaiApiKey);
    }
  }, [openaiApiKey]);

  useEffect(() => {
    if (claudeApiKey) {
      sessionStorage.setItem('yachiru_claude_api_key', claudeApiKey);
    }
  }, [claudeApiKey]);

  // Persist SSH secrets in session storage for current tab convenience (cleared on tab close)
  useEffect(() => {
    if (sshPassword) {
      sessionStorage.setItem('yachiru_ssh_password', sshPassword);
    } else {
      sessionStorage.removeItem('yachiru_ssh_password');
    }
  }, [sshPassword]);

  useEffect(() => {
    if (sshPrivateKey) {
      sessionStorage.setItem('yachiru_ssh_private_key', sshPrivateKey);
    } else {
      sessionStorage.removeItem('yachiru_ssh_private_key');
    }
  }, [sshPrivateKey]);

  useEffect(() => {
    if (sshPrivateKeyPassphrase) {
      sessionStorage.setItem('yachiru_ssh_private_key_passphrase', sshPrivateKeyPassphrase);
    } else {
      sessionStorage.removeItem('yachiru_ssh_private_key_passphrase');
    }
  }, [sshPrivateKeyPassphrase]);

  // Persist history write password in session storage for current tab only
  useEffect(() => {
    if (historyWritePassword) {
      sessionStorage.setItem('yachiru_history_write_password', historyWritePassword);
    } else {
      sessionStorage.removeItem('yachiru_history_write_password');
    }
  }, [historyWritePassword]);

  const handleProviderToggle = (newProvider: AiProvider) => {
    setAiProvider(newProvider);
    setApiKeyError(null);
    if (newProvider === 'gemini') {
      setSelectedModel('gemini-3.8-flash');
    } else if (newProvider === 'openai') {
      setSelectedModel('gpt-5.4-mini');
    } else {
      setSelectedModel('claude-haiku-4-5-20251001');
    }
  };

  const handleProtocolChange = (newProtocol: 'http' | 'https') => {
    setProtocol(newProtocol);
    if (newProtocol === 'https' && port === 8123) {
      setPort(8443);
    } else if (newProtocol === 'http' && port === 8443) {
      setPort(8123);
    }
  };

  const handleLoadProfile = (profileId: string) => {
    if (!profileId) return;
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;

    // Populate non-secret fields ONLY — NEVER touch credentials or API keys
    setHost(target.host);
    setPort(target.port);
    setProtocol(target.protocol);
    setDatabase(target.database);
    setUsername(target.username);

    if (target.useSshTunnel) {
      setUseSshTunnel(true);
      setSshHost(target.sshHost || '');
      setSshPort(target.sshPort || 22);
      setSshUsername(target.sshUsername || '');
      setSshAuthMethod(target.sshAuthMethod || 'password');
      setSshHostKeyFingerprint(target.sshHostKeyFingerprint || '');
    } else {
      setUseSshTunnel(false);
      setSshHostKeyFingerprint('');
    }

    if (target.enableHistoryTracking) {
      setEnableHistoryTracking(true);
      setHistoryDatabase(target.historyDatabase || target.database || 'default');
      setHistoryTableName(target.historyTableName || 'yachiru_scan_history');
      setHistoryWriteUsername(target.historyWriteUsername || 'yachiru_history_writer');
    } else {
      setEnableHistoryTracking(false);
    }

    // Touch last used timestamp
    touchProfileLastUsed(target.id);
    const refreshed = listSavedProfiles();
    setProfiles(refreshed);

    setProfileFeedbackNotice(`Loaded profile "${target.name}". Password & API keys require typing each session.`);
    setTimeout(() => setProfileFeedbackNotice(null), 5000);
  };

  const handleInitiateSaveProfile = () => {
    const trimmedName = profileNameInput.trim();
    if (!trimmedName) {
      setProfileSaveError('Please enter a name for this connection profile.');
      return;
    }
    if (!host.trim()) {
      setProfileSaveError('Host cannot be empty.');
      return;
    }

    // Check for existing profile with the same name (case-insensitive)
    const existing = profiles.find(
      (p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    if (existing) {
      setOverwriteCandidate(existing);
      setProfileSaveError(null);
      return;
    }

    executeSaveProfile(trimmedName);
  };

  const executeSaveProfile = (name: string, overwriteId?: string) => {
    try {
      // Build strictly using allowlist function — NO passwords, NO API keys
      const cleanData = extractProfileFromFormState({
        name,
        host,
        port,
        protocol,
        database,
        username,
        useSshTunnel,
        sshHost,
        sshPort,
        sshUsername,
        sshAuthMethod,
        sshHostKeyFingerprint: sshHostKeyFingerprint.trim() || undefined,
        enableHistoryTracking,
        historyDatabase: historyDatabase.trim() || undefined,
        historyTableName: historyTableName.trim() || undefined,
        historyWriteUsername: historyWriteUsername.trim() || undefined,
      });

      const saved = saveProfile(cleanData, overwriteId);
      const refreshed = listSavedProfiles();
      setProfiles(refreshed);
      setSelectedProfileId(saved.id);
      setIsSavingProfile(false);
      setProfileNameInput('');
      setOverwriteCandidate(null);
      setProfileSaveError(null);

      setProfileFeedbackNotice(`Saved "${saved.name}"! Non-secret fields persisted in localStorage.`);
      setTimeout(() => setProfileFeedbackNotice(null), 4000);
    } catch (err) {
      setProfileSaveError(err instanceof Error ? err.message : 'Failed to save profile to browser storage.');
    }
  };

  const confirmOverwriteProfile = () => {
    if (!overwriteCandidate) return;
    executeSaveProfile(overwriteCandidate.name, overwriteCandidate.id);
  };

  const handleDeleteProfile = (profileId: string) => {
    deleteProfile(profileId);
    const refreshed = listSavedProfiles();
    setProfiles(refreshed);
    setConfirmDeleteId(null);

    if (refreshed.length > 0) {
      const sorted = [...refreshed].sort((a, b) => {
        const timeA = new Date(a.lastUsedAt || a.createdAt).getTime();
        const timeB = new Date(b.lastUsedAt || b.createdAt).getTime();
        return timeB - timeA;
      });
      setSelectedProfileId(sorted[0].id);
    } else {
      setSelectedProfileId('');
    }

    setProfileFeedbackNotice('Profile deleted.');
    setTimeout(() => setProfileFeedbackNotice(null), 3000);
  };

  const applyHostSanitization = (raw: string) => {
    const { host: cleanedHost, autoProtocol, autoPort, wasCorrected } = sanitizeHostInput(raw);
    setHost(cleanedHost);
    if (autoProtocol) {
      setProtocol(autoProtocol);
      if (!autoPort) {
        setPort(autoProtocol === 'https' ? 8443 : 8123);
      }
    }
    if (autoPort) {
      setPort(autoPort);
    }
    if (wasCorrected) {
      setHostCorrectedNotice(`Domain cleaned: ${cleanedHost}`);
      setTimeout(() => setHostCorrectedNotice(null), 4000);
    }
  };

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHost(e.target.value);
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteText = e.clipboardData.getData('text');
    if (pasteText && (/^https?:\/\//i.test(pasteText) || pasteText.includes('/') || /:\d+$/.test(pasteText))) {
      e.preventDefault();
      applyHostSanitization(pasteText);
    }
  };

  const handleHostBlur = () => {
    if (/^https?:\/\//i.test(host) || host.includes('/') || /:\d+$/.test(host)) {
      applyHostSanitization(host);
    }
  };

  const applySshHostSanitization = (raw: string) => {
    let toClean = raw.trim();
    if (/^ssh:\/\//i.test(toClean)) {
      toClean = toClean.replace(/^ssh:\/\//i, '');
      if (toClean.includes('@')) {
        const parts = toClean.split('@');
        const userPart = parts[0];
        toClean = parts.slice(1).join('@');
        if (userPart && !sshUsername) {
          setSshUsername(userPart);
        }
      }
      toClean = 'http://' + toClean;
    }
    const { host: cleanedHost, autoPort, wasCorrected } = sanitizeHostInput(toClean);
    setSshHost(cleanedHost);
    if (autoPort) {
      setSshPort(autoPort);
    }
    if (wasCorrected || toClean !== raw.trim()) {
      setSshHostCorrectedNotice(`SSH Host cleaned: ${cleanedHost}`);
      setTimeout(() => setSshHostCorrectedNotice(null), 4000);
    }
  };

  const handleSshHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSshHost(e.target.value);
    if (sshValidationError) setSshValidationError(null);
  };

  const handleSshHostPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteText = e.clipboardData.getData('text');
    if (pasteText && (/^https?:\/\//i.test(pasteText) || /^ssh:\/\//i.test(pasteText) || pasteText.includes('/') || /:\d+$/.test(pasteText))) {
      e.preventDefault();
      applySshHostSanitization(pasteText);
    }
  };

  const handleSshHostBlur = () => {
    if (/^https?:\/\//i.test(sshHost) || /^ssh:\/\//i.test(sshHost) || sshHost.includes('/') || /:\d+$/.test(sshHost)) {
      applySshHostSanitization(sshHost);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);

    if (useSshTunnel) {
      if (!sshHost.trim()) {
        setTestResult({
          success: false,
          message: 'Bastion SSH Host is required when SSH tunnel is enabled.',
          hint: 'Please provide the bastion/jump host IP or domain name.',
        });
        setIsTestingConnection(false);
        return;
      }
      if (!sshUsername.trim()) {
        setTestResult({
          success: false,
          message: 'Bastion SSH Username is required when SSH tunnel is enabled.',
          hint: 'Please provide the SSH username for authenticating with the bastion.',
        });
        setIsTestingConnection(false);
        return;
      }
      if (sshAuthMethod === 'password' && !sshPassword.trim()) {
        setTestResult({
          success: false,
          message: 'Bastion SSH Password is required for Password Authentication.',
          hint: 'Please enter the SSH password for your bastion user.',
        });
        setIsTestingConnection(false);
        return;
      }
      if (sshAuthMethod === 'privateKey' && !sshPrivateKey.trim()) {
        setTestResult({
          success: false,
          message: 'Bastion SSH Private Key is required for Private Key Authentication.',
          hint: 'Please paste the PEM-formatted SSH private key.',
        });
        setIsTestingConnection(false);
        return;
      }
    }

    const { host: cleanedHost, autoProtocol, autoPort } = sanitizeHostInput(host);
    const targetHost = cleanedHost || host.trim();
    const targetPort = autoPort || Number(port) || (protocol === 'https' ? 8443 : 8123);
    const targetProtocol = autoProtocol || protocol;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKeyRequired && yachiruApiKey.trim()) {
        headers['Authorization'] = `Bearer ${yachiruApiKey.trim()}`;
      }

      const sshPayload = useSshTunnel
        ? {
            useSshTunnel: true,
            sshHost: sshHost.trim(),
            sshPort: Number(sshPort) || 22,
            sshUsername: sshUsername.trim(),
            sshAuthMethod,
            sshPassword: sshAuthMethod === 'password' ? sshPassword : undefined,
            sshPrivateKey: sshAuthMethod === 'privateKey' ? sshPrivateKey : undefined,
            sshPrivateKeyPassphrase:
              sshAuthMethod === 'privateKey' && sshPrivateKeyPassphrase
                ? sshPrivateKeyPassphrase
                : undefined,
            sshHostKeyFingerprint: sshHostKeyFingerprint.trim() || undefined,
          }
        : { useSshTunnel: false };

      const response = await fetch('/api/test-connection', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: targetHost,
          port: targetPort,
          protocol: targetProtocol,
          username: username.trim(),
          password,
          database: database.trim(),
          isDemo: false,
          ...sshPayload,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || `Connected to ClickHouse v${data.version || 'OK'} successfully (${targetProtocol.toUpperCase()}${useSshTunnel ? ' via SSH Tunnel' : ''})`,
          serverHostKey: data.serverHostKey,
          pinMatches: data.pinMatches,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || `Test connection failed (Status ${response.status})`,
          hint: data.hint,
          serverHostKey: data.serverHostKey,
          pinMatches: data.pinMatches,
        });
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network failure testing connection',
        hint: useSshTunnel
          ? 'Could not connect through SSH tunnel. Ensure bastion host and ClickHouse target are reachable.'
          : 'Please ensure host is reachable and HTTP port is open (default 8123 HTTP / 8443 HTTPS).',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const validateAndProceed = (targetIsDemo: boolean, forceWithoutAi: boolean = false) => {
    const willUseAi = forceWithoutAi ? false : enableAiNarrative;
    const activeApiKey =
      aiProvider === 'openai' ? openaiApiKey :
      aiProvider === 'claude' ? claudeApiKey : geminiApiKey;

    // Check if AI is enabled but user has not provided an API key for selected provider
    if (willUseAi && !activeApiKey.trim()) {
      const providerLabel =
        aiProvider === 'openai' ? 'OpenAI' :
        aiProvider === 'claude' ? 'Claude' : 'Gemini';
      setApiKeyError(
        `${providerLabel} API Key is required because AI Executive Narrative is enabled. Please enter your ${providerLabel} API key below or proceed with deterministic analysis without AI.`
      );
      setShowAdvanced(true);
      setTimeout(() => {
        apiKeyInputRef.current?.focus();
      }, 100);
      return;
    }

    setApiKeyError(null);

    if (forceWithoutAi) {
      setEnableAiNarrative(false);
    }

    if (targetIsDemo) {
      onConnect({
        host: 'demo.internal',
        port: 8443,
        protocol: 'https',
        username: 'default',
        password: '',
        database: 'production',
        enableAiNarrative: willUseAi,
        aiProvider,
        geminiModel: selectedModel.trim(),
        geminiApiKey: willUseAi && aiProvider === 'gemini' ? geminiApiKey.trim() : undefined,
        openaiApiKey: willUseAi && aiProvider === 'openai' ? openaiApiKey.trim() : undefined,
        claudeApiKey: willUseAi && aiProvider === 'claude' ? claudeApiKey.trim() : undefined,
        yachiruApiKey: apiKeyRequired && yachiruApiKey.trim() ? yachiruApiKey.trim() : undefined,
        isDemo: true,
        enableHistoryTracking: false,
      });
    } else {
      if (useSshTunnel) {
        if (!sshHost.trim()) {
          setSshValidationError('Bastion SSH Host is required when SSH tunnel is enabled.');
          return;
        }
        if (!sshUsername.trim()) {
          setSshValidationError('Bastion SSH Username is required when SSH tunnel is enabled.');
          return;
        }
        if (sshAuthMethod === 'password' && !sshPassword.trim()) {
          setSshValidationError('Bastion SSH Password is required for Password Authentication.');
          return;
        }
        if (sshAuthMethod === 'privateKey' && !sshPrivateKey.trim()) {
          setSshValidationError('Bastion SSH Private Key is required for Private Key Authentication.');
          return;
        }
      }
      setSshValidationError(null);

      if (enableHistoryTracking) {
        if (!historyWriteUsername.trim()) {
          setHistoryValidationError('Dedicated write username is required for scan history tracking.');
          return;
        }
        if (!historyWritePassword) {
          setHistoryValidationError('Dedicated write password is required for scan history tracking.');
          return;
        }
      }
      setHistoryValidationError(null);

      const { host: cleanedHost, autoProtocol, autoPort } = sanitizeHostInput(host);
      const finalHost = cleanedHost || host.trim();
      const finalPort = autoPort || Number(port);
      const finalProtocol = autoProtocol || protocol;

      const sshPayload = useSshTunnel
        ? {
            useSshTunnel: true,
            sshHost: sshHost.trim(),
            sshPort: Number(sshPort) || 22,
            sshUsername: sshUsername.trim(),
            sshAuthMethod,
            sshPassword: sshAuthMethod === 'password' ? sshPassword : undefined,
            sshPrivateKey: sshAuthMethod === 'privateKey' ? sshPrivateKey : undefined,
            sshPrivateKeyPassphrase:
              sshAuthMethod === 'privateKey' && sshPrivateKeyPassphrase
                ? sshPrivateKeyPassphrase
                : undefined,
            sshHostKeyFingerprint: sshHostKeyFingerprint.trim() || undefined,
          }
        : { useSshTunnel: false };

      onConnect({
        host: finalHost,
        port: finalPort,
        protocol: finalProtocol,
        username: username.trim(),
        password,
        database: database.trim(),
        queryDurationThresholdMs: Number(durationThreshold),
        queryMemoryThresholdBytes: Number(memoryThresholdMB) * 1024 * 1024,
        enableAiNarrative: willUseAi,
        aiProvider,
        geminiModel: selectedModel.trim(),
        geminiApiKey: willUseAi && aiProvider === 'gemini' ? geminiApiKey.trim() : undefined,
        openaiApiKey: willUseAi && aiProvider === 'openai' ? openaiApiKey.trim() : undefined,
        claudeApiKey: willUseAi && aiProvider === 'claude' ? claudeApiKey.trim() : undefined,
        yachiruApiKey: apiKeyRequired && yachiruApiKey.trim() ? yachiruApiKey.trim() : undefined,
        enableHistoryTracking,
        historyDatabase: enableHistoryTracking ? (historyDatabase.trim() || database.trim()) : undefined,
        historyTableName: enableHistoryTracking ? (historyTableName.trim() || 'yachiru_scan_history') : undefined,
        historyWriteUsername: enableHistoryTracking ? historyWriteUsername.trim() : undefined,
        historyWritePassword: enableHistoryTracking ? historyWritePassword : undefined,
        isDemo: false,
        ...sshPayload,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateAndProceed(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Hero Presentation */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Full-Spectrum ClickHouse Audit</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-3">
          Diagnose your ClickHouse cluster with pure evidence
        </h2>
        <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
          Connect to any live ClickHouse database to identify part merge bottlenecks, unpruned ORDER BY full scans, over-partitioning, and codec inefficiencies.
        </p>
      </div>

      {/* Safety & Read-Only Guarantee Banner */}
      <div className="mb-8 p-4 rounded-xl bg-zinc-900/90 border border-emerald-500/30 shadow-sm flex items-start gap-3.5">
        <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 shrink-0 mt-0.5">
          <Shield className="w-5 h-5" />
        </div>
        <div className="text-xs text-zinc-300 space-y-1">
          <p className="font-semibold text-emerald-400 text-sm flex items-center gap-1.5">
            Strict Read-Only SQL Architecture
          </p>
          <p className="text-zinc-400 leading-relaxed">
            Yachiru strictly issues read-only <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">SELECT</code> queries against ClickHouse system tables (<code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.parts</code>, <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.tables</code>, <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">system.query_log</code>). It will <strong className="text-zinc-200">never</strong> execute or expose mutating statements (no ALTER, DROP, TRUNCATE, INSERT, or KILL).
          </p>
          <p className="text-zinc-400">
            🔒 <strong className="text-zinc-300">Tab-Scoped Ephemeral Security:</strong> Connection credentials & API keys are held in server volatile memory during active scans and never written to database or persistent disk. For user convenience, the API key is cached in browser <code className="text-zinc-200 bg-zinc-800 px-1 py-0.5 rounded font-mono">sessionStorage</code> for this browser tab only and is automatically cleared when the tab closes.
          </p>
        </div>
      </div>

      {/* Main Connection Form Card */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Saved Connection Profiles Section */}
          <div className="space-y-2">
            {profiles.length > 0 ? (
              <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-200">Saved Connections</span>
                    <span className="text-[11px] text-zinc-500 font-mono">(Non-secret fields only)</span>
                  </div>
                  {!isSavingProfile && (
                    <button
                      type="button"
                      id="btn-open-save-profile"
                      onClick={() => {
                        setIsSavingProfile(true);
                        setProfileNameInput('');
                        setProfileSaveError(null);
                        setOverwriteCandidate(null);
                      }}
                      className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition cursor-pointer self-start sm:self-auto"
                    >
                      <Save className="w-3.5 h-3.5 text-rose-400" />
                      <span>Save Current as Profile</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="relative flex-1">
                    <select
                      id="select-saved-profile"
                      value={selectedProfileId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setSelectedProfileId(newId);
                        setConfirmDeleteId(null);
                        if (newId) {
                          handleLoadProfile(newId);
                        }
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-rose-500 cursor-pointer"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.host}:{p.port} ({p.database} / {p.username}){p.useSshTunnel ? ' [SSH]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    id="btn-load-saved-profile"
                    onClick={() => handleLoadProfile(selectedProfileId)}
                    disabled={!selectedProfileId}
                    className="px-3.5 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 rounded-lg text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Load Profile</span>
                  </button>

                  {confirmDeleteId === selectedProfileId ? (
                    <div className="flex items-center gap-1.5 shrink-0 bg-red-950/40 border border-red-500/30 rounded-lg px-2.5 py-1 text-xs">
                      <span className="text-red-300 text-[11px] font-medium">Delete?</span>
                      <button
                        type="button"
                        id="btn-confirm-delete-profile"
                        onClick={() => handleDeleteProfile(selectedProfileId)}
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[11px] font-semibold transition cursor-pointer"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        id="btn-cancel-delete-profile"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      id="btn-delete-saved-profile"
                      title="Delete selected profile"
                      onClick={() => setConfirmDeleteId(selectedProfileId)}
                      disabled={!selectedProfileId}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-zinc-800 transition cursor-pointer shrink-0 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Bookmark className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span>No saved connection profiles yet</span>
                  <span className="text-[11px] text-zinc-500 hidden sm:inline">(stores non-secret host/port/database, never passwords)</span>
                </div>
                {!isSavingProfile && (
                  <button
                    type="button"
                    id="btn-open-save-profile-empty"
                    onClick={() => {
                      setIsSavingProfile(true);
                      setProfileNameInput('');
                      setProfileSaveError(null);
                      setOverwriteCandidate(null);
                    }}
                    className="text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition cursor-pointer shrink-0"
                  >
                    <Save className="w-3.5 h-3.5 text-rose-400" />
                    <span>Save Current as Profile</span>
                  </button>
                )}
              </div>
            )}

            {/* Inline Save Form */}
            {isSavingProfile && (
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-700/80 space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Save className="w-3.5 h-3.5 text-rose-400" />
                    <span>Save Connection Profile</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono">🔒 Passwords & API keys are NEVER saved</span>
                </div>

                {overwriteCandidate ? (
                  <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-xs space-y-2">
                    <p className="text-amber-200">
                      A profile named &ldquo;<strong className="text-white">{overwriteCandidate.name}</strong>&rdquo; already exists. Overwrite it?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-confirm-overwrite-profile"
                        onClick={confirmOverwriteProfile}
                        className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium text-xs transition cursor-pointer"
                      >
                        Yes, Overwrite
                      </button>
                      <button
                        type="button"
                        id="btn-cancel-overwrite-profile"
                        onClick={() => setOverwriteCandidate(null)}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      id="input-profile-name"
                      value={profileNameInput}
                      onChange={(e) => {
                        setProfileNameInput(e.target.value);
                        setProfileSaveError(null);
                      }}
                      placeholder="Profile label (e.g. Production Cluster, Staging VPC)"
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 font-sans"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleInitiateSaveProfile();
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-submit-save-profile"
                        onClick={handleInitiateSaveProfile}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Save Profile
                      </button>
                      <button
                        type="button"
                        id="btn-cancel-save-profile"
                        onClick={() => {
                          setIsSavingProfile(false);
                          setProfileSaveError(null);
                          setOverwriteCandidate(null);
                        }}
                        className="px-2.5 py-1.5 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {profileSaveError && (
                  <p className="text-[11px] text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{profileSaveError}</span>
                  </p>
                )}
              </div>
            )}

            {/* Profile loaded or action feedback */}
            {profileFeedbackNotice && (
              <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 px-1 animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{profileFeedbackNotice}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-4 gap-3">
            <div className="flex items-center gap-2 text-zinc-100 font-semibold text-base">
              <Server className="w-4 h-4 text-rose-400" />
              <span>ClickHouse Target Instance</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* SSH Tunnel Toggle */}
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  type="button"
                  id="btn-toggle-ssh-tunnel"
                  onClick={() => setUseSshTunnel(!useSshTunnel)}
                  className={`px-3 py-1 rounded font-medium transition cursor-pointer flex items-center gap-1.5 ${
                    useSshTunnel
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  <span>SSH Tunnel {useSshTunnel ? 'Enabled' : 'Disabled'}</span>
                </button>
              </div>

              {/* Protocol Toggle */}
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => handleProtocolChange('http')}
                  className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                    protocol === 'http'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  HTTP (8123)
                </button>
                <button
                  type="button"
                  onClick={() => handleProtocolChange('https')}
                  className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                    protocol === 'https'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  HTTPS (8443 / Cloud)
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Host */}
            <div className="sm:col-span-8">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Host or Endpoint</span>
                </label>
                {hostCorrectedNotice && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono animate-in fade-in">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>{hostCorrectedNotice}</span>
                  </span>
                )}
              </div>
              <input
                id="input-host"
                type="text"
                required
                value={host}
                onChange={handleHostChange}
                onPaste={handleHostPaste}
                onBlur={handleHostBlur}
                placeholder={useSshTunnel ? "localhost or internal ClickHouse host (as reachable from bastion)" : "example.clickhouse.cloud or my-node.internal"}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
              {useSshTunnel ? (
                <p className="text-[11px] text-cyan-400/90 mt-1.5 flex items-start gap-1 leading-relaxed">
                  <span>ℹ️ <strong>Reachable from Bastion:</strong> When SSH tunneling is enabled, enter the ClickHouse host address <em>as reachable from the jump host</em> (often <code className="bg-zinc-800 text-zinc-200 px-1 py-0.5 rounded font-mono">localhost</code> or an internal VPC hostname/IP, not necessarily reachable directly from your browser).</span>
                </p>
              ) : (
                (host.trim().toLowerCase() === 'localhost' || host.trim() === '127.0.0.1') && (
                  <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1">
                    <span>💡 In this cloud runtime, &apos;localhost&apos; points to the container. Use a public URL/tunnel or ClickHouse Cloud for live instances.</span>
                  </p>
                )
              )}
            </div>

            {/* Port */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Port</label>
              <input
                id="input-port"
                type="number"
                required
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Username */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
                <span>Username</span>
              </label>
              <input
                id="input-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="default"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Password */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Password</span>
              </label>
              <input
                id="input-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="(optional for local default)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* Database */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-zinc-400" />
                <span>Database Name</span>
              </label>
              <input
                id="input-database"
                type="text"
                required
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="default"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
              />
            </div>

            {/* SSH Tunnel Configuration Section (when enabled) */}
            {useSshTunnel && (
              <div className="sm:col-span-12 p-4 sm:p-5 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-4 animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-cyan-500/20 pb-3 gap-2">
                  <div className="flex items-center gap-2 text-cyan-200 font-semibold text-sm">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    <span>SSH Bastion / Jump Host Details</span>
                  </div>
                  <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs self-start sm:self-auto">
                    <button
                      type="button"
                      id="btn-ssh-auth-password"
                      onClick={() => setSshAuthMethod('password')}
                      className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                        sshAuthMethod === 'password'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Password Auth
                    </button>
                    <button
                      type="button"
                      id="btn-ssh-auth-key"
                      onClick={() => setSshAuthMethod('privateKey')}
                      className={`px-3 py-1 rounded font-medium transition cursor-pointer ${
                        sshAuthMethod === 'privateKey'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Private Key (PEM)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                  {/* Bastion Host */}
                  <div className="sm:col-span-8">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Bastion SSH Host</span>
                        <span className="text-rose-400 text-xs">*</span>
                      </label>
                      {sshHostCorrectedNotice && (
                        <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono animate-in fade-in">
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>{sshHostCorrectedNotice}</span>
                        </span>
                      )}
                    </div>
                    <input
                      id="input-ssh-host"
                      type="text"
                      value={sshHost}
                      onChange={handleSshHostChange}
                      onPaste={handleSshHostPaste}
                      onBlur={handleSshHostBlur}
                      placeholder="bastion.example.com or 198.51.100.1"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                    />
                  </div>

                  {/* Bastion Port */}
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      <span>SSH Port</span>
                    </label>
                    <input
                      id="input-ssh-port"
                      type="number"
                      value={sshPort}
                      onChange={(e) => setSshPort(Number(e.target.value))}
                      placeholder="22"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                    />
                  </div>

                  {/* Bastion Username */}
                  <div className="sm:col-span-12">
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
                      <span>SSH Username</span>
                      <span className="text-rose-400 text-xs">*</span>
                    </label>
                    <input
                      id="input-ssh-username"
                      type="text"
                      value={sshUsername}
                      onChange={(e) => setSshUsername(e.target.value)}
                      placeholder="ubuntu, ec2-user, or bastion username"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                    />
                  </div>

                  {/* Auth Method Secrets */}
                  {sshAuthMethod === 'password' ? (
                    <div className="sm:col-span-12">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>SSH Password</span>
                          <span className="text-rose-400 text-xs">*</span>
                        </label>
                        <span className="text-[11px] text-zinc-500 font-mono">sessionStorage tab-scoped</span>
                      </div>
                      <div className="relative">
                        <input
                          id="input-ssh-password"
                          type={showSshPassword ? 'text' : 'password'}
                          value={sshPassword}
                          onChange={(e) => setSshPassword(e.target.value)}
                          placeholder="Enter bastion SSH password"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-3.5 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSshPassword(!showSshPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                        >
                          {showSshPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="sm:col-span-12">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                            <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                            <span>SSH Private Key (OpenSSH or RSA PEM)</span>
                            <span className="text-rose-400 text-xs">*</span>
                          </label>
                          <span className="text-[11px] text-zinc-500 font-mono">sessionStorage tab-scoped</span>
                        </div>
                        <textarea
                          id="input-ssh-private-key"
                          rows={4}
                          value={sshPrivateKey}
                          onChange={(e) => setSshPrivateKey(e.target.value)}
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                        />
                      </div>
                      <div className="sm:col-span-12">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Key Passphrase (optional, if key is encrypted)</span>
                          </label>
                          <span className="text-[11px] text-zinc-500 font-mono">sessionStorage tab-scoped</span>
                        </div>
                        <div className="relative">
                          <input
                            id="input-ssh-passphrase"
                            type={showSshPassphrase ? 'text' : 'password'}
                            value={sshPrivateKeyPassphrase}
                            onChange={(e) => setSshPrivateKeyPassphrase(e.target.value)}
                            placeholder="Passphrase to decrypt private key"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-3.5 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSshPassphrase(!showSshPassphrase)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                          >
                            {showSshPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* SSH Host Key Fingerprint (Pinned Key / MITM Protection) */}
                  <div className="sm:col-span-12">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Bastion SSH Host Key Fingerprint (Recommended for MITM Protection)</span>
                      </label>
                      <span className="text-[11px] text-zinc-500 font-mono">OpenSSH SHA256 / MD5 / public key</span>
                    </div>
                    <div className="relative">
                      <input
                        id="input-ssh-host-key-fingerprint"
                        type="text"
                        value={sshHostKeyFingerprint}
                        onChange={(e) => setSshHostKeyFingerprint(e.target.value)}
                        placeholder="e.g. SHA256:RXm/ruZ0eTzRXKwi1AQEDynB0VgHQ2ac9KPSFdf/YnA or ssh-ed25519..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                      />
                      {sshHostKeyFingerprint && (
                        <button
                          type="button"
                          onClick={() => setSshHostKeyFingerprint('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs px-1.5 py-0.5 rounded cursor-pointer"
                          title="Clear Fingerprint"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                      Enter the bastion&apos;s SHA256 base64 fingerprint, MD5 hex, or public key. When set, Yachiru cryptographically verifies the server during SSH handshake and immediately aborts if the key does not match (MITM protection).
                    </p>
                  </div>

                  {/* SSH Host Key Verification Security Status Notice */}
                  <div className="sm:col-span-12 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-zinc-200 font-semibold text-xs">
                        <Shield className={`w-4 h-4 shrink-0 ${sshHostKeyFingerprint.trim() ? 'text-emerald-400' : 'text-amber-400'}`} />
                        <span>Bastion Host Key Verification Status</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                        sshHostKeyFingerprint.trim()
                          ? testResult?.pinMatches
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {sshHostKeyFingerprint.trim()
                          ? testResult?.pinMatches
                            ? 'PINNED & VERIFIED'
                            : 'PINNED'
                          : 'UNVERIFIED (no pin)'}
                      </span>
                    </div>
                    <p className="leading-relaxed text-zinc-400">
                      {sshHostKeyFingerprint.trim() ? (
                        testResult?.pinMatches ? (
                          <>Pinned host key verified: The remote bastion presented a matching host key during handshake.</>
                        ) : (
                          <>Host key is pinned. Click <strong>Test Connection</strong> below to verify during SSH handshake.</>
                        )
                      ) : (
                        <>Unverified connection (no pin). Click <strong>Test Connection</strong> below to inspect the bastion&apos;s cryptographic host key and pin it with 1 click.</>
                      )}
                    </p>
                    <div className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/80 flex flex-wrap gap-x-4 gap-y-1">
                      <span>🔒 <strong>Ephemeral Credentials:</strong> SSH keys and passwords are held in session memory only and are never written to disk.</span>
                      <span>⚡ <strong>Dynamic Forwarding:</strong> Forwarded connections are bound to an OS-assigned ephemeral loopback port and torn down when the request completes.</span>
                    </div>
                  </div>

                  {/* SSH Validation Error Alert */}
                  {sshValidationError && (
                    <div className="sm:col-span-12 p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{sshValidationError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Yachiru API Key (Shown only when server requires authentication via YACHIRU_API_KEY) */}
            {apiKeyRequired && (
              <div className="sm:col-span-12 p-3.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    <span>Yachiru Server API Key</span>
                    <span className="text-amber-400 text-xs">*</span>
                  </label>
                  <span className="text-[11px] text-amber-400/80 font-mono">YACHIRU_API_KEY enforced</span>
                </div>
                <div className="relative">
                  <input
                    id="input-yachiru-api-key"
                    type={showYachiruApiKey ? 'text' : 'password'}
                    value={yachiruApiKey}
                    onChange={(e) => setYachiruApiKey(e.target.value)}
                    placeholder="Enter 32-byte hex key configured in server environment"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-3.5 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowYachiruApiKey(!showYachiruApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                    title={showYachiruApiKey ? 'Hide Key' : 'Show Key'}
                  >
                    {showYachiruApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                  This server requires API key authentication. The key is attached as a Bearer token and saved in <span className="text-zinc-300 font-mono">sessionStorage</span> for this tab.
                </p>
              </div>
            )}

            {/* Read-Only User Setup SQL Generator link */}
            <div className="sm:col-span-12 flex items-center justify-between pt-0.5">
              <button
                type="button"
                id="btn-open-user-setup-modal"
                onClick={() => setIsSetupModalOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer hover:underline"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Don&apos;t have a read-only ClickHouse user yet? Generate setup SQL &rarr;</span>
              </button>
            </div>
          </div>

          {/* AI Narrative Configuration Box (Directly visible in form) */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="toggle-ai-narrative"
                  checked={enableAiNarrative}
                  onChange={(e) => {
                    setEnableAiNarrative(e.target.checked);
                    if (e.target.checked) {
                      setApiKeyError(null);
                    }
                  }}
                  className="w-4 h-4 rounded border-zinc-700 text-rose-500 focus:ring-rose-500 focus:ring-offset-zinc-950 cursor-pointer"
                />
                <label htmlFor="toggle-ai-narrative" className="text-xs font-semibold text-zinc-200 cursor-pointer flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                  <span>Enable AI Executive Narrative</span>
                  <span className="text-[11px] font-normal text-zinc-400">(Optional)</span>
                </label>
              </div>

              <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${enableAiNarrative ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-500'}`}>
                {enableAiNarrative ? `${aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'claude' ? 'Claude' : 'Gemini'} AI Enabled` : 'Deterministic Only'}
              </span>
            </div>

            {/* If AI is enabled, user configures provider, API key, and model */}
            {enableAiNarrative && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-3 animate-in fade-in duration-150">
                {/* AI Provider Segmented Control */}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">AI Provider</label>
                  <div className="grid grid-cols-3 gap-2 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      id="btn-provider-gemini"
                      onClick={() => handleProviderToggle('gemini')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        aiProvider === 'gemini'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Gemini</span>
                    </button>

                    <button
                      type="button"
                      id="btn-provider-openai"
                      onClick={() => handleProviderToggle('openai')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        aiProvider === 'openai'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>OpenAI</span>
                    </button>

                    <button
                      type="button"
                      id="btn-provider-claude"
                      onClick={() => handleProviderToggle('claude')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        aiProvider === 'claude'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span>Claude</span>
                    </button>
                  </div>
                </div>

                {/* API Key Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                      <span>{aiProvider === 'openai' ? 'OpenAI API Key' : aiProvider === 'claude' ? 'Anthropic Claude API Key' : 'Google Gemini API Key'}</span>
                      <span className="text-rose-400 text-xs">*</span>
                    </label>

                    <a
                      href={
                        aiProvider === 'openai'
                          ? 'https://platform.openai.com/api-keys'
                          : aiProvider === 'claude'
                          ? 'https://console.anthropic.com/settings/keys'
                          : 'https://aistudio.google.com/app/apikey'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition underline decoration-rose-500/30"
                    >
                      <span>{aiProvider === 'openai' ? 'Get OpenAI Key' : aiProvider === 'claude' ? 'Get Anthropic Key' : 'Get Free Key at AI Studio'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="relative">
                    <input
                      ref={apiKeyInputRef}
                      id={aiProvider === 'openai' ? 'input-openai-api-key' : aiProvider === 'claude' ? 'input-claude-api-key' : 'input-gemini-api-key'}
                      type={showApiKey ? 'text' : 'password'}
                      value={aiProvider === 'openai' ? openaiApiKey : aiProvider === 'claude' ? claudeApiKey : geminiApiKey}
                      onChange={(e) => {
                        if (aiProvider === 'openai') {
                          setOpenaiApiKey(e.target.value);
                        } else if (aiProvider === 'claude') {
                          setClaudeApiKey(e.target.value);
                        } else {
                          setGeminiApiKey(e.target.value);
                        }
                        if (apiKeyError) setApiKeyError(null);
                      }}
                      placeholder={
                        aiProvider === 'openai'
                          ? 'Enter your OpenAI API Key (sk-...)'
                          : aiProvider === 'claude'
                          ? 'Enter your Anthropic Claude API Key (sk-ant-...)'
                          : 'Enter your Gemini API Key (AIzaSy...)'
                      }
                      className={`w-full bg-zinc-900 border ${
                        apiKeyError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-zinc-800'
                      } rounded-lg pl-3.5 pr-10 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono`}
                    />

                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                      title={showApiKey ? 'Hide Key' : 'Show Key'}
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {apiKeyError && (
                    <div className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{apiKeyError}</span>
                    </div>
                  )}

                  <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                    API key is provided directly in the UI (no .env setup required) and cached in <span className="text-zinc-300 font-mono">sessionStorage</span> for the current browser tab only. It is automatically cleared when this tab closes and is never saved to persistent disk.
                  </p>
                </div>

                {/* Model Selection Dropdown */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                  <span className="text-xs text-zinc-400 shrink-0">Model:</span>
                  <select
                    id="select-ai-model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 font-mono w-full sm:w-auto"
                  >
                    {AVAILABLE_AI_MODELS.filter((m) => m.provider === aiProvider).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.badge ? `(${m.badge})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Scan History & Trend Tracking Box */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="toggle-history-tracking"
                  checked={enableHistoryTracking}
                  onChange={(e) => {
                    setEnableHistoryTracking(e.target.checked);
                    if (e.target.checked) {
                      setHistoryValidationError(null);
                    }
                  }}
                  className="w-4 h-4 rounded border-zinc-700 text-rose-500 focus:ring-rose-500 focus:ring-offset-zinc-950 cursor-pointer"
                />
                <label htmlFor="toggle-history-tracking" className="text-xs font-semibold text-zinc-200 cursor-pointer flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-rose-400" />
                  <span>Enable Scan History &amp; Trend Tracking</span>
                  <span className="text-[11px] font-normal text-zinc-400">(In-Cluster Table)</span>
                </label>
              </div>

              <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${enableHistoryTracking ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-500'}`}>
                {enableHistoryTracking ? 'History Enabled' : 'No State Saved'}
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Persist scan scores and finding titles directly to a ClickHouse table inside your own cluster. Yachiru holds zero state in its own container.
            </p>

            {enableHistoryTracking && (
              <div className="pt-3 border-t border-zinc-800/80 space-y-3 animate-in fade-in duration-150">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      History Database
                    </label>
                    <input
                      type="text"
                      id="input-history-database"
                      value={historyDatabase}
                      onChange={(e) => setHistoryDatabase(e.target.value)}
                      placeholder={database || 'default'}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                    />
                    <span className="text-[10px] text-zinc-500">Leave blank to use connected database ({database || 'default'})</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      History Table Name
                    </label>
                    <input
                      type="text"
                      id="input-history-table-name"
                      value={historyTableName}
                      onChange={(e) => setHistoryTableName(e.target.value)}
                      placeholder="yachiru_scan_history"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                    />
                    <span className="text-[10px] text-zinc-500">Default: yachiru_scan_history</span>
                  </div>
                </div>

                <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-rose-400" />
                      <span>Dedicated Write Credentials (INSERT-only)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSetupModalOpen(true)}
                      className="text-[11px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                    >
                      Generate History Setup SQL &rarr;
                    </button>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Security requirement: Provide a dedicated user that holds <strong>only INSERT</strong> on the history table. Never provide your admin or scan credentials here.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Write Username <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        id="input-history-write-username"
                        value={historyWriteUsername}
                        onChange={(e) => {
                          setHistoryWriteUsername(e.target.value);
                          if (historyValidationError) setHistoryValidationError(null);
                        }}
                        placeholder="yachiru_history_writer"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1">
                        Write Password <span className="text-rose-400">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showHistoryWritePassword ? 'text' : 'password'}
                          id="input-history-write-password"
                          value={historyWritePassword}
                          onChange={(e) => {
                            setHistoryWritePassword(e.target.value);
                            if (historyValidationError) setHistoryValidationError(null);
                          }}
                          placeholder="Password for write user"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-3 pr-9 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowHistoryWritePassword(!showHistoryWritePassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1 transition cursor-pointer"
                          title={showHistoryWritePassword ? 'Hide Password' : 'Show Password'}
                        >
                          {showHistoryWritePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <span className="text-[10px] text-zinc-500">Stored in sessionStorage for current tab only; never saved to disk.</span>
                    </div>
                  </div>

                  {historyValidationError && (
                    <div className="text-xs text-rose-400 flex items-center gap-1.5 pt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{historyValidationError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Advanced Tunables Toggle */}
          <div className="pt-1">
            <button
              type="button"
              id="btn-toggle-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-500" />
              <span>{showAdvanced ? 'Hide Additional Threshold Tunables' : 'Show Additional Threshold Tunables'}</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 p-4 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Query Duration Flag Threshold (ms)
                    </label>
                    <input
                      type="number"
                      value={durationThreshold}
                      onChange={(e) => setDurationThreshold(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono"
                    />
                    <span className="text-[11px] text-zinc-500">Flags queries exceeding this duration in query_log</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Query Memory Flag Threshold (MB)
                    </label>
                    <input
                      type="number"
                      value={memoryThresholdMB}
                      onChange={(e) => setMemoryThresholdMB(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono"
                    />
                    <span className="text-[11px] text-zinc-500">Flags analytical queries with high peak memory consumption</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Reminder Banner when AI is enabled but API Key is missing */}
          {apiKeyError && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 space-y-2.5 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-amber-300 block mb-0.5">Notice: Gemini API Key Required</span>
                  <p className="text-zinc-300 leading-relaxed">{apiKeyError}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setEnableAiNarrative(true);
                    setShowAdvanced(true);
                    apiKeyInputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  Enter API Key Now
                </button>

                <button
                  type="button"
                  onClick={() => validateAndProceed(false, true)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Continue Without AI (Deterministic Analysis)</span>
                </button>
              </div>
            </div>
          )}

          {/* Test Connection Result Alert */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-200 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="font-semibold">{testResult.message}</div>
                {testResult.hint && <div className="text-zinc-300 leading-relaxed text-[11px]">{testResult.hint}</div>}

                {testResult.serverHostKey && (
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 text-[11px] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="text-zinc-400 font-medium">
                        Bastion Host Key ({testResult.serverHostKey.type}):
                      </span>
                      {testResult.pinMatches ? (
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Pinned &amp; Verified</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSshHostKeyFingerprint(testResult.serverHostKey!.fingerprintSha256)}
                          className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-semibold text-xs transition cursor-pointer flex items-center gap-1"
                        >
                          <Shield className="w-3 h-3 text-cyan-400" />
                          <span>Pin Host Key</span>
                        </button>
                      )}
                    </div>
                    <div className="font-mono text-zinc-300 bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-zinc-800 break-all select-all text-[11px]">
                      {testResult.serverHostKey.fingerprintSha256}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action CTAs */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              id="btn-submit-scan"
              type="submit"
              disabled={isLoading || isTestingConnection}
              className="w-full sm:flex-1 py-3 px-6 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 shadow-lg shadow-rose-950/40 disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Executing Read-Only Audit...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Run Live Optimization Analysis</span>
                </>
              )}
            </button>

            <button
              id="btn-test-connection"
              type="button"
              disabled={isLoading || isTestingConnection}
              onClick={handleTestConnection}
              className="w-full sm:w-auto py-3 px-4 rounded-xl font-medium text-sm text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isTestingConnection ? (
                <>
                  <div className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              id="btn-demo-cluster"
              type="button"
              disabled={isLoading || isTestingConnection}
              onClick={() => validateAndProceed(true)}
              className="w-full sm:w-auto py-3 px-4 rounded-xl font-medium text-sm text-zinc-200 hover:text-white bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileCode2 className="w-4 h-4 text-amber-400" />
              <span>Demo Cluster</span>
            </button>
          </div>
        </form>
      </div>

      {/* Audit Capabilities Grid */}
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-rose-400 mb-1">Part Compaction & Health</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Surveils active parts count per table/partition, flagging unmerged micro-batching and insert throttling risks.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-amber-400 mb-1">ORDER BY & Sparse Indices</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Analyzes sorting keys for empty tuples, low-cardinality flags, and data skipping index coverage.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <div className="text-xs font-semibold text-emerald-400 mb-1">Query Log Pruning & Memory</div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Detects read amplification ratios, peak analytical query latencies, and Materialized View opportunities.
          </p>
        </div>
      </div>

      {/* ClickHouse Read-Only User Setup Modal */}
      <ClickHouseUserSetupModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        defaultDatabase={database.trim() || 'default'}
      />
    </div>
  );
};
