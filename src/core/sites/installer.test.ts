// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isFromAppFrame } from './installer';

const FRAME = { name: 'the frame' };
const EXPECTED = {
  appId: 'app-7f31c2a4b901',
  appOrigin: 'https://app-7f31c2a4b901.palm.example',
  frame: FRAME,
};

const message = (overrides: Partial<{ origin: string; source: unknown; data: unknown }> = {}) => ({
  origin: EXPECTED.appOrigin,
  source: FRAME,
  data: { type: 'palm.installer.ready', appId: EXPECTED.appId },
  ...overrides,
});

describe('isFromAppFrame', () => {
  it('accepts the frame it opened', () => {
    expect(isFromAppFrame(message(), EXPECTED)).toBe(true);
  });

  it('rejects another origin', () => {
    expect(isFromAppFrame(message({ origin: 'https://evil.test' }), EXPECTED)).toBe(false);
  });

  it('rejects an origin that merely starts with the expected one', () => {
    // The classic way to get an origin check wrong. A prefix match would
    // accept this and hand the archive to somebody else's server.
    expect(
      isFromAppFrame(
        message({ origin: 'https://app-7f31c2a4b901.palm.example.evil.test' }),
        EXPECTED,
      ),
    ).toBe(false);
  });

  it('rejects another application origin', () => {
    expect(
      isFromAppFrame(message({ origin: 'https://app-9b02de114c27.palm.example' }), EXPECTED),
    ).toBe(false);
  });

  it('rejects a message from a different window on the right origin', () => {
    // Same origin is not enough: a popup the application opened would have it.
    expect(isFromAppFrame(message({ source: { other: true } }), EXPECTED)).toBe(false);
  });

  it('rejects a mismatched application id', () => {
    expect(
      isFromAppFrame(
        message({ data: { type: 'palm.installer.ready', appId: 'app-000000000000' } }),
        EXPECTED,
      ),
    ).toBe(false);
  });

  it('rejects message types outside the installer protocol', () => {
    expect(isFromAppFrame(message({ data: { type: 'palm.bridge.request' } }), EXPECTED)).toBe(false);
    expect(isFromAppFrame(message({ data: { type: 'anything' } }), EXPECTED)).toBe(false);
  });

  it('rejects payloads that are not objects', () => {
    for (const data of [null, undefined, 'palm.installer.ready', 42, []]) {
      expect(isFromAppFrame(message({ data }), EXPECTED)).toBe(false);
    }
  });

  it('accepts a protocol message that carries no application id', () => {
    expect(isFromAppFrame(message({ data: { type: 'palm.installer.result' } }), EXPECTED)).toBe(true);
  });
});
