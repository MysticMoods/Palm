import { describe, expect, it } from 'vitest';
import {
  applyValidation,
  computeStatus,
  expectedOffline,
  sanitisePermissions,
  statusLabel,
  statusSummary,
} from './manifest';
import { APP_PERMISSIONS, ARCHIVE_STATUS, ARCHIVE_VERSION, EMPTY_DIAGNOSTICS } from './types';
import type { AppManifest, ArchiveDiagnostics } from './types';

const diagnostics = (overrides: Partial<ArchiveDiagnostics> = {}): ArchiveDiagnostics => ({
  ...EMPTY_DIAGNOSTICS,
  ...overrides,
});

describe('computeStatus', () => {
  it('is COMPLETE when everything was captured', () => {
    expect(
      computeStatus({ resourceCount: 9, hasEntry: true, missing: [], diagnostics: diagnostics() }),
    ).toBe(ARCHIVE_STATUS.complete);
  });

  it('is FAILED without an entry document, whatever else was captured', () => {
    expect(
      computeStatus({ resourceCount: 20, hasEntry: false, missing: [], diagnostics: diagnostics() }),
    ).toBe(ARCHIVE_STATUS.failed);
  });

  it('is FAILED when nothing was captured', () => {
    expect(
      computeStatus({ resourceCount: 0, hasEntry: true, missing: [], diagnostics: diagnostics() }),
    ).toBe(ARCHIVE_STATUS.failed);
  });

  it('is PARTIAL when resources are missing', () => {
    expect(
      computeStatus({
        resourceCount: 9,
        hasEntry: true,
        missing: [{ url: 'https://x.test/a.js', reason: 'not-found' }],
        diagnostics: diagnostics(),
      }),
    ).toBe(ARCHIVE_STATUS.partial);
  });

  it('is PARTIAL when the archive was truncated by a limit', () => {
    expect(
      computeStatus({
        resourceCount: 300,
        hasEntry: true,
        missing: [],
        diagnostics: diagnostics({ truncated: true }),
      }),
    ).toBe(ARCHIVE_STATUS.partial);
  });

  it('is ONLINE_REQUIRED for a WebSocket application even with nothing missing', () => {
    // Every byte captured and still useless offline: the files were never the
    // problem, so PARTIAL would be the wrong thing to tell the user.
    expect(
      computeStatus({
        resourceCount: 40,
        hasEntry: true,
        missing: [],
        diagnostics: diagnostics({ websockets: ['wss://live.test/socket'] }),
      }),
    ).toBe(ARCHIVE_STATUS.onlineRequired);
  });

  it('prefers ONLINE_REQUIRED over PARTIAL when both apply', () => {
    expect(
      computeStatus({
        resourceCount: 40,
        hasEntry: true,
        missing: [{ url: 'https://x.test/a.js', reason: 'not-found' }],
        diagnostics: diagnostics({ backendHints: ['/api/documents'] }),
      }),
    ).toBe(ARCHIVE_STATUS.onlineRequired);
  });
});

describe('expectedOffline', () => {
  it('is true only for archives that actually run without a network', () => {
    expect(expectedOffline(ARCHIVE_STATUS.complete)).toBe(true);
    expect(expectedOffline(ARCHIVE_STATUS.partial)).toBe(true);
    expect(expectedOffline(ARCHIVE_STATUS.onlineRequired)).toBe(false);
    expect(expectedOffline(ARCHIVE_STATUS.failed)).toBe(false);
  });
});

describe('statusSummary', () => {
  it('counts what is missing rather than hedging', () => {
    const text = statusSummary({
      status: ARCHIVE_STATUS.partial,
      missingResources: [
        { url: 'https://x.test/a.js', reason: 'not-found' },
        { url: 'https://x.test/b.js', reason: 'not-found' },
      ],
      diagnostics: diagnostics(),
    });
    expect(text).toContain('2 resources');
    expect(text).not.toContain('may be');
  });

  it('uses the singular for one missing resource', () => {
    const text = statusSummary({
      status: ARCHIVE_STATUS.partial,
      missingResources: [{ url: 'https://x.test/a.js', reason: 'not-found' }],
      diagnostics: diagnostics(),
    });
    expect(text).toContain('1 resource could not');
  });

  it('separates the front end from the backend it still needs', () => {
    const text = statusSummary({
      status: ARCHIVE_STATUS.onlineRequired,
      missingResources: [],
      diagnostics: diagnostics({ websockets: ['wss://x.test'], backendHints: ['/api/x'] }),
    });
    expect(text).toContain('front end was archived successfully');
    expect(text).toContain('will not work offline');
  });

  it('says plainly when an archive is complete', () => {
    expect(
      statusSummary({
        status: ARCHIVE_STATUS.complete,
        missingResources: [],
        diagnostics: diagnostics(),
      }),
    ).toContain('no network at all');
  });
});

