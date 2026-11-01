import { Client as SshClient, ClientChannel } from 'ssh2';
import net from 'net';
import crypto from 'crypto';

export interface SshHostKeyInfo {
  type: string;
  fingerprintSha256: string; // e.g. "SHA256:..."
  fingerprintHexSha256: string; // 64 hex characters
  fingerprintMd5: string; // e.g. "aa:bb:cc:..."
  rawBase64: string; // base64 representation of wire public key
  authorizedKeyString: string; // e.g. "ssh-ed25519 AAAAC3..."
}

export interface SshTunnelConfig {
  sshHost: string;
  sshPort: number; // default 22
  sshUsername: string;
  sshAuthMethod: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string; // full PEM content
  sshPrivateKeyPassphrase?: string;
  sshHostKeyFingerprint?: string; // expected fingerprint (SHA256, MD5) or full public key
  strictHostKeyChecking?: boolean; // if true, reject when no expected fingerprint is provided
  targetHost: string; // the ClickHouse host, as reachable FROM the bastion
  targetPort: number; // the ClickHouse port, as reachable FROM the bastion
}

export interface OpenTunnelResult {
  localHost: string; // always '127.0.0.1'
  localPort: number; // OS-assigned free port
  serverHostKey?: SshHostKeyInfo;
  close: () => Promise<void>;
}

/**
 * Parses raw OpenSSH public key wire buffer (RFC 4253) and computes
 * standard SHA256 base64, SHA256 hex, and MD5 fingerprints.
 */
export function parseSshPublicKey(keyBuf: Buffer): SshHostKeyInfo {
  let type = 'unknown';
  try {
    if (keyBuf.length >= 4) {
      const typeLen = keyBuf.readUInt32BE(0);
      if (typeLen > 0 && 4 + typeLen <= keyBuf.length) {
        type = keyBuf.slice(4, 4 + typeLen).toString('utf-8');
      }
    }
  } catch {
    // fallback
  }

  const sha256Buf = crypto.createHash('sha256').update(keyBuf).digest();
  const sha256Base64 = sha256Buf.toString('base64').replace(/=+$/, '');
  const sha256Hex = sha256Buf.toString('hex').toLowerCase();

  const md5Hex = crypto.createHash('md5').update(keyBuf).digest('hex').toLowerCase();
  const md5Colon = md5Hex.match(/.{2}/g)?.join(':') || md5Hex;

  const rawBase64 = keyBuf.toString('base64');
  const authorizedKeyString = `${type} ${rawBase64}`;

  return {
    type,
    fingerprintSha256: `SHA256:${sha256Base64}`,
    fingerprintHexSha256: sha256Hex,
    fingerprintMd5: md5Colon,
    rawBase64,
    authorizedKeyString,
  };
}

/**
 * Checks if the server's public key matches an expected fingerprint or public key.
 * Supports:
 *  - OpenSSH SHA256 base64: "SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU" or without prefix
 *  - SHA256 hex: 64 hex characters
 *  - MD5 fingerprint: "MD5:aa:bb:cc:..." or "aa:bb:cc:..." or "aabbcc..."
 *  - Public key / known_hosts line: "ssh-ed25519 AAAAC3..." or "bastion.example.com ssh-ed25519 AAAAC3..."
 */
export function matchesExpectedHostKey(expectedInput: string, info: SshHostKeyInfo): boolean {
  if (!expectedInput || typeof expectedInput !== 'string') return false;
  const trimmed = expectedInput.trim();
  if (!trimmed) return false;

  // 1. SHA256 base64 fingerprint check (case-sensitive base64)
  const cleanExpected = trimmed.replace(/^SHA256:/i, '').replace(/=+$/, '');
  const cleanActual = info.fingerprintSha256.replace(/^SHA256:/i, '').replace(/=+$/, '');
  if (cleanExpected === cleanActual) return true;

  // 2. SHA256 hex check (64 hex characters)
  const cleanHex = trimmed.replace(/^SHA256:/i, '').toLowerCase();
  if (cleanHex === info.fingerprintHexSha256) return true;

  // 3. MD5 fingerprint check (with or without colons, with or without 'MD5:' prefix)
  const cleanMd5Expected = trimmed.replace(/^MD5:/i, '').replace(/[:\s-]/g, '').toLowerCase();
  const cleanMd5Actual = info.fingerprintMd5.replace(/[:\s-]/g, '').toLowerCase();
  if (cleanMd5Expected === cleanMd5Actual && cleanMd5Expected.length === 32) return true;

  // 4. Public key wire format (matches full public key or known_hosts line)
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    if (part === info.rawBase64) return true;
  }

  return false;
}

