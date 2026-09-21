/**
 * In-memory stand-ins for File System Access handles.
 *
 * `DiskVolume` is written against a structural interface precisely so it can
 * be driven without a browser picker: the File System Access API is
 * Chromium-only and cannot be exercised in a headless test run, so the volume
 * logic would otherwise be unverifiable.
 *
 * Test-support code, not shipped behaviour — but it lives in `src/` so the
 * types stay checked alongside the interface it imitates.
 */

import type { DiskDirectoryHandle, DiskFileHandle, DiskWritableStream } from './disk';

export interface FakeTree {
  [name: string]: string | FakeTree;
}

class FakeFileHandle implements DiskFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  private contents: string;
  private lastModified: number;

  constructor(name: string, contents: string, lastModified: number) {
    this.name = name;
    this.contents = contents;
    this.lastModified = lastModified;
  }

  async getFile(): Promise<File> {
    return new File([this.contents], this.name, {
      lastModified: this.lastModified,
      type: '', // real pickers often report '' too; the volume falls back to the extension
    });
  }

  /**
   * Mirrors the real API's swap-file behaviour: writes accumulate and are only
   * applied to the file on close, so an abandoned stream changes nothing.
   */
  async createWritable(): Promise<DiskWritableStream> {
    let pending = '';
    return {
      write: async (data: string | Blob) => {
        pending += typeof data === 'string' ? data : await data.text();
      },
      close: async () => {
        this.contents = pending;
        this.lastModified = Date.now();
      },
      abort: async () => {
        pending = '';
      },
    };
  }
}

class FakeDirectoryHandle implements DiskDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  private children = new Map<string, DiskFileHandle | DiskDirectoryHandle>();
  private readonly clock: number;

  constructor(name: string, tree: FakeTree, clock = 1_700_000_000_000) {
    this.name = name;
    this.clock = clock;
    for (const [key, value] of Object.entries(tree)) {
      this.children.set(
        key,
        typeof value === 'string'
          ? new FakeFileHandle(key, value, this.clock)
          : new FakeDirectoryHandle(key, value, this.clock),
      );
    }
  }

  async *entries(): AsyncIterableIterator<[string, DiskFileHandle | DiskDirectoryHandle]> {
    for (const entry of this.children) yield entry;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DiskDirectoryHandle> {
    const child = this.children.get(name);
    if (child) {
      if (child.kind !== 'directory') throw new Error(`TypeMismatchError: ${name}`);
      return child;
    }
    if (!options?.create) throw new Error(`NotFoundError: ${name}`);
    const created = new FakeDirectoryHandle(name, {}, this.clock);
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DiskFileHandle> {
    const child = this.children.get(name);
    if (child) {
      if (child.kind !== 'file') throw new Error(`TypeMismatchError: ${name}`);
      return child;
    }
    if (!options?.create) throw new Error(`NotFoundError: ${name}`);
    const created = new FakeFileHandle(name, '', this.clock);
    this.children.set(name, created);
    return created;
  }

  /** Test helper: read a file's current contents without going through the volume. */
  async contentsOf(name: string): Promise<string | null> {
    const child = this.children.get(name);
    if (!child || child.kind !== 'file') return null;
    return (await child.getFile()).text();
  }

  /** Test helper: mutate the tree to simulate an edit made outside Palm OS. */
  put(name: string, contents: string): void {
    this.children.set(name, new FakeFileHandle(name, contents, this.clock));
  }

  remove(name: string): void {
    this.children.delete(name);
  }
}

export function fakeDirectory(name: string, tree: FakeTree): FakeDirectoryHandle {
  return new FakeDirectoryHandle(name, tree);
}

export type { FakeDirectoryHandle };
