/**
 * Origin algebra for isolated application hosts.
 *
 * Palm OS and every installed application must live on separate origins, so
 * that the browser's own same-origin policy — not a sandbox attribute, not a
 * convention — is what keeps an archived application out of the OS's storage.
 *
 * The scheme is one subdomain per application:
 *
 *   https://os.palm.example/          Palm OS
 *   https://app-7f31c2a4.palm.example/   one installed application
 *   https://app-9b02de11.palm.example/   another, isolated from the first
 *
 * This module is deliberately pure and free of Node built-ins: the same rules
 * have to hold on the server (routing a request) and in the browser (deciding
 * where to point an iframe), and the only way to guarantee that is to test one
 * implementation and compile it into both.
 */

/** Application ids are DNS labels, so the alphabet is restricted on purpose. */
export const APP_ID_PATTERN = /^app-[0-9a-f]{8,32}$/;

/** Matches an application host and captures its id. */
const APP_HOST = /^(app-[0-9a-f]{8,32})\.(.+)$/;

/** Hosts that cannot carry a subdomain, so cannot host isolated applications. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isValidAppId(id) {
  return typeof id === 'string' && APP_ID_PATTERN.test(id);
}

/**
 * Split a Host header into hostname and port.
 *
 * IPv6 literals are bracketed (`[::1]:4173`), which a naive split on ":" gets
 * wrong — and getting it wrong here would mean routing an application request
 * to the OS.
 */
export function splitHost(host) {
  const value = String(host ?? '').trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return null;
    const hostname = value.slice(0, close + 1);
    const rest = value.slice(close + 1);
    if (rest && !rest.startsWith(':')) return null;
    return { hostname, port: rest ? rest.slice(1) : '' };
  }

  const colon = value.indexOf(':');
  if (colon === -1) return { hostname: value, port: '' };
  if (value.indexOf(':', colon + 1) !== -1) return null; // bare IPv6, unbracketed
  return { hostname: value.slice(0, colon), port: value.slice(colon + 1) };
}

/**
 * True when this hostname can have application subdomains under it.
 *
 * An IP literal cannot: `app-x.127.0.0.1` is not a name that resolves. A
 * deployment reached by IP therefore cannot isolate applications, and Palm OS
 * has to say so rather than quietly fall back to sharing its own origin.
 */
export function supportsAppOrigins(hostname) {
  const value = String(hostname ?? '').toLowerCase();
  if (!value) return false;
  if (value.startsWith('[')) return false; // IPv6 literal
  if (IPV4.test(value)) return false;
  // `localhost` and anything under it resolve to loopback and are treated as a
  // secure context, which is what service workers need.
  return true;
}

/**
 * The application id this Host header addresses, or null for the OS itself.
 */
export function appIdFromHost(host) {
  const parts = splitHost(host);
  if (!parts) return null;
  const match = APP_HOST.exec(parts.hostname);
  if (!match) return null;
  return isValidAppId(match[1]) ? match[1] : null;
}

/**
 * The base domain applications hang off, given any Host header.
 *
 * Passing an application host in returns the same base as passing the OS host,
 * so this is safe to call on a request that has already been routed.
 */
export function baseHostFrom(host) {
  const parts = splitHost(host);
  if (!parts) return null;
  const match = APP_HOST.exec(parts.hostname);
  const hostname = match ? match[2] : parts.hostname;
  return parts.port ? `${hostname}:${parts.port}` : hostname;
}

/** The full origin for an application, derived from where Palm OS is served. */
export function appOriginFor(appId, { protocol, host }) {
  if (!isValidAppId(appId)) return null;
  const base = baseHostFrom(host);
  if (!base) return null;
  const parts = splitHost(base);
  if (!supportsAppOrigins(parts.hostname)) return null;
  const scheme = String(protocol ?? 'https:').replace(/:?$/, ':');
  return `${scheme}//${appId}.${base}`;
}
