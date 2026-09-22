/**
 * The service worker for one installed application.
 *
 * It runs on the application's own origin — `app-7f31c2a4.palm.example` — and
 * serves that application's archive out of that origin's IndexedDB. Palm OS's
 * storage is on a different origin and is unreachable from here; that is the
 * point of the arrangement, and it is why this worker is not the same file as
 * the OS's.
 *
 * Responsibilities:
 *   • serve archived resources by path, with the right content type
 *   • enforce the NETWORK permission, which CSP alone cannot do for requests
 *     the application routes through its own origin
 *   • record every request it could not satisfy, so "this archive is complete"
 *     is a measured claim rather than an assumption
 *
 * Written as a classic worker on purpose: module service workers are still
 * uneven across browsers, and an application that will not start is a worse
 * outcome than a file that cannot use `import`.
 */

const DB_NAME = 'palm-app';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META = 'meta';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* --------------------------------------------------------------------- *
 * Storage
 * --------------------------------------------------------------------- */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(db, store, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(store, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const request = work(tx.objectStore(store));
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    }
  });
}

const getFile = (db, path) => run(db, STORE_FILES, 'readonly', (s) => s.get(path));
const putFile = (db, record) => run(db, STORE_FILES, 'readwrite', (s) => s.put(record));
const getMeta = (db, key) => run(db, STORE_META, 'readonly', (s) => s.get(key));
const putMeta = (db, key, value) => run(db, STORE_META, 'readwrite', (s) => s.put({ key, value }));

/** Cached across requests; a cold worker pays the open cost once. */
let dbPromise = null;
const database = () => (dbPromise ??= openDatabase());

/* --------------------------------------------------------------------- *
 * Manifest
 * --------------------------------------------------------------------- */

let manifestCache = null;

async function manifest() {
  if (manifestCache) return manifestCache;
  const db = await database();
  const record = await getMeta(db, 'manifest');
  manifestCache = record?.value ?? null;
  return manifestCache;
}

/*
 * What this run could not serve, and what it had to fetch.
 *
 * Kept in memory *and* written through to storage: a service worker is
 * terminated whenever the browser feels like it, and a validation report that
 * evaporated between the application starting and Palm OS asking for it would
 * silently turn every archive into an apparently complete one.
 */
const misses = [];
const captured = [];
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushReport();
  }, 250);
}

async function flushReport() {
  try {
    const db = await database();
    await putMeta(db, 'report', { misses: misses.slice(), captured: captured.slice() });
  } catch {
    /* the in-memory copy still answers if the worker survives */
  }
}

/** Merge whatever a previous incarnation of this worker recorded. */
async function loadReport() {
  try {
    const db = await database();
    const record = await getMeta(db, 'report');
    const stored = record?.value;
    if (!stored) return;
    for (const miss of stored.misses ?? []) {
      if (!misses.some((entry) => entry.url === miss.url)) misses.push(miss);
    }
    for (const entry of stored.captured ?? []) {
      if (!captured.some((existing) => existing.path === entry.path)) captured.push(entry);
    }
  } catch {
    /* nothing recorded yet */
  }
}

function recordMiss(url, reason) {
  if (misses.length >= 500) return;
  if (misses.some((entry) => entry.url === url)) return;
  misses.push({ url, reason });
  scheduleFlush();
}

/* --------------------------------------------------------------------- *
 * Path algebra
 * --------------------------------------------------------------------- *
 *
 * Archived resources keep the path the original site used, so an application
 * that requests `/assets/chunk-a1.js` at runtime finds it without the archiver
 * having had to predict the request. Resources from other hosts live under
 * `/_ext/<host>/…`, which is the one shape the original site cannot collide
 * with, because it did not exist there.
 */

const EXT_PREFIX = '/_ext/';

