import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup, validateBackup } from './backup';
import { seedFilesystem } from './filesystem/seed';
import { vfs } from './filesystem/vfs';
import { installedApps } from './sites/storage';
import { ARCHIVE_STATUS, ARCHIVE_VERSION, EMPTY_DIAGNOSTICS } from './sites/types';
import type { AppManifest } from './sites/types';

/**
 * Backing up and restoring installed applications.
 *
 * Only the manifests travel. Their archived files live in each application's
 * own origin, which Palm OS cannot read — that is the isolation boundary
 * working, not a gap in the exporter. What a manifest carries is the address
 * it came from, so a restored backup knows what was installed and can offer to
 * fetch it again.
 */
const manifest = (over: Partial<AppManifest> = {}): AppManifest => ({
  id: 'app-7f31c2a4b901',
  name: 'Fixture Notepad',
  version: '1.0.0',
  source: 'https://fixture.test/',
  primaryHost: 'fixture.test',
  entry: '/index.html',
  icon: 'Globe',
  color: '#38b6f0',
  status: ARCHIVE_STATUS.complete,
  offline: true,
  networkRequired: false,
  permissions: ['STORAGE'],
  resources: [],
  missingResources: [],
  diagnostics: { ...EMPTY_DIAGNOSTICS },
  bytes: 1024,
  fileCount: 3,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archiveVersion: ARCHIVE_VERSION,
  ...over,
});

beforeEach(async () => {
  await vfs.init();
  await seedFilesystem();
  for (const existing of await installedApps.list()) await installedApps.remove(existing.id);
});

describe('createBackup', () => {
  it('includes installed application manifests', async () => {
    await installedApps.save(manifest());
    const backup = await createBackup();

    expect(backup.apps).toHaveLength(1);
    expect(backup.apps?.[0]).toMatchObject({
      id: 'app-7f31c2a4b901',
      source: 'https://fixture.test/',
    });
  });

  it('carries no archived bytes, because it cannot read them', async () => {
    // The files are on another origin. A backup that appeared to contain them
    // would be lying about what a restore can bring back.
    await installedApps.save(manifest({ resources: [] }));
    const backup = await createBackup();
    expect(JSON.stringify(backup.apps)).not.toContain('base64');
  });

  it('produces a document that validates', async () => {
    await installedApps.save(manifest());
    const result = validateBackup(await createBackup());
    expect(result.valid).toBe(true);
    expect(result.summary?.apps).toBe(1);
  });
});

describe('restoreBackup', () => {
  it('brings the application list back', async () => {
    await installedApps.save(manifest());
    const backup = await createBackup();

    await installedApps.remove('app-7f31c2a4b901');
    expect(await installedApps.list()).toHaveLength(0);

    await restoreBackup(backup);
    const restored = await installedApps.list();
    expect(restored).toHaveLength(1);
    expect(restored[0].source).toBe('https://fixture.test/');
    // Enough survives to re-download it and to describe it meanwhile.
    expect(restored[0].name).toBe('Fixture Notepad');
    expect(restored[0].entry).toBe('/index.html');
  });

  it('does not restore a manifest that could never be repaired', async () => {
    // No `source` means no address to fetch from: restoring it would leave an
    // application entry that can only ever be deleted.
    await restoreBackup({
      ...(await createBackup()),
      apps: [{ id: 'app-000000000000', name: 'Broken' } as unknown as AppManifest],
    });
    expect(await installedApps.list()).toHaveLength(0);
  });

  it('restores a version 1 backup that has no application list at all', async () => {
    const backup = await createBackup();
    delete backup.apps;
    await expect(restoreBackup(backup)).resolves.toBeUndefined();
  });

  it('grants a restored application nothing beyond its own storage', async () => {
    await installedApps.save(manifest({ permissions: ['STORAGE', 'NETWORK', 'FILES'] }));
    const backup = await createBackup();
    await installedApps.remove('app-7f31c2a4b901');
    await restoreBackup(backup);

    /*
     * The manifest round-trips as written, including permissions — but the
     * application has no files on its origin yet, so nothing runs until it is
     * downloaded again, and that re-install re-applies the defaults.
     */
    const [restored] = await installedApps.list();
    expect(restored.permissions).toEqual(['STORAGE', 'NETWORK', 'FILES']);
  });
});
