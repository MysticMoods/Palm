/**
 * Wallpaper presets and the CSS they resolve to.
 *
 * Built-in "photo" wallpapers are generated SVG data URLs rather than binary
 * assets: they scale to any resolution, cost a couple of kilobytes and keep
 * the app dependency-free.
 */

import type { CSSProperties } from 'react';
import type { Wallpaper } from './types';

export interface GradientPreset {
  id: string;
  name: string;
  from: string;
  to: string;
  angle: number;
}

export const GRADIENT_WALLPAPERS: GradientPreset[] = [
  { id: 'midnight', name: 'Midnight', from: '#131a35', to: '#3a2255', angle: 135 },
  { id: 'ember', name: 'Ember', from: '#2b1055', to: '#7597de', angle: 160 },
  { id: 'lagoon', name: 'Lagoon', from: '#06283d', to: '#256d85', angle: 120 },
  { id: 'sunset', name: 'Sunset', from: '#3a1c53', to: '#f0704f', angle: 145 },
  { id: 'forest', name: 'Forest', from: '#0b3d2c', to: '#5d9c59', angle: 130 },
  { id: 'graphite', name: 'Graphite', from: '#1c1c22', to: '#42434a', angle: 145 },
  { id: 'rose', name: 'Rose', from: '#4a1942', to: '#d96098', angle: 150 },
  { id: 'arctic', name: 'Arctic', from: '#dfe9f3', to: '#8ea9c9', angle: 140 },
];

export const COLOR_WALLPAPERS: Array<{ id: string; name: string; color: string }> = [
  { id: 'ink', name: 'Ink', color: '#12141c' },
  { id: 'slate', name: 'Slate', color: '#242a38' },
  { id: 'plum', name: 'Plum', color: '#2e1f38' },
  { id: 'moss', name: 'Moss', color: '#1d2e22' },
  { id: 'clay', name: 'Clay', color: '#3a2b26' },
  { id: 'paper', name: 'Paper', color: '#e9e6df' },
];

function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Layered peaks — a calm "mountains at dusk" scene. */
function peaks(sky1: string, sky2: string, layers: string[]): string {
  const bands = layers
    .map((color, index) => {
      const base = 520 + index * 70;
      const amp = 120 - index * 22;
      const shift = index * 137;
      return `<path d="M0 ${base} L${160 + shift} ${base - amp} L${380 + shift} ${base + 26} L${600 + shift} ${base - amp * 0.8} L${880 + shift} ${base + 40} L${1200 + shift} ${base - amp * 0.5} L1600 ${base} L1600 900 L0 900 Z" fill="${color}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${sky1}"/><stop offset="100%" stop-color="${sky2}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#s)"/><circle cx="1240" cy="200" r="70" fill="#ffffff" opacity="0.22"/>${bands}</svg>`;
}

/** Soft overlapping blobs — an abstract "aurora" backdrop. */
function blobs(base: string, colors: string[]): string {
  const shapes = colors
    .map((color, index) => {
      const cx = 200 + index * 330;
      const cy = 260 + (index % 2) * 320;
      const r = 320 + index * 40;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.5"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="120"/></filter></defs><rect width="1600" height="900" fill="${base}"/><g filter="url(#b)">${shapes}</g></svg>`;
}

/** A fine grid over a wash — "engineering desk". */
function grid(base: string, line: string, glow: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0 L0 0 0 48" fill="none" stroke="${line}" stroke-width="1"/></pattern><radialGradient id="r" cx="0.3" cy="0.25" r="0.8"><stop offset="0%" stop-color="${glow}" stop-opacity="0.75"/><stop offset="100%" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="900" fill="${base}"/><rect width="1600" height="900" fill="url(#g)"/><rect width="1600" height="900" fill="url(#r)"/></svg>`;
}

export interface ImagePreset {
  id: string;
  name: string;
  /** Inline data URL, usable directly as a CSS `background-image`. */
  src: string;
}

export const IMAGE_WALLPAPERS: ImagePreset[] = [
  {
    id: 'ridge-dusk',
    name: 'Ridge at Dusk',
    src: svgUrl(peaks('#251d4a', '#6b4a7a', ['#1d1836', '#2a2148', '#382a58'])),
  },
  {
    id: 'ridge-dawn',
    name: 'Ridge at Dawn',
    src: svgUrl(peaks('#f2a65a', '#8a5a9b', ['#4a2f5e', '#5c3a6d', '#6f4a7c'])),
  },
  { id: 'aurora', name: 'Aurora', src: svgUrl(blobs('#070d1c', ['#1b4b8f', '#2bbfa0', '#7a3fb0', '#1f6fb5'])) },
  { id: 'nebula', name: 'Nebula', src: svgUrl(blobs('#120a1e', ['#7b2d8e', '#d1466f', '#3b2d9e', '#e08b3a'])) },
  { id: 'blueprint', name: 'Blueprint', src: svgUrl(grid('#0a1a2f', '#2a4a6e', '#2f7fd4')) },
  { id: 'drafting', name: 'Drafting', src: svgUrl(grid('#eceae4', '#cfccc2', '#b9a98c')) },
];

/** Reference an image that lives in the virtual filesystem. */
export const VFS_WALLPAPER_PREFIX = 'vfs:';

export function isVfsWallpaper(src: string): boolean {
  return src.startsWith(VFS_WALLPAPER_PREFIX);
}

export function vfsWallpaperId(src: string): string {
  return src.slice(VFS_WALLPAPER_PREFIX.length);
}

const FIT_STYLES: Record<string, CSSProperties> = {
  cover: { backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' },
  contain: { backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' },
  center: { backgroundSize: 'auto', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' },
  tile: { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'top left' },
};

/**
 * CSS for a wallpaper. `resolvedImageUrl` is supplied by the caller for
 * filesystem-backed images, which need an async object URL.
 */
export function wallpaperStyle(wallpaper: Wallpaper, resolvedImageUrl?: string | null): CSSProperties {
  switch (wallpaper.kind) {
    case 'color':
      return { backgroundColor: wallpaper.color };
    case 'gradient':
      return {
        backgroundImage: `linear-gradient(${wallpaper.angle}deg, ${wallpaper.from}, ${wallpaper.to})`,
      };
    case 'image': {
      const url = isVfsWallpaper(wallpaper.src)
        ? resolvedImageUrl
          ? `url("${resolvedImageUrl}")`
          : null
        : wallpaper.src;
      if (!url) return { backgroundColor: '#12141c' };
      return { backgroundImage: url, ...FIT_STYLES[wallpaper.fit] };
    }
    default:
      return { backgroundColor: '#12141c' };
  }
}

/** Small preview swatch, used in the wallpaper picker. */
export function wallpaperPreviewStyle(wallpaper: Wallpaper, resolvedImageUrl?: string | null): CSSProperties {
  return { ...wallpaperStyle(wallpaper, resolvedImageUrl), backgroundSize: 'cover' };
}
