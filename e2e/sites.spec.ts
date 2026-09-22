import { expect, test as base } from '@playwright/test';
import { Palm } from './fixtures';
import { installedManifests, routeFixture, waitForInstalls } from './site-fixture';

const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    await routeFixture(page);
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

test.describe('installing web applications', () => {
  test('archives a page and everything it needs to run', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText(
      'Installed "Notepad"',
    );

    const [manifest] = await waitForInstalls(page, 1);
    expect(manifest.missingResources).toEqual([]);
    expect(manifest.status).toBe('COMPLETE');

    /*
     * Paths keep the site's own layout, so a bundle that asks for
     * `/assets/main.js` at runtime finds it. Only the entry host sits at the
     * root; anything from elsewhere would be under /_ext/.
     */
    expect(manifest.resources.map((resource) => resource.path).sort()).toEqual([
      '/app.js',
      '/img/bg.png',
      '/img/hero.png',
      '/img/logo.png',
      '/index.html',
      '/styles/app.css',
      '/styles/base.css',
    ]);
  });

  test('grants the application nothing on installation', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');

    const [manifest] = await waitForInstalls(page, 1);
    // `STORAGE` is the application's own origin storage, which the browser
    // gives it whatever Palm OS thinks. Network access is off.
    expect(manifest.permissions).toEqual(['STORAGE']);
    expect(manifest.permissions).not.toContain('NETWORK');
  });

  test('runs the archived application in a window', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');

    // It registers as an ordinary application, so the launcher finds it.
    await palm.launch('Notepad');
    const win = palm.window('Notepad');
    await expect(win).toBeVisible();
    await expect(win).toContainText('fixture.test');

    const frame = page.frameLocator('iframe[title="Notepad"]');
    await expect(frame.locator('h1')).toHaveText('Fixture Notepad');
    // The archived script ran, which is the whole point of serving it properly.
    await expect(frame.locator('body')).toHaveAttribute('data-ready', 'yes');
  });

  test('needs nothing from the network once installed', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');

    /*
     * `context.setOffline` is not usable here: Firefox's offline emulation
     * rejects the request before the service worker sees it, which a real
     * offline machine does not — the worker answers from storage and never
     * reaches the network. So the property is asserted directly: with every
     * request to anywhere but this machine refused, the application still runs.
     */
    const blocked: string[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
        return route.fallback();
      }
      blocked.push(url.href);
      await route.abort();
    });

    await palm.launch('Notepad');
    const frame = page.frameLocator('iframe[title="Notepad"]');
    await expect(frame.locator('h1')).toHaveText('Fixture Notepad');
    await expect(frame.locator('body')).toHaveAttribute('data-ready', 'yes');
    expect(blocked).toEqual([]);
  });

  test('lists and removes installed applications', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/ Notepad --no-capture');

    await waitForInstalls(page, 1);
    const listed = await palm.runCommand('sites');
    expect(listed).toContain('fixture.test');
    expect(listed).toContain('Offline');

    const [manifest] = await waitForInstalls(page, 1);
    await palm.runCommand(`sites --remove ${manifest.id}`);
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText(
      'Removed "Notepad"',
    );

    await waitForInstalls(page, 0);
  });

  test('reports a failure instead of installing something broken', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://fixture.test/missing.html');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText(
      'could not install',
    );

    expect(await installedManifests(page)).toHaveLength(0);
  });
});

test.describe('the App Store', () => {
  test('states what installing means before anything is downloaded', async ({ palm, page }) => {
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();

    // The deployment's isolation status is stated up front, not discovered.
    await expect(page.getByText('Each application gets its own origin')).toBeVisible();
    await expect(page.getByText(/app-<id>\.localhost:4173/)).toBeVisible();

    await page.getByLabel('Address').fill('https://fixture.test/');
    await page.getByRole('button', { name: 'Download', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Install this web application?' });
    await expect(dialog).toBeVisible();
    // The three things a user needs to weigh: it runs someone else's code, it
    // is isolated, and the copy may be incomplete.
    await expect(dialog).toContainText('runs its JavaScript');
    await expect(dialog).toContainText('its own origin');
    await expect(dialog).toContainText('Network access is off');
    await expect(dialog).toContainText('incomplete');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeVisible();

    // Cancelling downloads nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await installedManifests(page)).toHaveLength(0);
  });

  test('installs from the store and lists it with its status', async ({ palm, page }) => {
    await palm.launch('App Store');
    await page.getByRole('radio', { name: 'Web applications' }).click();
    await page.getByLabel('Address').fill('https://fixture.test/');
    await page.getByLabel('Name (optional)').fill('Notepad');
    // Capture needs a network the fixture cannot provide; the store's default
    // is on, so it is turned off for this test.
    await page.getByRole('checkbox', { name: /Start it once/ }).uncheck();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Install this web application?' })
      .getByRole('button', { name: 'Install' })
      .click();

    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 60_000 })
      .toBe(1);

    const row = page.getByRole('listitem').filter({ hasText: 'Notepad' });
    await expect(row).toContainText('Offline');
    await expect(row).toContainText('Isolated');
    await expect(row).toContainText('no network at all');
  });
});