/** The URL an archived path came from, so a miss can be fetched and kept. */
function sourceUrlFor(pathname, search, primaryHost) {
  if (pathname.startsWith(EXT_PREFIX)) {
    const rest = pathname.slice(EXT_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    return `https://${rest.slice(0, slash)}${rest.slice(slash)}${search}`;
  }
  if (!primaryHost) return null;
  return `https://${primaryHost}${pathname}${search}`;
}

/* --------------------------------------------------------------------- *
 * Serving
 * --------------------------------------------------------------------- */

function headersFor(record, extra) {
  const headers = new Headers(extra || {});
  headers.set('Content-Type', record.mime || 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Archived bytes never change under a given path, and re-reading them from
  // IndexedDB on every navigation is the slowest thing this worker does.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return headers;
}

async function documentHeaders(record) {
  const current = await manifest();
  const policy = current?.security;
  const chosen = current?.permissions?.includes('NETWORK') ? policy?.online : policy?.offline;
  return headersFor(record, chosen || {});
}

const isDocument = (record) => /^text\/html/i.test(record.mime || '');

async function serveRecord(record) {
  const headers = isDocument(record) ? await documentHeaders(record) : headersFor(record);
  return new Response(record.data, { status: 200, headers });
}

/** A readable failure page, rather than a browser error the user cannot act on. */
function blockedResponse(message, status) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Unavailable offline</title>` +
      `<style>body{margin:0;height:100vh;display:grid;place-items:center;` +
      `font:14px/1.6 system-ui,sans-serif;background:#0d0f14;color:#8b93a7;text-align:center}` +
      `div{max-width:32rem;padding:0 1rem}</style><div><p>${message}</p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only GET is ever archived. A POST is by definition asking a server to do
  // something, which an offline archive cannot stand in for.
  if (request.method !== 'GET') {
    event.respondWith(handleNonGet(request));
    return;
  }
  event.respondWith(handle(event));
});

async function handleNonGet(request) {
  const current = await manifest();
  if (current?.permissions?.includes('NETWORK')) return fetch(request);
  recordMiss(request.url, 'network-blocked');
  return new Response('This application is installed offline, so it cannot send data to a server.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function handle(event) {
  const request = event.request;
  const url = new URL(request.url);
  const current = await manifest();
  const networkAllowed = Boolean(current?.permissions?.includes('NETWORK'));

  // Anything on another origin is the browser's business, not ours — except
  // that a strictly offline application is not allowed to make the attempt.
  if (url.origin !== self.location.origin) {
    if (networkAllowed) return fetch(request);
    recordMiss(request.url, 'network-blocked');
    return new Response('Blocked: this application has no network permission.', { status: 403 });
  }

  // The runtime itself is served by the server, not from the archive.
  if (url.pathname.startsWith('/_papp/')) return fetch(request);

  const db = await database();
  const entry = current?.entry || '/index.html';
  const path = url.pathname;

  const record = await getFile(db, path === '/' ? entry : path);
  if (record) return serveRecord(record);

  /*
   * A miss. Three things it might be, in order of likelihood:
   *   1. a client-side route — the application's own router will handle it
   *      once the entry document loads
   *   2. a resource the archiver never saw
   *   3. a genuine request to a server that an archive cannot answer
   */
  const wantsHtml =
    request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (networkAllowed) {
    const source = sourceUrlFor(path, url.search, current?.primaryHost);
    const fetched = source ? await captureFromNetwork(db, path, source, current) : null;
    if (fetched) return serveRecord(fetched);
  }

  if (wantsHtml) {
    // SPA fallback: hand the router its entry document. Recorded all the same,
    // because silently serving the wrong document is how an archive comes to
    // look complete when it is not.
    const fallback = await getFile(db, entry);
    if (fallback) {
      recordMiss(request.url, 'spa-fallback');
      return serveRecord(fallback);
    }
  }

  recordMiss(request.url, networkAllowed ? 'not-found' : 'network-blocked');
  return blockedResponse(
    networkAllowed
      ? 'This resource is not part of the downloaded copy and could not be fetched.'
      : 'This resource is not part of the downloaded copy, and this application has no network permission.',
    404,
  );
}

/**
 * Fetch a resource the archiver missed and keep it.
 *
 * This is how an archive becomes complete through use: the requests a bundle
 * makes at runtime are exactly the ones static analysis cannot predict.
 */
async function captureFromNetwork(db, path, sourceUrl, current) {
  const endpoint = current?.osOrigin ? `${current.osOrigin}/_palm/fetch` : '/_palm/fetch';
  try {
    const response = await fetch(`${endpoint}?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) {
      recordMiss(sourceUrl, `fetch-failed-${response.status}`);
      return null;
    }
    const mime = (response.headers.get('Content-Type') || 'application/octet-stream')
      .split(';')[0]
      .trim();
    const data = await response.blob();
    const record = { path, mime, data, source: 'runtime', bytes: data.size, url: sourceUrl };
    await putFile(db, record);
    // Palm OS asks for this list after a capture run.
    captured.push({ path, url: sourceUrl, bytes: data.size, mime });
    scheduleFlush();
    return record;
  } catch (error) {
    recordMiss(sourceUrl, `fetch-error: ${error && error.message}`);
    return null;
  }
}

