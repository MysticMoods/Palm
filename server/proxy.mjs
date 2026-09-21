#!/usr/bin/env node
/**
 * The standalone Palm OS server.
 *
 * In development and preview the same middleware chain is mounted inside Vite,
 * so this exists for real deployments. It does two things a static host cannot:
 * it runs the fetch service, and it routes by Host so that every installed
 * application gets its own origin.
 *
 *   node server/proxy.mjs --port 8788 --root dist
 *
 * A CDN or object store can serve `dist/` perfectly well, but it cannot give
 * `app-7f31c2a4.palm.example` different content from `palm.example` — and
 * without that, applications would have to share the OS's origin, which is the
 * one thing this architecture exists to prevent. See docs/DEPLOYMENT.md.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { palmService } from './palm-service.mjs';

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const port = Number(argOf('port', process.env.PORT)) || 8788;
const root = resolve(argOf('root', 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Resolve a request path inside the root, refusing anything that escapes it. */
function safeJoin(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const target = resolve(join(root, normalize(decoded)));
  return target === root || target.startsWith(root + sep) ? target : null;
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let target = safeJoin(url.pathname);
  if (!target) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    target = join(target, 'index.html');
    info = await stat(target).catch(() => null);
  }

  // Single-page fallback: unknown paths are routes, not missing files. Asset
  // requests are excluded so a genuine 404 does not arrive as HTML.
  if (!info && !extname(url.pathname)) {
    target = join(root, 'index.html');
    info = await stat(target).catch(() => null);
  }

  if (!info) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }

  const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', info.size);
  // Hashed build assets are immutable; documents must not be.
  res.setHeader(
    'Cache-Control',
    /\/assets\/.+-[A-Za-z0-9_-]{8,}\./.test(url.pathname)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  if (extname(target) === '.js' && url.pathname === '/_papp/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
  }
  createReadStream(target).pipe(res);
}

const server = createServer((req, res) => {
  void palmService(req, res, () => void serveStatic(req, res));
});

server.listen(port, () => {
  console.log(`Palm OS listening on http://localhost:${port} (serving ${root})`);
  console.log('Application origins: http://app-<id>.localhost:' + port);
});
