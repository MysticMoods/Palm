/**
 * The Palm OS fetch service.
 *
 * A page cannot read a cross-origin resource the server has not opted into
 * sharing, so archiving a site for offline use needs something outside the
 * browser to do the fetching. This is that, and nothing more: it retrieves a
 * URL and hands back the bytes with permissive CORS headers.
 *
 * What it deliberately does not do:
 *   • It does not strip framing headers to make sites embeddable live. That
 *     would defeat a clickjacking control the site chose on purpose.
 *   • It does not forward cookies, credentials or the caller's headers, so it
 *     cannot be used to reach anything behind a login.
 *   • It does not follow redirects blindly — each hop is re-validated, or a
 *     public URL could bounce to a private one.
 */

import { assertFetchable, BlockedError } from './guards.mjs';

export const DEFAULTS = {
  /** Generous enough for an application bundle, small enough to bound abuse. */
  maxBytes: 12 * 1024 * 1024,
  timeoutMs: 20_000,
  maxRedirects: 5,
};

/** A browser-ish UA: some servers refuse unknown clients outright. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; PalmOS-Archiver/1.0; +offline-archive)';

export class FetchFailure extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'FetchFailure';
    this.status = status;
  }
}

/**
 * Fetch a URL, following redirects manually so each destination is checked.
 */
export async function fetchResource(rawUrl, options = {}) {
  const { maxBytes, timeoutMs, maxRedirects } = { ...DEFAULTS, ...options };

  let target = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { url } = await assertFetchable(target);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          'Accept-Language': 'en',
        },
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof BlockedError) throw error;
      throw new FetchFailure(
        error?.name === 'AbortError'
          ? `Timed out after ${timeoutMs}ms fetching ${url.hostname}.`
          : `Could not reach ${url.hostname}.`,
      );
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FetchFailure('Redirect without a destination.');
      // Re-enter the loop so the new target is validated too.
      target = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      throw new FetchFailure(`${url.hostname} responded ${response.status}.`, response.status);
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      throw new FetchFailure(
        `That resource is ${Math.round(declared / 1024 / 1024)}MB, over the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`,
        413,
      );
    }

    const body = await readCapped(response, maxBytes);
    return {
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      body,
    };
  }

  throw new FetchFailure(`Gave up after ${maxRedirects} redirects.`);
}

/** Read a response body, aborting if it exceeds the cap mid-stream. */
async function readCapped(response, maxBytes) {
  if (!response.body) return new Uint8Array(0);

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchFailure(
        `That resource exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`,
        413,
      );
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Node request handler for `GET /_palm/fetch?url=…`.
 *
 * Mounted by the Vite dev and preview servers, and by the standalone service.
 */
export async function fetchMiddleware(req, res, next) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (!requestUrl.pathname.startsWith('/_palm/fetch')) return next?.();

  const respond = (status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.end();
    return;
  }
  if (req.method !== 'GET') return respond(405, { error: 'Use GET.' });

  const target = requestUrl.searchParams.get('url');
  if (!target) return respond(400, { error: 'Pass a ?url= parameter.' });

  try {
    const result = await fetchResource(target);
    res.statusCode = 200;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'X-Palm-Final-Url, Content-Type');
    // The archiver needs the post-redirect URL to resolve relative links.
    res.setHeader('X-Palm-Final-Url', result.url);
    res.end(Buffer.from(result.body));
  } catch (error) {
    if (error instanceof BlockedError) return respond(403, { error: error.message });
    if (error instanceof FetchFailure) return respond(error.status, { error: error.message });
    return respond(500, { error: 'The fetch service failed unexpectedly.' });
  }
}
