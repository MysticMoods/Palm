/**
 * Palm Disk — a real host folder, mounted as a volume.
 *
 * This is deliberately *not* part of the virtual filesystem. The two have
 * different guarantees and the user needs to be able to tell them apart:
 *
 *   • The virtual filesystem is transactional, always available, and private
 *     to this origin. Nothing in it can surprise you.
 *   • Palm Disk is a folder on the real machine. It can be edited behind our
 *     back, it disappears when permission lapses, and a torn write is a torn
 *     real file.
 *
 * Directories are listed on demand rather than walked at mount: pointing this
 * at a folder containing `node_modules` should not freeze the OS for a minute.
 *
 * Availability: the File System Access API is Chromium-only. Everything here
 * reports `unsupported` elsewhere rather than failing at the point of use.
 */

import { categoryForMime, mimeFromName } from './mime';
import * as p from './path';

/* --------------------------------------------------------------------- *
 * Structural handle types
 *
 * Declared rather than imported so the module can be exercised against an
 * in-memory fake in tests — real browser handles satisfy these structurally.
 * --------------------------------------------------------------------- */

/** The subset of `FileSystemWritableFileStream` the volume uses. */
export interface DiskWritableStream {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface DiskFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable?(options?: { keepExistingData?: boolean }): Promise<DiskWritableStream>;
}

export interface DiskDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, DiskFileHandle | DiskDirectoryHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DiskDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<DiskFileHandle>;
}

export type DiskHandle = DiskFileHandle | DiskDirectoryHandle;

/** An entry as the UI sees it. Paths are relative to the mount root. */
export interface DiskEntry {
  /** Absolute within the volume, e.g. `/src/main.ts`. The root is `/`. */
  path: string;
  name: string;
  kind: 'file' | 'folder';
  /** 0 for folders — computing a real folder's size would mean walking it. */
  size: number;
  /** Epoch milliseconds, or 0 when the platform did not report one. */
  modifiedAt: number;
  mime: string;
}

export class DiskError extends Error {
  readonly code: 'unsupported' | 'denied' | 'missing' | 'notdir' | 'io';
  constructor(code: DiskError['code'], message: string) {
    super(message);
    this.name = 'DiskError';
    this.code = code;
  }
}

/** Guards against a pathological mount point during recursive search. */
const SEARCH_LIMITS = { entries: 4000, depth: 8, results: 200 };

export class DiskVolume {
  private root: DiskDirectoryHandle | null = null;
  /** Directory listings, keyed by volume path. Cleared by `invalidate`. */
  private listings = new Map<string, DiskEntry[]>();
  private handles = new Map<string, DiskDirectoryHandle>();

  get mounted(): boolean {
    return this.root !== null;
  }

  /** The chosen folder's own name, for display. */
  get label(): string {
    return this.root?.name ?? '';
  }

  /**
   * The live root handle.
   *
   * Permission escalation asks *this* rather than whatever is in storage:
   * remembering the folder is best-effort, and a failure to persist must not
   * make the mounted volume unwritable.
   */
  get rootHandle(): DiskDirectoryHandle | null {
    return this.root;
  }

  attach(root: DiskDirectoryHandle): void {
    this.root = root;
    this.listings.clear();
    this.handles.clear();
    this.handles.set('/', root);
  }

  detach(): void {
    this.root = null;
    this.listings.clear();
    this.handles.clear();
  }

  /** Forget cached listings so the next read sees changes made outside. */
  invalidate(path?: string): void {
    if (!path) {
      this.listings.clear();
      return;
    }
    const normalized = p.normalize(path);
    this.listings.delete(normalized);
    // A child's listing may be stale too if the folder itself was replaced.
    for (const key of [...this.listings.keys()]) {
      if (p.isWithin(normalized, key)) this.listings.delete(key);
    }
  }

  private requireRoot(): DiskDirectoryHandle {
    if (!this.root) throw new DiskError('missing', 'No folder is connected.');
    return this.root;
  }

