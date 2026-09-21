/**
 * Window manager.
 *
 * Holds every open window, the stacking order and the current work area (the
 * desktop minus the taskbar). Geometry is stored in CSS pixels relative to the
 * viewport so windows can be positioned with plain `transform`/`width` styles.
 */

import { create } from 'zustand';
import { clamp, uid } from '../../utils/misc';
import { NS, attachPersistence } from '../storage/persist';
import { cascadeOffset, constrainToArea, snapRect } from './snap';
import type { OpenWindowOptions, Rect, SnapZone, WindowCrash, WindowState } from './types';

const BASE_Z = 100;

/** Below this width the shell switches to a single-window, phone-like mode. */
export const COMPACT_BREAKPOINT = 820;

interface WindowManagerState {
  windows: WindowState[];
  focusedId: string | null;
  workArea: Rect;
  nextZ: number;
  /** Live snap preview while dragging, or `null`. */
  snapPreview: { zone: SnapZone; rect: Rect } | null;
  /** Per-app last geometry, persisted so windows reopen where you left them. */
  remembered: Record<string, Rect>;
  /** True when the viewport is too narrow for free-floating windows. */
  compact: boolean;

  open: (options: OpenWindowOptions) => string;
  close: (id: string) => void;
  closeApp: (appId: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMinimize: (id: string) => void;
  maximize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  setBounds: (id: string, bounds: Partial<Rect>) => void;
  snapTo: (id: string, zone: SnapZone) => void;
  setSnapPreview: (preview: { zone: SnapZone; rect: Rect } | null) => void;
  setWorkArea: (area: Rect) => void;
  setTitle: (id: string, title: string) => void;
  setBusy: (id: string, busy: boolean) => void;
  setCloseGuard: (id: string, guard: boolean) => void;
  setCrash: (id: string, crash: WindowCrash | null) => void;
  restartWindow: (id: string) => void;
  cycleFocus: (direction: 1 | -1) => void;
  minimizeAll: () => void;
  rememberBounds: (appId: string, rect: Rect) => void;
}

const DEFAULT_AREA: Rect = { x: 0, y: 0, width: 1280, height: 720 };

export const useWindowStore = create<WindowManagerState>()((set, get) => ({
  windows: [],
  focusedId: null,
  workArea: DEFAULT_AREA,
  nextZ: BASE_Z,
  snapPreview: null,
  remembered: {},
  compact: false,

  open: (options) => {
    const state = get();

    if (options.singleton) {
      const existing = state.windows.find((w) => w.appId === options.appId);
      if (existing) {
        get().focus(existing.id);
        if (options.props && Object.keys(options.props).length > 0) {
          set((s) => ({
            windows: s.windows.map((w) =>
              w.id === existing.id
                ? { ...w, props: { ...w.props, ...options.props }, generation: w.generation + 1 }
                : w,
            ),
          }));
        }
        return existing.id;
      }
    }

    const area = state.workArea;
    const remembered = state.remembered[options.appId];
    const width = clamp(options.width ?? remembered?.width ?? 860, 240, area.width);
    const height = clamp(options.height ?? remembered?.height ?? 580, 180, area.height);

    const placement =
      options.x !== undefined && options.y !== undefined
        ? { x: options.x, y: options.y }
        : remembered
          ? { x: remembered.x, y: remembered.y }
          : cascadeOffset(state.windows.length, area, { width, height });

    const bounds = constrainToArea({ ...placement, width, height }, area);
    const z = state.nextZ + 1;
    const shouldMaximize = options.maximized || state.compact;

    const win: WindowState = {
      id: uid('win'),
      appId: options.appId,
      title: options.title ?? options.appId,
      icon: options.icon ?? 'AppWindow',
      bounds: shouldMaximize ? area : bounds,
      restoreBounds: shouldMaximize ? bounds : null,
      mode: shouldMaximize ? 'maximized' : 'normal',
      snap: null,
      zIndex: z,
      props: options.props ?? {},
      resizable: options.resizable ?? true,
      minWidth: options.minWidth ?? 320,
      minHeight: options.minHeight ?? 200,
      crash: null,
      generation: 0,
      createdAt: Date.now(),
      busy: false,
      closeGuard: false,
    };

    set((s) => ({ windows: [...s.windows, win], focusedId: win.id, nextZ: z }));
    return win.id;
  },

  close: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id);
      const windows = s.windows.filter((w) => w.id !== id);
      const remembered =
        target && target.mode === 'normal'
          ? { ...s.remembered, [target.appId]: target.bounds }
          : target?.restoreBounds
            ? { ...s.remembered, [target.appId]: target.restoreBounds }
            : s.remembered;
      const focusedId =
        s.focusedId === id
          ? (windows.filter((w) => w.mode !== 'minimized').sort((a, b) => b.zIndex - a.zIndex)[0]?.id ??
            null)
          : s.focusedId;
      return { windows, focusedId, remembered };
    }),

  closeApp: (appId) => {
    for (const win of get().windows.filter((w) => w.appId === appId)) {
      get().close(win.id);
    }
  },

