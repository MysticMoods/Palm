import { describe, expect, it } from 'vitest';
import { cascadeOffset, constrainToArea, snapRect, zoneForPointer } from './snap';
import type { Rect } from './types';

const AREA: Rect = { x: 0, y: 0, width: 1400, height: 852 };

describe('snapRect', () => {
  it('splits the work area in half', () => {
    expect(snapRect('left', AREA)).toEqual({ x: 0, y: 0, width: 700, height: 852 });
    expect(snapRect('right', AREA)).toEqual({ x: 700, y: 0, width: 700, height: 852 });
    expect(snapRect('top', AREA)).toEqual({ x: 0, y: 0, width: 1400, height: 426 });
    expect(snapRect('bottom', AREA)).toEqual({ x: 0, y: 426, width: 1400, height: 426 });
  });

  it('splits into quarters', () => {
    expect(snapRect('top-left', AREA)).toEqual({ x: 0, y: 0, width: 700, height: 426 });
    expect(snapRect('bottom-right', AREA)).toEqual({ x: 700, y: 426, width: 700, height: 426 });
  });

  it('fills the area when maximising', () => {
    expect(snapRect('maximize', AREA)).toEqual(AREA);
  });

  it('respects a work area offset by the taskbar', () => {
    const offset: Rect = { x: 0, y: 48, width: 1400, height: 804 };
    expect(snapRect('left', offset)).toEqual({ x: 0, y: 48, width: 700, height: 804 });
  });

  it('halves add back up to the whole for odd widths', () => {
    const odd: Rect = { x: 0, y: 0, width: 1401, height: 801 };
    const left = snapRect('left', odd);
    const right = snapRect('right', odd);
    expect(right.x + right.width).toBe(odd.x + odd.width);
    expect(left.x).toBe(odd.x);
  });
});

describe('zoneForPointer', () => {
  it('finds nothing in the middle', () => {
    expect(zoneForPointer(700, 400, AREA)).toBeNull();
  });

  it('treats the top edge as maximise, not "top half"', () => {
    // Matches Windows and GNOME, and is what dragging a window to the top means.
    expect(zoneForPointer(700, 2, AREA)).toBe('maximize');
  });

  it('finds the side edges', () => {
    expect(zoneForPointer(2, 400, AREA)).toBe('left');
    expect(zoneForPointer(1398, 400, AREA)).toBe('right');
    expect(zoneForPointer(700, 850, AREA)).toBe('bottom');
  });

  it('prefers corners over edges', () => {
    expect(zoneForPointer(2, 2, AREA)).toBe('top-left');
    expect(zoneForPointer(1398, 2, AREA)).toBe('top-right');
    expect(zoneForPointer(2, 850, AREA)).toBe('bottom-left');
    expect(zoneForPointer(1398, 850, AREA)).toBe('bottom-right');
  });

  it('measures edges from the work area, not the viewport', () => {
    // Taskbar on the left: the work area starts at x=48.
    const offset: Rect = { x: 48, y: 0, width: 1352, height: 852 };
    expect(zoneForPointer(50, 400, offset)).toBe('left');
    expect(zoneForPointer(1398, 400, offset)).toBe('right');
    expect(zoneForPointer(700, 400, offset)).toBeNull();
  });

  it('still snaps when the pointer is dragged past the edge', () => {
    // Over the taskbar is an even more emphatic request for a left snap.
    const offset: Rect = { x: 48, y: 0, width: 1352, height: 852 };
    expect(zoneForPointer(10, 400, offset)).toBe('left');
  });
});

describe('constrainToArea', () => {
  it('leaves a window that already fits alone', () => {
    const rect = { x: 100, y: 100, width: 600, height: 400 };
    expect(constrainToArea(rect, AREA)).toEqual(rect);
  });

  it('never lets a window be dragged fully off the right edge', () => {
    const result = constrainToArea({ x: 5000, y: 100, width: 600, height: 400 }, AREA);
    expect(result.x).toBeLessThanOrEqual(AREA.width - 80);
  });

  it('keeps the title bar reachable when dragged off the left', () => {
    const result = constrainToArea({ x: -5000, y: 100, width: 600, height: 400 }, AREA);
    expect(result.x + result.width).toBeGreaterThanOrEqual(80);
  });

  it('never puts the title bar above the work area', () => {
    const result = constrainToArea({ x: 100, y: -300, width: 600, height: 400 }, AREA);
    expect(result.y).toBeGreaterThanOrEqual(AREA.y);
  });

  it('clamps a window larger than the screen', () => {
    const result = constrainToArea({ x: 0, y: 0, width: 9999, height: 9999 }, AREA);
    expect(result.width).toBeLessThanOrEqual(AREA.width);
    expect(result.height).toBeLessThanOrEqual(AREA.height);
  });
});

describe('cascadeOffset', () => {
  it('offsets each successive window', () => {
    const size = { width: 600, height: 400 };
    const first = cascadeOffset(0, AREA, size);
    const second = cascadeOffset(1, AREA, size);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('keeps every cascaded window fully on screen', () => {
    const size = { width: 600, height: 400 };
    for (let index = 0; index < 20; index += 1) {
      const { x, y } = cascadeOffset(index, AREA, size);
      expect(x).toBeGreaterThanOrEqual(AREA.x);
      expect(y).toBeGreaterThanOrEqual(AREA.y);
      expect(x + size.width).toBeLessThanOrEqual(AREA.x + AREA.width);
      expect(y + size.height).toBeLessThanOrEqual(AREA.y + AREA.height);
    }
  });
});
