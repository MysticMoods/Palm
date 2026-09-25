import { expect, test as base } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';
import { Palm } from './fixtures';
import { installedManifests, routeFixture } from './site-fixture';

/**
 * The security boundary, asserted rather than assumed.
 *
 * Every other feature of installed applications is a convenience. This is the
 * part that has to be true: an application is somebody else's JavaScript, and
 * the only thing standing between it and the user's files, settings and other
 * applications is that the browser considers it a different origin.
 *
 * So these tests do not check that the code *intends* isolation. They put data
 * on one side and try to read it from the other.
 */
const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    await routeFixture(page);
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

/**
 * Install one application and return its manifest.
 *
 * Polled rather than read once: installing crosses to another origin and back,
 * which takes longer than the shell prompt does to return.
 */
async function install(palm: Palm, url: string, name: string) {
  await palm.runCommand(`fetchsite ${url} ${name} --no-capture`);
  await expect
    .poll(
      async () => (await installedManifests(palm.page)).some((entry) => entry.name === name),
      { timeout: 30_000 },
    )
    .toBe(true);
  const manifests = await installedManifests(palm.page);
  return manifests.find((entry) => entry.name === name)!;
}

/**
 * The frame an application is running in, once its window is open.
 *
 * `/_papp/` is excluded deliberately: Palm OS opens a short-lived installer
 * frame on the *same* origin whenever it installs or changes permissions, and
 * matching that instead would look like the application and evaluate nothing.
 */
function findAppFrame(page: Page, appId: string): Frame | undefined {
  const origin = `http://${appId}.localhost:4173`;
  return page
    .frames()
    .find((frame) => frame.url().startsWith(origin) && !frame.url().includes('/_papp/'));
}

async function appFrame(page: Page, appId: string): Promise<Frame> {
  await expect.poll(() => Boolean(findAppFrame(page, appId)), { timeout: 15_000 }).toBe(true);
  return findAppFrame(page, appId)!;
}

/**
 * Read something from the application, re-resolving the frame each time.
 *
 * Every read of an application frame goes through here, for two reasons. The
 * frame is replaced whenever the application reloads — changing a permission
 * does that — so a handle taken beforehand goes stale. And a frame caught
 * mid-navigation has no `document.body` yet, so the read throws; polling a raw
 * `frame.evaluate` lets that escape the poll and fail the test instead of
 * retrying, which is an intermittent failure rather than a real one.
 */
function pollApp<T>(page: Page, appId: string, read: () => string) {
  return expect.poll(
    async () => {
      const frame = findAppFrame(page, appId);
      if (!frame) return undefined as T | undefined;
      try {
        return (await frame.evaluate(read)) as T;
      } catch {
        // Detached mid-reload, or no body yet; the next poll gets the new one.
        return undefined as T | undefined;
      }
    },
    { timeout: 20_000 },
  );
}

/** Call into the application, once it is loaded enough to answer. */
async function callApp(page: Page, appId: string, fn: () => void): Promise<void> {
  await pollApp<string>(page, appId, () => document.body?.dataset.hasBridge ?? '').toBe('true');
  await findAppFrame(page, appId)!.evaluate(fn);
}

