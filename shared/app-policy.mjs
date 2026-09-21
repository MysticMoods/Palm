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

/** Headers for the Palm OS origin itself. */
export function osSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Palm OS frames application origins, so it cannot isolate itself from
    // them entirely — but nothing may frame Palm OS.
    'X-Frame-Options': 'DENY',
  };
}
