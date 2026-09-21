import type { Page } from '@playwright/test';

/**
 * A fixture site, served by intercepting the fetch service.
 *
 * The service refuses private addresses by design, so a locally-hosted fixture
 * cannot be archived — and archiving a real third-party site in a test would
 * be neither deterministic nor polite. Intercepting the one endpoint the
 * archiver calls leaves every other part of the pipeline real: the rewriting,
 * the transfer to the application origin, the service worker, the validation
 * run and the status are all the production code paths.
 */
export const FIXTURE: Record<string, { type: string; body: string }> = {
  'https://fixture.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head>
      <title>Fixture Notepad</title>
      <link rel="stylesheet" href="/styles/app.css">
      <style>.hero { background: url(img/hero.png); }</style>
    </head><body>
      <h1>Fixture Notepad</h1>
      <img src="img/logo.png" alt="logo">
      <a href="https://elsewhere.test/docs">Docs</a>
      <script src="./app.js"></script>
    </body></html>`,
  },
  'https://fixture.test/styles/app.css': {
    type: 'text/css',
    body: `@import "base.css";\n.page { background: url(../img/bg.png); }`,
  },
  'https://fixture.test/styles/base.css': {
    type: 'text/css',
    body: `body { margin: 0; font-family: system-ui; }`,
  },
  'https://fixture.test/app.js': {
    type: 'text/javascript',
    body: `document.body.dataset.ready = 'yes';`,
  },
  'https://fixture.test/img/logo.png': { type: 'image/png', body: 'PNG-LOGO' },
  'https://fixture.test/img/hero.png': { type: 'image/png', body: 'PNG-HERO' },
  'https://fixture.test/img/bg.png': { type: 'image/png', body: 'PNG-BG' },

  /*
   * A second site whose script asks for something at runtime that no static
   * scan can see: the path is assembled from pieces. This is what a real
   * code-splitting bundle looks like to an archiver, and it is the case the
   * status vocabulary exists for.
   */
  'https://dynamic.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Dynamic App</title></head><body>
      <h1>Dynamic App</h1>
      <script src="/boot.js"></script>
    </body></html>`,
  },
  'https://dynamic.test/boot.js': {
    type: 'text/javascript',
    body:
      `const part = '/la' + 'te-chunk' + '.json';\n` +
      `fetch(part).then((r) => r.json()).then((data) => {\n` +
      `  document.body.dataset.late = data.value;\n` +
      `}).catch(() => { document.body.dataset.late = 'failed'; });`,
  },
  'https://dynamic.test/late-chunk.json': { type: 'application/json', body: '{"value":"loaded"}' },

  /**
   * A site that uses the `PalmOS` bridge, for the permission tests. It records
   * the outcome on the document so a test can read it without a channel of
   * its own.
   */
  'https://bridge.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Bridge App</title></head><body>
      <h1>Bridge App</h1>
      <script src="/bridge-app.js"></script>
    </body></html>`,
  },
  'https://bridge.test/bridge-app.js': {
    type: 'text/javascript',
    body:
      `document.body.dataset.hasBridge = String(typeof window.PalmOS === 'object');\n` +
      `window.tryNotify = () => PalmOS.request('notification', { title: 'From the app' })\n` +
      `  .then(() => { document.body.dataset.notify = 'allowed'; })\n` +
      `  .catch((error) => { document.body.dataset.notify = 'refused: ' + error.message; });\n` +
      `window.tryForbidden = () => PalmOS.request('run-shell-command', { cmd: 'rm -rf /' })\n` +
      `  .then(() => { document.body.dataset.forbidden = 'allowed'; })\n` +
      `  .catch((error) => { document.body.dataset.forbidden = 'refused: ' + error.message; });\n` +
      `window.tryNotify();`,
  },

  /**
   * A site that writes to its own storage, so a test can check that another
   * application, and Palm OS, cannot see it.
   */
  'https://storage-a.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Store A</title></head><body>
      <h1>Store A</h1><script src="/write.js"></script></body></html>`,
  },
  'https://storage-a.test/write.js': {
    type: 'text/javascript',
    body:
      `localStorage.setItem('app-secret', 'written-by-store-a');\n` +
      `document.body.dataset.wrote = 'yes';`,
  },
  'https://storage-b.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Store B</title></head><body>
      <h1>Store B</h1></body></html>`,
  },

  /** A site that plainly needs a server, for the ONLINE_REQUIRED path. */
  'https://live.test/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Live Board</title></head><body>
      <h1>Live Board</h1>
      <script src="/live.js"></script>
    </body></html>`,
  },
  'https://live.test/live.js': {
    type: 'text/javascript',
    body: `const socket = new WebSocket("wss://live.test/stream");\nfetch("/api/board");`,
  },
};

/** Serve the fixture in place of the real fetch service. */
export async function routeFixture(page: Page): Promise<void> {
  await page.route('**/_palm/fetch?url=*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url') ?? '';
    const entry = FIXTURE[target] ?? FIXTURE[`${target}/`];
    if (!entry) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `no fixture for ${target}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: entry.type,
      headers: {
        'X-Palm-Final-Url': target,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Palm-Final-Url, Content-Type',
      },
      body: entry.body,
    });
  });
}

/** Every installed manifest, read from Palm OS's own database. */
export async function installedManifests(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('palm-os');
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<
      Array<{
        id: string;
        name: string;
        entry: string;
        status: string;
        primaryHost: string;
        permissions: string[];
        fileCount: number;
        missingResources: Array<{ url: string; reason: string }>;
        resources: Array<{ path: string }>;
        diagnostics: { websockets: string[]; backendHints: string[] };
      }>
    >((resolve) => {
      const read = db.transaction('apps', 'readonly').objectStore('apps').getAll();
      read.onsuccess = () => resolve(read.result);
    });
  });
}
