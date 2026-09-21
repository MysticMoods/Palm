/** Virtual filesystem data model. */

export type NodeKind = 'file' | 'folder';

export interface TrashInfo {
  /** Where the node lived before deletion, so Restore can put it back. */
  originalParentId: string;
  /** Human-readable original path, shown in the Trash listing. */
  originalPath: string;
  deletedAt: number;
}

export interface FSNode {
  id: string;
  name: string;
  /** `null` only for the filesystem root. */
  parentId: string | null;
  kind: NodeKind;
  mime: string;
  /** Byte length for files; 0 for folders (computed on demand). */
  size: number;
  createdAt: number;
  modifiedAt: number;
  /** Present only while the node sits in the Trash. */
  trash?: TrashInfo | null;
  /** Folders the OS depends on cannot be renamed or deleted. */
  system?: boolean;
  /** Optional icon hint (lucide icon name) for special folders. */
  icon?: string;
}

/** File payload record, stored separately from metadata. */
export interface FSContent {
  id: string;
  /** Text files keep a string; binary files keep a Blob. */
  data: string | Blob;
}

export type FileData = string | Blob;

export interface WriteOptions {
  mime?: string;
  /** Create parent folders as needed. */
  recursive?: boolean;
}

export interface FSChange {
  type: 'create' | 'update' | 'delete' | 'move' | 'trash' | 'restore' | 'reset';
  /** Node ids touched by the change. */
  ids: string[];
}

export type FSListener = (change: FSChange) => void;

export class FSError extends Error {
  readonly code:
    | 'ENOENT'
    | 'EEXIST'
    | 'ENOTDIR'
    | 'EISDIR'
    | 'EINVAL'
    | 'EPERM'
    | 'ELOOP';
  constructor(code: FSError['code'], message: string) {
    super(message);
    this.name = 'FSError';
    this.code = code;
  }
}
