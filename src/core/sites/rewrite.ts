/**
 * Turning a live site's URLs into paths inside an application origin.
 *
 * An installed application is served from the root of its own origin, so the
 * archive keeps the paths the original site used: a bundle that asks for
 * `/assets/chunk-a1f3.js` at runtime finds it without the archiver having had
 * to predict the request. Resources from other hosts go under `/_ext/<host>/`,
 * the one shape the original site cannot already have used.
 *
 * All of this is pure string work, and all of it is tested directly. A URL
 * mangled here produces an application that is subtly broken in a way that is
 * very hard to trace back from a blank screen.
 */

import { EXT_PREFIX } from './types';

/* --------------------------------------------------------------------- *
 * Paths
 * --------------------------------------------------------------------- */

/**
 * The path an absolute URL takes inside the application origin.
 *
 * Percent-encoding is preserved exactly as `URL` produces it, because that is
 * the form the browser will ask for later; decoding here and encoding there is
 * how Unicode paths end up 404ing.
 */
export function archivePath(absoluteUrl: string, primaryHost: string): string {
  const url = new URL(absoluteUrl);
  let path = url.pathname;
  if (path === '' || path.endsWith('/')) path += 'index.html';
  if (!path.startsWith('/')) path = `/${path}`;

  // A query string is part of the identity of a generated asset: two calls to
  // `/render?size=2` and `/render?size=4` are different files.
  if (url.search) {
    const suffix = `__${hashString(url.search)}`;
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    path = dot > slash ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}`;
  }

  const local = collapseSlashes(path);
  if (url.host === primaryHost) return local;
  return collapseSlashes(`${EXT_PREFIX}${url.host}${local}`);
}

/** `//a///b` → `/a/b`, without touching the scheme of anything. */
const collapseSlashes = (path: string) => path.replace(/\/{2,}/g, '/');

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The URL an archived path came from.
 *
 * The inverse of `archivePath` for everything except the query-string suffix,
 * which is one-way by construction. The service worker uses this to fetch a
 * resource the archiver never saw.
 */
export function sourceUrlFor(path: string, primaryHost: string): string | null {
  if (!path.startsWith('/')) return null;
  if (path.startsWith(EXT_PREFIX)) {
    const rest = path.slice(EXT_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    return `https://${rest.slice(0, slash)}${rest.slice(slash)}`;
  }
  return primaryHost ? `https://${primaryHost}${path}` : null;
}

/* --------------------------------------------------------------------- *
 * References
 * --------------------------------------------------------------------- */

/** Schemes that are already self-contained or are not resources at all. */
const NON_FETCHABLE = /^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|chrome:|file:|ftp:|#)/i;

/**
 * Absolute URL for a reference, or null when it is not something to fetch.
 *
 * Protocol-relative references (`//cdn.example/x.js`) resolve against the base
 * scheme, which is what a browser does and what naive string handling gets
 * wrong.
 */
export function resolveReference(reference: string, base: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed || NON_FETCHABLE.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // A fragment identifies a place in a document, not a different resource.
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The path a reference should point at once archived, or null to leave it. */
export function localHref(reference: string, base: string, primaryHost: string): string | null {
  const resolved = resolveReference(reference, base);
  if (!resolved) return null;
  const path = archivePath(resolved, primaryHost);
  // The fragment is dropped by `resolveReference`; put it back so in-page
  // anchors keep working.
  const hash = fragmentOf(reference);
  return hash ? `${path}${hash}` : path;
}

function fragmentOf(reference: string): string {
  const index = reference.indexOf('#');
  return index >= 0 ? reference.slice(index) : '';
}

/* --------------------------------------------------------------------- *
 * CSS
 * --------------------------------------------------------------------- */

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi;

/** Every fetchable reference inside a stylesheet. */
export function cssReferences(css: string, base: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(CSS_URL)) {
    const resolved = resolveReference(match[2], base);
    if (resolved) found.add(resolved);
  }
  for (const match of css.matchAll(CSS_IMPORT)) {
    const resolved = resolveReference(match[2], base);
    if (resolved) found.add(resolved);
  }
  return [...found];
}

/** Rewrite a stylesheet's references to point inside the application origin. */
export function rewriteCss(css: string, base: string, primaryHost: string): string {
  return css
    .replace(CSS_URL, (whole, quote: string, raw: string) => {
      const next = localHref(raw, base, primaryHost);
      return next === null ? whole : `url(${quote}${next}${quote})`;
    })
    .replace(CSS_IMPORT, (whole, _quote: string, raw: string) => {
      const next = localHref(raw, base, primaryHost);
      return next === null ? whole : whole.replace(raw, next);
    });
}

/* --------------------------------------------------------------------- *
 * srcset
 * --------------------------------------------------------------------- */

/** Parse `srcset`: a comma-separated list of URL plus optional descriptor. */
export function srcsetEntries(value: string): Array<{ url: string; descriptor: string }> {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...rest] = part.split(/\s+/);
      return { url, descriptor: rest.join(' ') };
    });
}

