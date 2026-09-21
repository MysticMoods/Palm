import { describe, expect, it } from 'vitest';
import { appContentSecurityPolicy, appSecurityHeaders, osSecurityHeaders } from './app-policy.mjs';

const OS = 'https://os.palm.example';

/** Pull one directive out of a policy string. */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe('appContentSecurityPolicy', () => {
  it('cuts off every remote source when the app is offline', () => {
    const policy = appContentSecurityPolicy({ osOrigin: OS, allowNetwork: false });
    // Every fetch directive, checked individually: `frame-ancestors` names the
    // OS origin and so legitimately contains a scheme.
    const fetchDirectives = policy
      .split(';')
      .map((part) => part.trim())
      .filter((part) => !part.startsWith('frame-ancestors'));
    for (const part of fetchDirectives) {
      expect(part).not.toContain('https:');
      expect(part).not.toContain('http:');
    }
    // connect-src is the directive that stops fetch, XHR, EventSource *and*
    // WebSockets, which a service worker cannot intercept.
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' blob: data:");
  });

  it('permits remote sources once network access is granted', () => {
    const policy = appContentSecurityPolicy({ osOrigin: OS, allowNetwork: true });
    expect(directive(policy, 'connect-src')).toContain('https:');
  });

  it('lets only Palm OS frame an application', () => {
    const policy = appContentSecurityPolicy({ osOrigin: OS, allowNetwork: true });
    expect(directive(policy, 'frame-ancestors')).toBe(`frame-ancestors ${OS}`);
  });

  it("falls back to 'self' when no OS origin is known", () => {
    expect(directive(appContentSecurityPolicy({}), 'frame-ancestors')).toBe(
      "frame-ancestors 'self'",
    );
  });

  it('allows the unsafe script sources real bundles need', () => {
    // Deliberate: the boundary that protects Palm OS is the origin, not CSP
    // inside the app. Refusing these would break compatibility for nothing.
    const policy = appContentSecurityPolicy({ osOrigin: OS, allowNetwork: false });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'");
  });

  it('never allows plugins or a rewritten base URL', () => {
    const policy = appContentSecurityPolicy({ osOrigin: OS, allowNetwork: true });
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
  });
});

describe('appSecurityHeaders', () => {
  it('denies device access regardless of network permission', () => {
    for (const allowNetwork of [true, false]) {
      const headers = appSecurityHeaders({ osOrigin: OS, allowNetwork });
      expect(headers['Permissions-Policy']).toContain('camera=()');
      expect(headers['Permissions-Policy']).toContain('microphone=()');
      expect(headers['Permissions-Policy']).toContain('geolocation=()');
    }
  });

  it('sends no referrer, so an app cannot learn the OS origin that way', () => {
    expect(appSecurityHeaders({ osOrigin: OS })['Referrer-Policy']).toBe('no-referrer');
  });

  it('forbids content sniffing', () => {
    expect(appSecurityHeaders({ osOrigin: OS })['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('osSecurityHeaders', () => {
  it('refuses to let Palm OS itself be framed', () => {
    expect(osSecurityHeaders()['X-Frame-Options']).toBe('DENY');
  });
});
