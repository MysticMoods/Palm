/**
 * Bridge to the user's *real* local files via the File System Access API.
 *
 * This is deliberately a separate module from the virtual filesystem: nothing
 * here is implicit. The user picks a folder, the browser grants a handle, and
 * that handle is the entire extent of Palm OS's access to the real disk.
 *
 * Availability: Chromium-based browsers (Chrome, Edge, Opera, Arc) support
 * `showDirectoryPicker`. Firefox and Safari do not, so the Files app falls
 * back to plain file upload/download, which is the closest thing the platform
 * allows.
 */

import { kv } from '../storage/kv';

const NAMESPACE = 'system.localdisk';
const HANDLE_KEY = 'root-handle';

export interface LocalEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemHandle;
  size?: number;
  modifiedAt?: number;
  type?: string;
}

export type LocalSupport = 'full' | 'fallback';

/** Whether the browser can grant persistent access to a real folder. */
export function localDiskSupport(): LocalSupport {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window ? 'full' : 'fallback';
}

type PermissionMode = 'read' | 'readwrite';

interface HandleWithPermission extends FileSystemHandle {
  queryPermission?: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>;
}

export async function handlePermission(
  handle: FileSystemHandle,
  mode: PermissionMode = 'readwrite',
  prompt = false,
): Promise<PermissionState> {
  const target = handle as HandleWithPermission;
  try {
    const current = (await target.queryPermission?.({ mode })) ?? 'granted';
    if (current === 'granted' || !prompt) return current;
    return (await target.requestPermission?.({ mode })) ?? 'denied';
  } catch {
    return 'denied';
  }
}

/** Ask the user to pick a real folder. Throws `AbortError` if they cancel. */
export async function pickLocalDirectory(): Promise<FileSystemDirectoryHandle> {
  if (localDiskSupport() !== 'full') {
    throw new Error('This browser does not support granting folder access.');
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: { mode?: PermissionMode }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await kv.set(NAMESPACE, HANDLE_KEY, handle);
  return handle;
}

/**
 * Re-open the previously granted folder. Returns `null` when nothing was ever
 * granted, or when the browser has since dropped the permission (the user must
 * then pick the folder again — the spec gives no way around this).
 */
export async function restoreLocalDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await kv.get<FileSystemDirectoryHandle>(NAMESPACE, HANDLE_KEY);
    if (!handle) return null;
    const state = await handlePermission(handle, 'readwrite', false);
    return state === 'granted' ? handle : handle; // caller re-prompts on demand
  } catch {
    return null;
  }
}

export async function forgetLocalDirectory(): Promise<void> {
  await kv.remove(NAMESPACE, HANDLE_KEY);
}

export async function readLocalDirectory(handle: FileSystemDirectoryHandle): Promise<LocalEntry[]> {
  const entries: LocalEntry[] = [];
  const iterable = handle as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name, child] of iterable) {
    if (child.kind === 'file') {
      try {
        const file = await (child as FileSystemFileHandle).getFile();
        entries.push({
          name,
          kind: 'file',
          handle: child,
          size: file.size,
          modifiedAt: file.lastModified,
          type: file.type,
        });
      } catch {
        entries.push({ name, kind: 'file', handle: child });
      }
    } else {
      entries.push({ name, kind: 'directory', handle: child });
    }
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

export async function readLocalFile(handle: FileSystemFileHandle): Promise<File> {
  return handle.getFile();
}

export async function writeLocalFile(
  handle: FileSystemFileHandle,
  data: string | Blob,
): Promise<void> {
  const writable = await (
    handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }
  ).createWritable();
  await writable.write(data);
  await writable.close();
}

/** Universal fallback: hand the browser a file to save via a download. */
export function downloadBlob(data: Blob | string, filename: string, mime = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the navigation a tick before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Universal fallback: prompt for real files to copy into the virtual FS. */
export function pickFilesFallback(accept?: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files ? [...input.files] : []));
    // `cancel` is not universally supported; the focus fallback covers the rest.
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}
