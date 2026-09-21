/**
 * Transient shell UI state: which system panel is open, and the
 * desktop context menu.
 *
 * Only one system panel can be open at a time, which is what makes
 * "click anywhere else to close" and Escape handling straightforward.
 */

import { create } from 'zustand';

export type ShellPanel =
  | 'start'
  | 'search'
  | 'notifications'
  | 'quick-settings'
  | 'calendar'
  | null;

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a divider; `label` is ignored. */
  separator?: boolean;
  /** Nested submenu. */
  items?: ContextMenuItem[];
  /** Shown right-aligned, e.g. a keyboard shortcut. */
  hint?: string;
  checked?: boolean;
}

export interface ContextMenuRequest {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Accessible label for the menu. */
  label?: string;
}

interface ShellState {
  panel: ShellPanel;
  contextMenu: ContextMenuRequest | null;
  /** Set while the user is holding "show desktop". */
  peekingDesktop: boolean;
  bootPhase: 'booting' | 'ready' | 'error';
  bootError: string | null;

  openPanel: (panel: NonNullable<ShellPanel>) => void;
  togglePanel: (panel: NonNullable<ShellPanel>) => void;
  closePanel: () => void;
  openContextMenu: (request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
  setPeekingDesktop: (peeking: boolean) => void;
  setBoot: (phase: ShellState['bootPhase'], error?: string | null) => void;
}

export const useShellStore = create<ShellState>()((set, get) => ({
  panel: null,
  contextMenu: null,
  peekingDesktop: false,
  bootPhase: 'booting',
  bootError: null,

  openPanel: (panel) => set({ panel, contextMenu: null }),
  togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel, contextMenu: null }),
  closePanel: () => set({ panel: null }),
  openContextMenu: (request) => set({ contextMenu: request, panel: null }),
  closeContextMenu: () => set({ contextMenu: null }),
  setPeekingDesktop: (peekingDesktop) => set({ peekingDesktop }),
  setBoot: (bootPhase, bootError = null) => set({ bootPhase, bootError }),
}));

export const shell = {
  openPanel: (panel: NonNullable<ShellPanel>) => useShellStore.getState().openPanel(panel),
  closePanel: () => useShellStore.getState().closePanel(),
  contextMenu: (request: ContextMenuRequest) => useShellStore.getState().openContextMenu(request),
};
