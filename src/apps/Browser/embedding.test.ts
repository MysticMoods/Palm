import { describe, expect, it } from 'vitest';
import { FRAME_VERDICT, chooseMode, explainMode, needsRealOrigin } from './embedding';
import type { FramePolicy } from './embedding';

const policy = (verdict: FramePolicy['verdict'], source = 'x-frame-options'): FramePolicy => ({
  url: 'https://example.test/',
  verdict,
  source,
});

describe('needsRealOrigin', () => {
  it('recognises the well-known identity providers', () => {
    expect(needsRealOrigin('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(needsRealOrigin('https://login.microsoftonline.com/common/oauth2/authorize')).toBe(true);
    expect(needsRealOrigin('https://github.com/login/oauth/authorize')).toBe(true);
  });

  it('recognises an authorisation request by its parameters', () => {
    expect(
      needsRealOrigin('https://any.test/authz?response_type=code&client_id=abc&redirect_uri=x'),
    ).toBe(true);
  });

  it('does not treat a single common parameter as an OAuth flow', () => {
    // `client_id` alone turns up on plenty of ordinary pages.
    expect(needsRealOrigin('https://any.test/page?client_id=abc')).toBe(false);
  });

  it('recognises sign-in paths', () => {
    for (const path of ['/login', '/sign-in', '/signin', '/sso/start', '/auth/callback']) {
      expect(needsRealOrigin(`https://any.test${path}`)).toBe(true);
    }
  });

  it('leaves ordinary pages alone', () => {
    for (const url of [
      'https://example.test/',
      'https://example.test/docs/authentication-guide',
      'https://example.test/blog/how-login-works',
    ]) {
      expect(needsRealOrigin(url)).toBe(false);
    }
  });

  it('is false for an unparseable address rather than throwing', () => {
    expect(needsRealOrigin('not a url')).toBe(false);
  });
});

describe('chooseMode', () => {
  it('embeds a site that permits it', () => {
    expect(chooseMode('https://example.test/', policy(FRAME_VERDICT.allowed))).toBe('embedded');
  });

  it('opens normally when the site refuses', () => {
    expect(chooseMode('https://example.test/', policy(FRAME_VERDICT.denied))).toBe('normal');
    expect(chooseMode('https://example.test/', policy(FRAME_VERDICT.sameOriginOnly))).toBe('normal');
  });

  it('opens a sign-in flow normally whatever the headers say', () => {
    // Even a site that would allow framing cannot complete OAuth in one.
    expect(chooseMode('https://accounts.google.com/o/oauth2/auth', policy(FRAME_VERDICT.allowed))).toBe(
      'normal',
    );
  });

  it('tries embedding when the check could not be made', () => {
    // Refusing on an unknown would make Palm OS needlessly useless whenever
    // the probe is blocked; a frame that fails is recoverable.
    expect(chooseMode('https://example.test/', policy(FRAME_VERDICT.unknown))).toBe('embedded');
    expect(chooseMode('https://example.test/', null)).toBe('embedded');
  });
});

describe('explainMode', () => {
  it('names the header responsible', () => {
    expect(explainMode('https://example.test/', policy(FRAME_VERDICT.denied))).toContain(
      'X-Frame-Options: DENY',
    );
    expect(
      explainMode('https://example.test/', policy(FRAME_VERDICT.denied, 'frame-ancestors')),
    ).toContain('content security policy');
  });

  it('explains a sign-in flow in terms the user can act on', () => {
    expect(explainMode('https://accounts.google.com/o/oauth2/auth', null)).toContain('sign-in flow');
  });

  it('passes on the reason a probe failed', () => {
    const text = explainMode('https://example.test/', {
      url: 'https://example.test/',
      verdict: FRAME_VERDICT.unknown,
      source: 'probe-failed',
      error: 'Could not reach example.test.',
    });
    expect(text).toContain('Could not reach example.test.');
  });
});
