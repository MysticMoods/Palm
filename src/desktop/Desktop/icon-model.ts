/**
 * The desktop's icon model.
 *
 * The desktop shows the contents of `/Desktop` plus a couple of permanent
 * shortcuts. Positions are grid cells, auto-assigned column-major (like every
 * desktop OS) for icons the user has not placed by hand.
 */

import { categoryForMime } from '../../core/filesystem/mime';
import type { FSNode } from '../../core/filesystem/types';
import type { GridPosition } from '../../core/shell/desktop-store';
import type { IconSize } from '../../core/settings/types';

export interface DesktopIconModel {
  /** `file:<nodeId>` or `shortcut:<id>`. */
  key: string;
  label: string;
  icon: string;
  /** Tint applied to shortcut icons. */
  color?: string;
  node?: FSNode;
  /** Shortcuts open an app instead of a file. */
  appId?: string;
  appParams?: Record<string, unknown>;
  renamable: boolean;
  deletable: boolean;
  position: GridPosition;
  /** Overlay badge, e.g. a non-empty Trash. */
  badge?: number;
}

export const CELL: Record<IconSize, { width: number; height: number; icon: number }> = {
  small: { width: 76, height: 84, icon: 26 },
  medium: { width: 92, height: 100, icon: 32 },
  large: { width: 110, height: 118, icon: 40 },
};

export const GRID_MARGIN = 10;

const CATEGORY_ICONS: Record<string, string> = {
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

export function iconForNode(node: FSNode): string {
  if (node.kind === 'folder') return node.icon ?? 'Folder';
  return CATEGORY_ICONS[categoryForMime(node.mime)] ?? 'File';
}

/** How many rows fit in the available height. */
export function gridRows(height: number, size: IconSize): number {
  return Math.max(1, Math.floor((height - GRID_MARGIN * 2) / CELL[size].height));
}

export function gridColumns(width: number, size: IconSize): number {
  return Math.max(1, Math.floor((width - GRID_MARGIN * 2) / CELL[size].width));
}

export function cellToPixels(position: GridPosition, size: IconSize) {
  return {
    left: GRID_MARGIN + position.col * CELL[size].width,
    top: GRID_MARGIN + position.row * CELL[size].height,
  };
}

export function pixelsToCell(x: number, y: number, size: IconSize, columns: number, rows: number): GridPosition {
  const col = Math.round((x - GRID_MARGIN) / CELL[size].width);
  const row = Math.round((y - GRID_MARGIN) / CELL[size].height);
  return {
    col: Math.max(0, Math.min(columns - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

const cellKey = (position: GridPosition) => `${position.col},${position.row}`;

/**
 * Assign a grid cell to every icon: honour saved positions where the cell is
 * still on screen and unclaimed, then fill the first free cell for the rest.
 */
export function layoutIcons<T extends { key: string }>(
  icons: T[],
  saved: Record<string, GridPosition>,
  columns: number,
  rows: number,
): Array<T & { position: GridPosition }> {
  const taken = new Set<string>();
  const placed = new Map<string, GridPosition>();

  for (const icon of icons) {
    const position = saved[icon.key];
    if (!position) continue;
    if (position.col >= columns || position.row >= rows || position.col < 0 || position.row < 0) continue;
    const key = cellKey(position);
    if (taken.has(key)) continue;
    taken.add(key);
    placed.set(icon.key, position);
  }

  let cursor = 0;
  const total = columns * rows;
  const nextFree = (): GridPosition => {
    while (cursor < total) {
      const col = Math.floor(cursor / rows);
      const row = cursor % rows;
      cursor += 1;
      if (!taken.has(cellKey({ col, row }))) {
        taken.add(cellKey({ col, row }));
        return { col, row };
      }
    }
    // Overflow: stack in the last column rather than dropping icons.
    return { col: columns - 1, row: rows - 1 };
  };

  return icons.map((icon) => ({
    ...icon,
    position: placed.get(icon.key) ?? nextFree(),
  }));
}

/** Sort comparator for "Sort by" in the desktop context menu. */
export function compareNodes(a: FSNode, b: FSNode, mode: 'name' | 'type' | 'modified'): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  switch (mode) {
    case 'type': {
      const diff = a.mime.localeCompare(b.mime);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, undefined, { numeric: true });
    }
    case 'modified':
      return b.modifiedAt - a.modifiedAt;
    default:
      return a.name.localeCompare(b.name, undefined, { numeric: true });
  }
}
