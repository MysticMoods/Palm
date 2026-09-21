/**
 * OS-level clipboard.
 *
 * Two things share one clipboard, as they do on a real desktop:
 *   • text, mirrored to the browser's system clipboard when permitted, and
 *   • virtual filesystem nodes, which only make sense inside Palm OS and are
 *     therefore kept in memory with a copy/cut mode.
 *
 * The browser Clipboard API is asynchronous and permission-gated, and reads in
 * particular are often blocked outside a user gesture, so every call falls back
 * to the in-memory buffer rather than failing.
 */

import { create } from 'zustand';

export type ClipboardMode = 'copy' | 'cut';

export interface FileClipboardPayload {
  kind: 'files';
  /** Virtual filesystem node ids. */
  ids: string[];
  mode: ClipboardMode;
  /** Folder the nodes were taken from, used for same-folder paste naming. */
  sourceParentId: string | null;
}

export interface TextClipboardPayload {
  kind: 'text';
  text: string;
}

export type ClipboardPayload = FileClipboardPayload | TextClipboardPayload | null;

interface ClipboardState {
  payload: ClipboardPayload;
  setText: (text: string) => void;
  setFiles: (ids: string[], mode: ClipboardMode, sourceParentId: string | null) => void;
  clear: () => void;
  hasFiles: () => boolean;
}

export const useClipboardStore = create<ClipboardState>()((set, get) => ({
  payload: null,
  setText: (text) => set({ payload: { kind: 'text', text } }),
  setFiles: (ids, mode, sourceParentId) =>
    set({ payload: { kind: 'files', ids, mode, sourceParentId } }),
  clear: () => set({ payload: null }),
  hasFiles: () => get().payload?.kind === 'files',
}));

/** Write text to both the OS buffer and the system clipboard. */
export async function writeText(text: string): Promise<boolean> {
  useClipboardStore.getState().setText(text);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not in a user gesture — the OS buffer still works.
  }
  return false;
}

/** Read text, preferring the system clipboard and falling back to ours. */
export async function readText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text) return text;
    }
  } catch {
    // Firefox and Safari block programmatic reads; use what we last copied.
  }
  const payload = useClipboardStore.getState().payload;
  return payload?.kind === 'text' ? payload.text : '';
}

export const clipboard = {
  writeText,
  readText,
  copyFiles: (ids: string[], sourceParentId: string | null) =>
    useClipboardStore.getState().setFiles(ids, 'copy', sourceParentId),
  cutFiles: (ids: string[], sourceParentId: string | null) =>
    useClipboardStore.getState().setFiles(ids, 'cut', sourceParentId),
  get payload() {
    return useClipboardStore.getState().payload;
  },
  clear: () => useClipboardStore.getState().clear(),
};