/**
 * Resolves whether strict SSH host key checking is in effect.
 *
 * Server operator policy forms a non-negotiable floor:
 * - If YACHIRU_SSH_STRICT_HOST_KEY is 'true' -> strict
 * - If YACHIRU_SSH_STRICT_HOST_KEY is 'false' -> non-strict (permissive)
 * - If unset: In production (NODE_ENV === 'production'), defaults to strict (true).
 *   In non-production, defaults to permissive (false).
 * - Client configuration may make the policy stricter (strictHostKeyChecking: true),
 *   but can NEVER lower or bypass an active server policy floor.
 */
export function isStrictHostKeyChecking(config?: { strictHostKeyChecking?: boolean } | null): boolean {
  const envVal = process.env.YACHIRU_SSH_STRICT_HOST_KEY?.trim().toLowerCase();
  let serverFloor: boolean;

  if (envVal === 'true') {
    serverFloor = true;
  } else if (envVal === 'false') {
    serverFloor = false;
  } else {
    // Option A (Maintainer decision): In production, default is strict (true); non-production is permissive (false)
    serverFloor = process.env.NODE_ENV === 'production';
  }

  return serverFloor || config?.strictHostKeyChecking === true;
}

export async function openSshTunnel(config: SshTunnelConfig): Promise<OpenTunnelResult> {
  const sshClient = new SshClient();
  const activeSockets = new Set<net.Socket>();
  const activeStreams = new Set<ClientChannel>();
  let server: net.Server | null = null;
  let isClosed = false;

  const cleanup = async () => {
    if (isClosed) return;
    isClosed = true;

    // 1. Stop the local server from accepting new connections
    if (server) {
      await new Promise<void>((resolve) => {
        try {
          server?.close(() => resolve());
          // Fallback if server close callback is delayed
          setTimeout(resolve, 300);
        } catch {
          resolve();
        }
      });
      server = null;
    }

    // 2. End any in-flight forwarded streams and client sockets
    for (const stream of activeStreams) {
      try {
        stream.destroy();
      } catch {
        // Ignore destroy error
      }
    }
    activeStreams.clear();

    for (const sock of activeSockets) {
      try {
        sock.destroy();
      } catch {
        // Ignore destroy error
      }
    }
    activeSockets.clear();

    // 3. End the SSH client connection
    try {
      sshClient.end();
      setTimeout(() => {
        try {
          sshClient.destroy();
        } catch {
          // Ignore destroy error
        }
      }, 300);
    } catch {
      // Ignore
    }
  };

  return new Promise<OpenTunnelResult>((resolve, reject) => {
    let hasConnected = false;
    let didReject = false;
    let serverHostKey: SshHostKeyInfo | undefined;
    let hostVerificationError: Error | null = null;

    const safeReject = async (err: Error) => {
      if (didReject) return;
      didReject = true;
      await cleanup();
      reject(err);
    };

    sshClient.on('ready', () => {
      hasConnected = true;

      // Create local TCP server listening on 127.0.0.1:0 (ephemeral port)
      server = net.createServer((localSocket) => {
        if (isClosed) {
          localSocket.destroy();
          return;
        }

        activeSockets.add(localSocket);

        const srcIp = localSocket.remoteAddress || '127.0.0.1';
        const srcPort = localSocket.remotePort || 0;

        sshClient.forwardOut(
          srcIp,
          srcPort,
          config.targetHost,
          config.targetPort,
          (err, stream) => {
            if (err) {
              activeSockets.delete(localSocket);
              localSocket.destroy(err);
              return;
            }

            activeStreams.add(stream);

            localSocket.on('error', () => {
              try {
                stream.destroy();
              } catch {
                // Ignore
              }
            });

            stream.on('error', () => {
              try {
                localSocket.destroy();
              } catch {
                // Ignore
              }
            });

            localSocket.on('close', () => {
              activeSockets.delete(localSocket);
              try {
                stream.destroy();
              } catch {
                // Ignore
              }
            });

            stream.on('close', () => {
              activeStreams.delete(stream);
              try {
                localSocket.destroy();
              } catch {
                // Ignore
              }
            });

            // Pipe bidirectionally
            localSocket.pipe(stream);
            stream.pipe(localSocket);
          }
        );
      });

      server.on('error', (err) => {
        safeReject(err instanceof Error ? err : new Error(String(err)));
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server?.address() as net.AddressInfo | null;
        if (!address || typeof address.port !== 'number') {
          safeReject(new Error('Failed to obtain ephemeral port for SSH local tunnel listener'));
          return;
        }

        resolve({
          localHost: '127.0.0.1',
          localPort: address.port,
          serverHostKey,
          close: cleanup,
        });
      });
    });

    sshClient.on('error', (err) => {
      if (!hasConnected) {
        if (hostVerificationError) {
          safeReject(hostVerificationError);
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        safeReject(new Error(`SSH tunnel connection error (${config.sshHost}:${config.sshPort || 22}): ${msg}`));
      } else {
        // Connection died mid-session: trigger cleanup so local sockets fail quickly
        cleanup();
      }
    });

    sshClient.on('timeout', () => {
      safeReject(new Error(`SSH connection to ${config.sshHost}:${config.sshPort || 22} timed out (readyTimeout exceeded)`));
    });

    sshClient.on('close', () => {
      if (!hasConnected) {
        if (hostVerificationError) {
          safeReject(hostVerificationError);
          return;
        }
        safeReject(new Error(`SSH connection to ${config.sshHost}:${config.sshPort || 22} closed before ready`));
      } else {
        cleanup();
      }
    });

    // Prepare connection options
    try {
      const connectOptions: Record<string, any> = {
        host: config.sshHost,
        port: config.sshPort || 22,
        username: config.sshUsername,
        readyTimeout: 10_000,
        hostVerifier: (keyBuf: Buffer, verify: (permitted: boolean) => void) => {
          try {
            const info = parseSshPublicKey(keyBuf);
            serverHostKey = info;
            const isStrict = isStrictHostKeyChecking(config);
            const expected = config.sshHostKeyFingerprint?.trim();

            if (expected) {
              const match = matchesExpectedHostKey(expected, info);
              if (!match) {
                hostVerificationError = new Error(
                  `SSH host key verification failed for ${config.sshHost}:${config.sshPort || 22}. Remote server presented ${info.type} key with fingerprint ${info.fingerprintSha256} (MD5: ${info.fingerprintMd5}), which does NOT match expected fingerprint "${expected}". Possible Man-In-The-Middle (MITM) attack!`
                );
                return verify(false);
              }
              return verify(true);
            }

            if (isStrict) {
              hostVerificationError = new Error(
                `SSH host key verification failed: Strict host key checking is enabled (YACHIRU_SSH_STRICT_HOST_KEY=true), but no expected host key fingerprint was configured for ${config.sshHost}:${config.sshPort || 22}. Remote server presented ${info.type} key with fingerprint ${info.fingerprintSha256}.`
              );
              return verify(false);
            }

            console.warn(
              `[Yachiru SSH] Connecting to bastion ${config.sshHost}:${config.sshPort || 22} without host key verification. Server presented ${info.type} key with fingerprint ${info.fingerprintSha256}. Pin this fingerprint in connection settings for MITM protection.`
            );
            return verify(true);
          } catch (err) {
            hostVerificationError = err instanceof Error ? err : new Error(String(err));
            return verify(false);
          }
        },
      };

      if (config.sshAuthMethod === 'privateKey') {
        connectOptions.privateKey = config.sshPrivateKey;
        if (config.sshPrivateKeyPassphrase) {
          connectOptions.passphrase = config.sshPrivateKeyPassphrase;
        }
      } else {
        connectOptions.password = config.sshPassword;
      }

      sshClient.connect(connectOptions);
    } catch (err) {
      safeReject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
