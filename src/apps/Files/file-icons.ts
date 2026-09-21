import { categoryForMime } from '../../core/filesystem/mime';
import type { FSNode } from '../../core/filesystem/types';

const CATEGORY_ICON: Record<string, string> = {
  folder: 'Folder',
  text: 'FileText',
  code: 'FileCode',
  image: 'FileImage',
  audio: 'FileAudio',
  video: 'FileVideo',
  archive: 'FileArchive',
  document: 'FileText',
  binary: 'File',
};

const CATEGORY_COLOR: Record<string, string> = {
  folder: '#f0c060',
  text: '#8fa6c9',
  code: '#6ec3a8',
  image: '#c48ce0',
  audio: '#e08c9e',
  video: '#7aa8e8',
  archive: '#c9a26b',
  document: '#8fa6c9',
  binary: '#8b94a8',
};

export function nodeIcon(node: FSNode): string {
  if (node.kind === 'folder') return node.icon ?? 'Folder';
  return CATEGORY_ICON[categoryForMime(node.mime)] ?? 'File';
}

export function nodeColor(node: FSNode): string {
  if (node.kind === 'folder') return CATEGORY_COLOR.folder;
  return CATEGORY_COLOR[categoryForMime(node.mime)] ?? CATEGORY_COLOR.binary;
}

export type SortKey = 'name' | 'type' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

export function sortNodes(nodes: FSNode[], key: SortKey, direction: SortDirection): FSNode[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    // Folders always lead, regardless of the sort direction — this is what
    // every file manager does and what makes navigation predictable.
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    switch (key) {
      case 'size':
        return (a.size - b.size) * factor;
      case 'modified':
        return (a.modifiedAt - b.modifiedAt) * factor;
      case 'type': {
        const diff = a.mime.localeCompare(b.mime);
        return (diff !== 0 ? diff : a.name.localeCompare(b.name, undefined, { numeric: true })) * factor;
      }
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true }) * factor;
    }
  });
}
