import dns from 'dns/promises';
import net from 'net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

const RESTRICTED_RANGES = new Set([
  'private',
  'loopback',
  'linkLocal',
  'uniqueLocal',
  'reserved',
  'unspecified',
  'multicast',
  'broadcast',
  'carrierGradeNat',
]);

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'localhost',
]);

/**
 * Extracts and normalizes the raw hostname or IP, stripping protocol prefixes,
 * subpaths, and enclosing brackets/ports.
 */
export function extractCleanHost(rawHost: string): string {
  if (!rawHost || typeof rawHost !== 'string') return '';
  let clean = rawHost.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();

  // Handle [ipv6]:port or [ipv6]
  if (clean.startsWith('[')) {
    const end = clean.indexOf(']');
    if (end !== -1) {
      return clean.substring(1, end);
    }
  }

  // If not pure IPv6 and contains a single port colon (e.g. host.domain.com:8123 or 1.2.3.4:8123)
  if (clean.includes(':')) {
    const colonCount = (clean.match(/:/g) || []).length;
    if (colonCount === 1) {
      clean = clean.split(':')[0].trim();
    }
  }

  return clean;
}

/**
 * Evaluates whether a given IP address string falls within private, loopback,
 * link-local, or cloud-metadata network ranges.
 */
export function isRestrictedIpAddress(addrStr: string): { isRestricted: boolean; range?: string } {
  try {
    let parsed = ipaddr.parse(addrStr);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    const range = parsed.range();
    if (RESTRICTED_RANGES.has(range)) {
      return { isRestricted: true, range };
    }
    return { isRestricted: false, range };
  } catch {
    // If not a parseable IP string, treat as non-IP (requires DNS resolution)
    return { isRestricted: false };
  }
}

export interface HostSafetyCheckResult {
  safe: boolean;
  cleanHost: string;
  error?: string;
}

/**
 * Synchronously checks if a hostname or literal IP violates SSRF restrictions:
 * - Empty host
 * - Blocked cloud metadata hosts (metadata.google.internal, instance-data, etc.)
 * - Local/internal host domains (.internal, .local, .localhost)
 * - Private/loopback/link-local IP addresses (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, etc.)
 *
 * Shared between Zod schema validation (scanSchemas.ts) and network pre-flight assertions.
 */
export function checkStaticHostSafety(rawHost: string, isDemoCluster = false): HostSafetyCheckResult {
  if (isDemoCluster) {
    return { safe: true, cleanHost: extractCleanHost(rawHost) };
  }

  if (process.env.ALLOW_INTERNAL_CLUSTERS === 'true') {
    return { safe: true, cleanHost: extractCleanHost(rawHost) };
  }

  const cleanHost = extractCleanHost(rawHost);
  if (!cleanHost) {
    return { safe: false, cleanHost: '', error: 'Target host is required' };
  }

  const lowerHost = cleanHost.toLowerCase();

  // 1. Block well-known cloud metadata and internal hostnames
  if (
    BLOCKED_HOSTNAMES.has(lowerHost) ||
    lowerHost.endsWith('.internal') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.localhost')
  ) {
    return {
      safe: false,
      cleanHost,
      error: `Connection to internal, loopback, or cloud-metadata host '${cleanHost}' is not permitted. Please specify a public ClickHouse cluster or select a Demo Cluster.`,
    };
  }

  // 2. Check literal IP address range
  const { isRestricted, range } = isRestrictedIpAddress(cleanHost);
  if (isRestricted) {
    return {
      safe: false,
      cleanHost,
      error: `Target IP '${cleanHost}' belongs to restricted network range (${range || 'private'}). Connecting to internal VPC, loopback, or metadata services is blocked for security.`,
    };
  }

  return { safe: true, cleanHost };
}

export interface PinnedHostResult {
  safeHost: string;
  pinnedIp: string;
  allAddresses: string[];
}

/**
 * Resolves the host, verifies that neither the host nor ANY resolved IP is in a restricted
 * network range (SSRF check), and returns the validated host and pinned IP.
 *
 * This prevents DNS-rebinding TOCTOU attacks by enabling the caller to pin the connection
 * directly to the validated IP.
 */
export async function resolveAndPinSafeHost(rawHost: string, isDemoCluster = false): Promise<PinnedHostResult> {
  const staticCheck = checkStaticHostSafety(rawHost, isDemoCluster);
  if (!staticCheck.safe) {
    throw new Error(staticCheck.error || `Refusing to connect to restricted host or domain: ${staticCheck.cleanHost}`);
  }

  const cleanHost = staticCheck.cleanHost;

  if (isDemoCluster || process.env.ALLOW_INTERNAL_CLUSTERS === 'true') {
    return { safeHost: cleanHost, pinnedIp: cleanHost, allAddresses: [cleanHost] };
  }

  // Resolve DNS addresses (or check literal IP)
  let addresses: string[] = [];
  if (net.isIP(cleanHost)) {
    addresses = [cleanHost];
  } else {
    try {
      const lookupResults = await dns.lookup(cleanHost, { all: true });
      addresses = lookupResults.map((a) => a.address);
    } catch (err: any) {
      throw new Error(`Could not resolve host '${cleanHost}': ${err?.message || 'DNS resolution failed'}`);
    }
  }

  if (!addresses.length) {
    throw new Error(`No network addresses resolved for host: ${cleanHost}`);
  }

  // Inspect every resolved IP address
  for (const addr of addresses) {
    const { isRestricted, range } = isRestrictedIpAddress(addr);
    if (isRestricted) {
      throw new Error(
        `Refusing to connect to restricted network range: ${addr} (${range || 'forbidden'}). Internal, private, and metadata network access is strictly prohibited.`
      );
    }
  }

  return {
    safeHost: cleanHost,
    pinnedIp: addresses[0],
    allAddresses: addresses,
  };
}

/**
 * Asserts that the provided target host does not resolve to loopback, private VPC,
 * link-local (e.g., GCP metadata 169.254.169.254), or reserved networks.
 *
 * Performs static host safety check first, followed by full asynchronous DNS resolution.
 * Throws an Error if connection is refused due to SSRF risk.
 */
export async function assertSafeHost(rawHost: string, isDemoCluster = false): Promise<void> {
  await resolveAndPinSafeHost(rawHost, isDemoCluster);
}

/**
 * Creates an undici Agent that forces all TCP connections to resolve to the pinned IP.
 *
 * This guarantees immune defense against DNS-rebinding Time-Of-Check to Time-Of-Use (TOCTOU)
 * attacks: the underlying socket connects strictly to the pre-validated IP, while retaining
 * the original Host header and TLS SNI (Server Name Indication) for valid certificate verification.
 */
export function createPinnedDispatcher(pinnedIp: string): Agent {
  const family = net.isIPv6(pinnedIp) ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (_hostname: string, options: any, callback: any) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        if (options && (options as any).all) {
          callback(null, [{ address: pinnedIp, family }]);
        } else {
          callback(null, pinnedIp, family);
        }
      },
    },
  });
}

