import { Client as SshClient, ClientChannel } from 'ssh2';
import net from 'net';

export interface SshTunnelConfig {
  sshHost: string;
  sshPort: number; // default 22
  sshUsername: string;
  sshAuthMethod: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string; // full PEM content
  sshPrivateKeyPassphrase?: string;
  targetHost: string; // the ClickHouse host, as reachable FROM the bastion
  targetPort: number; // the ClickHouse port, as reachable FROM the bastion
}

export interface OpenTunnelResult {
  localHost: string; // always '127.0.0.1'
  localPort: number; // OS-assigned free port
  close: () => Promise<void>;
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
          close: cleanup,
        });
      });
    });

    sshClient.on('error', (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!hasConnected) {
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
        // Explicitly accept host keys: this version does not verify bastion SSH host keys
        hostVerifier: () => true,
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
