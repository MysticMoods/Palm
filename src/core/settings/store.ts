/**
 * Central settings store.
 *
 * Every preference in the OS lives here. Changes are applied to the document
 * immediately (see `apply.ts`) and written back to IndexedDB on a debounce.
 */

import { create } from 'zustand';
import { NS, attachPersistence } from '../storage/persist';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from './defaults';
import type { Settings, UserProfile } from './types';

interface SettingsState {
  settings: Settings;
  profile: UserProfile;
  hydrated: boolean;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  patch: (values: Partial<Settings>) => void;
  reset: () => void;
  replaceAll: (settings: Settings, profile?: UserProfile) => void;
  updateProfile: (values: Partial<UserProfile>) => void;
  setAppNotifications: (appId: string, enabled: boolean) => void;
  setDefaultApp: (category: string, appId: string) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  profile: DEFAULT_PROFILE,
  hydrated: false,

  set: (key, value) =>
    set((state) => ({ settings: { ...state.settings, [key]: value } })),

  patch: (values) => set((state) => ({ settings: { ...state.settings, ...values } })),

  reset: () => set({ settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE }),

  replaceAll: (settings, profile) =>
    set((state) => ({
      // Merge over defaults so a backup from an older version stays valid.
      settings: { ...DEFAULT_SETTINGS, ...settings },
      profile: profile ? { ...DEFAULT_PROFILE, ...profile } : state.profile,
    })),

  updateProfile: (values) => set((state) => ({ profile: { ...state.profile, ...values } })),

  setAppNotifications: (appId, enabled) =>
    set((state) => ({
      settings: {
        ...state.settings,
        appNotifications: { ...state.settings.appNotifications, [appId]: enabled },
      },
    })),

  setDefaultApp: (category, appId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        defaultApps: { ...state.settings.defaultApps, [category]: appId },
      },
    })),
}));

/** Read settings outside React (the OS API, keyboard manager, apps). */
export const getSettings = (): Settings => useSettingsStore.getState().settings;
export const getProfile = (): UserProfile => useSettingsStore.getState().profile;

/** Selector hook — components only re-render when their slice changes. */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettingsStore((state) => state.settings[key]);
}

export async function hydrateSettings(): Promise<void> {
  /*
   * Written without a debounce, unlike the higher-frequency stores.
   *
   * Preferences change at human speed, so coalescing buys nothing — while the
   * delay is long enough to lose a change to a reload that follows it: the
   * pagehide flush can only *start* an IndexedDB write, and that write will not
   * complete while the page is tearing down.
   */
  await attachPersistence(useSettingsStore, {
    namespace: NS.settings,
    key: 'settings',
    pick: (state) => state.settings,
    merge: (persisted) =>
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...persisted } }),
    debounceMs: 0,
  });
  await attachPersistence(useSettingsStore, {
    namespace: NS.user,
    key: 'profile',
    pick: (state) => state.profile,
    merge: (persisted) =>
      useSettingsStore.setState({ profile: { ...DEFAULT_PROFILE, ...persisted } }),
    debounceMs: 0,
  });
  useSettingsStore.setState({ hydrated: true });
}
