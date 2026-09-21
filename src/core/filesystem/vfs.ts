/**
 * The Palm OS virtual filesystem.
 *
 * Node metadata is kept in memory (so listings, path resolution and search are
 * synchronous and cheap) and mirrored into IndexedDB. File payloads stay in a
 * separate object store and are only loaded when something actually reads a
 * file.
 *
 * This filesystem is entirely virtual: it lives in the browser's IndexedDB and
 * has no relationship to the host machine's disk. Real local files are reached
 * through a separate, explicitly-granted bridge — see `core/filesystem/local`.
 */

import { STORE, idb, transact } from '../storage/db';
import { FOLDER_MIME, mimeFromName } from './mime';
import * as p from './path';
import { FSError } from './types';
import type { FSChange, FSContent, FSListener, FSNode, FileData, WriteOptions } from './types';

export const ROOT_ID = 'root';

function uid(): string {
  return crypto.randomUUID();
}

function byteLength(data: FileData): number {
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  return data.size;
}

class VirtualFileSystem {
  /** id → node */
  private nodes = new Map<string, FSNode>();
  /** parentId → set of child ids */
  private children = new Map<string, Set<string>>();
  private listeners = new Set<FSListener>();
  private ready = false;

  // ------------------------------------------------------------------ //
  // Lifecycle
  // ------------------------------------------------------------------ //

  async init(): Promise<void> {
    if (this.ready) return;
    const stored = await idb.getAll<FSNode>(STORE.nodes);
    this.nodes.clear();
    this.children.clear();
    for (const node of stored) this.index(node);
    this.ready = true;
  }

  get initialized(): boolean {
    return this.ready;
  }

  get isEmpty(): boolean {
    return this.nodes.size === 0;
  }

  private index(node: FSNode) {
    this.nodes.set(node.id, node);
    if (node.parentId) {
      let set = this.children.get(node.parentId);
      if (!set) {
        set = new Set();
        this.children.set(node.parentId, set);
      }
      set.add(node.id);
    }
  }

  private unindex(node: FSNode) {
    this.nodes.delete(node.id);
    if (node.parentId) this.children.get(node.parentId)?.delete(node.id);
    this.children.delete(node.id);
  }

  // ------------------------------------------------------------------ //
  // Change notification
  // ------------------------------------------------------------------ //

