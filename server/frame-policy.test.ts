import { describe, expect, it } from 'vitest';
import {
  FRAME_VERDICT,
  frameVerdict,
  parseFrameAncestors,
  parseXFrameOptions,
} from './frame-policy.mjs';

const OS = 'https://os.palm.example';

describe('parseXFrameOptions', () => {
  it('normalises case and whitespace', () => {
    expect(parseXFrameOptions('DENY')).toBe('deny');
    expect(parseXFrameOptions('  SameOrigin ')).toBe('sameorigin');
  });

  it('reads the first value when a server sends the header twice', () => {
    expect(parseXFrameOptions('DENY, SAMEORIGIN')).toBe('deny');
  });

  it('flags the obsolete ALLOW-FROM rather than trusting it', () => {
    expect(parseXFrameOptions('ALLOW-FROM https://palm.example')).toBe('allow-from');
  });

  it('returns null for an absent header', () => {
    expect(parseXFrameOptions(null)).toBeNull();
    expect(parseXFrameOptions('')).toBeNull();
  });
});

describe('parseFrameAncestors', () => {
  it('finds the directive among others', () => {
    expect(parseFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *")).toEqual([
      "'none'",
    ]);
  });

  it('distinguishes absent from empty', () => {
    // Absent means the site has no opinion; empty means nobody may frame it.
    expect(parseFrameAncestors("default-src 'self'")).toBeNull();
    expect(parseFrameAncestors('frame-ancestors')).toEqual([]);
  });

  it('collects sources across several comma-joined policies', () => {
    expect(
      parseFrameAncestors("frame-ancestors 'self', frame-ancestors https://partner.example"),
    ).toEqual(["'self'", 'https://partner.example']);
  });

  it('is case-insensitive about the directive name', () => {
    expect(parseFrameAncestors('Frame-Ancestors *')).toEqual(['*']);
  });
});

describe('frameVerdict', () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it('allows a response with no framing headers', () => {
    expect(frameVerdict(headers({}), OS).verdict).toBe(FRAME_VERDICT.allowed);
  });

  it('denies frame-ancestors none', () => {
    const result = frameVerdict(headers({ 'content-security-policy': "frame-ancestors 'none'" }), OS);
    expect(result.verdict).toBe(FRAME_VERDICT.denied);
    expect(result.source).toBe('frame-ancestors');
  });

  it("denies frame-ancestors 'self' for a cross-origin embedder", () => {
    expect(
      frameVerdict(headers({ 'content-security-policy': "frame-ancestors 'self'" }), OS).verdict,
    ).toBe(FRAME_VERDICT.denied);
  });

  it('allows when our origin is listed', () => {
    expect(
      frameVerdict(
        headers({ 'content-security-policy': 'frame-ancestors https://os.palm.example' }),
        OS,
      ).verdict,
    ).toBe(FRAME_VERDICT.allowed);
  });

  it('allows a wildcard host that covers us', () => {
    expect(
      frameVerdict(headers({ 'content-security-policy': 'frame-ancestors *.palm.example' }), OS)
        .verdict,
    ).toBe(FRAME_VERDICT.allowed);
  });

  it('allows a bare wildcard', () => {
    expect(
      frameVerdict(headers({ 'content-security-policy': 'frame-ancestors *' }), OS).verdict,
    ).toBe(FRAME_VERDICT.allowed);
  });

  it('lets CSP override X-Frame-Options, as browsers do', () => {
    const result = frameVerdict(
      headers({ 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' }),
      OS,
    );
    expect(result.verdict).toBe(FRAME_VERDICT.allowed);
    expect(result.source).toBe('frame-ancestors');
  });

  it('reports SAMEORIGIN distinctly from DENY', () => {
    // Worth separating: the wording shown to the user differs, and a same-
    // origin-only site is not refusing everyone.
    expect(frameVerdict(headers({ 'x-frame-options': 'SAMEORIGIN' }), OS).verdict).toBe(
      FRAME_VERDICT.sameOriginOnly,
    );
    expect(frameVerdict(headers({ 'x-frame-options': 'DENY' }), OS).verdict).toBe(
      FRAME_VERDICT.denied,
    );
  });

  it('treats obsolete ALLOW-FROM as unknown rather than protection', () => {
    expect(
      frameVerdict(headers({ 'x-frame-options': 'ALLOW-FROM https://x.example' }), OS).verdict,
    ).toBe(FRAME_VERDICT.unknown);
  });

  it('accepts a plain header object as well as a Headers instance', () => {
    expect(frameVerdict({ 'x-frame-options': 'DENY' }, OS).verdict).toBe(FRAME_VERDICT.denied);
  });
});
