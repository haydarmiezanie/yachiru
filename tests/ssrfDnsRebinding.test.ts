import { describe, it, expect, vi } from 'vitest';
import {
  assertSafeHost,
  resolveAndPinSafeHost,
  createPinnedDispatcher,
  isRestrictedIpAddress,
} from '../server/security/ssrfValidator.js';
import { fetch as undiciFetch } from 'undici';
import http from 'http';
import dns from 'dns/promises';

describe('P0-5: SSRF & DNS-Rebinding TOCTOU Defense', () => {
  describe('Private & Metadata IP Range Detection', () => {
    it('detects loopback addresses', () => {
      expect(isRestrictedIpAddress('127.0.0.1').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('127.0.1.10').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('::1').isRestricted).toBe(true);
    });

    it('detects RFC 1918 private IPv4 networks', () => {
      expect(isRestrictedIpAddress('10.0.0.1').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('10.254.1.5').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('172.16.0.1').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('172.31.255.255').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('192.168.0.1').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('192.168.100.200').isRestricted).toBe(true);
    });

    it('detects Cloud Metadata and Link-Local addresses (AWS, GCP, Azure)', () => {
      expect(isRestrictedIpAddress('169.254.169.254').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('169.254.0.1').isRestricted).toBe(true);
      expect(isRestrictedIpAddress('fe80::1').isRestricted).toBe(true);
    });

    it('identifies valid public IPv4/IPv6 addresses as non-private', () => {
      expect(isRestrictedIpAddress('8.8.8.8').isRestricted).toBe(false);
      expect(isRestrictedIpAddress('1.1.1.1').isRestricted).toBe(false);
      expect(isRestrictedIpAddress('151.101.1.140').isRestricted).toBe(false);
      expect(isRestrictedIpAddress('2606:4700:4700::1111').isRestricted).toBe(false);
    });
  });

  describe('Hostname SSRF Validation (assertSafeHost)', () => {
    it('rejects cloud metadata hostnames directly', async () => {
      await expect(assertSafeHost('metadata.google.internal')).rejects.toThrow(
        /Connection to internal, loopback, or cloud-metadata host|restricted network range/
      );
      await expect(assertSafeHost('169.254.169.254')).rejects.toThrow(
        /Connection to internal, loopback, or cloud-metadata host|restricted network range/
      );
    });

    it('rejects localhost and loopback targets', async () => {
      await expect(assertSafeHost('localhost')).rejects.toThrow(
        /Connection to internal, loopback, or cloud-metadata host|restricted network range/
      );
      await expect(assertSafeHost('127.0.0.1')).rejects.toThrow(
        /Connection to internal, loopback, or cloud-metadata host|restricted network range/
      );
    });

    it('allows demo cluster bypass if explicit flag is true', async () => {
      await expect(assertSafeHost('localhost', true)).resolves.toBeUndefined();
      await expect(assertSafeHost('127.0.0.1', true)).resolves.toBeUndefined();
    });
  });

  describe('DNS-Rebinding Mitigation & IP Pinning (resolveAndPinSafeHost & createPinnedDispatcher)', () => {
    it('resolves public host and returns pinned IP', async () => {
      // Mock DNS resolution with { all: true } array return signature
      const lookupSpy = vi.spyOn(dns, 'lookup').mockResolvedValueOnce([
        {
          address: '93.184.216.34',
          family: 4,
        },
      ] as any);

      const result = await resolveAndPinSafeHost('example.com');
      expect(result.safeHost).toBe('example.com');
      expect(result.pinnedIp).toBe('93.184.216.34');

      lookupSpy.mockRestore();
    });

    it('blocks DNS rebinding where host resolves to a private or metadata address', async () => {
      // Attacker attempts DNS rebinding: rebind.attacker.com resolves to 169.254.169.254
      const lookupSpy = vi.spyOn(dns, 'lookup').mockResolvedValueOnce([
        {
          address: '169.254.169.254',
          family: 4,
        },
      ] as any);

      await expect(resolveAndPinSafeHost('rebind.attacker.com')).rejects.toThrow(
        /restricted network range/
      );

      lookupSpy.mockRestore();
    });

    it('pins the connection to the validated IP, preventing TOCTOU re-resolution', async () => {
      // Spin up an ephemeral local HTTP server on port 0
      let receivedHostHeader = '';
      const server = http.createServer((req, res) => {
        receivedHostHeader = req.headers.host || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', pinned: true }));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;

      // Create a dispatcher pinned to 127.0.0.1
      const dispatcher = createPinnedDispatcher('127.0.0.1');

      try {
        // Request uses hostname 'external-cluster.example.org', but dispatcher forces connection to 127.0.0.1
        const resp = await undiciFetch(`http://external-cluster.example.org:${port}/api/test`, {
          method: 'GET',
          dispatcher,
        });

        expect(resp.ok).toBe(true);
        const body = (await resp.json()) as any;
        expect(body.pinned).toBe(true);

        // Crucial verification: Host header is preserved as 'external-cluster.example.org' for virtual hosts / TLS SNI
        expect(receivedHostHeader).toBe(`external-cluster.example.org:${port}`);
      } finally {
        await dispatcher.destroy();
        server.close();
      }
    });
  });
});