test.describe('origin isolation', () => {
  test('an installed application runs on its own origin, not on Palm OS’s', async ({
    palm,
    page,
  }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');

    await palm.launch('Notepad');
    const frame = await appFrame(page, manifest.id);

    const frameOrigin = new URL(frame.url()).origin;
    expect(frameOrigin).toBe(`http://${manifest.id}.localhost:4173`);
    expect(frameOrigin).not.toBe(new URL(page.url()).origin);
    // The id is a DNS label, which is what makes the subdomain scheme work.
    expect(manifest.id).toMatch(/^app-[0-9a-f]{12}$/);
  });

  test('the application cannot read Palm OS’s storage', async ({ palm, page }) => {
    await palm.launch('Terminal');
    // Put something identifiable in Palm OS's own storage first, so a pass
    // means "could not read it", not "there was nothing to read".
    await page.evaluate(async () => {
      localStorage.setItem('palm-os-marker', 'os-only');
    });

    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');
    const frame = await appFrame(page, manifest.id);

    const seen = await frame.evaluate(async () => {
      const localStorageValue = (() => {
        try {
          return localStorage.getItem('palm-os-marker');
        } catch {
          return 'threw';
        }
      })();

      // Opening the OS database by name from here gets a *new*, empty database
      // on this origin — not the OS's.
      const stores = await new Promise<string[]>((resolve) => {
        const request = indexedDB.open('palm-os');
        request.onsuccess = () => resolve([...request.result.objectStoreNames]);
        request.onerror = () => resolve(['error']);
      });

      return { localStorageValue, stores };
    });

    expect(seen.localStorageValue).toBeNull();
    // Palm OS's database has nodes, contents, kv, apps… this one has nothing.
    expect(seen.stores).toEqual([]);
  });

  test('Palm OS cannot reach into the application either', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');
    await appFrame(page, manifest.id);

    // The browser refuses a cross-origin document access; Palm OS holds a
    // handle to the frame but can see nothing through it.
    const reach = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Notepad"]');
      if (!frame) return 'no frame';
      try {
        const doc = frame.contentDocument;
        return doc ? `read ${doc.title}` : 'null document';
      } catch {
        return 'threw';
      }
    });
    expect(['null document', 'threw']).toContain(reach);
  });

  test('two applications cannot see each other’s storage', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const alpha = await install(palm, 'https://storage-a.test/', 'StoreA');
    const beta = await install(palm, 'https://storage-b.test/', 'StoreB');
    expect(alpha.id).not.toBe(beta.id);

    await palm.launch('StoreA');
    await appFrame(page, alpha.id);
    await pollApp<string>(page, alpha.id, () => document.body?.dataset.wrote ?? '').toBe('yes');

    await palm.launch('StoreB');
    const frameB = await appFrame(page, beta.id);

    const seen = await frameB.evaluate(() => {
      try {
        return localStorage.getItem('app-secret');
      } catch {
        return 'threw';
      }
    });
    expect(seen).toBeNull();

    // And Palm OS cannot see it either.
    expect(await page.evaluate(() => localStorage.getItem('app-secret'))).toBeNull();
  });

  test('Palm OS’s own document is never served on an application origin', async ({
    palm,
    page,
  }) => {
    await palm.launch('Terminal');
    await install(palm, 'https://fixture.test/', 'Notepad');

    /*
     * An application id that was never installed: the origin still must not
     * answer with the OS. Booting a second copy of Palm OS there would put its
     * code on an origin meant for third-party applications.
     *
     * Two things can answer, depending on how quickly the bootstrap document's
     * worker registers and reloads — the server's bootstrap, or the worker
     * reporting an empty origin. Both name the application and neither is Palm
     * OS, which is the invariant.
     */
    await page.goto('http://app-000000000000.localhost:4173/');
    await expect
      .poll(async () => (await page.locator('body').innerText()).includes('app-000000000000'), {
        timeout: 15_000,
      })
      .toBe(true);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Taskbar');
    expect(await page.locator('[role="toolbar"][aria-label="Taskbar"]').count()).toBe(0);
  });

  test('no service worker controls the Palm OS origin', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');

    // Each application's worker is scoped to its own origin. Palm OS has none
    // of its own, and an application's cannot reach across.
    const state = await page.evaluate(async () => ({
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      registrations: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
    }));
    expect(state.controller).toBeNull();
    expect(state.registrations).toEqual([]);
  });

  test('each application’s service worker is scoped to its own origin', async ({
    palm,
    page,
  }) => {
    await palm.launch('Terminal');
    const alpha = await install(palm, 'https://storage-a.test/', 'StoreA');
    const beta = await install(palm, 'https://storage-b.test/', 'StoreB');

    await palm.launch('StoreA');
    await palm.launch('StoreB');
    const frameA = await appFrame(page, alpha.id);
    const frameB = await appFrame(page, beta.id);

    const scopeOf = (frame: Frame) =>
      frame.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.map((registration) => registration.scope);
      });

    expect(await scopeOf(frameA)).toEqual([`http://${alpha.id}.localhost:4173/`]);
    expect(await scopeOf(frameB)).toEqual([`http://${beta.id}.localhost:4173/`]);
  });
});

test.describe('application policy', () => {
  test('the security headers cut an offline application off from the network', async ({
    palm,
    page,
  }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');
    const frame = await appFrame(page, manifest.id);

    const policy = await frame.evaluate(async () => {
      const response = await fetch(location.href);
      return {
        csp: response.headers.get('content-security-policy'),
        permissions: response.headers.get('permissions-policy'),
        nosniff: response.headers.get('x-content-type-options'),
      };
    });

    // `connect-src` is what stops fetch, XHR, EventSource *and* WebSockets —
    // the last of which a service worker cannot intercept at all.
    expect(policy.csp).toContain("connect-src 'self' blob: data:");
    expect(policy.csp).not.toContain('connect-src https:');
    // Only Palm OS may frame an application.
    expect(policy.csp).toContain('frame-ancestors http://localhost:4173');
    expect(policy.permissions).toContain('camera=()');
    expect(policy.nosniff).toBe('nosniff');
  });

  test('an offline application cannot reach another origin', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');
    const frame = await appFrame(page, manifest.id);

    const result = await frame.evaluate(async () => {
      try {
        await fetch('http://localhost:4173/_palm/origin-info');
        return 'reached';
      } catch (error) {
        return `blocked: ${(error as Error).name}`;
      }
    });
    expect(result).toMatch(/^blocked/);
  });
});

