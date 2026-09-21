/**
 * Detecting whether a site permits being embedded.
 *
 * Palm OS does not strip `X-Frame-Options` or `frame-ancestors`. Those headers
 * are a site's anti-clickjacking control, and a proxy that removes them turns
 * the OS into a clickjacking tool aimed at whoever is logged in. So instead of
 * defeating the protection, we read it, and let the browser choose the right
 * mode up front rather than presenting a blank rectangle and hoping.
 *
 * The parsing lives apart from the network call so it can be tested against
 * the header shapes that actually occur in the wild.
 */

import { assertFetchable, BlockedError } from './guards.mjs';

/** Outcome vocabulary shared with the client. */
export const FRAME_VERDICT = {
  allowed: 'ALLOWED',
  denied: 'DENIED',
  sameOriginOnly: 'SAME_ORIGIN_ONLY',
  unknown: 'UNKNOWN',
};

/**
 * Pull the `frame-ancestors` source list out of a CSP header.
 *
 * Returns null when the header does not mention it — which is not the same as
 * an empty list: absent means "no opinion", empty means "nobody".
 */
export function parseFrameAncestors(csp) {
  if (!csp) return null;
  // A response may carry several CSP headers; the most restrictive wins, so
  // every one of them has to be considered.
  const policies = String(csp).split(',');
  let result = null;

  for (const policy of policies) {
    for (const directive of policy.split(';')) {
      const parts = directive.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) continue;
      if (parts[0].toLowerCase() !== 'frame-ancestors') continue;
      const sources = parts.slice(1).map((source) => source.toLowerCase());
      result = result === null ? sources : [...result, ...sources];
    }
  }
  return result;
}

/** Normalise `X-Frame-Options`, which is case-insensitive and often repeated. */
export function parseXFrameOptions(value) {
  if (!value) return null;
  const first = String(value).split(',')[0].trim().toLowerCase();
  if (first === 'deny') return 'deny';
  if (first === 'sameorigin') return 'sameorigin';
  // ALLOW-FROM was removed from every current browser, so a site relying on it
  // has, in practice, no framing protection at all. Say so rather than guess.
  if (first.startsWith('allow-from')) return 'allow-from';
  return 'unknown';
}

/**
 * Decide how a response's headers constrain embedding by `embedderOrigin`.
 *
 * CSP wins where both are present, which is what browsers do.
 */
export function frameVerdict(headers, embedderOrigin) {
  const get = (name) =>
    typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? null;

  const ancestors = parseFrameAncestors(get('content-security-policy'));
  if (ancestors !== null) {
    if (ancestors.length === 0 || ancestors.includes("'none'")) {
      return { verdict: FRAME_VERDICT.denied, source: 'frame-ancestors' };
    }
    if (ancestors.includes('*')) {
      return { verdict: FRAME_VERDICT.allowed, source: 'frame-ancestors' };
    }
    if (embedderOrigin && ancestors.some((source) => originMatches(source, embedderOrigin))) {
      return { verdict: FRAME_VERDICT.allowed, source: 'frame-ancestors' };
    }
    // `'self'` and a list of other origins both land here: someone may embed
    // this, but not us.
    return { verdict: FRAME_VERDICT.denied, source: 'frame-ancestors' };
  }

  const xfo = parseXFrameOptions(get('x-frame-options'));
  if (xfo === 'deny') return { verdict: FRAME_VERDICT.denied, source: 'x-frame-options' };
  if (xfo === 'sameorigin') {
    return { verdict: FRAME_VERDICT.sameOriginOnly, source: 'x-frame-options' };
  }
  if (xfo === 'allow-from') {
    return { verdict: FRAME_VERDICT.unknown, source: 'x-frame-options' };
  }

  return { verdict: FRAME_VERDICT.allowed, source: 'none' };
}

/** Does a CSP source expression cover this origin? */
function originMatches(source, origin) {
  if (source === '*') return true;
  let candidate;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  // Scheme-only sources, e.g. `https:`.
  if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return source === candidate.protocol;

  const withScheme = source.includes('://') ? source : `${candidate.protocol}//${source}`;
  let allowed;
  try {
    allowed = new URL(withScheme);
  } catch {
    return false;
  }
  if (allowed.hostname.startsWith('*.')) {
    const suffix = allowed.hostname.slice(1); // ".example.com"
    return candidate.hostname.endsWith(suffix);
  }
  return allowed.hostname === candidate.hostname && (!allowed.port || allowed.port === candidate.port);
}

/**
 * Ask a site how it feels about being framed.
 *
 * GET rather than HEAD: enough servers answer HEAD with a 405, or omit the
 * security headers from it, that HEAD produces confident wrong answers.
 */
export async function probeFramePolicy(rawUrl, embedderOrigin, options = {}) {
  const { timeoutMs = 8000 } = options;
  const { url } = await assertFetchable(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PalmOS-FrameProbe/1.0)', Accept: 'text/html,*/*' },
    });
  } finally {
    clearTimeout(timer);
  }
  // The body is irrelevant; releasing it promptly keeps the socket free.
  await response.body?.cancel().catch(() => undefined);

  const decision = frameVerdict(response.headers, embedderOrigin);
  return {
    url: response.url || url.toString(),
    status: response.status,
    verdict: decision.verdict,
    source: decision.source,
    xFrameOptions: response.headers.get('x-frame-options'),
    frameAncestors: parseFrameAncestors(response.headers.get('content-security-policy')),
  };
}

/** Node handler for `GET /_palm/frame-policy?url=…`. */
export async function framePolicyMiddleware(req, res, next) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (!requestUrl.pathname.startsWith('/_palm/frame-policy')) return next?.();

  const respond = (status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(payload));
  };

  const target = requestUrl.searchParams.get('url');
  if (!target) return respond(400, { error: 'Pass a ?url= parameter.' });
  const embedder = requestUrl.searchParams.get('embedder') ?? '';

  try {
    return respond(200, await probeFramePolicy(target, embedder));
  } catch (error) {
    if (error instanceof BlockedError) return respond(403, { error: error.message });
    // A probe that cannot complete must not claim the site refuses embedding;
    // "unknown" lets the browser try, which is the compatible default.
    return respond(200, {
      url: target,
      verdict: FRAME_VERDICT.unknown,
      source: 'probe-failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
