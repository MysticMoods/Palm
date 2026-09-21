/**
 * Which apps are installed, pinned and recently used.
 *
 * The registry knows what *exists*; this store knows what the user has chosen
 * to keep. Uninstalling a non-core app hides it from the launcher and desktop
 * without removing its code — the App Store can put it back.
 */

import { create } from 'zustand';
import { NS, attachPersistence } from '../storage/persist';
import { allApps, getApp } from './registry';
import type { AppDefinition } from './types';

const MAX_RECENT = 12;

interface AppManagerState {
  /** App ids the user has installed. Core apps are always present. */
  installed: string[];
  pinned: string[];
  recent: string[];
  /** Launch counts, used to order "most used" in the launcher. */
  usage: Record<string, number>;

  install: (id: string) => void;
  uninstall: (id: string) => void;
  isInstalled: (id: string) => boolean;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  togglePin: (id: string) => void;
  setPinnedOrder: (ids: string[]) => void;
  noteLaunch: (id: string) => void;
  clearRecent: () => void;
  resetToDefaults: () => void;
}

const DEFAULT_PINNED = ['files', 'terminal', 'text-editor', 'browser', 'settings'];

/** Core apps are implicitly installed; this keeps the list honest. */
function withCoreApps(ids: string[]): string[] {
  const core = allApps()
    .filter((app) => app.core)
    .map((app) => app.id);
  return [...new Set([...core, ...ids])];
}

export const useAppStore = create<AppManagerState>()((set, get) => ({
  installed: [],
  pinned: DEFAULT_PINNED,
  recent: [],
  usage: {},

  install: (id) =>
    set((state) =>
      state.installed.includes(id) ? {} : { installed: [...state.installed, id] },
    ),

  uninstall: (id) => {
    const app = getApp(id);
    if (app?.core) return;
    set((state) => ({
      installed: state.installed.filter((appId) => appId !== id),
      pinned: state.pinned.filter((appId) => appId !== id),
      recent: state.recent.filter((appId) => appId !== id),
    }));
  },

  isInstalled: (id) => {
    const app = getApp(id);
    if (!app) return false;
    return app.core === true || get().installed.includes(id);
  },

  pin: (id) => set((state) => (state.pinned.includes(id) ? {} : { pinned: [...state.pinned, id] })),

  unpin: (id) => set((state) => ({ pinned: state.pinned.filter((appId) => appId !== id) })),

  togglePin: (id) => {
    if (get().pinned.includes(id)) get().unpin(id);
    else get().pin(id);
  },

  setPinnedOrder: (ids) => set({ pinned: ids }),

  noteLaunch: (id) =>
    set((state) => ({
      recent: [id, ...state.recent.filter((appId) => appId !== id)].slice(0, MAX_RECENT),
      usage: { ...state.usage, [id]: (state.usage[id] ?? 0) + 1 },
    })),

  clearRecent: () => set({ recent: [] }),

  resetToDefaults: () => set({ installed: [], pinned: DEFAULT_PINNED, recent: [], usage: {} }),
}));

/* ------------------------------ Selectors ------------------------------ */

/** Apps available to the user: core apps plus anything explicitly installed. */
export function useInstalledApps(): AppDefinition[] {
  const installed = useAppStore((s) => s.installed);
  return allApps()
    .filter((app) => !app.hidden && (app.core || installed.includes(app.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function usePinnedApps(): AppDefinition[] {
  const pinned = useAppStore((s) => s.pinned);
  const installed = useAppStore((s) => s.installed);
  return pinned
    .map((id) => getApp(id))
    .filter((app): app is AppDefinition => {
      if (!app) return false;
      return app.core === true || installed.includes(app.id);
    });
}

export function useRecentApps(limit = 6): AppDefinition[] {
  const recent = useAppStore((s) => s.recent);
  return recent
    .map((id) => getApp(id))
    .filter((app): app is AppDefinition => app !== undefined && !app.hidden)
    .slice(0, limit);
}

export const isAppInstalled = (id: string): boolean => useAppStore.getState().isInstalled(id);

export async function hydrateAppManager(): Promise<void> {
  await attachPersistence(useAppStore, {
    namespace: NS.apps,
    key: 'state',
    pick: (state) => ({
      installed: state.installed,
      pinned: state.pinned,
      recent: state.recent,
      usage: state.usage,
    }),
    merge: (persisted) => {
      if (!persisted) return;
      useAppStore.setState({
        installed: withCoreApps(persisted.installed ?? []).filter((id) => getApp(id)),
        pinned: (persisted.pinned ?? DEFAULT_PINNED).filter((id) => getApp(id)),
        recent: (persisted.recent ?? []).filter((id) => getApp(id)),
        usage: persisted.usage ?? {},
      });
    },
  });
}
