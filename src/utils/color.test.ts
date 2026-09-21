import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hexToRgb,
  hexToTriplet,
  isValidHex,
  readableAccentTriplet,
  readableForeground,
  rgbToHex,
} from './color';

const parse = (triplet: string) => {
  const [r, g, b] = triplet.split(' ').map(Number);
  return { r, g, b };
};

describe('parsing', () => {
  it('reads six-digit hex', () => {
    expect(hexToRgb('#5884ff')).toEqual({ r: 88, g: 132, b: 255 });
  });

  it('expands three-digit hex', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
  });

  it('tolerates a missing hash and stray whitespace', () => {
    expect(hexToRgb('  5884ff ')).toEqual({ r: 88, g: 132, b: 255 });
  });

  it('rejects nonsense', () => {
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(isValidHex('#gggggg')).toBe(false);
  });

  it('round-trips through rgbToHex', () => {
    expect(rgbToHex(hexToRgb('#5884ff')!)).toBe('#5884ff');
  });

  it('falls back rather than emitting an invalid custom property', () => {
    expect(hexToTriplet('nope')).toBe('88 132 255');
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio({ r: 88, g: 132, b: 255 }, { r: 88, g: 132, b: 255 })).toBeCloseTo(1, 5);
  });

  it('does not depend on argument order', () => {
    const a = { r: 20, g: 30, b: 40 };
    const b = { r: 200, g: 210, b: 220 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe('readableForeground', () => {
  it('picks dark text on a light accent', () => {
    expect(readableForeground('#f0e040')).toBe('17 17 17');
  });

  it('picks light text on a dark accent', () => {
    expect(readableForeground('#2a2a6a')).toBe('255 255 255');
  });

  it('always clears AA against its own background', () => {
    for (const hex of ['#5884ff', '#f0e040', '#69c94a', '#2bc4b0', '#ff6b5e', '#111111']) {
      const bg = hexToRgb(hex)!;
      expect(contrastRatio(parse(readableForeground(hex)), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('readableAccentTriplet', () => {
  /*
   * The accent is user-chosen, so it cannot be assumed readable as text. This
   * derives a variant that clears AA against the surface of the active theme.
   */
  const LIGHT_SURFACE = { r: 241, g: 243, b: 248 };
  const DARK_SURFACE = { r: 32, g: 36, b: 48 };

  it('leaves an already-readable accent alone', () => {
    expect(readableAccentTriplet('#5884ff', 'dark')).toBe('88 132 255');
  });

  it('darkens a pale accent for the light theme', () => {
    const result = parse(readableAccentTriplet('#f0e040', 'light'));
    expect(contrastRatio(result, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a dark accent for the dark theme', () => {
    const result = parse(readableAccentTriplet('#101040', 'dark'));
    expect(contrastRatio(result, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears AA for every shipped preset in both themes', () => {
    const presets = ['#5884ff', '#a06bff', '#f25ec0', '#ff6b5e', '#f0a030', '#69c94a', '#2bc4b0', '#38b6f0'];
    for (const hex of presets) {
      expect(contrastRatio(parse(readableAccentTriplet(hex, 'light')), LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(parse(readableAccentTriplet(hex, 'dark')), DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('honours a stricter target for high contrast mode', () => {
    const result = parse(readableAccentTriplet('#5884ff', 'light', 7));
    expect(contrastRatio(result, LIGHT_SURFACE)).toBeGreaterThanOrEqual(7);
  });

  it('falls back to a sane value for an invalid colour', () => {
    expect(readableAccentTriplet('nope', 'dark')).toBe('88 132 255');
    expect(readableAccentTriplet('nope', 'light')).toBe('46 92 232');
  });
});
