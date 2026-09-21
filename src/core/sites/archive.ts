/**
 * Building an offline archive of a web application.
 *
 * The pipeline, in order:
 *
 *   fetch entry → parse → static discovery → normalise → dependency walk
 *   → archive → status
 *
 * Installation and validation happen after this, in `store.ts`, because they
 * need the application's own origin: the bytes are written there, the
 * application is started once, and what it asks for at runtime is folded back
 * into the manifest. Static analysis alone cannot tell you what a modern
 * bundle loads, and this module does not pretend otherwise — it records what
 * it could not follow instead of quietly declaring success.
 *
 * Scripts are read, never executed. Fetching goes through the Palm OS fetch
 * service, because a page cannot read a cross-origin resource whose server has
 * not opted into sharing it.
 */

import { newAppId } from './origin';
import {
  archivePath,
  cssReferences,
  resolveReference,
  rewriteCss,
  rewriteSrcset,
  scanScript,
} from './rewrite';
import { computeStatus, expectedOffline } from './manifest';
import {
  ARCHIVE_STATUS,
  ARCHIVE_VERSION,
  DEFAULT_APP_PERMISSIONS,
  EMPTY_DIAGNOSTICS,
  ArchiveError,
} from './types';
import type {
  AppManifest,
  ArchiveDiagnostics,
  ArchiveFile,
  ArchiveProgress,
  ArchiveResource,
  MissingResource,
} from './types';

/** Endpoint of the fetch service, mounted by the dev and preview servers. */
const FETCH_ENDPOINT = '/_palm/fetch';

const LIMITS = {
  /*
   * Enough for a real application bundle without archiving half the web.
   *
   * Sized from measurement rather than taste: a current build of Excalidraw
   * needs a little over four hundred files, and a cap that cuts a real
   * application in half produces a PARTIAL archive for no good reason. Bytes
   * are the limit that actually protects the device; the count is a backstop
   * against a crawl that has gone wrong.
   */
  maxResources: 1200,
  maxTotalBytes: 64 * 1024 * 1024,
  /** Stylesheets can import stylesheets; two levels is plenty in practice. */
  maxCssDepth: 3,
  /** How far to follow references discovered inside scripts. */
  maxScriptDepth: 2,
  /*
   * Resources fetched at once. Serially, a four-hundred-file application takes
   * minutes, which is long enough that people assume it has hung. Six is
   * polite to the origin server while removing most of that wait.
   */
  concurrency: 6,
};

/** The runtime script injected into an archived page (see `bridge.js`). */
const BRIDGE_SRC = '/_papp/bridge.js';

type ResourceKind = 'asset' | 'css' | 'script' | 'manifest';

