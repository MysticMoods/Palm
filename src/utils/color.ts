/** Colour helpers used by theming and the accent-colour picker. */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB | null {
  const value = hex.trim().replace('#', '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** `"88 132 255"` — the format the CSS custom properties expect. */
export function hexToTriplet(hex: string, fallback = '88 132 255'): string {
  const rgb = hexToRgb(hex);
  return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : fallback;
}

/** Relative luminance per WCAG 2.1. */
export function luminance({ r, g, b }: RGB): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Pick black or white text for a background, whichever has more contrast.
 * Used so a custom accent colour never produces unreadable button labels.
 */
export function readableForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '255 255 255';
  const white = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
  const black = contrastRatio(rgb, { r: 0, g: 0, b: 0 });
  return white >= black ? '255 255 255' : '17 17 17';
}

export function isValidHex(value: string): boolean {
  return hexToRgb(value) !== null;
}
