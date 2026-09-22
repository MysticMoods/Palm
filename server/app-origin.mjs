/**
 * Routing by Host, so that an installed application and Palm OS are served
 * from genuinely different origins.
 *
 *   https://palm.example/                Palm OS
 *   https://app-7f31c2a4.palm.example/   one installed application
 *
 * The rule this enforces is short and absolute: **Palm OS's own document is
 * never served on an application host.** Without that, a request to
 * `app-x.palm.example/` would fall through to the SPA handler, boot a second
 * copy of the OS on the application's origin, and blur the boundary the whole
 * design rests on.
 *
 * Applications are not served from disk here. Each one's archive lives in its
 * own origin's storage and is served by its own service worker; this handler
 * only provides the small runtime that installs and starts that worker.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appIdFromHost, baseHostFrom, splitHost, supportsAppOrigins } from '../shared/origins.mjs';
import { appSecurityHeaders, osSecurityHeaders } from '../shared/app-policy.mjs';

/** Files the application runtime is allowed to load from the server. */
const RUNTIME_PREFIX = '/_papp/';

/** Modules under `shared/` that the in-browser runtime is served directly. */
const SHARED_MODULES = new Set(['origins.mjs', 'app-policy.mjs']);

async function serveSharedModule(res, name) {
  if (!SHARED_MODULES.has(name)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const path = fileURLToPath(new URL(`../shared/${name}`, import.meta.url));
  try {
    const source = await readFile(path);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(source);
  } catch {
    res.statusCode = 500;
    res.end('Could not read the shared module.');
  }
}

/** Work out the scheme, honouring a reverse proxy in front of us. */
function protocolOf(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  if (forwarded) return `${forwarded}:`;
  return req.socket?.encrypted ? 'https:' : 'http:';
}

/** The Palm OS origin, derived from whatever host this request arrived on. */
export function osOriginOf(req) {
  const base = baseHostFrom(req.headers.host);
  return base ? `${protocolOf(req)}//${base}` : null;
}

/**
 * The bootstrap document for an application origin.
 *
 * It exists for the cold case: the service worker is normally installed before
 * the application is ever opened, but storage can be evicted, or the user can
 * open the origin directly. Registering and reloading from here means an
 * application recovers by itself instead of showing whatever the static
 * handler would otherwise have returned.
 */
function bootstrapDocument(appId) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Starting…</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light dark }
  body { margin:0; height:100vh; display:grid; place-items:center;
         font:14px/1.5 system-ui,sans-serif; background:#0d0f14; color:#8b93a7 }
  .box { text-align:center; max-width:34rem; padding:0 1rem }
  code { font-size:12px; color:#5f6880 }
</style>
</head>
<body>
  <div class="box">
    <p id="status">Starting this application…</p>
    <p><code>${appId}</code></p>
  </div>
  <script type="module">
    const status = document.getElementById('status');
    const fail = (message) => { status.textContent = message; };

    if (!('serviceWorker' in navigator)) {
      fail('This browser will not run offline applications here: service workers are unavailable in this context.');
    } else {
      try {
        await navigator.serviceWorker.register('/_papp/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        // The worker now controls this origin, so a reload is answered from
        // the archive rather than by this placeholder.
        location.reload();
      } catch (error) {
        fail('Offline installation could not be completed: ' + error.message);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Connect-style middleware. Mounted ahead of the static and SPA handlers.
 */
export function appOriginMiddleware(req, res, next, options = {}) {
  const host = req.headers.host;
  const appId = appIdFromHost(host);
  const osOrigin = osOriginOf(req);

  if (!appId) {
    // The Palm OS origin. Add its own headers and carry on.
    for (const [name, value] of Object.entries(osSecurityHeaders(options))) {
      res.setHeader(name, value);
    }
    return next?.();
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  /*
   * Network permission is not known here — it lives in the application's own
   * storage, and the service worker applies the accurate policy to everything
   * it serves. The bootstrap document is given the strict policy, because it
   * needs nothing but its own origin.
   */
  for (const [name, value] of Object.entries(appSecurityHeaders({ osOrigin, allowNetwork: false }))) {
    res.setHeader(name, value);
  }

  if (pathname.startsWith(RUNTIME_PREFIX)) {
    // A worker script at /_papp/ may only claim a scope that broad if the
    // server says so.
    if (pathname === '/_papp/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    // The installer needs the same origin rules the server routes by. Serving
    // the shared module rather than copying it into `public/` is what keeps
    // the two from drifting apart.
    if (pathname === '/_papp/origins.mjs') return serveSharedModule(res, 'origins.mjs');
    // Everything else under /_papp/ is a static file of the application runtime.
    return next?.();
  }

  /*
   * Only a navigation gets the bootstrap document. A write reaching the server
   * means the application asked its own server for something and the service
   * worker was not there to say no — answering with an HTML page and a 200
   * would tell it the request succeeded.
   */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'palm-os-archive',
        message:
          'This is a downloaded copy of an application, not the server it talks to. ' +
          'Requests that send data cannot be answered.',
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(bootstrapDocument(appId));
}

/**
 * `GET /_palm/origin-info` — what Palm OS needs to know about its deployment.
 *
 * Isolation is a property of how the OS is reached, not of the code, so the
 * client cannot assume it. Asking means the App Store can refuse to install
 * rather than quietly falling back to sharing the OS origin.
 */
export function originInfoMiddleware(req, res, next) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/_palm/origin-info') return next?.();

  const base = baseHostFrom(req.headers.host);
  const parts = splitHost(base);
  const isolated = parts ? supportsAppOrigins(parts.hostname) : false;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      osOrigin: osOriginOf(req),
      baseHost: base,
      isolation: isolated ? 'available' : 'unavailable',
      reason: isolated
        ? null
        : 'Palm OS is being reached by IP address, which cannot have per-application subdomains.',
      /** Present so a deployment can be checked without installing anything. */
      appOriginTemplate: isolated ? `${protocolOf(req)}//app-<id>.${base}` : null,
    }),
  );
}
