/**
 * Choosing between embedded viewing and a real browser tab.
 *
 * Palm OS shows a site inside a window when the site permits it, and hands it
 * to the real browser when it does not. What it never does is strip the
 * headers that say no: `X-Frame-Options` and `frame-ancestors` are a site's
 * anti-clickjacking control, and a proxy that removes them turns the OS into a
 * clickjacking tool pointed at whoever is logged in.
 *
 * So the decision is made by asking, not by trying and watching it fail. The
 * rules are pure functions and tested; the asking is one fetch.
 */

/** What the server's headers said about being framed. */
export const FRAME_VERDICT = {
  allowed: 'ALLOWED',
  denied: 'DENIED',
  sameOriginOnly: 'SAME_ORIGIN_ONLY',
  unknown: 'UNKNOWN',
} as const;

export type FrameVerdict = (typeof FRAME_VERDICT)[keyof typeof FRAME_VERDICT];

export interface FramePolicy {
  url: string;
  verdict: FrameVerdict;
  source: string;
  xFrameOptions?: string | null;
  frameAncestors?: string[] | null;
  error?: string;
}

export type BrowseMode = 'embedded' | 'normal';

/**
 * Flows that only work on the site's real origin.
 *
 * An OAuth authorisation URL is bound to a redirect URI registered against a
 * real origin, and a sign-in page sets cookies that a third-party frame will
 * not get back. Rewriting either to point at Palm OS does not make them work;
 * it makes them fail in a more confusing way. These are recognised up front so
 * the user is sent somewhere that can actually complete the flow.
 */
const AUTH_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'github.com/login',
  'gitlab.com/users/sign_in',
  'auth0.com',
  'okta.com',
  'login.yahoo.com',
  'www.facebook.com/dialog/oauth',
  'api.twitter.com/oauth',
  'discord.com/oauth2',
];

const AUTH_PATHS = /\/(oauth2?|authorize|signin|sign-in|sign_in|login|log-in|sso|saml|auth)(\/|$)/i;

const OAUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge'];

/** True when this address needs the site's own origin to work at all. */
export function needsRealOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostAndPath = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (AUTH_HOSTS.some((candidate) => hostAndPath.startsWith(candidate))) return true;

  // An authorisation request carries the parameters that identify it; two of
  // them together is a strong enough signal, one alone is not.
  const present = OAUTH_PARAMS.filter((name) => parsed.searchParams.has(name));
  if (present.length >= 2) return true;

  return AUTH_PATHS.test(parsed.pathname);
}

/** The mode to open an address in, given what we know about it. */
export function chooseMode(url: string, policy: FramePolicy | null): BrowseMode {
  if (needsRealOrigin(url)) return 'normal';
  if (!policy) return 'embedded';
  switch (policy.verdict) {
    case FRAME_VERDICT.denied:
    case FRAME_VERDICT.sameOriginOnly:
      return 'normal';
    // An unknown verdict means the probe could not reach the site, or the site
    // uses a header no current browser honours. Trying is the compatible
    // choice: a frame that fails is recoverable, a refusal that was wrong is
    // just Palm OS being needlessly useless.
    case FRAME_VERDICT.unknown:
    case FRAME_VERDICT.allowed:
    default:
      return 'embedded';
  }
}

/** One sentence explaining why a site will not be embedded. */
export function explainMode(url: string, policy: FramePolicy | null): string {
  if (needsRealOrigin(url)) {
    return 'This address is part of a sign-in flow, which only works on the website’s own address. Palm OS cannot stand in for it.';
  }
  if (!policy) return 'Palm OS has not checked this site yet.';

  switch (policy.verdict) {
    case FRAME_VERDICT.denied:
      return policy.source === 'frame-ancestors'
        ? 'This website’s content security policy lists who may embed it, and Palm OS is not on the list.'
        : 'This website sends X-Frame-Options: DENY, which tells your browser to refuse to display it inside another page.';
    case FRAME_VERDICT.sameOriginOnly:
      return 'This website allows embedding only by itself (X-Frame-Options: SAMEORIGIN).';
    case FRAME_VERDICT.unknown:
      return policy.error
        ? `Palm OS could not check this site (${policy.error}), so it will try to embed it.`
        : 'This website uses a framing header no current browser honours, so the result is uncertain.';
    case FRAME_VERDICT.allowed:
    default:
      return 'This website permits being embedded.';
  }
}

/** Ask the fetch service what a site's headers say. */
export async function probeFramePolicy(url: string, signal?: AbortSignal): Promise<FramePolicy> {
  const endpoint = `/_palm/frame-policy?url=${encodeURIComponent(url)}&embedder=${encodeURIComponent(
    window.location.origin,
  )}`;
  try {
    const response = await fetch(endpoint, { signal });
    const body = (await response.json()) as FramePolicy & { error?: string };
    if (!response.ok) {
      return { url, verdict: FRAME_VERDICT.unknown, source: 'probe-failed', error: body.error };
    }
    return body;
  } catch (error) {
    return {
      url,
      verdict: FRAME_VERDICT.unknown,
      source: 'probe-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
