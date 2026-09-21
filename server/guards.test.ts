import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain JS module shared with the standalone service.
import { assertFetchable, BlockedError, isPrivateAddress } from './guards.mjs';

/** Stand-in for DNS, so the tests never depend on a real resolver. */
const resolvesTo = (...addresses: string[]) => async () =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('isPrivateAddress', () => {
  it('rejects loopback, private and link-local ranges', () => {
    for (const address of [
      '127.0.0.1', '127.1.2.3', '0.0.0.0',
      '10.0.0.5', '172.16.3.4', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', // cloud instance metadata
      '100.64.0.1', // carrier-grade NAT
      '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('sees through an IPv4-mapped IPv6 literal', () => {
    // ::ffff:127.0.0.1 is loopback wearing a different notation.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('ignores brackets and case', () => {
    expect(isPrivateAddress('[::1]')).toBe(true);
    expect(isPrivateAddress('FE80::1')).toBe(true);
  });
});

describe('assertFetchable', () => {
  const resolver = resolvesTo('93.184.216.34');

  it('accepts an ordinary https URL', async () => {
    const { url } = await assertFetchable('https://example.com/page', { resolver });
    expect(url.hostname).toBe('example.com');
  });

  it('rejects schemes that are not http or https', async () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com/x',
      'gopher://example.com/',
    ]) {
      await expect(assertFetchable(bad, { resolver })).rejects.toThrow(BlockedError);
    }
  });

  it('rejects malformed input', async () => {
    await expect(assertFetchable('not a url', { resolver })).rejects.toThrow(/valid URL/i);
  });

  it('rejects the machine it is running on', async () => {
    for (const bad of ['http://localhost/', 'http://localhost:8080/admin', 'http://127.0.0.1/']) {
      await expect(assertFetchable(bad, { resolver })).rejects.toThrow(BlockedError);
    }
  });

  it('rejects private network names', async () => {
    for (const bad of ['http://router.local/', 'http://db.internal/', 'http://nas.home.arpa/']) {
      await expect(assertFetchable(bad, { resolver })).rejects.toThrow(/private network name/i);
    }
  });

  it('rejects a literal private address without consulting DNS', async () => {
    const never = async () => {
      throw new Error('DNS should not have been consulted');
    };
    await expect(assertFetchable('http://192.168.0.1/', { resolver: never })).rejects.toThrow(
      /private or loopback/i,
    );
  });

  /*
   * The important one: a name that looks public but points somewhere private.
   * Checking the hostname alone would let this straight through to the cloud
   * metadata endpoint.
   */
  it('rejects a public name that resolves to a private address', async () => {
    await expect(
      assertFetchable('http://sneaky.example.com/', { resolver: resolvesTo('169.254.169.254') }),
    ).rejects.toThrow(/resolves to a private/i);
  });

  it('rejects a name that resolves to both a public and a private address', async () => {
    // Accepting the first public answer would leave the private one reachable.
    await expect(
      assertFetchable('http://mixed.example.com/', { resolver: resolvesTo('8.8.8.8', '10.0.0.1') }),
    ).rejects.toThrow(/resolves to a private/i);
  });

  it('reports a name that does not resolve', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertFetchable('https://nope.example/', { resolver: failing })).rejects.toThrow(
      /could not resolve/i,
    );
  });
});
