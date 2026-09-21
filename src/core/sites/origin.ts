/**
 * Where an installed application lives.
 *
 * Every application is served from its own origin, so that the boundary
 * between Palm OS and third-party code is the browser's same-origin policy
 * rather than a sandbox attribute or a convention. The rules for deriving that
 * origin are shared with the server — one implementation, so a request cannot
 * be routed one way and framed another.
 */

import { appOriginFor, isValidAppId, supportsAppOrigins, splitHost } from '../../../shared/origins.mjs';

export { isValidAppId };

/** A fresh application id: `app-` plus twelve hex characters. */
export function newAppId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `app-${hex}`;
}

/** The origin Palm OS itself is served from. */
export function osOrigin(): string {
  return window.location.origin;
}

/** The origin an application is served from, or null if it cannot have one. */
export function appOrigin(appId: string): string | null {
  return appOriginFor(appId, {
    protocol: window.location.protocol,
    host: window.location.host,
  });
}

/** The address of an application's install frame. */
export function installerUrl(appId: string): string | null {
  const origin = appOrigin(appId);
  return origin ? `${origin}/_papp/installer.html` : null;
}

/* --------------------------------------------------------------------- *
 * Deployment capability
 * --------------------------------------------------------------------- */

export interface IsolationStatus {
  /** True when applications can be given their own origin here. */
  available: boolean;
  /** Plain-language explanation when they cannot. */
  reason: string | null;
  osOrigin: string;
  /** Example of where an application would be served, for the details panel. */
  template: string | null;
  /** True when service workers are usable, without which nothing runs offline. */
  serviceWorkers: boolean;
}

let cached: Promise<IsolationStatus> | null = null;

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Can this deployment isolate applications?
 *
 * Asked of the server rather than assumed, because the answer depends on how
 * Palm OS is being reached: behind a wildcard domain, yes; by IP address, no.
 * When the answer is no, installation is refused rather than falling back to
 * sharing the OS origin — a fallback that "works" would be the one outcome
 * this architecture exists to avoid.
 */
export function isolationStatus(): Promise<IsolationStatus> {
  cached ??= probe();
  return cached;
}

/** Discard the cached answer; used by tests and after a deployment change. */
export function resetIsolationCache(): void {
  cached = null;
}

async function probe(): Promise<IsolationStatus> {
  const serviceWorkers = serviceWorkerSupported();
  const local = localVerdict();

  try {
    const response = await fetch('/_palm/origin-info', { cache: 'no-store' });
    if (response.ok) {
      const info = (await response.json()) as {
        osOrigin?: string;
        isolation?: string;
        reason?: string | null;
        appOriginTemplate?: string | null;
      };
      const available = info.isolation === 'available';
      return {
        available,
        reason: available ? null : info.reason ?? local.reason,
        osOrigin: info.osOrigin ?? osOrigin(),
        template: info.appOriginTemplate ?? null,
        serviceWorkers,
      };
    }
  } catch {
    /* fall through to the local answer */
  }

  /*
   * No answer from the server. That is itself informative: application origins
   * need a server that routes by Host, and a deployment without one cannot
   * isolate applications however the hostname looks.
   */
  return {
    ...local,
    osOrigin: osOrigin(),
    serviceWorkers,
  };
}

/** What we can tell from the address bar alone. */
function localVerdict(): Pick<IsolationStatus, 'available' | 'reason' | 'template'> {
  const parts = splitHost(window.location.host);
  if (!parts || !supportsAppOrigins(parts.hostname)) {
    return {
      available: false,
      reason:
        'Palm OS is being reached at an address that cannot have per-application subdomains, so applications cannot be given their own origin.',
      template: null,
    };
  }
  return {
    available: false,
    reason:
      'The Palm OS server is not answering, so per-application origins cannot be confirmed. Installing would mean running downloaded code without an isolation boundary.',
    template: null,
  };
}
