/**
 * Backup export and import.
 *
 * The whole OS state — settings, profile, filesystem and every application's
 * private data — serialises to a single JSON document. Binary file payloads
 * are base64-encoded so the backup stays a plain, inspectable text file.
 *
 * Imports are validated before anything is written: a malformed or hostile
 * file must not be able to corrupt the filesystem index.
 */

import { OS_VERSION } from './settings/defaults';
import type { FSContent, FSNode } from './filesystem/types';
import { vfs } from './filesystem/vfs';
import { kv } from './storage/kv';
import type { KVRecord } from './storage/kv';

export const BACKUP_FORMAT = 'palm-os-backup';
export const BACKUP_VERSION = 1;

interface SerialisedContent {
  id: string;
  /** `text` payloads are stored verbatim; `blob` payloads are base64. */
  encoding: 'text' | 'blob';
  mime?: string;
  data: string;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  osVersion: string;
  createdAt: number;
  nodes: FSNode[];
  contents: SerialisedContent[];
  kv: KVRecord[];
}

/* ------------------------------ Base64 helpers ---------------------------- */

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  // Chunked to avoid blowing the argument limit on large files.
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

/* --------------------------------- Export -------------------------------- */

export async function createBackup(): Promise<Backup> {
  const nodes = vfs.allNodes();
  const rawContents = await vfs.allContents();

  const contents: SerialisedContent[] = [];
  for (const record of rawContents) {
    if (typeof record.data === 'string') {
      contents.push({ id: record.id, encoding: 'text', data: record.data });
    } else {
      contents.push({
        id: record.id,
        encoding: 'blob',
        mime: record.data.type,
        data: await blobToBase64(record.data),
      });
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    osVersion: OS_VERSION,
    createdAt: Date.now(),
    nodes,
    contents,
    kv: await kv.dump(),
  };
}

export function backupFilename(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `palm-os-backup-${stamp}.json`;
}

/* --------------------------------- Import -------------------------------- */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  summary?: {
    createdAt: number;
    osVersion: string;
    files: number;
    folders: number;
    settings: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validNode(value: unknown): value is FSNode {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.parentId === 'string' || value.parentId === null) &&
    (value.kind === 'file' || value.kind === 'folder') &&
    typeof value.mime === 'string' &&
    typeof value.size === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.modifiedAt === 'number'
  );
}

/**
 * Check a parsed backup thoroughly before it is applied.
 *
 * Beyond shape checking, this verifies the filesystem graph itself: a node
 * pointing at a missing parent, or a cycle, would leave the OS unable to
 * resolve paths at all.
 */
export function validateBackup(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) return { valid: false, errors: ['The file is not a JSON object.'] };
  if (value.format !== BACKUP_FORMAT) {
    return { valid: false, errors: ['This is not a Palm OS backup file.'] };
  }
  if (typeof value.version !== 'number' || value.version > BACKUP_VERSION) {
    errors.push(`Backup version ${String(value.version)} is newer than this version of Palm OS can read.`);
  }
  if (!Array.isArray(value.nodes)) errors.push('The backup has no filesystem entries.');
  if (!Array.isArray(value.contents)) errors.push('The backup has no file contents.');
  if (!Array.isArray(value.kv)) errors.push('The backup has no settings.');

  if (errors.length > 0) return { valid: false, errors };

  const nodes = value.nodes as unknown[];
  const invalid = nodes.filter((node) => !validNode(node));
  if (invalid.length > 0) {
    errors.push(`${invalid.length} filesystem entries are malformed.`);
    return { valid: false, errors };
  }

  const typed = nodes as FSNode[];
  const ids = new Set(typed.map((node) => node.id));

  if (ids.size !== typed.length) errors.push('The backup contains duplicate filesystem ids.');
  if (!typed.some((node) => node.parentId === null)) errors.push('The backup has no filesystem root.');

  for (const node of typed) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      errors.push(`"${node.name}" refers to a parent folder that is not in the backup.`);
      break;
    }
  }

  // Walk every node up to the root; a cycle would otherwise hang path lookup.
  const byId = new Map(typed.map((node) => [node.id, node]));
  for (const node of typed) {
    const seen = new Set<string>([node.id]);
    let current = node.parentId ? byId.get(node.parentId) : null;
    while (current) {
      if (seen.has(current.id)) {
        errors.push('The backup contains a folder loop and cannot be restored.');
        break;
      }
      seen.add(current.id);
      current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
    }
    if (errors.length > 0) break;
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    summary: {
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
      osVersion: typeof value.osVersion === 'string' ? value.osVersion : 'unknown',
      files: typed.filter((node) => node.kind === 'file').length,
      folders: typed.filter((node) => node.kind === 'folder').length - 1,
      settings: (value.kv as unknown[]).length,
    },
  };
}

/** Apply a validated backup, replacing everything. */
export async function restoreBackup(backup: Backup): Promise<void> {
  const contents: FSContent[] = backup.contents.map((record) =>
    record.encoding === 'blob'
      ? { id: record.id, data: base64ToBlob(record.data, record.mime ?? 'application/octet-stream') }
      : { id: record.id, data: record.data },
  );

  await vfs.replaceAll(backup.nodes, contents);
  await kv.restore(backup.kv);
}

export async function parseBackupFile(file: File): Promise<{ backup: Backup; validation: ValidationResult }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return {
      backup: null as unknown as Backup,
      validation: { valid: false, errors: ['The file is not valid JSON.'] },
    };
  }
  const validation = validateBackup(parsed);
  return { backup: parsed as Backup, validation };
}
