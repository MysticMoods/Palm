/**
 * Mount state for Palm Disk.
 *
 * The permission dance is the awkward part and it lives here so the UI does
 * not have to think about it. A `FileSystemDirectoryHandle` survives in
 * IndexedDB across sessions, but the *permission* attached to it does not:
 * on a new page load it reverts to `prompt`, and re-requesting it requires a
 * user gesture. So boot can restore the handle silently but must wait for a
 * click before it can read anything — which is why mounting a disk is a
 * deliberate, visible act rather than something that happens invisibly.
 */

import { create } from 'zustand';
import { kv } from '../storage/kv';
import { DiskVolume, disk, diskSupported } from './disk';
import type { DiskDirectoryHandle } from './disk';

const NAMESPACE = 'system.disk';
const HANDLE_KEY = 'root-handle';

export type DiskStatus =
  /** This browser has no File System Access API. */
  | 'unsupported'
  /** Supported, but no folder has ever been chosen. */
  | 'unmounted'
  /** A folder is remembered but the browser has not re-granted access. */
  | 'needs-permission'
  | 'mounting'
  | 'ready'
  | 'error';

interface DiskState {
  status: DiskStatus;
  label: string;
  error: string | null;
  /** Bumped whenever the volume's contents may have changed. */
  revision: number;
  /** True once the user has granted write access to the mounted folder. */
  writable: boolean;

  choose: () => Promise<void>;
  reconnect: () => Promise<void>;
  restore: () => Promise<void>;
  eject: () => Promise<void>;
  refresh: (path?: string) => void;
  /** Escalate to read/write. Returns whether writing is now permitted. */
  requestWrite: () => Promise<boolean>;
}

type PermissionMode = 'read' | 'readwrite';

interface WithPermission {
  queryPermission?: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>;
}

/**
 * Mounting asks only for read access.
 *
 * Write access is a much larger thing to agree to — it is the whole reason
 * Firefox and Safari declined to ship this API — so it is escalated to only
 * when the user actually tries to save something. The prompt then arrives
 * attached to that intent, rather than to an opaque "connect a folder".
 */
const MODE: PermissionMode = 'read';

/**
 * Structured clone preserves a real handle, but a husk (or a value written by
 * an older build) would survive storage as a plain object with no methods and
 * fail later, deep inside a listing. Check before trusting it.
 */
function looksLikeDirectory(value: unknown): value is DiskDirectoryHandle {
  const handle = value as Partial<DiskDirectoryHandle> | null;
  return (
    !!handle &&
    handle.kind === 'directory' &&
    typeof handle.entries === 'function' &&
    typeof handle.getDirectoryHandle === 'function'
  );
}

async function permissionState(
  handle: DiskDirectoryHandle,
  prompt: boolean,
  mode: PermissionMode = MODE,
): Promise<PermissionState> {
  const target = handle as unknown as WithPermission;
  try {
    const current = (await target.queryPermission?.({ mode })) ?? 'granted';
    if (current === 'granted' || !prompt) return current;
    return (await target.requestPermission?.({ mode })) ?? 'denied';
  } catch {
    return 'denied';
  }
}

export const useDiskStore = create<DiskState>()((set, get) => ({
  status: diskSupported() ? 'unmounted' : 'unsupported',
  label: '',
  error: null,
  revision: 0,
  writable: false,

  choose: async () => {
    if (!diskSupported()) return;
    set({ status: 'mounting', error: null });
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker: (options?: { mode?: PermissionMode; id?: string }) => Promise<DiskDirectoryHandle>;
        }
      ).showDirectoryPicker;
      // `id` asks the browser to reopen at the last place this app was used.
      const handle = await picker({ mode: MODE, id: 'palm-disk' });

      // Remembering the folder for next time is a convenience, not a
      // precondition: if storage refuses the handle, mount it anyway.
      try {
        await kv.set(NAMESPACE, HANDLE_KEY, handle);
      } catch (error) {
        console.warn('[palm/disk] could not remember this folder for next time', error);
      }

      disk.attach(handle);
      set({
        status: 'ready',
        label: handle.name,
        error: null,
        writable: false,
        revision: get().revision + 1,
      });
    } catch (error) {
      // Closing the picker is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        set({ status: disk.mounted ? 'ready' : 'unmounted' });
        return;
      }
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  reconnect: async () => {
    const handle = await kv.get<DiskDirectoryHandle>(NAMESPACE, HANDLE_KEY);
    if (!looksLikeDirectory(handle)) {
      set({ status: 'unmounted' });
      return;
    }
    set({ status: 'mounting', error: null });
    const state = await permissionState(handle, true);
    if (state !== 'granted') {
      set({ status: 'needs-permission', label: handle.name });
      return;
    }
    disk.attach(handle);
    set({
      status: 'ready',
      label: handle.name,
      error: null,
      writable: false,
      revision: get().revision + 1,
    });
  },

  restore: async () => {
    if (!diskSupported()) {
      set({ status: 'unsupported' });
      return;
    }
    let handle: DiskDirectoryHandle | undefined;
    try {
      handle = await kv.get<DiskDirectoryHandle>(NAMESPACE, HANDLE_KEY);
    } catch {
      handle = undefined;
    }
    if (!looksLikeDirectory(handle)) {
      set({ status: 'unmounted' });
      return;
    }
    // Query without prompting — boot has no user gesture to spend.
    const state = await permissionState(handle, false);
    if (state === 'granted') {
      disk.attach(handle);
      // A restored session is read-only until the user asks to write again:
      // write permission is never inherited silently across a reload.
      set({ status: 'ready', label: handle.name, writable: false, revision: get().revision + 1 });
    } else {
      set({ status: 'needs-permission', label: handle.name });
    }
  },

  eject: async () => {
    disk.detach();
    await kv.remove(NAMESPACE, HANDLE_KEY);
    set({
      status: 'unmounted',
      label: '',
      error: null,
      writable: false,
      revision: get().revision + 1,
    });
  },

  refresh: (path) => {
    disk.invalidate(path);
    set({ revision: get().revision + 1 });
  },

  requestWrite: async () => {
    if (get().writable) return true;

    // The mounted handle is the source of truth. Falling back to storage
    // covers nothing useful — if the volume is not mounted there is nothing
    // to write to — and reading storage first would make a failed "remember
    // this folder" silently disable writing for the whole session.
    const handle = disk.rootHandle;
    if (!looksLikeDirectory(handle)) return false;

    const state = await permissionState(handle, true, 'readwrite');
    const writable = state === 'granted';
    set({ writable });
    return writable;
  },
}));

/** Non-React entry point, used at boot. */
export async function restoreDisk(): Promise<void> {
  await useDiskStore.getState().restore();
}

export { disk, DiskVolume, diskSupported };