test.describe('archive completeness', () => {
  test('marks an application that needs a server as ONLINE_REQUIRED', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://live.test/ Board --no-capture');


    const [manifest] = await waitForInstalls(page, 1);
    expect(manifest.status).toBe('ONLINE_REQUIRED');
    expect(manifest.diagnostics.websockets).toContain('wss://live.test/stream');
    expect(manifest.diagnostics.backendHints).toContain('/api/board');

    // And it says so, rather than presenting itself as a working offline copy.
    const listed = await palm.runCommand('sites');
    expect(listed).toContain('Online required');
  });

  test('drops network access again after the capture run', async ({ palm, page }) => {
    /*
     * Installing with capture starts the application once *with* a connection,
     * which is the only way to find what a bundle loads at runtime. The
     * property that matters afterwards is that the permission does not linger.
     *
     * The capture itself cannot succeed here: Playwright's request
     * interception does not reach service-worker-initiated requests in
     * Firefox, so the worker's fetch goes to the real network and the fixture
     * host does not exist. That is a harness limit, not a product one — and
     * what it leaves behind is exactly the honest outcome: a PARTIAL archive
     * naming the resource it could not get. See docs/TESTING.md.
     */
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://dynamic.test/ Dynamic');
    await expect
      .poll(async () => (await installedManifests(page)).length, { timeout: 60_000 })
      .toBe(1);

    const [manifest] = await installedManifests(page);
    expect(manifest.permissions).toEqual(['STORAGE']);
    expect(manifest.status).toBe('PARTIAL');
    expect(manifest.missingResources.some((entry) => entry.url.includes('late-chunk.json'))).toBe(
      true,
    );
  });

  test('reports a resource the application loads at runtime', async ({ palm, page }) => {
    /*
     * The fixture assembles its request path at runtime, so no static scan can
     * find it. Installed without a capture run, the archive cannot contain it —
     * and the requirement is that this is reported, not hidden behind an
     * application that half works.
     */
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://dynamic.test/ Dynamic --no-capture');

    const before = await waitForInstalls(page, 1);
    expect(before[0].status).toBe('COMPLETE');

    // Running it is what exposes the gap; that is what revalidation does.
    await palm.launch('Dynamic');
    const frame = page.frameLocator('iframe[title="Dynamic"]');
    await expect(frame.locator('h1')).toHaveText('Dynamic App');
    await expect(frame.locator('body')).toHaveAttribute('data-late', 'failed');

    await page.getByRole('button', { name: 'About this application' }).click();
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByRole('button', { name: /Check again/ }).click();

    await expect
      .poll(async () => (await installedManifests(page))[0].status, { timeout: 20_000 })
      .toBe('PARTIAL');

    const after = await installedManifests(page);
    expect(after[0].missingResources.some((entry) => entry.url.includes('late-chunk.json'))).toBe(
      true,
    );
  });
});

test.describe('an application that needs a server', () => {
  test('says so instead of showing a page that fails silently', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://live.test/ Board --no-capture');
    await waitForInstalls(page, 1);

    await palm.launch('Board');
    const win = palm.window('Board');

    /*
     * The archive is present and the application would load — and then fail at
     * every request it makes, because it needs its own server and has no
     * network permission. Palm OS knows both, so it explains rather than
     * letting someone watch a blank page.
     */
    await expect(win.getByText('Board needs a live connection')).toBeVisible();
    await expect(win).toContainText('live.test');
    await expect(win).toContainText('no archive can stand in for that');
    // The diagnostics that produced the verdict are named, not just asserted.
    await expect(win).toContainText('/api/board');
    expect(await win.locator('iframe').count()).toBe(0);

    // Three ways out, including being allowed to look anyway.
    await expect(win.getByRole('button', { name: 'Use it as an app instead' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Allow network access' })).toBeVisible();
    await win.getByRole('button', { name: 'Show it anyway' }).click();
    await expect(win.locator('iframe')).toHaveCount(1);
  });

  test('warns that a sign-in still will not work once network is allowed', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('fetchsite https://live.test/ Board --no-capture');
    await waitForInstalls(page, 1);

    await palm.launch('Board');
    const win = palm.window('Board');
    await win.getByRole('button', { name: 'Allow network access' }).click();

    // Granting network is not the same as being signed in, and saying so up
    // front is cheaper than the confusion of finding out.
    await expect(win.getByText(/anything needing a sign-in will still not work/)).toBeVisible();
    await expect(win.locator('iframe')).toHaveCount(1);
  });
});
