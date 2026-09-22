/**
 * The security headers an isolated application origin is served with.
 *
 * Shared by the server (which serves the bootstrap document) and by each
 * application's own service worker (which serves everything after that), so
 * the policy cannot drift between the two paths into the same origin.
 *
 * The policy protects Palm OS and the rest of the web from the application.
 * It does not try to protect the application from itself: `unsafe-eval` and
 * `unsafe-inline` are permitted inside the application origin because real
 * bundles need them, and withholding them would break compatibility without
 * buying anything — the isolation that matters is the origin boundary.
 */

/** Sources that are local to the application in every sense. */
const LOCAL = "'self' blob: data:";

/**
 * @param options.osOrigin      the Palm OS origin permitted to frame this app
 * @param options.allowNetwork  whether the app may talk to the network at all
 */
export function appContentSecurityPolicy({ osOrigin, allowNetwork } = {}) {
  const remote = allowNetwork ? ' https: http:' : '';
  const ancestors = osOrigin ? osOrigin : "'self'";

  return [
    `default-src ${LOCAL}${remote}`,
    `script-src ${LOCAL}${remote} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${LOCAL}${remote} 'unsafe-inline'`,
    `img-src ${LOCAL}${remote}`,
    `font-src ${LOCAL}${remote}`,
    `media-src ${LOCAL}${remote}`,
    // The one that matters most offline: with no remote sources here the
    // application cannot reach a server, a WebSocket or an event stream, which
    // a service worker alone could not guarantee.
    `connect-src ${LOCAL}${remote}`,
    `worker-src 'self' blob:`,
    `frame-src ${LOCAL}${remote}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action ${LOCAL}${remote}`,
    // Only Palm OS may frame an application, so an installed app cannot be
    // lifted out of the OS and embedded somewhere it would look official.
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

/** Everything an application-origin response should carry, as a plain object. */
export function appSecurityHeaders({ osOrigin, allowNetwork } = {}) {
  return {
    'Content-Security-Policy': appContentSecurityPolicy({ osOrigin, allowNetwork }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Device access is never granted to an archived application. Palm OS's own
    // applications ask through the permission system instead.
    'Permissions-Policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'serial=()',
      'midi=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  };
}

/**
 * The Palm OS origin's own policy.
 *
 * Palm OS is first-party code and uses no `eval`, `new Function` or
 * `dangerouslySetInnerHTML` — so `script-src 'self'` costs nothing and is the
 * directive doing the real work here. It means no inline script, no remote
 * script and no eval can run on the origin that holds the user's files, even
 * if something later introduces an injection bug.
 *
 * The permissive directives are permissive because the Browser application
 * legitimately needs them: it embeds arbitrary sites in a frame and fetches
 * arbitrary URLs to download them. Tightening those would break the feature
 * rather than protect anything — the frame is separately sandboxed, and the
 * fetch is subject to CORS.
 */
export function osContentSecurityPolicy() {
  // Both schemes: an installed deployment is https, and dev and preview are
  // http on localhost.
  const web = 'https: http:';

  return [
    `default-src 'self'`,
    // The one that matters.
    `script-src 'self'`,
    // React writes inline `style` attributes in ~70 places; `style-src-attr`
    // is not honoured widely enough to rely on instead.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${web}`,
    `font-src 'self' data:`,
    `media-src 'self' data: blob: ${web}`,
    // The Browser downloads pages; installed applications are fetched through
    // the archiver on this origin.
    `connect-src 'self' ${web}`,
    `worker-src 'self' blob:`,
    // The Browser embeds remote sites, and the OS frames application origins.
    `frame-src 'self' data: blob: ${web}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Nothing may frame Palm OS itself.
    `frame-ancestors 'none'`,
  ].join('; ');
}

/**
 * Headers for the Palm OS origin itself.
 *
 * @param options.dev  true for the Vite dev server, which injects an inline
 *   module preamble for React Fast Refresh. `script-src 'self'` would block
 *   it, so the policy is applied to preview and production builds only —
 *   exactly where it is the code users actually run.
 */
export function osSecurityHeaders({ dev = false } = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Kept alongside `frame-ancestors` for browsers that honour only this.
    'X-Frame-Options': 'DENY',
    ...(dev ? {} : { 'Content-Security-Policy': osContentSecurityPolicy() }),
  };
}