  subscribe(listener: FSListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: FSChange) {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[palm/fs] listener failed', err);
      }
    }
  }

  // ------------------------------------------------------------------ //
  // Lookup
  // ------------------------------------------------------------------ //

  getNode(id: string): FSNode | undefined {
    return this.nodes.get(id);
  }

  /** Resolve an absolute path to a node, or `undefined` if it does not exist. */
  nodeAt(path: string): FSNode | undefined {
    const normalized = p.normalize(path);
    if (normalized === p.ROOT) return this.nodes.get(ROOT_ID);
    let current = this.nodes.get(ROOT_ID);
    if (!current) return undefined;
    for (const segment of p.segments(normalized)) {
      const next = this.childByName(current.id, segment);
      if (!next) return undefined;
      current = next;
    }
    return current;
  }

  /** Same as `nodeAt` but throws a typed error when missing. */
  requireNode(path: string): FSNode {
    const node = this.nodeAt(path);
    if (!node) throw new FSError('ENOENT', `No such file or directory: ${path}`);
    return node;
  }

  requireById(id: string): FSNode {
    const node = this.nodes.get(id);
    if (!node) throw new FSError('ENOENT', `No such node: ${id}`);
    return node;
  }

  exists(path: string): boolean {
    return this.nodeAt(path) !== undefined;
  }

  childByName(parentId: string, name: string): FSNode | undefined {
    const ids = this.children.get(parentId);
    if (!ids) return undefined;
    const target = name.toLowerCase();
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node && !node.trash && node.name.toLowerCase() === target) return node;
    }
    return undefined;
  }

  /** Absolute path of a node. Returns `/` for the root. */
  pathOf(id: string): string {
    const parts: string[] = [];
    let current = this.nodes.get(id);
    const guard = new Set<string>();
    while (current && current.parentId) {
      if (guard.has(current.id)) break; // defensive: never loop forever
      guard.add(current.id);
      parts.unshift(current.name);
      current = this.nodes.get(current.parentId);
    }
    return parts.length > 0 ? p.SEP + parts.join(p.SEP) : p.ROOT;
  }

  /** Direct children of a folder, excluding anything in the Trash. */
  list(idOrPath: string): FSNode[] {
    const node = idOrPath.startsWith(p.SEP) ? this.requireNode(idOrPath) : this.requireById(idOrPath);
    if (node.kind !== 'folder') throw new FSError('ENOTDIR', `Not a folder: ${node.name}`);
    const ids = this.children.get(node.id);
    if (!ids) return [];
    const out: FSNode[] = [];
    for (const id of ids) {
      const child = this.nodes.get(id);
      if (child && !child.trash) out.push(child);
    }
    return out;
  }

  /** Every non-trashed node beneath `id`, depth-first. */
  descendants(id: string, includeTrashed = false): FSNode[] {
    const out: FSNode[] = [];
    const stack = [...(this.children.get(id) ?? [])];
    while (stack.length > 0) {
      const childId = stack.pop()!;
      const node = this.nodes.get(childId);
      if (!node) continue;
      if (!includeTrashed && node.trash) continue;
      out.push(node);
      const grandchildren = this.children.get(childId);
      if (grandchildren) stack.push(...grandchildren);
    }
    return out;
  }

  /** Recursive byte size; folders sum their contents. */
  sizeOf(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    if (node.kind === 'file') return node.size;
    return this.descendants(id).reduce((sum, child) => sum + (child.kind === 'file' ? child.size : 0), 0);
  }

  countWithin(id: string): { files: number; folders: number } {
    let files = 0;
    let folders = 0;
    for (const node of this.descendants(id)) {
      if (node.kind === 'folder') folders += 1;
      else files += 1;
    }
    return { files, folders };
  }

  /** A name that does not collide inside `parentId` ("report (2).txt"). */
  uniqueName(parentId: string, name: string): string {
    if (!this.childByName(parentId, name)) return name;
    const base = p.stem(name);
    const ext = p.extname(name);
    const suffix = ext ? `.${ext}` : '';
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base} (${n})${suffix}`;
      if (!this.childByName(parentId, candidate)) return candidate;
    }
    return `${base} ${Date.now()}${suffix}`;
  }

  // ------------------------------------------------------------------ //
  // Mutation
  // ------------------------------------------------------------------ //

  private assertName(name: string) {
    if (!p.isValidName(name)) {
      throw new FSError('EINVAL', `"${name}" is not a valid name.`);
    }
  }

  private async persist(nodes: FSNode[]): Promise<void> {
    await idb.putMany(STORE.nodes, nodes);
  }

  async createFolder(parentId: string, name: string, options?: { system?: boolean; icon?: string }): Promise<FSNode> {
    const trimmed = name.trim();
    this.assertName(trimmed);
    const parent = this.requireById(parentId);
    if (parent.kind !== 'folder') throw new FSError('ENOTDIR', `Not a folder: ${parent.name}`);
    if (this.childByName(parentId, trimmed)) {
      throw new FSError('EEXIST', `"${trimmed}" already exists here.`);
    }
    const now = Date.now();
    const node: FSNode = {
      id: uid(),
      name: trimmed,
      parentId,
      kind: 'folder',
      mime: FOLDER_MIME,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      trash: null,
      system: options?.system ?? false,
      icon: options?.icon,
    };
    this.index(node);
    await this.persist([node]);
    this.touchParent(parentId);
    this.emit({ type: 'create', ids: [node.id] });
    return node;
  }

  /** `mkdir -p` over an absolute path; returns the deepest folder. */
  async mkdirp(path: string): Promise<FSNode> {
    let current = this.nodes.get(ROOT_ID);
    if (!current) throw new FSError('ENOENT', 'Filesystem root is missing.');
    for (const segment of p.segments(p.normalize(path))) {
      const existing = this.childByName(current.id, segment);
      if (existing) {
        if (existing.kind !== 'folder') {
          throw new FSError('ENOTDIR', `${segment} exists and is not a folder.`);
        }
        current = existing;
      } else {
        current = await this.createFolder(current.id, segment);
      }
    }
    return current;
  }

  async createFile(
    parentId: string,
    name: string,
    data: FileData = '',
    mime?: string,
  ): Promise<FSNode> {
    const trimmed = name.trim();
    this.assertName(trimmed);
    const parent = this.requireById(parentId);
    if (parent.kind !== 'folder') throw new FSError('ENOTDIR', `Not a folder: ${parent.name}`);
    if (this.childByName(parentId, trimmed)) {
      throw new FSError('EEXIST', `"${trimmed}" already exists here.`);
    }
    const now = Date.now();
    const node: FSNode = {
      id: uid(),
      name: trimmed,
      parentId,
      kind: 'file',
      mime: mime ?? (typeof data !== 'string' && data.type ? data.type : mimeFromName(trimmed)),
      size: byteLength(data),
      createdAt: now,
      modifiedAt: now,
      trash: null,
    };
    this.index(node);
    await transact([STORE.nodes, STORE.contents], 'readwrite', (tx) => {
      tx.objectStore(STORE.nodes).put(node);
      tx.objectStore(STORE.contents).put({ id: node.id, data } satisfies FSContent);
    });
    this.touchParent(parentId);
    this.emit({ type: 'create', ids: [node.id] });
    return node;
  }

  /** Write by absolute path, creating or overwriting as needed. */
  async writeFile(path: string, data: FileData, options: WriteOptions = {}): Promise<FSNode> {
    const normalized = p.normalize(path);
    const existing = this.nodeAt(normalized);
    if (existing) {
      if (existing.kind === 'folder') throw new FSError('EISDIR', `${path} is a folder.`);
      await this.writeNode(existing.id, data, options.mime);
      return this.requireById(existing.id);
    }
    const parentPath = p.dirname(normalized);
    let parent = this.nodeAt(parentPath);
    if (!parent) {
      if (!options.recursive) throw new FSError('ENOENT', `No such folder: ${parentPath}`);
      parent = await this.mkdirp(parentPath);
    }
    return this.createFile(parent.id, p.basename(normalized), data, options.mime);
  }

  /** Replace a file's contents in place. */
  async writeNode(id: string, data: FileData, mime?: string): Promise<FSNode> {
    const node = this.requireById(id);
    if (node.kind === 'folder') throw new FSError('EISDIR', `${node.name} is a folder.`);
    const updated: FSNode = {
      ...node,
      size: byteLength(data),
      mime: mime ?? node.mime,
      modifiedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    await transact([STORE.nodes, STORE.contents], 'readwrite', (tx) => {
      tx.objectStore(STORE.nodes).put(updated);
      tx.objectStore(STORE.contents).put({ id, data } satisfies FSContent);
    });
    this.emit({ type: 'update', ids: [id] });
    return updated;
  }

  async readNode(id: string): Promise<FileData> {
    const node = this.requireById(id);
    if (node.kind === 'folder') throw new FSError('EISDIR', `${node.name} is a folder.`);
    const record = await idb.get<FSContent>(STORE.contents, id);
    return record?.data ?? '';
  }

  async readFile(path: string): Promise<FileData> {
    return this.readNode(this.requireNode(path).id);
  }

  /** Read a node as text, decoding Blob payloads when necessary. */
  async readText(id: string): Promise<string> {
    const data = await this.readNode(id);
    if (typeof data === 'string') return data;
    return data.text();
  }

  /** Object URL for a binary payload. Callers must revoke it when done. */
  async createObjectURL(id: string): Promise<string> {
    const node = this.requireById(id);
    const data = await this.readNode(id);
    const blob = typeof data === 'string' ? new Blob([data], { type: node.mime }) : data;
    return URL.createObjectURL(blob);
  }

  async rename(id: string, name: string): Promise<FSNode> {
    const trimmed = name.trim();
    this.assertName(trimmed);
    const node = this.requireById(id);
    if (node.system) throw new FSError('EPERM', `"${node.name}" is a system folder and cannot be renamed.`);
    if (node.name === trimmed) return node;
    if (node.parentId && this.childByName(node.parentId, trimmed)) {
      throw new FSError('EEXIST', `"${trimmed}" already exists here.`);
    }
    const updated: FSNode = {
      ...node,
      name: trimmed,
      // Keep the MIME in step when a file's extension changes.
      mime: node.kind === 'file' ? mimeFromName(trimmed) : node.mime,
      modifiedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    await this.persist([updated]);
    this.emit({ type: 'update', ids: [id] });
    return updated;
  }

  async move(id: string, newParentId: string, newName?: string): Promise<FSNode> {
    const node = this.requireById(id);
    const parent = this.requireById(newParentId);
    if (parent.kind !== 'folder') throw new FSError('ENOTDIR', `Not a folder: ${parent.name}`);
    if (node.system) throw new FSError('EPERM', `"${node.name}" is a system folder and cannot be moved.`);
    if (id === newParentId) throw new FSError('EINVAL', 'A folder cannot contain itself.');
    if (this.isAncestor(id, newParentId)) {
      throw new FSError('ELOOP', 'A folder cannot be moved inside itself.');
    }
    if (node.parentId === newParentId && !newName) return node;

    const name = newName?.trim() ?? node.name;
    this.assertName(name);
    const finalName = this.childByName(newParentId, name) ? this.uniqueName(newParentId, name) : name;

    const previousParent = node.parentId;
    const updated: FSNode = { ...node, parentId: newParentId, name: finalName, modifiedAt: Date.now() };
    if (previousParent) this.children.get(previousParent)?.delete(id);
    this.nodes.set(id, updated);
    this.index(updated);
    await this.persist([updated]);
    if (previousParent) this.touchParent(previousParent);
    this.touchParent(newParentId);
    this.emit({ type: 'move', ids: [id] });
    return updated;
  }

  /** True when `ancestorId` is anywhere above `nodeId`. */
  isAncestor(ancestorId: string, nodeId: string): boolean {
    let current = this.nodes.get(nodeId);
    const guard = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (guard.has(current.parentId)) return false;
      guard.add(current.parentId);
      current = this.nodes.get(current.parentId);
    }
    return false;
  }

  /** Deep copy of a file or folder into `targetParentId`. */
  async copy(id: string, targetParentId: string, newName?: string): Promise<FSNode> {
    const node = this.requireById(id);
    const target = this.requireById(targetParentId);
    if (target.kind !== 'folder') throw new FSError('ENOTDIR', `Not a folder: ${target.name}`);
    if (node.kind === 'folder' && (id === targetParentId || this.isAncestor(id, targetParentId))) {
      throw new FSError('ELOOP', 'A folder cannot be copied inside itself.');
    }
    const name = this.uniqueName(targetParentId, newName?.trim() || node.name);

    if (node.kind === 'file') {
      const data = await this.readNode(id);
      return this.createFile(targetParentId, name, data, node.mime);
    }

    const folder = await this.createFolder(targetParentId, name, { icon: node.icon });
    for (const child of this.list(id)) {
      await this.copy(child.id, folder.id, child.name);
    }
    return folder;
  }

  async duplicate(id: string): Promise<FSNode> {
    const node = this.requireById(id);
    if (!node.parentId) throw new FSError('EPERM', 'The root cannot be duplicated.');
    const base = p.stem(node.name);
    const ext = p.extname(node.name);
    const candidate = node.kind === 'folder' ? `${node.name} copy` : `${base} copy${ext ? `.${ext}` : ''}`;
    return this.copy(id, node.parentId, this.uniqueName(node.parentId, candidate));
  }

  // ------------------------------------------------------------------ //
  // Trash
  // ------------------------------------------------------------------ //

  async moveToTrash(id: string): Promise<void> {
    const node = this.requireById(id);
    if (node.system) throw new FSError('EPERM', `"${node.name}" is a system folder and cannot be deleted.`);
    if (!node.parentId) throw new FSError('EPERM', 'The root cannot be deleted.');
    if (node.trash) return;
    const updated: FSNode = {
      ...node,
      trash: {
        originalParentId: node.parentId,
        originalPath: this.pathOf(node.id),
        deletedAt: Date.now(),
      },
    };
    this.nodes.set(id, updated);
    await this.persist([updated]);
    this.touchParent(node.parentId);
    this.emit({ type: 'trash', ids: [id] });
  }

  /** Top-level trashed items (children of trashed folders stay nested). */
  listTrash(): FSNode[] {
    const out: FSNode[] = [];
    for (const node of this.nodes.values()) {
      if (!node.trash) continue;
      // Skip nodes that are only in the trash because an ancestor is.
      const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
      if (parent?.trash) continue;
      out.push(node);
    }
    return out.sort((a, b) => (b.trash?.deletedAt ?? 0) - (a.trash?.deletedAt ?? 0));
  }

  trashSize(): number {
    return this.listTrash().reduce((sum, node) => {
      if (node.kind === 'file') return sum + node.size;
      return (
        sum +
        this.descendants(node.id, true).reduce(
          (inner, child) => inner + (child.kind === 'file' ? child.size : 0),
          0,
        )
      );
    }, 0);
  }

  async restoreFromTrash(id: string): Promise<FSNode> {
    const node = this.requireById(id);
    if (!node.trash) return node;
    // If the original home is gone (or itself trashed), fall back to Desktop.
    const original = this.nodes.get(node.trash.originalParentId);
    const destination =
      original && !original.trash && original.kind === 'folder'
        ? original
        : (this.nodeAt('/Desktop') ?? this.requireById(ROOT_ID));

    const name = this.childByName(destination.id, node.name)
      ? this.uniqueName(destination.id, node.name)
      : node.name;

    const previousParent = node.parentId;
    const updated: FSNode = { ...node, trash: null, parentId: destination.id, name };
    if (previousParent && previousParent !== destination.id) {
      this.children.get(previousParent)?.delete(id);
    }
    this.nodes.set(id, updated);
    this.index(updated);
    await this.persist([updated]);
    this.emit({ type: 'restore', ids: [id] });
    return updated;
  }

  /** Irreversibly remove a node and everything under it. */
  async deletePermanently(id: string): Promise<void> {
    const node = this.requireById(id);
    if (node.system) throw new FSError('EPERM', `"${node.name}" is a system folder and cannot be deleted.`);
    if (!node.parentId) throw new FSError('EPERM', 'The root cannot be deleted.');

    const victims = [node, ...this.descendants(id, true)];
    const ids = victims.map((n) => n.id);
    for (const victim of victims) this.unindex(victim);

    await transact([STORE.nodes, STORE.contents], 'readwrite', (tx) => {
      const nodeStore = tx.objectStore(STORE.nodes);
      const contentStore = tx.objectStore(STORE.contents);
      for (const victimId of ids) {
        nodeStore.delete(victimId);
        contentStore.delete(victimId);
      }
    });
    if (node.parentId) this.touchParent(node.parentId);
    this.emit({ type: 'delete', ids });
  }

  async emptyTrash(): Promise<number> {
    const top = this.listTrash();
    for (const node of top) {
      await this.deletePermanently(node.id);
    }
    return top.length;
  }

  private touchParent(parentId: string) {
    const parent = this.nodes.get(parentId);
    if (!parent) return;
    const updated = { ...parent, modifiedAt: Date.now() };
    this.nodes.set(parentId, updated);
    void idb.put(STORE.nodes, updated).catch(() => undefined);
  }

  // ------------------------------------------------------------------ //
  // Search
  // ------------------------------------------------------------------ //

  search(query: string, options: { limit?: number; root?: string } = {}): FSNode[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const limit = options.limit ?? 50;
    const rootId = options.root ? this.nodeAt(options.root)?.id : undefined;
    const pool = rootId ? this.descendants(rootId) : [...this.nodes.values()];

    const scored: Array<{ node: FSNode; score: number }> = [];
    for (const node of pool) {
      if (node.trash || node.id === ROOT_ID) continue;
      const name = node.name.toLowerCase();
      const index = name.indexOf(needle);
      if (index === -1) continue;
      // Prefix matches rank above mid-word matches; shorter names win ties.
      const score = (index === 0 ? 0 : 100 + index) + name.length * 0.01;
      scored.push({ node, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map((entry) => entry.node);
  }

  // ------------------------------------------------------------------ //
  // Backup
  // ------------------------------------------------------------------ //

  /** All nodes, including trashed ones — used by the exporter. */
  allNodes(): FSNode[] {
    return [...this.nodes.values()];
  }

  async allContents(): Promise<FSContent[]> {
    return idb.getAll<FSContent>(STORE.contents);
  }

  /** Replace the entire filesystem. Used by import and reset. */
  async replaceAll(nodes: FSNode[], contents: FSContent[]): Promise<void> {
    await transact([STORE.nodes, STORE.contents], 'readwrite', (tx) => {
      const nodeStore = tx.objectStore(STORE.nodes);
      const contentStore = tx.objectStore(STORE.contents);
      nodeStore.clear();
      contentStore.clear();
      for (const node of nodes) nodeStore.put(node);
      for (const content of contents) contentStore.put(content);
    });
    this.nodes.clear();
    this.children.clear();
    for (const node of nodes) this.index(node);
    this.emit({ type: 'reset', ids: [] });
  }

  stats(): { nodes: number; files: number; folders: number; bytes: number } {
    let files = 0;
    let folders = 0;
    let bytes = 0;
    for (const node of this.nodes.values()) {
      if (node.id === ROOT_ID) continue;
      if (node.kind === 'folder') folders += 1;
      else {
        files += 1;
        bytes += node.size;
      }
    }
    return { nodes: this.nodes.size, files, folders, bytes };
  }
}

/** The single filesystem instance shared by the OS and every application. */
export const vfs = new VirtualFileSystem();
export { FSError };
export type { FSNode, FSContent, FileData };