/* --------------------------------------------------------------------- *
 * Control channel
 * --------------------------------------------------------------------- *
 *
 * Commands that change what is installed are accepted only from the installer
 * document, `/_papp/installer.html`, and the worker checks that itself using
 * the sending client's URL.
 *
 * A shared secret was the obvious alternative and is the wrong one: any code
 * running on this origin — including the archived application — can read this
 * origin's IndexedDB, so a token stored there would be readable by exactly the
 * party it was meant to exclude. Where a message comes from cannot be forged
 * that way. The installer, in turn, only acts on messages from the Palm OS
 * origin, so the chain of custody holds end to end.
 */

const INSTALLER_PATH = '/_papp/installer.html';

/** Commands an ordinary application page must never be able to issue. */
const PRIVILEGED = new Set([
  'palm.sw.install',
  'palm.sw.permissions',
  'palm.sw.clear',
  'palm.sw.report',
]);

function fromInstaller(source) {
  if (!source || typeof source.url !== 'string') return false;
  try {
    return new URL(source.url).pathname === INSTALLER_PATH;
  } catch {
    return false;
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  event.waitUntil(handleMessage(data, event.ports[0], event.source));
});

async function handleMessage(data, port, source) {
  const reply = (payload) => port?.postMessage(payload);

  try {
    if (data.type === 'palm.sw.ping') {
      /*
       * Answered from storage, not from the cached manifest.
       *
       * The manifest is held in memory for speed, so a worker that is still
       * alive when its storage is cleared — which is what eviction looks like
       * — would go on reporting itself installed while 404ing every request.
       * Checking that the entry document is actually readable makes
       * "installed" mean the only thing worth reporting: that this
       * application can still be served.
       */
      const current = await manifest();
      const entry = current?.entry
        ? await getFile(await database(), current.entry).catch(() => null)
        : null;
      if (current && !entry) manifestCache = null;
      return reply({ ok: true, installed: Boolean(current && entry) });
    }

    if (PRIVILEGED.has(data.type) && !fromInstaller(source)) {
      return reply({ ok: false, error: 'Rejected: only the installer may issue this command.' });
    }

    switch (data.type) {
      case 'palm.sw.install': {
        const db = await database();
        for (const file of data.files) {
          await putFile(db, {
            path: file.path,
            mime: file.mime,
            data: file.data,
            bytes: file.data.size,
            url: file.url,
            source: file.source || 'static',
          });
        }
        await putMeta(db, 'manifest', data.manifest);
        manifestCache = data.manifest;
        return reply({ ok: true, files: data.files.length });
      }

      case 'palm.sw.permissions': {
        const db = await database();
        const current = (await manifest()) || {};
        const next = {
          ...current,
          permissions: data.permissions,
          security: data.security ?? current.security,
        };
        await putMeta(db, 'manifest', next);
        manifestCache = next;
        return reply({ ok: true, permissions: next.permissions });
      }

      case 'palm.sw.report': {
        await loadReport();
        const report = { misses: misses.slice(), captured: captured.slice() };
        if (data.reset) {
          misses.length = 0;
          captured.length = 0;
          await flushReport();
        }
        return reply({ ok: true, ...report });
      }

      case 'palm.sw.clear': {
        const db = await database();
        await run(db, STORE_FILES, 'readwrite', (s) => s.clear());
        await run(db, STORE_META, 'readwrite', (s) => s.clear());
        manifestCache = null;
        return reply({ ok: true });
      }

      default:
        return reply({ ok: false, error: `Unknown command ${data.type}` });
    }
  } catch (error) {
    return reply({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}
