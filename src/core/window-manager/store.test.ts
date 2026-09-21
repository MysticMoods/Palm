import { beforeEach, describe, expect, it } from 'vitest';
import { useWindowStore } from './store';
import type { Rect } from './types';

const AREA: Rect = { x: 0, y: 0, width: 1400, height: 852 };

const store = () => useWindowStore.getState();
const titles = (ids: string[]) => ids.map((id) => store().windows.find((w) => w.id === id)?.title);

/** Open n windows and return their ids in creation order. */
function openWindows(...names: string[]): string[] {
  return names.map((name) => store().open({ appId: name, title: name }));
}

beforeEach(() => {
  useWindowStore.setState({
    windows: [],
    focusedId: null,
    nextZ: 100,
    snapPreview: null,
    remembered: {},
    compact: false,
    switcher: null,
    workArea: AREA,
  });
});

describe('opening and focus', () => {
  it('focuses the newest window and stacks it on top', () => {
    const [a, b] = openWindows('A', 'B');
    expect(store().focusedId).toBe(b);
    const zOf = (id: string) => store().windows.find((w) => w.id === id)!.zIndex;
    expect(zOf(b)).toBeGreaterThan(zOf(a));
  });

  it('reuses the window of a singleton app', () => {
    const first = store().open({ appId: 'settings', singleton: true });
    const second = store().open({ appId: 'settings', singleton: true });
    expect(second).toBe(first);
    expect(store().windows).toHaveLength(1);
  });

  it('opens a second window for a non-singleton app', () => {
    openWindows('files', 'files');
    expect(store().windows).toHaveLength(2);
  });

  it('moves focus to the next visible window when one closes', () => {
    const [a, b] = openWindows('A', 'B');
    store().close(b);
    expect(store().focusedId).toBe(a);
  });

  it('leaves nothing focused once the last window closes', () => {
    const [a] = openWindows('A');
    store().close(a);
    expect(store().focusedId).toBeNull();
  });
});

describe('minimise and restore', () => {
  it('hands focus on when the focused window is minimised', () => {
    const [a, b] = openWindows('A', 'B');
    store().minimize(b);
    expect(store().focusedId).toBe(a);
  });

  it('restores a minimised window when it is focused again', () => {
    const [, b] = openWindows('A', 'B');
    store().minimize(b);
    store().focus(b);
    expect(store().windows.find((w) => w.id === b)!.mode).toBe('normal');
    expect(store().focusedId).toBe(b);
  });

  it('toggleMinimize minimises only when the window is already focused', () => {
    const [a, b] = openWindows('A', 'B');
    store().toggleMinimize(a); // not focused → focus it
    expect(store().focusedId).toBe(a);
    store().toggleMinimize(a); // focused → minimise it
    expect(store().windows.find((w) => w.id === a)!.mode).toBe('minimized');
    expect(store().focusedId).toBe(b);
  });
});

describe('maximise and snap', () => {
  it('remembers the previous size and restores to it', () => {
    const [a] = openWindows('A');
    store().setBounds(a, { x: 120, y: 80, width: 640, height: 480 });
    store().maximize(a);
    expect(store().windows.find((w) => w.id === a)!.bounds).toEqual(AREA);
    store().restore(a);
    expect(store().windows.find((w) => w.id === a)!.bounds).toEqual({
      x: 120, y: 80, width: 640, height: 480,
    });
  });

  it('records the snap zone so a work-area change can re-apply it', () => {
    const [a] = openWindows('A');
    store().snapTo(a, 'left');
    const win = () => store().windows.find((w) => w.id === a)!;
    expect(win().mode).toBe('snapped');
    expect(win().snap).toBe('left');
    expect(win().bounds).toEqual({ x: 0, y: 0, width: 700, height: 852 });

    store().setWorkArea({ x: 0, y: 0, width: 1000, height: 800 });
    expect(win().bounds).toEqual({ x: 0, y: 0, width: 500, height: 800 });
  });

  it('un-snaps when the window is moved by hand', () => {
    const [a] = openWindows('A');
    store().snapTo(a, 'left');
    store().setBounds(a, { x: 300, y: 200 });
    const win = store().windows.find((w) => w.id === a)!;
    expect(win.snap ?? null).toBeNull();
    expect(win.mode).toBe('normal');
  });

  it('keeps maximised windows filling a resized work area', () => {
    const [a] = openWindows('A');
    store().maximize(a);
    store().setWorkArea({ x: 0, y: 48, width: 1000, height: 700 });
    expect(store().windows.find((w) => w.id === a)!.bounds).toEqual({
      x: 0, y: 48, width: 1000, height: 700,
    });
  });
});

