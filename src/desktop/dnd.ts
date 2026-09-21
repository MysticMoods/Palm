/**
 * Shared drag-and-drop plumbing.
 *
 * Internal drags carry virtual filesystem node ids on a custom MIME type, so
 * the desktop, the Files app and the Trash can all recognise each other's
 * drags. Real files dropped from the host OS arrive as `DataTransfer.files`
 * and are copied into the virtual filesystem.
 */

import { notifications } from '../core/notifications/store';
import { FSError, vfs } from '../core/filesystem/vfs';

export const DROP_MIME = 'application/x-palm-nodes';

/** Largest real file we will pull into IndexedDB in one go. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export function writeDraggedNodes(transfer: DataTransfer, ids: string[]): void {
  transfer.setData(DROP_MIME, JSON.stringify(ids));
  // A plain-text fallback makes drags into text fields do something sensible.
  transfer.setData(
    'text/plain',
    ids
      .map((id) => vfs.pathOf(id))
      .filter(Boolean)
      .join('\n'),
  );
  transfer.effectAllowed = 'copyMove';
}

export function readDroppedNodes(transfer: DataTransfer): string[] {
  const raw = transfer.getData(DROP_MIME);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && vfs.getNode(id) !== undefined);
  } catch {
    return [];
  }
}

/** Copy real files dropped from the host OS into a virtual folder. */
export async function importDroppedFiles(transfer: DataTransfer, targetFolderId: string): Promise<number> {
  const files = [...(transfer.files ?? [])];
  if (files.length === 0) return 0;

  let imported = 0;
  const skipped: string[] = [];

  for (const file of files) {
    if (file.size > MAX_IMPORT_BYTES) {
      skipped.push(file.name);
      continue;
    }
    try {
      const name = vfs.uniqueName(targetFolderId, file.name);
      const isText = file.type.startsWith('text/') || file.type === 'application/json';
      const data = isText ? await file.text() : new Blob([await file.arrayBuffer()], { type: file.type });
      await vfs.createFile(targetFolderId, name, data, file.type || undefined);
      imported += 1;
    } catch (err) {
      skipped.push(file.name);
      console.warn('[palm/dnd] import failed', file.name, err);
    }
  }

  if (imported > 0) {
    notifications.push('files', {
      title: imported === 1 ? `Imported "${files[0].name}"` : `Imported ${imported} files`,
      body: 'Copied into your Palm OS filesystem.',
      tag: 'import',
    });
  }
  if (skipped.length > 0) {
    notifications.push('files', {
      title: `Could not import ${skipped.length} file${skipped.length === 1 ? '' : 's'}`,
      body: `${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''} — too large or unreadable.`,
      urgency: 'critical',
    });
  }
  return imported;
}

/** Move nodes into a folder, reporting failures once rather than per item. */
export async function moveNodesInto(ids: string[], targetFolderId: string): Promise<void> {
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await vfs.move(id, targetFolderId);
    } catch (err) {
      if (err instanceof FSError && err.code === 'ELOOP') failures.push(vfs.getNode(id)?.name ?? id);
      else if (err instanceof FSError && err.code === 'EPERM') failures.push(vfs.getNode(id)?.name ?? id);
    }
  }
  if (failures.length > 0) {
    notifications.push('files', {
      title: 'Some items could not be moved',
      body: failures.join(', '),
      urgency: 'critical',
    });
  }
}
