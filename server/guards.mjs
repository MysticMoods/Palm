/**
 * Safety guards for the fetch service.
 *
 * A server that fetches arbitrary URLs on a client's behalf is a
 * server-side request forgery engine unless it is deliberately restrained.
 * Without these checks, anyone who can reach the proxy can use it to probe
 * the machine it runs on, the private network around it, and — on a cloud
 * host — the instance metadata endpoint that hands out credentials.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedError';
  }
}

/** Only these schemes are ever fetched. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames that always resolve to somewhere we refuse to go. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa'];

/** Parse an IPv4 address into its four octets, or null. */
function octets(address) {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

/**
 * True when an address belongs to a range that should never be reachable
 * through a public fetch service.
 */
export function isPrivateAddress(address) {
  const normalised = address.replace(/^\[|\]$/g, '').toLowerCase();

  const v4 = octets(normalised);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (isIP(normalised) === 6) {
    if (normalised === '::' || normalised === '::1') return true;
    if (normalised.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(normalised)) return true; // unique local
    // IPv4-mapped addresses smuggle a v4 target through a v6 literal.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return false;
}

/**
 * Validate a target URL and resolve it to an address we are willing to reach.
 *
 * Resolution happens here, not in the HTTP client, so that a hostname which
 * points at a private address is rejected before any connection is made.
 */
export async function assertFetchable(rawUrl, { resolver = lookup } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedError('That is not a valid URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedError(`Only http and https are fetched, not "${url.protocol}".`);
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new BlockedError('Refusing to fetch from the machine running this service.');
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new BlockedError('Refusing to fetch from a private network name.');
  }

  // A literal address needs no lookup, but still needs checking.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedError('Refusing to fetch from a private or loopback address.');
    }
    return { url, address: hostname };
  }

  let resolved;
  try {
    resolved = await resolver(hostname, { all: true });
  } catch {
    throw new BlockedError(`Could not resolve "${hostname}".`);
  }

  const addresses = (Array.isArray(resolved) ? resolved : [resolved]).map((entry) =>
    typeof entry === 'string' ? entry : entry.address,
  );
  if (addresses.length === 0) throw new BlockedError(`Could not resolve "${hostname}".`);

  // Every address must be acceptable: a name that resolves to both a public
  // and a private address must not be usable to reach the private one.
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedError('That name resolves to a private or loopback address.');
    }
  }

  return { url, address: addresses[0] };
}