describe('window switcher', () => {
  /*
   * Regression: the previous implementation sorted by z-index and focused the
   * next window, but focusing raises z-index — so each press destroyed the
   * ordering it had just derived. With four windows open it oscillated between
   * the two most recent and the other two were unreachable by keyboard.
   */
  it('steps through every window and wraps', () => {
    const ids = openWindows('A', 'B', 'C', 'D');
    store().beginSwitch(1, false);

    const visited = [store().switcher!.order[store().switcher!.index]];
    for (let i = 0; i < 3; i += 1) {
      store().moveSwitch(1);
      visited.push(store().switcher!.order[store().switcher!.index]);
    }

    // MRU order is D (focused), C, B, A; stepping starts at the second entry.
    expect(titles(visited)).toEqual(['C', 'B', 'A', 'D']);
    expect(new Set(visited).size).toBe(4);
    void ids;
  });

  it('keeps the order fixed even though committing changes z-index', () => {
    openWindows('A', 'B', 'C');
    store().beginSwitch(1, false);
    const frozen = [...store().switcher!.order];
    store().moveSwitch(1);
    store().commitSwitch();
    store().beginSwitch(1, false);
    // A fresh gesture re-derives MRU, which must now reflect the new focus.
    expect(store().switcher!.order).not.toEqual(frozen);
    expect(titles([store().switcher!.order[0]])).toEqual(['A']);
  });

  it('steps backwards from the end', () => {
    openWindows('A', 'B', 'C');
    store().beginSwitch(-1, false);
    expect(titles([store().switcher!.order[store().switcher!.index]])).toEqual(['A']);
  });

  it('commits focus to the highlighted window', () => {
    const ids = openWindows('A', 'B', 'C');
    store().beginSwitch(1, false);
    store().moveSwitch(1);
    store().commitSwitch();
    expect(store().switcher).toBeNull();
    expect(store().focusedId).toBe(ids[0]);
  });

  it('cancelling leaves focus untouched', () => {
    const ids = openWindows('A', 'B', 'C');
    const before = store().focusedId;
    store().beginSwitch(1, false);
    store().cancelSwitch();
    expect(store().switcher).toBeNull();
    expect(store().focusedId).toBe(before);
    expect(before).toBe(ids[2]);
  });

  it('does not open with fewer than two windows', () => {
    openWindows('A');
    store().beginSwitch(1, false);
    expect(store().switcher).toBeNull();
  });

  it('includes minimised windows, since reaching them is the point', () => {
    const ids = openWindows('A', 'B');
    store().minimize(ids[1]);
    store().beginSwitch(1, false);
    expect(store().switcher!.order).toHaveLength(2);
  });

  it('drops a window that closes mid-gesture', () => {
    const ids = openWindows('A', 'B', 'C');
    store().beginSwitch(1, false);
    store().close(ids[0]);
    expect(store().switcher!.order).not.toContain(ids[0]);
    expect(store().switcher!.index).toBeLessThan(store().switcher!.order.length);
  });

  it('closes the gesture when too few windows remain', () => {
    const ids = openWindows('A', 'B');
    store().beginSwitch(1, false);
    store().close(ids[0]);
    expect(store().switcher).toBeNull();
  });
});

describe('compact mode', () => {
  it('makes every window full-screen when it turns on', () => {
    const ids = openWindows('A', 'B');
    store().setBounds(ids[0], { x: 100, y: 100, width: 400, height: 300 });
    store().setCompact(true);
    for (const win of store().windows) {
      expect(win.mode).toBe('maximized');
      expect(win.bounds).toEqual(AREA);
    }
  });

  it('leaves minimised windows minimised', () => {
    const ids = openWindows('A', 'B');
    store().minimize(ids[0]);
    store().setCompact(true);
    expect(store().windows.find((w) => w.id === ids[0])!.mode).toBe('minimized');
  });
});