test.describe('requests an archive cannot answer', () => {
  /**
   * A POST is asking a server to do something, and an archive is not a server.
   *
   * What matters is *how* it fails. These are almost always API calls, so an
   * HTML page with a 200 — which is what the server's bootstrap document used
   * to give them — leaves the application unable to tell it failed at all.
   */
  test('fails a write with JSON and a failing status, not an HTML page', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');
    const frame = await appFrame(page, manifest.id);

    const result = await frame.evaluate(async () => {
      const response = await fetch('/api/save', {
        method: 'POST',
        body: JSON.stringify({ hello: 'world' }),
      });
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        body: await response.text(),
      };
    });

    expect(result.status).toBe(503);
    expect(result.type).toContain('application/json');
    expect(result.body).not.toContain('<!doctype');
    expect(JSON.parse(result.body)).toMatchObject({ reason: 'network-blocked' });
  });

  test('still refuses to forward a write once network is allowed', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://fixture.test/', 'Notepad');
    await palm.launch('Notepad');

    await page.getByRole('button', { name: 'About this application' }).click();
    const toggle = page
      .locator('label', { hasText: 'Contact servers over the internet' })
      .locator('input[type="checkbox"]')
      .first();
    await toggle.click();
    await expect(toggle).toBeChecked();

    /*
     * Network permission lets the application *read* from the web. It does not
     * make Palm OS a write proxy: relaying arbitrary request bodies to
     * arbitrary hosts is a different product, and one with an abuse surface.
     */
    const body = await pollWrite(page, manifest.id);
    expect(body.status).toBe(501);
    expect(JSON.parse(body.text)).toMatchObject({ reason: 'cannot-forward-write' });
  });
});

/** POST from inside the application, re-resolving the frame as it reloads. */
async function pollWrite(page: Page, appId: string) {
  let last: { status: number; text: string } = { status: 0, text: '' };
  await expect
    .poll(
      async () => {
        const frame = findAppFrame(page, appId);
        if (!frame) return 0;
        try {
          last = await frame.evaluate(async () => {
            const response = await fetch('/api/save', { method: 'POST', body: '{}' });
            return { status: response.status, text: await response.text() };
          });
          return last.status;
        } catch {
          return 0;
        }
      },
      { timeout: 20_000 },
    )
    .toBe(501);
  return last;
}

test.describe('the application bridge', () => {
  test('is offered to the application but grants nothing by default', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://bridge.test/', 'Bridged');
    await palm.launch('Bridged');
    await appFrame(page, manifest.id);

    await pollApp<string>(page, manifest.id, () => document.body?.dataset.hasBridge ?? '').toBe(
      'true',
    );

    // The request is refused because the permission was never granted, and the
    // application is told why rather than left hanging.
    await pollApp<string>(page, manifest.id, () => document.body?.dataset.notify ?? '').toMatch(
      /^refused: "Notifications"/,
    );
  });

  test('refuses a request Palm OS does not implement', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://bridge.test/', 'Bridged');
    await palm.launch('Bridged');
    await appFrame(page, manifest.id);

    await callApp(page, manifest.id, () =>
      (window as unknown as { tryForbidden: () => void }).tryForbidden(),
    );
    await pollApp<string>(page, manifest.id, () => document.body?.dataset.forbidden ?? '').toMatch(
      /^refused/,
    );
  });

  test('works once the permission is granted', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const manifest = await install(palm, 'https://bridge.test/', 'Bridged');
    await palm.launch('Bridged');

    /*
     * Grant Notifications from the application's own details panel. Scoped to
     * the label rather than by accessible name: "Notifications" also names the
     * notification centre, and the first match would be that.
     */
    await page.getByRole('button', { name: 'About this application' }).click();
    const toggle = page
      .locator('label', { hasText: 'Post notifications to the Palm OS' })
      .locator('input[type="checkbox"]')
      .first();
    await toggle.click();
    await expect(toggle).toBeChecked();

    /*
     * The application reloads when its permissions change, and its script runs
     * `tryNotify()` on load — so the outcome recorded on the fresh document is
     * the one made under the new permission.
     */
    await pollApp<string>(page, manifest.id, () => document.body?.dataset.notify ?? '').toBe(
      'allowed',
    );
  });
});
