import { ScanTarget, SshTunnelConfig } from '../../src/types/yachiru.js';

/**
 * Sanitizes SSH tunnel configuration so passwords, private keys, and passphrases
 * are never exposed in log outputs or diagnostic dumps.
 */
export function redactSshTunnel(tunnel?: SshTunnelConfig | null): Partial<SshTunnelConfig> | undefined {
  if (!tunnel) return undefined;
  return {
    enabled: tunnel.enabled,
    host: tunnel.host,
    port: tunnel.port,
    username: tunnel.username,
    authMethod: tunnel.authMethod,
    password: undefined,
    privateKey: undefined,
    passphrase: undefined,
  };
}

/**
 * Sanitizes ScanTarget so passwords, API keys, and SSH credentials are never leaked.
 */
export function redactTarget(target: ScanTarget): Partial<ScanTarget> {
  if (!target) return {};
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: undefined,
    protocol: target.protocol,
    isDemoCluster: target.isDemoCluster,
    demoClusterId: target.demoClusterId,
    lookbackDays: target.lookbackDays,
    sshTunnel: redactSshTunnel(target.sshTunnel) as SshTunnelConfig | undefined,
  };
}

export const redactScanTarget = redactTarget;

const SECRET_KEY_PATTERNS = [
  /password/i,
  /passphrase/i,
  /private_?key/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /api_key/i,
  /credential/i,
  /auth/i,
];

/**
 * Recursively deep-redacts sensitive fields in arbitrary JSON/log objects.
 */
export function redactObjectSecrets<T = any>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObjectSecrets(item)) as any;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    const isSecretKey = SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSecretKey && typeof value === 'string' && value.length > 0) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObjectSecrets(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

