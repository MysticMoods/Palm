/**
 * Desktop icon layout.
 *
 * The desktop shows the contents of `/Desktop` plus a few permanent shortcuts
 * (This Computer, Trash). Positions are stored per icon key as grid cells so
 * the layout survives a resolution change, and are persisted to IndexedDB.
 */

import { create } from 'zustand';
import { NS, attachPersistence } from '../storage/persist';

export interface GridPosition {
  col: number;
  row: number;
}

/** Icon keys are `file:<nodeId>` for filesystem entries, or `shortcut:<id>`. */
export type IconKey = string;

interface DesktopState {
  positions: Record<IconKey, GridPosition>;
  selection: string[];
  renaming: string | null;
  /** Manual sort order override; `null` means "auto arrange by name". */
  sortMode: 'name' | 'type' | 'modified' | 'manual';

  setPosition: (key: IconKey, position: GridPosition) => void;
  setPositions: (entries: Array<[IconKey, GridPosition]>) => void;
  clearPosition: (key: IconKey) => void;
  setSelection: (keys: string[]) => void;
  toggleSelection: (key: string, additive: boolean) => void;
  clearSelection: () => void;
  setRenaming: (key: string | null) => void;
  setSortMode: (mode: DesktopState['sortMode']) => void;
  resetLayout: () => void;
}

export const useDesktopStore = create<DesktopState>()((set) => ({
  positions: {},
  selection: [],
  renaming: null,
  sortMode: 'manual',

  setPosition: (key, position) =>
    set((state) => ({ positions: { ...state.positions, [key]: position } })),

  setPositions: (entries) =>
    set((state) => {
      const positions = { ...state.positions };
      for (const [key, position] of entries) positions[key] = position;
      return { positions };
    }),

  clearPosition: (key) =>
    set((state) => {
      const positions = { ...state.positions };
      delete positions[key];
      return { positions };
    }),

  setSelection: (selection) => set({ selection }),

  toggleSelection: (key, additive) =>
    set((state) => {
      if (!additive) return { selection: [key] };
      return state.selection.includes(key)
        ? { selection: state.selection.filter((k) => k !== key) }
        : { selection: [...state.selection, key] };
    }),

  clearSelection: () => set({ selection: [] }),
  setRenaming: (renaming) => set({ renaming }),
  setSortMode: (sortMode) => set({ sortMode }),
  resetLayout: () => set({ positions: {}, sortMode: 'name' }),
}));

export async function hydrateDesktop(): Promise<void> {
  await attachPersistence(useDesktopStore, {
    namespace: NS.desktop,
    key: 'layout',
    pick: (state) => ({ positions: state.positions, sortMode: state.sortMode }),
    merge: (persisted) => {
      if (!persisted) return;
      useDesktopStore.setState({
        positions: persisted.positions ?? {},
        sortMode: persisted.sortMode ?? 'manual',
      });
    },
  });
}
