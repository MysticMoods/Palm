import { expect, test } from './fixtures';
import { installedManifests } from './site-fixture';

/**
 * Moving applications installed under the previous architecture.
 *
 * Schema 2 archived a site into Palm OS's *own* origin and served it from
 * `/site/<id>/…`, which meant an archived application ran with the same reach
 * as the OS. Those installs still exist in people's browsers, so they are
 * moved onto isolated origins rather than left running that way — and rather
 * than deleted, which would throw away something the user downloaded.
 *
 * The legacy records are written into the live database, which still has the
 * version 2 stores, and Palm OS is then reloaded so boot finds them.
 */
const LEGACY_ID = 'site_legacy1';

async function seedLegacyApp(page: import('@playwright/test').Page) {
  await page.evaluate(async (siteId: string) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('palm-os');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const put = (store: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    await put('sites', {
      id: siteId,
      name: 'Old Notepad',
      url: 'https://legacy.test/',
      host: 'legacy.test',
      entry: 'legacy.test/index.html',
      icon: 'Globe',
      color: '#38b6f0',
      installedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      bytes: 300,
      fileCount: 2,
      missing: [],
    });

    await put('siteFiles', {
      key: `${siteId}/legacy.test/index.html`,
      siteId,
      path: 'legacy.test/index.html',
      mime: 'text/html',
      data: new Blob(
        [
          `<!doctype html><html><head><title>Old Notepad</title>` +
            `<link rel="stylesheet" href="/site/${siteId}/legacy.test/app.css">` +
            `</head><body><h1>Old Notepad</h1></body></html>`,
        ],
        { type: 'text/html' },
      ),
    });

    await put('siteFiles', {
      key: `${siteId}/legacy.test/app.css`,
      siteId,
      path: 'legacy.test/app.css',
      mime: 'text/css',
      data: new Blob([`h1 { color: rgb(0, 128, 0); }`], { type: 'text/css' }),
    });
  }, LEGACY_ID);
}

/** What is left in the version 2 stores. */
async function legacyRecords(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('palm-os');
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store: string) =>
      new Promise<unknown[]>((resolve) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
      });
    return { sites: await read('sites'), files: await read('siteFiles') };
  });
}

test.describe('migrating pre-isolation applications', () => {
  test('moves a legacy application onto its own origin and removes the old copy', async ({
    palm,
    page,
  }) => {
    await seedLegacyApp(page);
    expect((await legacyRecords(page)).sites).toHaveLength(1);

    // No fetch service is routed in this test: migration must work from the
    // bytes already on the device, with no network at all.
    await page.reload();
    await palm.skipWelcome();

    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 30_000 })
      .toBe(1);

    const [manifest] = await installedManifests(page);
    expect(manifest.name).toBe('Old Notepad');
    expect(manifest.id).toMatch(/^app-[0-9a-f]{12}$/);
    expect(manifest.entry).toBe('/index.html');
    // Nothing is granted on arrival: the point of moving it is that it stops
    // having the OS's access, so it must not arrive with permissions.
    expect(manifest.permissions).toEqual(['STORAGE']);

    // The old records are gone, and only after the move succeeded.
    const leftovers = await legacyRecords(page);
    expect(leftovers.sites).toHaveLength(0);
    expect(leftovers.files).toHaveLength(0);
  });

  test('the migrated application runs from its new origin', async ({ palm, page }) => {
    await seedLegacyApp(page);
    await page.reload();
    await palm.skipWelcome();

    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 30_000 })
      .toBe(1);
    const [manifest] = await installedManifests(page);

    await palm.launch('Old Notepad');
    const frame = page.frameLocator('iframe[title="Old Notepad"]');
    await expect(frame.locator('h1')).toHaveText('Old Notepad');

    // The stylesheet reference was rewritten out of the old `/site/<id>/`
    // scope; if it had not been, the heading would be unstyled.
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(0, 128, 0)');

    const appFrame = page.frames().find((candidate) => candidate.url().includes(manifest.id));
    expect(new URL(appFrame!.url()).origin).toBe(`http://${manifest.id}.localhost:4173`);
  });
});