interface Fetched {
  finalUrl: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

async function fetchThrough(url: string, signal?: AbortSignal): Promise<Fetched> {
  const response = await fetch(`${FETCH_ENDPOINT}?url=${encodeURIComponent(url)}`, { signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new ArchiveError(detail.error ?? `Could not fetch ${url}`);
  }
  return {
    finalUrl: response.headers.get('X-Palm-Final-Url') ?? url,
    mime: (response.headers.get('Content-Type') ?? 'application/octet-stream').split(';')[0].trim(),
    bytes: new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>,
  };
}

export interface ArchiveResult {
  manifest: AppManifest;
  files: ArchiveFile[];
}

export interface ArchiveOptions {
  name?: string;
  /** Reuse an id, e.g. when migrating or re-archiving in place. */
  appId?: string;
  onProgress?: (progress: ArchiveProgress) => void;
  signal?: AbortSignal;
}

/** Attributes carrying a single fetchable URL, by selector. */
const URL_ATTRIBUTES: Array<[selector: string, attribute: string, kind: ResourceKind]> = [
  ['script[src]', 'src', 'script'],
  ['img[src]', 'src', 'asset'],
  ['source[src]', 'src', 'asset'],
  ['video[src]', 'src', 'asset'],
  ['audio[src]', 'src', 'asset'],
  ['video[poster]', 'poster', 'asset'],
  ['embed[src]', 'src', 'asset'],
  ['object[data]', 'data', 'asset'],
  ['iframe[src]', 'src', 'asset'],
  ['input[src]', 'src', 'asset'],
  ['track[src]', 'src', 'asset'],
  ['use[href]', 'href', 'asset'],
  ['image[href]', 'href', 'asset'],
];

/**
 * Archive `url` and everything it references.
 */
export async function archiveSite(url: string, options: ArchiveOptions = {}): Promise<ArchiveResult> {
  const { onProgress, signal } = options;
  const report = (progress: ArchiveProgress) => onProgress?.(progress);
  const abortIfCancelled = () => {
    if (signal?.aborted) throw new ArchiveError('Download cancelled.');
  };

  /* ------------------------------ 1. Entry ----------------------------- */

  report({ stage: 'fetching', message: 'Fetching the page…', fetched: 0, total: 1 });
  const entry = await fetchThrough(url, signal);
  if (!/^text\/html/i.test(entry.mime)) {
    throw new ArchiveError(
      `That address returned ${entry.mime}, not a web page. Applications are archived from HTML pages.`,
    );
  }

  const appId = options.appId ?? newAppId();
  const baseUrl = entry.finalUrl;
  const primaryHost = new URL(baseUrl).host;
  const html = new TextDecoder().decode(entry.bytes);

  /* ------------------------------ 2. Parse ----------------------------- */

  report({ stage: 'parsing', message: 'Reading the page…', fetched: 1, total: 1 });
  const document_ = new DOMParser().parseFromString(html, 'text/html');

  /*
   * A <base> tag would repoint every relative URL once the page is served from
   * our origin, so references are resolved against it and it is then removed.
   */
  const baseTag = document_.querySelector('base[href]');
  const resolveBase = baseTag
    ? new URL(baseTag.getAttribute('href')!, baseUrl).toString()
    : baseUrl;
  baseTag?.remove();

  const diagnostics: ArchiveDiagnostics = { ...EMPTY_DIAGNOSTICS, websockets: [], backendHints: [] };
  const queue = new Map<string, { kind: ResourceKind; depth: number }>();
  const enqueue = (reference: string | null, kind: ResourceKind, depth = 0) => {
    if (!reference) return;
    const existing = queue.get(reference);
    if (!existing || existing.depth > depth) queue.set(reference, { kind, depth });
  };

  /* ------------------------ 3. Static discovery ------------------------ */

  for (const [selector, attribute, kind] of URL_ATTRIBUTES) {
    for (const element of document_.querySelectorAll(selector)) {
      const raw = element.getAttribute(attribute);
      const resolved = resolveReference(raw ?? '', resolveBase);
      if (!resolved) continue;
      enqueue(resolved, kind);
      element.setAttribute(attribute, archivePath(resolved, primaryHost));
    }
  }

  // `<link>` covers stylesheets, icons, preloads, prefetches and the web app
  // manifest, which need telling apart: only some are stylesheets, and the
  // manifest is worth reading for a name and an icon.
  for (const element of document_.querySelectorAll('link[href]')) {
    const relation = (element.getAttribute('rel') ?? '').toLowerCase();
    const resolved = resolveReference(element.getAttribute('href') ?? '', resolveBase);
    if (!resolved) continue;
    // A canonical or alternate link is metadata about another page, not a
    // resource this application needs; rewriting it would be wrong.
    if (/\b(canonical|alternate|author|license|dns-prefetch|preconnect)\b/.test(relation)) continue;

    const kind: ResourceKind = relation.includes('stylesheet')
      ? 'css'
      : relation.includes('manifest')
        ? 'manifest'
        : 'asset';
    enqueue(resolved, kind);
    element.setAttribute('href', archivePath(resolved, primaryHost));
  }

  for (const element of document_.querySelectorAll('[srcset]')) {
    const { value, references } = rewriteSrcset(
      element.getAttribute('srcset') ?? '',
      resolveBase,
      primaryHost,
    );
    for (const reference of references) enqueue(reference, 'asset');
    element.setAttribute('srcset', value);
  }

  // `imagesrcset` on a preload link follows the same rules as `srcset`.
  for (const element of document_.querySelectorAll('link[imagesrcset]')) {
    const { value, references } = rewriteSrcset(
      element.getAttribute('imagesrcset') ?? '',
      resolveBase,
      primaryHost,
    );
    for (const reference of references) enqueue(reference, 'asset');
    element.setAttribute('imagesrcset', value);
  }

  for (const style of document_.querySelectorAll('style')) {
    const css = style.textContent ?? '';
    for (const reference of cssReferences(css, resolveBase)) enqueue(reference, 'asset');
    style.textContent = rewriteCss(css, resolveBase, primaryHost);
  }

  for (const element of document_.querySelectorAll('[style]')) {
    const css = element.getAttribute('style') ?? '';
    for (const reference of cssReferences(css, resolveBase)) enqueue(reference, 'asset');
    element.setAttribute('style', rewriteCss(css, resolveBase, primaryHost));
  }

  // Inline scripts are scanned like external ones, but not rewritten: editing
  // code by regular expression would break more than it fixed.
  for (const script of document_.querySelectorAll('script:not([src])')) {
    absorbScan(diagnostics, scanScript(script.textContent ?? '', resolveBase), enqueue, 1);
  }

  /*
   * A form posts to a server. Nothing archived can answer it, so the action is
   * made absolute — submitting will at least reach the real site — and
   * recorded as evidence that this application expects a backend.
   */
  for (const form of document_.querySelectorAll('form[action]')) {
    const resolved = resolveReference(form.getAttribute('action') ?? '', resolveBase);
    if (!resolved) continue;
    form.setAttribute('action', resolved);
    form.setAttribute('target', '_blank');
    diagnostics.backendHints.push(new URL(resolved).pathname);
  }

  /*
   * Links are made absolute and opened outside the archive. An archive is one
   * application, not a copy of a site, and a link that silently did nothing
   * would be worse than one that opens properly in a real browser tab.
   */
  for (const anchor of document_.querySelectorAll('a[href], area[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    // An in-page anchor stays as it is.
    if (href.startsWith('#')) continue;
    const resolved = resolveReference(href, resolveBase);
    if (!resolved) continue;
    anchor.setAttribute('href', resolved);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }

  /* ------------------------- 4. Dependency walk ------------------------ */

  const files: ArchiveFile[] = [];
  const resources: ArchiveResource[] = [];
  const missing: MissingResource[] = [];
  const seen = new Set<string>();
  let totalBytes = entry.bytes.byteLength;

  const store = (absoluteUrl: string, mime: string, data: BlobPart, size: number) => {
    const path = archivePath(absoluteUrl, primaryHost);
    if (files.some((file) => file.path === path)) return;
    files.push({ path, url: absoluteUrl, mime, data: new Blob([data], { type: mime }), source: 'static' });
    resources.push({ path, url: absoluteUrl, mime, bytes: size, source: 'static' });
  };

  let processed = 0;
  const pending: Array<[string, ResourceKind, number]> = [...queue].map(([reference, meta]) => [
    reference,
    meta.kind,
    meta.depth,
  ]);

  /** Fetch one resource, storing it and queueing whatever it references. */
  const fetchOne = async (reference: string, kind: ResourceKind, depth: number): Promise<void> => {
    processed += 1;
    report({
      stage: 'assets',
      message: `Fetching ${new URL(reference).pathname.split('/').pop() || reference}`,
      fetched: processed,
      total: processed + pending.length,
    });

    try {
      const resource = await fetchThrough(reference, signal);
      totalBytes += resource.bytes.byteLength;

      if (kind === 'css' || /^text\/css/i.test(resource.mime)) {
        const css = new TextDecoder().decode(resource.bytes);
        if (depth < LIMITS.maxCssDepth) {
          for (const nested of cssReferences(css, resource.finalUrl)) {
            if (!seen.has(nested)) pending.push([nested, 'asset', depth + 1]);
          }
        }
        const rewritten = rewriteCss(css, resource.finalUrl, primaryHost);
        store(reference, 'text/css', rewritten, rewritten.length);
        return;
      }

      if (kind === 'script' || /javascript|ecmascript/i.test(resource.mime)) {
        const source = new TextDecoder().decode(resource.bytes);
        const scan = scanScript(source, resource.finalUrl);
        absorbScan(
          diagnostics,
          scan,
          (ref, refKind, refDepth) => {
            if (refDepth !== undefined && refDepth > LIMITS.maxScriptDepth) return;
            if (ref && !seen.has(ref)) pending.push([ref, refKind, refDepth ?? depth + 1]);
          },
          depth + 1,
        );
        // Stored verbatim: the paths it contains already match the archive,
        // because the archive keeps the site's own path layout.
        store(reference, resource.mime, resource.bytes, resource.bytes.byteLength);
        return;
      }

      if (kind === 'manifest') {
        absorbManifest(resource, enqueueInto(pending, seen, depth));
        store(reference, resource.mime, resource.bytes, resource.bytes.byteLength);
        return;
      }

      store(reference, resource.mime, resource.bytes, resource.bytes.byteLength);
    } catch (error) {
      // One unreachable asset must not abandon the whole archive.
      missing.push({
        url: reference,
        reason: error instanceof Error ? error.message : 'fetch-failed',
      });
    }
  };

  /*
   * Breadth-first, a batch at a time. Each resource can queue more work, so
   * the list is re-read every round rather than snapshotted.
   */
  while (pending.length > 0) {
    abortIfCancelled();

    const batch: Array<[string, ResourceKind, number]> = [];
    while (batch.length < LIMITS.concurrency && pending.length > 0) {
      const item = pending.shift()!;
      if (seen.has(item[0])) continue;
      seen.add(item[0]);

      if (files.length + batch.length >= LIMITS.maxResources || totalBytes >= LIMITS.maxTotalBytes) {
        diagnostics.truncated = true;
        missing.push({ url: item[0], reason: 'archive-limit' });
        continue;
      }
      batch.push(item);
    }

    await Promise.all(batch.map(([reference, kind, depth]) => fetchOne(reference, kind, depth)));
  }

  /* --------------------------- 5. Finish up ---------------------------- */

  report({ stage: 'assets', message: 'Assembling…', fetched: processed, total: processed });

  /*
   * The bridge gives an archived application a way to ask Palm OS for things —
   * a notification, a file — through a checked message channel, instead of
   * having no route at all. Nothing it offers works without permission.
   */
  const bridge = document_.createElement('script');
  bridge.setAttribute('src', BRIDGE_SRC);
  document_.head.insertBefore(bridge, document_.head.firstChild);

  const entryPath = archivePath(baseUrl, primaryHost);
  const finalHtml = `<!doctype html>\n${document_.documentElement.outerHTML}`;
  files.push({
    path: entryPath,
    url: baseUrl,
    mime: 'text/html',
    data: new Blob([finalHtml], { type: 'text/html' }),
    source: 'static',
  });
  resources.push({
    path: entryPath,
    url: baseUrl,
    mime: 'text/html',
    bytes: finalHtml.length,
    source: 'static',
  });

  diagnostics.websockets = [...new Set(diagnostics.websockets)].slice(0, 20);
  diagnostics.backendHints = [...new Set(diagnostics.backendHints)].slice(0, 20);

  const status = computeStatus({
    resourceCount: resources.length,
    hasEntry: true,
    missing,
    diagnostics,
  });

  const title = document_.querySelector('title')?.textContent?.trim();
  const manifest: AppManifest = {
    id: appId,
    name: options.name?.trim() || title || primaryHost,
    version: '1.0.0',
    source: baseUrl,
    primaryHost,
    entry: entryPath,
    icon: 'Globe',
    color: '#38b6f0',
    status,
    offline: expectedOffline(status),
    networkRequired: status === ARCHIVE_STATUS.onlineRequired,
    permissions: [...DEFAULT_APP_PERMISSIONS],
    resources,
    missingResources: missing,
    diagnostics,
    bytes: resources.reduce((sum, resource) => sum + resource.bytes, 0),
    fileCount: resources.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archiveVersion: ARCHIVE_VERSION,
  };

  report({ stage: 'done', message: 'Archived', fetched: processed, total: processed });
  return { manifest, files };
}

/* --------------------------------------------------------------------- *
 * Helpers
 * --------------------------------------------------------------------- */

type Enqueue = (reference: string | null, kind: ResourceKind, depth?: number) => void;

/** Fold a script scan into the running diagnostics and the work queue. */
function absorbScan(
  diagnostics: ArchiveDiagnostics,
  scan: ReturnType<typeof scanScript>,
  enqueue: Enqueue,
  depth: number,
): void {
  diagnostics.websockets.push(...scan.websockets);
  diagnostics.backendHints.push(...scan.backendHints);
  diagnostics.workers += scan.workers;
  diagnostics.dynamicImports += scan.dynamicImports;
  diagnostics.wasm ||= scan.wasm;
  diagnostics.serviceWorker ||= scan.serviceWorker;

  for (const reference of scan.references) {
    enqueue(reference, /\.css(\?|$)/i.test(reference) ? 'css' : guessKind(reference), depth);
  }
}

const guessKind = (reference: string): ResourceKind =>
  /\.(m?js|cjs)(\?|$)/i.test(reference) ? 'script' : 'asset';

/** Push straight onto the pending list, respecting what has been seen. */
function enqueueInto(
  pending: Array<[string, ResourceKind, number]>,
  seen: Set<string>,
  depth: number,
): Enqueue {
  return (reference, kind) => {
    if (!reference || seen.has(reference)) return;
    pending.push([reference, kind, depth + 1]);
  };
}

/** Read a web app manifest for the icons it points at. */
function absorbManifest(resource: Fetched, enqueue: Enqueue): void {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(resource.bytes)) as {
      icons?: Array<{ src?: string }>;
      start_url?: string;
    };
    for (const icon of parsed.icons ?? []) {
      enqueue(resolveReference(icon.src ?? '', resource.finalUrl), 'asset');
    }
  } catch {
    // A malformed manifest is the site's problem, not a reason to stop.
  }
}

export { archivePath, cssReferences, resolveReference, rewriteCss, localHref } from './rewrite';
