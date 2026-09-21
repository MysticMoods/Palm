/**
 * Address-bar parsing and the internal `palm:` pages.
 *
 * Only http and https are ever navigated to. `javascript:`, `data:` and
 * `blob:` URLs are rejected outright — accepting them would turn the address
 * bar into a script-injection vector.
 */

export const INTERNAL_SCHEME = 'palm:';

export const INTERNAL_PAGES = {
  start: 'palm:start',
  bookmarks: 'palm:bookmarks',
  history: 'palm:history',
  downloads: 'palm:downloads',
  about: 'palm:about',
} as const;

export type InternalPage = (typeof INTERNAL_PAGES)[keyof typeof INTERNAL_PAGES];

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
} as const;

export type SearchEngineId = keyof typeof SEARCH_ENGINES;
export const SEARCH_ENGINE_LIST = Object.entries(SEARCH_ENGINES).map(([id, engine]) => ({
  id: id as SearchEngineId,
  ...engine,
}));

export function isInternal(url: string): boolean {
  return url.startsWith(INTERNAL_SCHEME);
}

/** Looks enough like a hostname to try as a URL rather than a search. */
function looksLikeHost(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (value.startsWith('localhost')) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(value);
}

export interface ResolvedAddress {
  url: string;
  kind: 'internal' | 'web' | 'search' | 'rejected';
  /** Explanation shown to the user when `kind` is `rejected`. */
  reason?: string;
}

export function resolveAddress(input: string, engine: SearchEngineId = 'duckduckgo'): ResolvedAddress {
  const value = input.trim();
  if (value.length === 0) return { url: INTERNAL_PAGES.start, kind: 'internal' };

  if (isInternal(value)) {
    const known = Object.values(INTERNAL_PAGES).includes(value as InternalPage);
    return known
      ? { url: value, kind: 'internal' }
      : { url: INTERNAL_PAGES.start, kind: 'internal' };
  }

  const lower = value.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('file:') ||
    lower.startsWith('vbscript:')
  ) {
    return {
      url: INTERNAL_PAGES.start,
      kind: 'rejected',
      reason: `"${value.split(':')[0]}:" addresses are not allowed — they can run code or read local files.`,
    };
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      return { url: new URL(value).toString(), kind: 'web' };
    } catch {
      return { url: INTERNAL_PAGES.start, kind: 'rejected', reason: 'That is not a valid web address.' };
    }
  }

  if (looksLikeHost(value)) {
    try {
      return { url: new URL(`https://${value}`).toString(), kind: 'web' };
    } catch {
      /* fall through to search */
    }
  }

  return { url: `${SEARCH_ENGINES[engine].url}${encodeURIComponent(value)}`, kind: 'search' };
}

export function displayAddress(url: string): string {
  if (isInternal(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function hostOf(url: string): string {
  if (isInternal(url)) return 'Palm OS';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Favicon via the site's own /favicon.ico — no third-party proxy involved. */
export function faviconFor(url: string): string | null {
  if (isInternal(url)) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/**
 * Sites that publish permissive framing headers, used for the start page.
 * Most of the web sends `X-Frame-Options: DENY` or a restrictive
 * `frame-ancestors`, which no browser-based app can override.
 */
export const EMBEDDABLE_SUGGESTIONS = [
  { name: 'Example.com', url: 'https://example.com', description: 'The canonical test page' },
  { name: 'MDN Play', url: 'https://developer.mozilla.org/en-US/play', description: 'Web docs playground' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org', description: 'Usually opens externally' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org', description: 'Maps' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', description: 'Tech news' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com', description: 'Search' },
];
