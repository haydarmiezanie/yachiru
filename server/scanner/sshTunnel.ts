import net from 'net';
import { Client, ConnectConfig } from 'ssh2';
import { SshTunnelConfig } from '../../src/types/yachiru.js';
import { assertSafeHost } from '../security/ssrfValidator.js';
import { verifyOrRecordHostKey } from './hostKeyStore.js';
import { redactSshTunnel } from '../security/redaction.js';
import { logger } from '../logger.js';

export interface SshTunnelInstance {
  id: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshPort: number;
  close: () => Promise<void>;
}

const MAX_CONCURRENT_TUNNELS = 10;
const IDLE_TIMEOUT_MS = Number(process.env.SSH_TUNNEL_IDLE_TIMEOUT_MS) || 60000;

// Registry of currently active SSH tunnels
const activeTunnels = new Map<string, { tunnel: SshTunnelInstance; timer: NodeJS.Timeout }>();

export function getActiveTunnelCount(): number {
  return activeTunnels.size;
}

/**
 * Establishes an SSH tunnel using `ssh2`, opening a local TCP forwarding server
 * on an ephemeral 127.0.0.1 port that multiplexes traffic to the remote private ClickHouse endpoint.
 *
 * Security guarantees:
 * 1. Pre-flight SSRF check on SSH bastion host
 * 2. Strict Host Key Verification with Trust-On-First-Use (TOFU)
 * 3. Ephemeral local loopback binding (127.0.0.1 only)
 * 4. Concurrency pool limit to prevent Denial of Service
 * 5. Inactivity cleanup timer
 * 6. Explicit credential redaction in all log emissions
 */