describe('statusLabel', () => {
  it('gives every status a short badge', () => {
    expect(statusLabel(ARCHIVE_STATUS.complete)).toBe('Offline');
    expect(statusLabel(ARCHIVE_STATUS.partial)).toBe('Partial archive');
    expect(statusLabel(ARCHIVE_STATUS.onlineRequired)).toBe('Online required');
    expect(statusLabel(ARCHIVE_STATUS.failed)).toBe('Failed');
  });
});

describe('applyValidation', () => {
  const base = (): AppManifest => ({
    id: 'app-7f31c2a4b901',
    name: 'Fixture',
    version: '1.0.0',
    source: 'https://fixture.test/',
    primaryHost: 'fixture.test',
    entry: '/index.html',
    icon: 'Globe',
    color: '#38b6f0',
    status: ARCHIVE_STATUS.partial,
    offline: true,
    networkRequired: false,
    permissions: ['STORAGE'],
    resources: [
      { path: '/index.html', url: 'https://fixture.test/', mime: 'text/html', bytes: 100, source: 'static' },
    ],
    missingResources: [{ url: 'https://fixture.test/late.js', reason: 'not-found' }],
    diagnostics: { ...EMPTY_DIAGNOSTICS },
    bytes: 100,
    fileCount: 1,
    createdAt: 1,
    updatedAt: 1,
    archiveVersion: ARCHIVE_VERSION,
  });

  it('promotes an archive to COMPLETE once the missing chunk is captured', () => {
    const next = applyValidation(base(), {
      misses: [],
      captured: [
        { path: '/late.js', url: 'https://fixture.test/late.js', bytes: 42, mime: 'text/javascript' },
      ],
    });
    expect(next.missingResources).toEqual([]);
    expect(next.status).toBe(ARCHIVE_STATUS.complete);
    expect(next.resources.map((entry) => entry.path)).toContain('/late.js');
    expect(next.fileCount).toBe(2);
    expect(next.bytes).toBe(142);
  });

  it('records a request the run could not satisfy', () => {
    const next = applyValidation({ ...base(), missingResources: [] }, {
      misses: [{ url: 'https://fixture.test/chunk-a.js', reason: 'not-found' }],
      captured: [],
    });
    expect(next.status).toBe(ARCHIVE_STATUS.partial);
    expect(next.missingResources).toEqual([
      { url: 'https://fixture.test/chunk-a.js', reason: 'not-found' },
    ]);
  });

  it('does not count a single-page route as a missing resource', () => {
    // A router asking for /settings is the application working, not failing.
    const next = applyValidation({ ...base(), missingResources: [] }, {
      misses: [{ url: 'https://app-x.localhost/settings', reason: 'spa-fallback' }],
      captured: [],
    });
    expect(next.missingResources).toEqual([]);
    expect(next.status).toBe(ARCHIVE_STATUS.complete);
  });

  it('does not duplicate a miss already on the manifest', () => {
    const next = applyValidation(base(), {
      misses: [{ url: 'https://fixture.test/late.js', reason: 'not-found' }],
      captured: [],
    });
    expect(next.missingResources).toHaveLength(1);
  });

  it('keeps ONLINE_REQUIRED after a clean run, because the backend is still absent', () => {
    const manifest = {
      ...base(),
      missingResources: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, websockets: ['wss://fixture.test/live'] },
    };
    expect(applyValidation(manifest, { misses: [], captured: [] }).status).toBe(
      ARCHIVE_STATUS.onlineRequired,
    );
  });

  it('keeps offline and networkRequired consistent with the status', () => {
    const next = applyValidation(base(), {
      misses: [],
      captured: [
        { path: '/late.js', url: 'https://fixture.test/late.js', bytes: 42, mime: 'text/javascript' },
      ],
    });
    expect(next.offline).toBe(true);
    expect(next.networkRequired).toBe(false);
  });
});

describe('sanitisePermissions', () => {
  it('keeps only recognised permissions', () => {
    expect(sanitisePermissions(['NETWORK', 'ROOT', 'FILES'], APP_PERMISSIONS)).toEqual([
      'NETWORK',
      'FILES',
    ]);
  });

  it('removes duplicates', () => {
    expect(sanitisePermissions(['NETWORK', 'NETWORK'], APP_PERMISSIONS)).toEqual(['NETWORK']);
  });

  it('rejects anything that is not an array', () => {
    expect(sanitisePermissions('NETWORK', APP_PERMISSIONS)).toEqual([]);
    expect(sanitisePermissions(null, APP_PERMISSIONS)).toEqual([]);
    expect(sanitisePermissions({ 0: 'NETWORK' }, APP_PERMISSIONS)).toEqual([]);
  });
});