  focus: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id);
      if (!target) return {};
      // Already on top and focused — nothing to do (avoids a pointless render).
      if (s.focusedId === id && target.mode !== 'minimized' && target.zIndex === s.nextZ) return {};
      const z = s.nextZ + 1;
      return {
        focusedId: id,
        nextZ: z,
        windows: s.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                zIndex: z,
                mode: w.mode === 'minimized' ? (w.snap ? 'snapped' : (w.restoreBounds ? 'maximized' : 'normal')) : w.mode,
              }
            : w,
        ),
      };
    }),

  minimize: (id) =>
    set((s) => {
      const windows = s.windows.map((w) => (w.id === id ? { ...w, mode: 'minimized' as const } : w));
      const next = windows
        .filter((w) => w.id !== id && w.mode !== 'minimized')
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      return { windows, focusedId: next?.id ?? null };
    }),

  toggleMinimize: (id) => {
    const state = get();
    const win = state.windows.find((w) => w.id === id);
    if (!win) return;
    if (win.mode === 'minimized') state.focus(id);
    else if (state.focusedId === id) state.minimize(id);
    else state.focus(id);
  },

  maximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? {
              ...w,
              restoreBounds: w.mode === 'normal' ? w.bounds : w.restoreBounds,
              bounds: s.workArea,
              mode: 'maximized',
              snap: null,
            }
          : w,
      ),
      focusedId: id,
    })),

  restore: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const bounds = w.restoreBounds ?? w.bounds;
        return {
          ...w,
          bounds: constrainToArea(bounds, s.workArea),
          restoreBounds: null,
          mode: 'normal',
          snap: null,
        };
      }),
      focusedId: id,
    })),

  toggleMaximize: (id) => {
    const win = get().windows.find((w) => w.id === id);
    if (!win) return;
    if (win.mode === 'maximized' || win.mode === 'snapped') get().restore(id);
    else get().maximize(id);
  },

  setBounds: (id, partial) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const bounds = { ...w.bounds, ...partial };
        return {
          ...w,
          bounds,
          // Moving or resizing a snapped window returns it to free-floating.
          mode: w.mode === 'normal' ? 'normal' : w.mode === 'minimized' ? 'minimized' : 'normal',
          snap: null,
          restoreBounds: null,
        };
      }),
    })),

  snapTo: (id, zone) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const rect = snapRect(zone, s.workArea);
        return {
          ...w,
          restoreBounds: w.restoreBounds ?? (w.mode === 'normal' ? w.bounds : null),
          bounds: rect,
          mode: zone === 'maximize' ? 'maximized' : 'snapped',
          snap: zone === 'maximize' ? null : zone,
        };
      }),
      focusedId: id,
      snapPreview: null,
    })),

  setSnapPreview: (preview) =>
    set((s) => {
      if (s.snapPreview?.zone === preview?.zone) return {};
      return { snapPreview: preview };
    }),

  setWorkArea: (area) =>
    set((s) => {
      if (
        s.workArea.x === area.x &&
        s.workArea.y === area.y &&
        s.workArea.width === area.width &&
        s.workArea.height === area.height
      ) {
        return {};
      }
      // Re-fit every window so nothing ends up off-screen after a resize.
      const windows = s.windows.map((w) => {
        if (w.mode === 'maximized' || w.mode === 'fullscreen') return { ...w, bounds: area };
        if (w.mode === 'snapped' && w.snap) return { ...w, bounds: snapRect(w.snap, area) };
        return { ...w, bounds: constrainToArea(w.bounds, area) };
      });
      return { workArea: area, windows };
    }),

  setTitle: (id, title) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id && w.title !== title ? { ...w, title } : w)),
    })),

  setBusy: (id, busy) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, busy } : w)) })),

  setCloseGuard: (id, closeGuard) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, closeGuard } : w)) })),

  setCrash: (id, crash) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, crash } : w)) })),

  restartWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, crash: null, generation: w.generation + 1 } : w,
      ),
    })),

  cycleFocus: (direction) => {
    const { windows, focusedId, focus } = get();
    const visible = windows.slice().sort((a, b) => b.zIndex - a.zIndex);
    if (visible.length === 0) return;
    const index = visible.findIndex((w) => w.id === focusedId);
    const next = visible[(index + direction + visible.length) % visible.length];
    if (next) focus(next.id);
  },

  minimizeAll: () =>
    set((s) => ({
      windows: s.windows.map((w) => ({ ...w, mode: 'minimized' as const })),
      focusedId: null,
    })),

  rememberBounds: (appId, rect) =>
    set((s) => ({ remembered: { ...s.remembered, [appId]: rect } })),
}));

/* ------------------------------ Selectors ------------------------------ */

export const useWindows = () => useWindowStore((s) => s.windows);
export const useFocusedWindowId = () => useWindowStore((s) => s.focusedId);
export const useWorkArea = () => useWindowStore((s) => s.workArea);

export function useWindow(id: string): WindowState | undefined {
  return useWindowStore((s) => s.windows.find((w) => w.id === id));
}

/** Non-React access for the OS API and keyboard handlers. */
export const windowManager = {
  open: (options: OpenWindowOptions) => useWindowStore.getState().open(options),
  close: (id: string) => useWindowStore.getState().close(id),
  focus: (id: string) => useWindowStore.getState().focus(id),
  get windows() {
    return useWindowStore.getState().windows;
  },
  get focused() {
    const { windows, focusedId } = useWindowStore.getState();
    return windows.find((w) => w.id === focusedId) ?? null;
  },
};

export async function hydrateWindowPreferences(): Promise<void> {
  await attachPersistence(useWindowStore, {
    namespace: NS.windows,
    key: 'remembered',
    pick: (state) => state.remembered,
    merge: (remembered) => useWindowStore.setState({ remembered: remembered ?? {} }),
    debounceMs: 600,
  });
}

export type { WindowState, Rect, SnapZone };