export async function openSshTunnel(
  config: SshTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<SshTunnelInstance> {
  // 1. Check concurrency limit
  if (activeTunnels.size >= MAX_CONCURRENT_TUNNELS) {
    throw new Error(
      `Maximum concurrent SSH tunnels limit reached (${MAX_CONCURRENT_TUNNELS}). Please wait for active scans to complete or retry later.`
    );
  }

  const sshHost = config.host.trim();
  const sshPort = config.port || 22;

  // 2. SSRF Check on SSH host (Node makes a direct outbound connection to this server)
  await assertSafeHost(sshHost);

  const tunnelId = `ssh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  logger.info(
    {
      tunnelId,
      sshConfig: redactSshTunnel(config),
      remoteTarget: `${remoteHost}:${remotePort}`,
    },
    'Opening SSH tunnel to private destination'
  );

  return new Promise<SshTunnelInstance>((resolve, reject) => {
    let resolved = false;
    let localServer: net.Server | null = null;
    let sshClient: Client | null = null;
    const clientSockets = new Set<net.Socket>();
    let verificationError: Error | null = null;

    const cleanup = async () => {
      // Clear from active map
      const entry = activeTunnels.get(tunnelId);
      if (entry) {
        clearTimeout(entry.timer);
        activeTunnels.delete(tunnelId);
      }

      // Close client sockets
      for (const sock of clientSockets) {
        try {
          sock.destroy();
        } catch {}
      }
      clientSockets.clear();

      // Close local server
      if (localServer) {
        try {
          localServer.close();
        } catch {}
        localServer = null;
      }

      // Close SSH client
      if (sshClient) {
        try {
          sshClient.end();
          sshClient.destroy();
        } catch {}
        sshClient = null;
      }
    };

    // Connection timeout
    const connectTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`SSH connection to ${sshHost}:${sshPort} timed out after 15 seconds.`));
      }
    }, 15000);

    const client = new Client();
    sshClient = client;

    // Build ssh2 connection config
    const sshConnectOptions: ConnectConfig = {
      host: sshHost,
      port: sshPort,
      username: config.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      hostHash: 'sha256',
      hostVerifier: ((keyOrHash: string | Buffer, verify: (verified: boolean) => void) => {
        const keyHash = typeof keyOrHash === 'string' ? keyOrHash : Buffer.isBuffer(keyOrHash) ? keyOrHash.toString('hex') : String(keyOrHash);
        // TOFU host key verification (Return undefined so ssh2 waits for async verify callback)
        (async () => {
          try {
            const result = await verifyOrRecordHostKey(sshHost, sshPort, keyHash);
            if (result.action === 'mismatch') {
              verificationError = new Error(
                `SSH Host Key verification failed for ${sshHost}:${sshPort}. Expected stored fingerprint '${result.storedFingerprint}', but server presented '${keyHash}'. Possible Man-In-The-Middle (MITM) attack! An administrator must explicitly re-trust the key after verification.`
              );
              verify(false);
            } else {
              verify(true);
            }
          } catch (err: any) {
            verificationError = new Error(`Host key verification error: ${err?.message || err}`);
            verify(false);
          }
        })();
      }) as any,
    };

    if (config.authMethod === 'password') {
      sshConnectOptions.password = config.password;
    } else if (config.authMethod === 'privateKey') {
      sshConnectOptions.privateKey = config.privateKey;
      if (config.passphrase) {
        sshConnectOptions.passphrase = config.passphrase;
      }
    }

    client.on('error', (err: any) => {
      logger.warn(
        {
          tunnelId,
          sshHost,
          sshPort,
          err: err?.message || err,
          verificationErr: verificationError?.message,
        },
        'SSH client error occurred'
      );

      if (!resolved) {
        resolved = true;
        clearTimeout(connectTimer);
        cleanup();
        reject(verificationError || err);
      }
    });

    client.on('ready', () => {
      // SSH connection authenticated and ready!
      // Now start local TCP server on ephemeral port (127.0.0.1:0)
      const server = net.createServer((socket) => {
        clientSockets.add(socket);

        socket.on('close', () => {
          clientSockets.delete(socket);
        });

        socket.on('error', (err) => {
          clientSockets.delete(socket);
        });

        // Forward connection through SSH tunnel
        client.forwardOut(
          '127.0.0.1',
          socket.remotePort || 0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              logger.warn(
                { tunnelId, remoteHost, remotePort, err: err?.message },
                'Failed to forwardOut to remote target via SSH tunnel'
              );
              socket.destroy();
              return;
            }

            // Pipe TCP socket <-> SSH forwarding channel
            socket.pipe(stream);
            stream.pipe(socket);

            stream.on('error', () => {
              socket.destroy();
            });
            stream.on('close', () => {
              socket.end();
            });
          }
        );
      });

      localServer = server;

      server.listen(0, '127.0.0.1', () => {
        clearTimeout(connectTimer);
        const address = server.address();
        if (!address || typeof address === 'string') {
          resolved = true;
          cleanup();
          reject(new Error('Failed to obtain bound address for local SSH tunnel port forward.'));
          return;
        }

        const localPort = address.port;
        const localHost = '127.0.0.1';

        // Schedule idle timeout to automatically clean up abandoned tunnels
        const idleTimer = setTimeout(() => {
          logger.info({ tunnelId }, 'SSH tunnel reached idle timeout. Cleaning up.');
          cleanup();
        }, IDLE_TIMEOUT_MS);

        const instance: SshTunnelInstance = {
          id: tunnelId,
          localHost,
          localPort,
          remoteHost,
          remotePort,
          sshHost,
          sshPort,
          close: async () => {
            await cleanup();
          },
        };

        activeTunnels.set(tunnelId, { tunnel: instance, timer: idleTimer });
        resolved = true;

        logger.info(
          {
            tunnelId,
            localEndpoint: `${localHost}:${localPort}`,
            remoteTarget: `${remoteHost}:${remotePort}`,
          },
          'SSH tunnel successfully established'
        );

        resolve(instance);
      });

      server.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(connectTimer);
          cleanup();
          reject(err);
        }
      });
    });

    // Initiate SSH connection
    client.connect(sshConnectOptions);
  });
}
