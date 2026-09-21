// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BRIDGE_LIMITS, validate } from './bridge-host';
import type { BridgeExpectation } from './bridge-host';
import { APP_PERMISSIONS } from './types';

const FRAME = { id: 'the app frame' };

const expectation = (granted: string[] = [...APP_PERMISSIONS]): BridgeExpectation => ({
  appId: 'app-7f31c2a4b901',
  appOrigin: 'https://app-7f31c2a4b901.palm.example',
  frame: FRAME,
  granted: granted as BridgeExpectation['granted'],
});

const envelope = (request: string, payload: unknown, overrides: Record<string, unknown> = {}) => ({
  origin: 'https://app-7f31c2a4b901.palm.example',
  source: FRAME,
  data: { type: 'palm.bridge.request', requestId: 'b1', request, payload },
  ...overrides,
});

describe('validate — who is asking', () => {
  it('accepts a well-formed request from the application frame', () => {
    const result = validate(envelope('notification', { title: 'Saved' }), expectation());
    expect(result).toMatchObject({ ok: true, request: 'notification', permission: 'NOTIFICATIONS' });
  });

  it('ignores another origin entirely, rather than replying', () => {
    // Replying would confirm to an unknown sender that something is listening.
    const result = validate(
      envelope('notification', { title: 'x' }, { origin: 'https://evil.test' }),
      expectation(),
    );
    expect(result).toEqual({ ok: false, kind: 'ignore' });
  });

  it('ignores an origin that only shares a prefix with ours', () => {
    const result = validate(
      envelope('notification', { title: 'x' }, {
        origin: 'https://app-7f31c2a4b901.palm.example.evil.test',
      }),
      expectation(),
    );
    expect(result).toEqual({ ok: false, kind: 'ignore' });
  });

  it('ignores another application on a sibling origin', () => {
    const result = validate(
      envelope('notification', { title: 'x' }, {
        origin: 'https://app-9b02de114c27.palm.example',
      }),
      expectation(),
    );
    expect(result).toEqual({ ok: false, kind: 'ignore' });
  });

  it('ignores a different window on the right origin', () => {
    const result = validate(
      envelope('notification', { title: 'x' }, { source: { other: true } }),
      expectation(),
    );
    expect(result).toEqual({ ok: false, kind: 'ignore' });
  });

  it('ignores messages that are not bridge requests', () => {
    for (const data of [null, 'hello', 42, [], { type: 'other' }, { type: 'palm.bridge.request' }]) {
      expect(validate({ origin: expectation().appOrigin, source: FRAME, data }, expectation())).toEqual({
        ok: false,
        kind: 'ignore',
      });
    }
  });
});

describe('validate — permissions', () => {
  it('refuses a request whose permission is not granted', () => {
    const result = validate(envelope('notification', { title: 'x' }), expectation(['STORAGE']));
    expect(result).toMatchObject({ ok: false, kind: 'reject' });
    expect((result as { error: string }).error).toContain('Notifications');
  });

  it('checks the permission before the payload', () => {
    // An application without the permission should not be able to learn
    // anything about what payloads would have been accepted.
    const result = validate(envelope('notification', { nonsense: true }), expectation(['STORAGE']));
    expect((result as { error: string }).error).toContain('not enabled');
  });

  it('grants nothing by default', () => {
    for (const request of ['notification', 'open-file', 'save-file', 'clipboard-write', 'system-info']) {
      expect(validate(envelope(request, {}), expectation([]))).toMatchObject({ kind: 'reject' });
    }
  });

  it('rejects an unknown request type', () => {
    const result = validate(envelope('run-shell-command', {}), expectation());
    expect(result).toMatchObject({ ok: false, kind: 'reject' });
    expect((result as { error: string }).error).toContain('does not support');
  });
});

describe('validate — payloads', () => {
  it('requires a notification title', () => {
    expect(validate(envelope('notification', {}), expectation())).toMatchObject({ kind: 'reject' });
    expect(validate(envelope('notification', { title: '   ' }), expectation())).toMatchObject({
      kind: 'reject',
    });
  });

  it('caps notification length', () => {
    expect(
      validate(envelope('notification', { title: 'x'.repeat(BRIDGE_LIMITS.title + 1) }), expectation()),
    ).toMatchObject({ kind: 'reject' });
    expect(
      validate(
        envelope('notification', { title: 'ok', body: 'x'.repeat(BRIDGE_LIMITS.body + 1) }),
        expectation(),
      ),
    ).toMatchObject({ kind: 'reject' });
  });

  it('accepts the two window actions and nothing else', () => {
    expect(
      validate(envelope('window-control', { action: 'set-title', title: 'Doc' }), expectation()),
    ).toMatchObject({ ok: true });
    expect(validate(envelope('window-control', { action: 'close' }), expectation())).toMatchObject({
      ok: true,
    });
    expect(
      validate(envelope('window-control', { action: 'maximise-everything' }), expectation()),
    ).toMatchObject({ kind: 'reject' });
  });

  it('refuses a save whose name contains a path', () => {
    // The name becomes a file in the Palm OS filesystem; an application does
    // not get to choose where that goes.
    for (const name of ['../../etc/passwd', '/etc/passwd', 'a/b.txt', 'a\\b.txt', '..', '.']) {
      expect(validate(envelope('save-file', { name, data: 'x' }), expectation())).toMatchObject({
        kind: 'reject',
      });
    }
  });

  it('accepts a plain file name', () => {
    expect(
      validate(envelope('save-file', { name: 'notes.txt', data: 'hello' }), expectation()),
    ).toMatchObject({ ok: true });
  });

  it('accepts binary bodies and refuses anything else', () => {
    expect(
      validate(
        envelope('save-file', { name: 'a.bin', data: new Uint8Array([1, 2, 3]) }),
        expectation(),
      ),
    ).toMatchObject({ ok: true });
    expect(
      validate(envelope('save-file', { name: 'a.bin', data: { nope: true } }), expectation()),
    ).toMatchObject({ kind: 'reject' });
  });

  it('caps the size of a saved file', () => {
    expect(
      validate(
        envelope('save-file', {
          name: 'big.bin',
          data: new Uint8Array(BRIDGE_LIMITS.fileBytes + 1),
        }),
        expectation(),
      ),
    ).toMatchObject({ kind: 'reject' });
  });

  it('caps clipboard text', () => {
    expect(
      validate(
        envelope('clipboard-write', { text: 'x'.repeat(BRIDGE_LIMITS.clipboard + 1) }),
        expectation(),
      ),
    ).toMatchObject({ kind: 'reject' });
    expect(validate(envelope('clipboard-write', { text: 'hi' }), expectation())).toMatchObject({
      ok: true,
    });
  });

  it('treats a non-object payload as empty rather than trusting it', () => {
    expect(validate(envelope('system-info', 'not-an-object'), expectation())).toMatchObject({
      ok: true,
    });
    expect(validate(envelope('notification', ['title']), expectation())).toMatchObject({
      kind: 'reject',
    });
  });

  it('returns the request id on a rejection so the app can settle its promise', () => {
    const result = validate(envelope('notification', {}), expectation());
    expect(result).toMatchObject({ kind: 'reject', requestId: 'b1' });
  });
});
