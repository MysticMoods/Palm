import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Palm } from './fixtures';
import { installedManifests, routeFixture, waitForInstalls } from './site-fixture';

/**
 * What happens when storage goes away.
 *
 * Browsers evict origin storage under pressure, and they do not ask first. The
 * OS's own database and an installed application's archive can each disappear
 * independently, and neither should produce a broken desktop — which is the
 * outcome you get if boot assumes what it found last time is still there.
 */
const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    await routeFixture(page);
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

/** Delete a database from whichever origin the page is currently on. */
async function deleteDatabase(page: Page, name: string) {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    name,
  );
}

test.describe('when the OS database is evicted', () => {
  test('the desktop still boots, and re-seeds itself', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('echo hello > /Documents/evidence.txt');
    expect(await palm.runCommand('ls /Documents')).toContain('evidence.txt');

    // What the browser does under storage pressure, without asking.
    await deleteDatabase(page, 'palm-os');
    await page.reload();

    // The desktop comes up rather than hanging on a boot error.
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor({ timeout: 20_000 });
    await palm.skipWelcome();

    // The file is gone — that is what eviction means, and pretending otherwise
    // would be worse. What matters is that the filesystem was rebuilt.
    await palm.launch('Terminal');
    const listing = await palm.runCommand('ls /');
    expect(listing).toContain('Documents');
    expect(await palm.runCommand('ls /Documents')).not.toContain('evidence.txt');
  });

  test('reports no console errors while recovering', async ({ palm, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await deleteDatabase(page, 'palm-os');
    await page.reload();
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor({ timeout: 20_000 });
    await palm.skipWelcome();

    expect(errors).toEqual([]);
  });
});

test.describe('when an application’s archive is evicted', () => {
  /**
   * Wipe an application origin the way a browser reclaiming space would.
   *
   * The stores are emptied rather than the database dropped: `deleteDatabase`
   * blocks for as long as anything still holds a connection, and the service
   * worker may outlive its own unregistration for a moment. A blocked delete
   * silently does nothing, which would make this test pass by not testing.
   */
  async function evictApplication(page: Page, appId: string) {
    const origin = `http://${appId}.localhost:4173`;
    const osUrl = page.url();

    await page.goto(`${origin}/_papp/installer.html`);
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }

      await new Promise<void>((resolve) => {
        const request = indexedDB.open('palm-app');
        request.onsuccess = () => {
          const db = request.result;
          const names = [...db.objectStoreNames];
          if (names.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(names, 'readwrite');
          for (const name of names) tx.objectStore(name).clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        };
        request.onerror = () => resolve();
      });
    });
    await page.goto(osUrl);
  }

  test('Palm OS notices, says so, and can fetch it again', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');
    const [installed] = await waitForInstalls(page, 1);

    await evictApplication(page, installed.id);
    await palm.skipWelcome();

    // The manifest is still Palm OS's; the files were never Palm OS's to keep.
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'Notepad' });
    await expect(row.getByText('Files missing')).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('browser reclaimed the space');

    // And the repair works, from the address recorded in the manifest.
    await row.getByRole('button', { name: 'Download again' }).click();
    await expect(row.getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 60_000 });
    await expect(row.getByText('Files missing')).toHaveCount(0);
  });

  test('keeps the same origin when it downloads again', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');
    const [before] = await waitForInstalls(page, 1);

    await evictApplication(page, before.id);
    await palm.skipWelcome();

    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Notepad' });
    await expect(row.getByText('Files missing')).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: 'Download again' }).click();
    await expect(row.getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 60_000 });

    /*
     * The id is the origin, and the origin is where the application keeps its
     * own data. Minting a new one to repair a missing archive would silently
     * throw away whatever the user had saved inside it.
     */
    const [after] = await installedManifests(page);
    expect(after.id).toBe(before.id);
  });
});
