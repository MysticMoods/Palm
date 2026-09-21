/** Snap-zone geometry and edge detection. */

import { clamp } from '../../utils/misc';
import type { Rect, SnapZone } from './types';

/** How close to an edge the pointer must get, in CSS pixels. */
const EDGE = 12;
/** Corner zones extend further along each edge than plain half-snapping. */
const CORNER = 96;

export function snapRect(zone: SnapZone, area: Rect): Rect {
  const halfW = Math.round(area.width / 2);
  const halfH = Math.round(area.height / 2);
  const { x, y, width, height } = area;

  switch (zone) {
    case 'left':
      return { x, y, width: halfW, height };
    case 'right':
      return { x: x + width - halfW, y, width: halfW, height };
    case 'top':
      return { x, y, width, height: halfH };
    case 'bottom':
      return { x, y: y + height - halfH, width, height: halfH };
    case 'top-left':
      return { x, y, width: halfW, height: halfH };
    case 'top-right':
      return { x: x + width - halfW, y, width: halfW, height: halfH };
    case 'bottom-left':
      return { x, y: y + height - halfH, width: halfW, height: halfH };
    case 'bottom-right':
      return { x: x + width - halfW, y: y + height - halfH, width: halfW, height: halfH };
    case 'maximize':
      return { x, y, width, height };
    default:
      return { x, y, width, height };
  }
}

/**
 * Which zone (if any) a pointer at (px, py) is requesting.
 *
 * Corners win over edges, and the top edge means "maximise" rather than
 * "top half" — matching how Windows and GNOME behave, and how people expect
 * dragging a window to the top of the screen to work.
 */
export function zoneForPointer(px: number, py: number, area: Rect): SnapZone | null {
  const left = px - area.x <= EDGE;
  const right = area.x + area.width - px <= EDGE;
  const top = py - area.y <= EDGE;
  const bottom = area.y + area.height - py <= EDGE;

  const nearTop = py - area.y <= CORNER;
  const nearBottom = area.y + area.height - py <= CORNER;
  const nearLeft = px - area.x <= CORNER;
  const nearRight = area.x + area.width - px <= CORNER;

  if (left && nearTop) return 'top-left';
  if (left && nearBottom) return 'bottom-left';
  if (right && nearTop) return 'top-right';
  if (right && nearBottom) return 'bottom-right';
  if (top && nearLeft) return 'top-left';
  if (top && nearRight) return 'top-right';
  if (bottom && nearLeft) return 'bottom-left';
  if (bottom && nearRight) return 'bottom-right';

  if (top) return 'maximize';
  if (left) return 'left';
  if (right) return 'right';
  if (bottom) return 'bottom';
  return null;
}

export const SNAP_ZONE_LABELS: Record<SnapZone, string> = {
  left: 'Left half',
  right: 'Right half',
  top: 'Top half',
  bottom: 'Bottom half',
  'top-left': 'Top-left quarter',
  'top-right': 'Top-right quarter',
  'bottom-left': 'Bottom-left quarter',
  'bottom-right': 'Bottom-right quarter',
  maximize: 'Maximise',
};

/** Keep at least a sliver of the title bar reachable inside the work area. */
export function constrainToArea(rect: Rect, area: Rect): Rect {
  const minVisible = 80;
  const width = clamp(rect.width, 160, Math.max(160, area.width));
  const height = clamp(rect.height, 120, Math.max(120, area.height));
  return {
    width,
    height,
    x: clamp(rect.x, area.x - width + minVisible, area.x + area.width - minVisible),
    y: clamp(rect.y, area.y, area.y + area.height - 40),
  };
}

/** Offset each new window so stacked windows stay individually clickable. */
export function cascadeOffset(index: number, area: Rect, size: { width: number; height: number }): {
  x: number;
  y: number;
} {
  const step = 28;
  const wrap = 7;
  const slot = index % wrap;
  const baseX = area.x + Math.max(24, (area.width - size.width) / 2 - (wrap * step) / 2);
  const baseY = area.y + Math.max(20, (area.height - size.height) / 2 - (wrap * step) / 2);
  return {
    x: clamp(baseX + slot * step, area.x + 8, Math.max(area.x + 8, area.x + area.width - size.width - 8)),
    y: clamp(baseY + slot * step, area.y + 8, Math.max(area.y + 8, area.y + area.height - size.height - 8)),
  };
}
