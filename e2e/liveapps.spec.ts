import { expect, test as base } from '@playwright/test';
import { Palm } from './fixtures';
import { installedManifests, routeFixture } from './site-fixture';

/**
 * Web applications that run live.
 *
 * The case this exists for is the one an archive cannot serve: a site that
 * refuses to be framed and needs your session. Nothing Palm OS does changes
 * either fact, so instead of pretending, it opens the real site in its own
 * top-level window and manages that window from the desktop.
 */
const test = base.extend<{ palm: Palm }>({
  palm: async ({ page, context }, use) => {
    await routeFixture(page);
    /*
     * Routed on the context, not the page: a live application opens a *new*
     * top-level page, and `page.route` would not reach it — which is the whole
     * point of this feature and exactly what the stub has to cover.
     */
    await context.route('https://watch.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Watch</title><h1>The real site</h1>',
      }),
    );
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

test.describe('adding a site as a live app', () => {
  test('downloads nothing and appears in the launcher', async ({ palm, page }) => {
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();
    await page.getByLabel('Address').fill('https://watch.test/');
    await page.getByLabel('Name (optional)').fill('Watch');
    await page.getByRole('button', { name: 'Add as app' }).click();

    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 20_000 })
      .toBe(1);

    const [manifest] = await installedManifests(page);
    expect(manifest.kind).toBe('live');
    expect(manifest.fileCount).toBe(0);
    // It has no origin of its own and nothing was archived, so it is granted
    // nothing — there is nothing to grant.
    expect(manifest.permissions).toEqual([]);

    const row = page.getByRole('listitem').filter({ hasText: 'Watch' });
    await expect(row.getByText('Live')).toBeVisible();
    await expect(row).toContainText('nothing downloaded');
    await expect(row).toContainText('its own browser window');
  });

  test('opens the real site in a real window, and tracks it', async ({ palm, page, context }) => {
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();
    await page.getByLabel('Address').fill('https://watch.test/');
    await page.getByLabel('Name (optional)').fill('Watch');
    await page.getByRole('button', { name: 'Add as app' }).click();
    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 20_000 })
      .toBe(1);

    // Launching from the start menu opens it, inside the click's gesture.
    const [popup] = await Promise.all([context.waitForEvent('page'), palm.launch('Watch')]);
    await popup.waitForLoadState('domcontentloaded');

    // The real origin — not an iframe, not a Palm OS origin.
    expect(new URL(popup.url()).origin).toBe('https://watch.test');
    expect(await popup.evaluate(() => window.top === window)).toBe(true);
    await expect(popup.locator('h1')).toHaveText('The real site');

    const win = palm.window('Watch');
    await expect(win.getByText('Running in its own window')).toBeVisible();

    // Closing it directly is noticed: there is no event for that, so the
    // manager polls, and the desktop has to reflect it.
    await popup.close();
    await expect(win.getByText('Not running')).toBeVisible({ timeout: 15_000 });
    await expect(win.getByRole('button', { name: /^Open Watch/ })).toBeVisible();
  });

  test('can close the window from the desktop', async ({ palm, page, context }) => {
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();
    await page.getByLabel('Address').fill('https://watch.test/');
    await page.getByRole('button', { name: 'Add as app' }).click();
    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 20_000 })
      .toBe(1);

    const [popup] = await Promise.all([context.waitForEvent('page'), palm.launch('watch.test')]);
    await popup.waitForLoadState('domcontentloaded');

    await palm.window('watch.test').getByRole('button', { name: 'Close it' }).click();
    await expect.poll(() => popup.isClosed(), { timeout: 15_000 }).toBe(true);
  });

  test('offers itself as the way out when an archive needs a server', async ({ palm, page, context }) => {
    // Archiving a site that needs a backend succeeds and is marked
    // ONLINE_REQUIRED — and this is the thing to do about it.
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://live.test/ Board --no-capture');
    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 30_000 })
      .toBe(1);

    await palm.launch('Board');
    const win = palm.window('Board');
    await expect(win.getByText('Board needs a live connection')).toBeVisible();

    await page.context().route('https://live.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Live Board</h1>' }),
    );
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      win.getByRole('button', { name: 'Use it as an app instead' }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');

    expect(new URL(popup.url()).origin).toBe('https://live.test');
    const manifests = await installedManifests(page);
    expect(manifests.some((entry) => entry.kind === 'live')).toBe(true);
  });
});
