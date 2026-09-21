// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appOrigin, installerUrl, isValidAppId, newAppId, osOrigin, resetIsolationCache, isolationStatus } from './origin';

describe('newAppId', () => {
  it('produces an id that is a valid DNS label and passes validation', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newAppId();
      expect(id).toMatch(/^app-[0-9a-f]{12}$/);
      expect(isValidAppId(id)).toBe(true);
    }
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, newAppId));
    expect(ids.size).toBe(200);
  });
});

describe('appOrigin', () => {
  it('places an application beside the OS origin', () => {
    // jsdom serves at http://localhost:3000 by default.
    expect(osOrigin()).toBe('http://localhost:3000');
    expect(appOrigin('app-7f31c2a4b901')).toBe('http://app-7f31c2a4b901.localhost:3000');
  });

  it('is never the OS origin', () => {
    expect(appOrigin('app-7f31c2a4b901')).not.toBe(osOrigin());
  });

  it('gives two applications different origins', () => {
    expect(appOrigin('app-aaaaaaaaaaaa')).not.toBe(appOrigin('app-bbbbbbbbbbbb'));
  });

  it('refuses a malformed id rather than building a strange host', () => {
    expect(appOrigin('../evil')).toBeNull();
    expect(appOrigin('app-XYZ')).toBeNull();
    expect(installerUrl('app-XYZ')).toBeNull();
  });

  it('points the installer at the application origin', () => {
    expect(installerUrl('app-7f31c2a4b901')).toBe(
      'http://app-7f31c2a4b901.localhost:3000/_papp/installer.html',
    );
  });
});

describe('isolationStatus', () => {
  beforeEach(() => resetIsolationCache());

  it('reports availability from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          osOrigin: 'https://palm.example',
          isolation: 'available',
          appOriginTemplate: 'https://app-<id>.palm.example',
        }),
      }),
    );
    const status = await isolationStatus();
    expect(status.available).toBe(true);
    expect(status.template).toBe('https://app-<id>.palm.example');
  });

  it('refuses when the server says isolation is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ isolation: 'unavailable', reason: 'Reached by IP address.' }),
      }),
    );
    const status = await isolationStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('Reached by IP address.');
  });

  it('refuses when no server answers, rather than assuming the best', async () => {
    // A static deployment cannot route by Host, so applications would end up
    // sharing the OS origin — exactly what must not happen silently.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const status = await isolationStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('not answering');
  });

  it('asks once and caches the answer', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isolation: 'available' }) });
    vi.stubGlobal('fetch', spy);
    await isolationStatus();
    await isolationStatus();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