export function rewriteSrcset(value: string, base: string, primaryHost: string): {
  value: string;
  references: string[];
} {
  const references: string[] = [];
  const rewritten = srcsetEntries(value)
    .map(({ url, descriptor }) => {
      const resolved = resolveReference(url, base);
      if (!resolved) return `${url} ${descriptor}`.trim();
      references.push(resolved);
      return `${archivePath(resolved, primaryHost)} ${descriptor}`.trim();
    })
    .join(', ');
  return { value: rewritten, references };
}

/* --------------------------------------------------------------------- *
 * JavaScript
 * --------------------------------------------------------------------- *
 *
 * Scripts are read, never run. Executing a downloaded bundle to find out what
 * it loads is exactly the thing that must not happen during installation, so
 * this is deliberately a scanner: it finds string literals that look like
 * resources, and it counts the constructs it cannot follow rather than
 * pretending they are not there.
 *
 * It is a heuristic, and the archive status says so: what a bundle computes at
 * runtime is only discoverable by running it, which happens later, in the
 * application's own isolated origin.
 */

/** Extensions worth chasing from inside a script. */
const ASSET_EXTENSIONS =
  'js|mjs|cjs|css|json|wasm|map|png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|txt|md|html';

/** A quoted string that looks like a path or URL to one of those. */
const ASSET_LITERAL = new RegExp(
  `(['"\`])((?:https?:)?//[^'"\`\\s]+?\\.(?:${ASSET_EXTENSIONS})(?:\\?[^'"\`\\s]*)?` +
    `|[./][^'"\`\\s]*?\\.(?:${ASSET_EXTENSIONS})(?:\\?[^'"\`\\s]*)?)\\1`,
  'gi',
);

const WEBSOCKET = /new\s+WebSocket\s*\(\s*(['"`])([^'"`]+)\1/gi;
const WEBSOCKET_LITERAL = /(['"`])(wss?:\/\/[^'"`\s]+)\1/gi;
const WORKER = /new\s+(?:Shared)?Worker\s*\(/gi;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const SW_REGISTER = /serviceWorker\s*\.\s*register\s*\(/i;
const WASM = /WebAssembly\s*\.\s*(?:instantiate|compile)(?:Streaming)?\s*\(/i;
const API_CALL = /(['"`])(\/(?:api|graphql|rest|v\d)\/[^'"`\s]*)\1/gi;

export interface ScriptScan {
  /** Absolute URLs worth trying to archive. */
  references: string[];
  websockets: string[];
  backendHints: string[];
  workers: number;
  dynamicImports: number;
  wasm: boolean;
  serviceWorker: boolean;
}

/** Scan for a size beyond which the regex work costs more than it is worth. */
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

export function scanScript(source: string, base: string): ScriptScan {
  const text = source.length > MAX_SCAN_BYTES ? source.slice(0, MAX_SCAN_BYTES) : source;

  const references = new Set<string>();
  for (const match of text.matchAll(ASSET_LITERAL)) {
    const resolved = resolveReference(match[2], base);
    if (resolved) references.add(resolved);
  }

  const websockets = new Set<string>();
  for (const match of text.matchAll(WEBSOCKET)) websockets.add(match[2]);
  for (const match of text.matchAll(WEBSOCKET_LITERAL)) websockets.add(match[2]);

  const backendHints = new Set<string>();
  for (const match of text.matchAll(API_CALL)) backendHints.add(match[2]);

  return {
    references: [...references],
    websockets: [...websockets],
    backendHints: [...backendHints],
    workers: [...text.matchAll(WORKER)].length,
    dynamicImports: [...text.matchAll(DYNAMIC_IMPORT)].length,
    wasm: WASM.test(text),
    serviceWorker: SW_REGISTER.test(text),
  };
}