  /** Resolve a volume path to its directory handle, caching as it walks. */
  async directoryAt(path: string): Promise<DiskDirectoryHandle> {
    const normalized = p.normalize(path);
    const cached = this.handles.get(normalized);
    if (cached) return cached;

    let current = this.requireRoot();
    let walked = '';
    for (const segment of p.segments(normalized)) {
      walked = `${walked}/${segment}`;
      const known = this.handles.get(walked);
      if (known) {
        current = known;
        continue;
      }
      try {
        current = await current.getDirectoryHandle(segment);
      } catch {
        throw new DiskError('missing', `No such folder on Palm Disk: ${normalized}`);
      }
      this.handles.set(walked, current);
    }
    return current;
  }

  async fileAt(path: string): Promise<DiskFileHandle> {
    const normalized = p.normalize(path);
    const parent = await this.directoryAt(p.dirname(normalized));
    try {
      return await parent.getFileHandle(p.basename(normalized));
    } catch {
      throw new DiskError('missing', `No such file on Palm Disk: ${normalized}`);
    }
  }

  /** Directory contents, folders first then names naturally ordered. */
  async list(path: string): Promise<DiskEntry[]> {
    const normalized = p.normalize(path);
    const cached = this.listings.get(normalized);
    if (cached) return cached;

    const directory = await this.directoryAt(normalized);
    const entries: DiskEntry[] = [];

    for await (const [name, handle] of directory.entries()) {
      const entryPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
      if (handle.kind === 'directory') {
        this.handles.set(entryPath, handle);
        entries.push({
          path: entryPath,
          name,
          kind: 'folder',
          size: 0,
          modifiedAt: 0,
          mime: 'inode/directory',
        });
      } else {
        let size = 0;
        let modifiedAt = 0;
        let type = '';
        try {
          const file = await handle.getFile();
          size = file.size;
          modifiedAt = file.lastModified;
          type = file.type;
        } catch {
          // A file can vanish between listing and stat; show what we know.
        }
        entries.push({
          path: entryPath,
          name,
          kind: 'file',
          size,
          modifiedAt,
          mime: type || mimeFromName(name),
        });
      }
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    this.listings.set(normalized, entries);
    return entries;
  }

  /* ------------------------------------------------------------------ *
   * Writing
   *
   * The platform already makes a write atomic: `createWritable()` buffers
   * into a swap file and only replaces the real one on `close()`, so an
   * abandoned or failed stream leaves the original intact. What it does *not*
   * give us is an undo — there is no Trash on someone's real disk — which is
   * why deleting and renaming are deliberately absent.
   * ------------------------------------------------------------------ */

  /** Overwrite an existing file, or create it if `create` is set. */
  async writeFile(path: string, data: string | Blob, options: { create?: boolean } = {}): Promise<void> {
    const normalized = p.normalize(path);
    const parent = await this.directoryAt(p.dirname(normalized));
    const name = p.basename(normalized);

    let handle: DiskFileHandle;
    try {
      handle = await parent.getFileHandle(name, { create: options.create ?? false });
    } catch {
      throw new DiskError('missing', `No such file on Palm Disk: ${normalized}`);
    }

    if (!handle.createWritable) {
      throw new DiskError('denied', 'This browser cannot write to real files.');
    }

    let stream: DiskWritableStream | undefined;
    try {
      stream = await handle.createWritable();
      await stream.write(data);
      await stream.close();
    } catch (error) {
      // Abandoning the stream discards the swap file; the original is untouched.
      await stream?.abort?.().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new DiskError(
        /denied|NotAllowed/i.test(message) ? 'denied' : 'io',
        `Could not write ${normalized}: ${message}`,
      );
    }

    this.invalidate(p.dirname(normalized));
  }

  /** Create a new, empty file. Fails if something is already there. */
  async createFile(path: string, data: string | Blob = ''): Promise<void> {
    const normalized = p.normalize(path);
    if (await this.stat(normalized)) {
      throw new DiskError('io', `"${p.basename(normalized)}" already exists in this folder.`);
    }
    await this.writeFile(normalized, data, { create: true });
  }

  /** Create a new folder. Fails if something is already there. */
  async createFolder(path: string): Promise<void> {
    const normalized = p.normalize(path);
    if (await this.stat(normalized)) {
      throw new DiskError('io', `"${p.basename(normalized)}" already exists in this folder.`);
    }
    const parent = await this.directoryAt(p.dirname(normalized));
    try {
      await parent.getDirectoryHandle(p.basename(normalized), { create: true });
    } catch (error) {
      throw new DiskError('io', `Could not create folder: ${String(error)}`);
    }
    this.invalidate(p.dirname(normalized));
  }

  /** A name that does not collide inside `directory`. */
  async uniqueName(directory: string, name: string): Promise<string> {
    const entries = await this.list(directory);
    const taken = new Set(entries.map((entry) => entry.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const suffix = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${stem} (${n})${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${stem} ${Date.now()}${suffix}`;
  }

  async stat(path: string): Promise<DiskEntry | null> {
    const normalized = p.normalize(path);
    if (normalized === '/') {
      return { path: '/', name: this.label, kind: 'folder', size: 0, modifiedAt: 0, mime: 'inode/directory' };
    }
    const siblings = await this.list(p.dirname(normalized));
    return siblings.find((entry) => entry.path === normalized) ?? null;
  }

  async readFile(path: string): Promise<File> {
    const handle = await this.fileAt(path);
    try {
      return await handle.getFile();
    } catch (error) {
      throw new DiskError('io', `Could not read ${path}: ${String(error)}`);
    }
  }

  async readText(path: string): Promise<string> {
    return (await this.readFile(path)).text();
  }

  /** Object URL for a real file. Callers must revoke it. */
  async createObjectURL(path: string): Promise<string> {
    return URL.createObjectURL(await this.readFile(path));
  }

  /**
   * Breadth-first name search, bounded.
   *
   * A real folder can be arbitrarily large and there is no index to consult,
   * so this walks live and stops at the limits rather than hanging the UI.
   */
  async search(
    query: string,
    options: { root?: string } = {},
  ): Promise<{ results: DiskEntry[]; truncated: boolean }> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return { results: [], truncated: false };

    const start = p.normalize(options.root ?? '/');
    const queue: Array<{ path: string; depth: number }> = [{ path: start, depth: 0 }];
    const results: DiskEntry[] = [];
    let seen = 0;
    let truncated = false;

    while (queue.length > 0) {
      const { path: current, depth } = queue.shift()!;
      let entries: DiskEntry[];
      try {
        entries = await this.list(current);
      } catch {
        continue; // unreadable folder — skip rather than abort the search
      }

      for (const entry of entries) {
        seen += 1;
        if (seen > SEARCH_LIMITS.entries) {
          truncated = true;
          break;
        }
        if (entry.name.toLowerCase().includes(needle)) {
          results.push(entry);
          if (results.length >= SEARCH_LIMITS.results) {
            truncated = true;
            break;
          }
        }
        if (entry.kind === 'folder' && depth + 1 <= SEARCH_LIMITS.depth) {
          queue.push({ path: entry.path, depth: depth + 1 });
        }
      }
      if (truncated) break;
    }

    // Prefix matches first, then shorter names, matching the virtual search.
    results.sort((a, b) => {
      const ai = a.name.toLowerCase().indexOf(needle);
      const bi = b.name.toLowerCase().indexOf(needle);
      if (ai !== bi) return ai - bi;
      return a.name.length - b.name.length;
    });

    return { results, truncated };
  }
}

/** The single mounted volume. */
export const disk = new DiskVolume();

/** Whether this browser can grant access to a real folder at all. */
export function diskSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export { categoryForMime };
