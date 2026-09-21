import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDirectory, useFsRevision } from '../../core/filesystem/useFs';
import { FSError, vfs } from '../../core/filesystem/vfs';
import { notifications } from '../../core/notifications/store';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { useDesktopStore } from '../../core/shell/desktop-store';
import { useShellStore } from '../../core/shell/store';
import type { ContextMenuItem } from '../../core/shell/store';
import { useClipboardStore } from '../../core/clipboard/store';
import { cn } from '../../utils/cn';
import { DesktopIcon } from './DesktopIcon';
import {
  CELL,
  compareNodes,
  gridColumns,
  gridRows,
  iconForNode,
  layoutIcons,
} from './icon-model';
import type { DesktopIconModel } from './icon-model';
import { Wallpaper } from './Wallpaper';
import { DROP_MIME, readDroppedNodes, importDroppedFiles } from '../dnd';

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function Desktop({ height }: { height: number }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const revision = useFsRevision();
  const { children } = useDirectory('/Desktop');

  const settings = useSettingsStore((s) => s.settings);
  const iconSize = settings.desktopIconSize;
  const showIcons = settings.showDesktopIcons;

  const positions = useDesktopStore((s) => s.positions);
  const selection = useDesktopStore((s) => s.selection);
  const renaming = useDesktopStore((s) => s.renaming);
  const sortMode = useDesktopStore((s) => s.sortMode);
  const setPositions = useDesktopStore((s) => s.setPositions);
  const setSelection = useDesktopStore((s) => s.setSelection);
  const setRenaming = useDesktopStore((s) => s.setRenaming);
  const setSortMode = useDesktopStore((s) => s.setSortMode);
  const resetLayout = useDesktopStore((s) => s.resetLayout);

  const openContextMenu = useShellStore((s) => s.openContextMenu);
  const clipboardPayload = useClipboardStore((s) => s.payload);

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [size, setSize] = useState({ width: 1280, height: 720 });

  /* ------------------------------ Measurement ----------------------------- */

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = gridColumns(size.width, iconSize);
  const rows = gridRows(size.height, iconSize);

  /* -------------------------------- Icons -------------------------------- */

  const icons = useMemo<DesktopIconModel[]>(() => {
    void revision;
    const trashCount = vfs.listTrash().length;

    const shortcuts: Array<Omit<DesktopIconModel, 'position'>> = [
      {
        key: 'shortcut:computer',
        label: 'This Computer',
        icon: 'HardDrive',
        color: '#7aa2ff',
        appId: 'files',
        appParams: { path: '/' },
        renamable: false,
        deletable: false,
      },
      {
        key: 'shortcut:trash',
        label: 'Recycle Bin',
        icon: 'Trash2',
        color: trashCount > 0 ? '#f0a030' : '#9aa3b8',
        appId: 'files',
        appParams: { view: 'trash' },
        renamable: false,
        deletable: false,
        badge: trashCount,
      },
    ];

    const fileIcons = [...children]
      .sort((a, b) => compareNodes(a, b, sortMode === 'manual' ? 'name' : sortMode))
      .map<Omit<DesktopIconModel, 'position'>>((node) => ({
        key: `file:${node.id}`,
        label: node.name,
        icon: iconForNode(node),
        color: node.kind === 'folder' ? '#f0c060' : undefined,
        node,
        renamable: !node.system,
        deletable: !node.system,
      }));

    const combined = [...shortcuts, ...fileIcons];
    const effectivePositions = sortMode === 'manual' ? positions : {};
    return layoutIcons(combined, effectivePositions, columns, rows) as DesktopIconModel[];
  }, [children, positions, columns, rows, sortMode, revision]);

  const iconByKey = useMemo(() => new Map(icons.map((icon) => [icon.key, icon])), [icons]);

  /* ------------------------------- Opening ------------------------------- */

  const openIcon = useCallback((model: DesktopIconModel) => {
    if (model.appId) {
      OS.openApp(model.appId, { params: model.appParams });
      return;
    }
    if (model.node) OS.openFile(model.node);
  }, []);

  /* ------------------------------ Icon drag ------------------------------ */

  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    keys: string[];
    origin: Record<string, { col: number; row: number }>;
    moved: boolean;
  } | null>(null);

  const onIconPointerDown = useCallback(
    (event: React.PointerEvent, model: DesktopIconModel) => {
      if (event.button === 2) return; // context menu handles its own selection
      event.stopPropagation();

      const additive = event.ctrlKey || event.metaKey;
      const current = useDesktopStore.getState().selection;
      let nextSelection: string[];

      if (additive) {
        nextSelection = current.includes(model.key)
          ? current.filter((key) => key !== model.key)
          : [...current, model.key];
      } else if (current.includes(model.key)) {
        nextSelection = current;
      } else {
        nextSelection = [model.key];
      }
      setSelection(nextSelection);
      if (renaming && renaming !== model.key) setRenaming(null);

      if (sortMode !== 'manual') return; // auto-arranged: dragging is disabled

      const origin: Record<string, { col: number; row: number }> = {};
      for (const key of nextSelection) {
        const icon = iconByKey.get(key);
        if (icon) origin[key] = icon.position;
      }

      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        keys: nextSelection,
        origin,
        moved: false,
      };

      const onMove = (moveEvent: PointerEvent) => {
        const state = dragState.current;
        if (!state || moveEvent.pointerId !== state.pointerId) return;
        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 5) return;
        state.moved = true;

        const cell = CELL[iconSize];
        const dCol = Math.round(dx / cell.width);
        const dRow = Math.round(dy / cell.height);
        if (dCol === 0 && dRow === 0) return;

        const updates: Array<[string, { col: number; row: number }]> = [];
        for (const key of state.keys) {
          const start = state.origin[key];
          if (!start) continue;
          updates.push([
            key,
            {
              col: Math.max(0, Math.min(columns - 1, start.col + dCol)),
              row: Math.max(0, Math.min(rows - 1, start.row + dRow)),
            },
          ]);
        }
        setPositions(updates);
      };

      const finish = (upEvent: PointerEvent) => {
        const state = dragState.current;
        if (!state || upEvent.pointerId !== state.pointerId) return;
        dragState.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [columns, iconByKey, iconSize, renaming, rows, setPositions, setRenaming, setSelection, sortMode],
  );

  /* -------------------------------- Marquee ------------------------------- */

  const onSurfacePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest('[data-icon-key]')) return;

      setSelection([]);
      setRenaming(null);
      useShellStore.getState().closePanel();

      const surface = surfaceRef.current;
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      const startX = event.clientX - box.left;
      const startY = event.clientY - box.top;

      const onMove = (moveEvent: PointerEvent) => {
        const x = moveEvent.clientX - box.left;
        const y = moveEvent.clientY - box.top;
        const rect = {
          x: Math.min(startX, x),
          y: Math.min(startY, y),
          width: Math.abs(x - startX),
          height: Math.abs(y - startY),
        };
        if (rect.width < 4 && rect.height < 4) return;
        setMarquee(rect);

        const hits: string[] = [];
        for (const icon of icons) {
          const cell = CELL[iconSize];
          const left = 10 + icon.position.col * cell.width;
          const top = 10 + icon.position.row * cell.height;
          const intersects =
            left < rect.x + rect.width &&
            left + cell.width > rect.x &&
            top < rect.y + rect.height &&
            top + cell.height > rect.y;
          if (intersects) hits.push(icon.key);
        }
        setSelection(hits);
      };

      const finish = () => {
        setMarquee(null);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [icons, iconSize, setRenaming, setSelection],
  );

  /* ------------------------------ Operations ------------------------------ */

  const selectedNodes = useMemo(
    () =>
      selection
        .map((key) => iconByKey.get(key)?.node)
        .filter((node): node is NonNullable<typeof node> => Boolean(node)),
    [selection, iconByKey],
  );

  const trashSelected = useCallback(async () => {
    const nodes = selectedNodes.filter((node) => !node.system);
    if (nodes.length === 0) return;
    try {
      for (const node of nodes) await vfs.moveToTrash(node.id);
      setSelection([]);
      notifications.push('files', {
        title: nodes.length === 1 ? `"${nodes[0].name}" moved to Trash` : `${nodes.length} items moved to Trash`,
        tag: 'trash',
      });
    } catch (err) {
      notifications.push('files', {
        title: 'Could not delete',
        body: err instanceof FSError ? err.message : String(err),
        urgency: 'critical',
      });
    }
  }, [selectedNodes, setSelection]);

  const commitRename = useCallback(
    async (model: DesktopIconModel, name: string) => {
      setRenaming(null);
      if (!model.node || name.trim() === model.label || !name.trim()) return;
      try {
        await vfs.rename(model.node.id, name);
      } catch (err) {
        notifications.push('files', {
          title: 'Could not rename',
          body: err instanceof FSError ? err.message : String(err),
          urgency: 'critical',
        });
      }
    },
    [setRenaming],
  );

  const createItem = useCallback(async (kind: 'folder' | 'file') => {
    const desktop = vfs.nodeAt('/Desktop');
    if (!desktop) return;
    try {
      const node =
        kind === 'folder'
          ? await vfs.createFolder(desktop.id, vfs.uniqueName(desktop.id, 'New Folder'))
          : await vfs.createFile(desktop.id, vfs.uniqueName(desktop.id, 'New File.txt'), '', 'text/plain');
      useDesktopStore.getState().setSelection([`file:${node.id}`]);
      useDesktopStore.getState().setRenaming(`file:${node.id}`);
    } catch (err) {
      notifications.push('files', {
        title: 'Could not create item',
        body: err instanceof FSError ? err.message : String(err),
        urgency: 'critical',
      });
    }
  }, []);

  const pasteHere = useCallback(async () => {
    const payload = useClipboardStore.getState().payload;
    const desktop = vfs.nodeAt('/Desktop');
    if (!desktop || payload?.kind !== 'files') return;
    try {
      for (const id of payload.ids) {
        const node = vfs.getNode(id);
        if (!node) continue;
        if (payload.mode === 'cut') await vfs.move(id, desktop.id);
        else await vfs.copy(id, desktop.id);
      }
      if (payload.mode === 'cut') useClipboardStore.getState().clear();
    } catch (err) {
      notifications.push('files', {
        title: 'Could not paste',
        body: err instanceof FSError ? err.message : String(err),
        urgency: 'critical',
      });
    }
  }, []);

  /* ----------------------------- Context menus ---------------------------- */

  const desktopMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const items: ContextMenuItem[] = [
        {
          id: 'new',
          label: 'New',
          icon: 'Plus',
          items: [
            { id: 'new-folder', label: 'Folder', icon: 'FolderPlus', onSelect: () => void createItem('folder') },
            { id: 'new-file', label: 'Text file', icon: 'FilePlus', onSelect: () => void createItem('file') },
          ],
        },
        {
          id: 'paste',
          label: 'Paste',
          icon: 'ClipboardPaste',
          hint: 'Ctrl + V',
          disabled: clipboardPayload?.kind !== 'files',
          onSelect: () => void pasteHere(),
        },
        { id: 'sep-1', separator: true },
        {
          id: 'view',
          label: 'Icon size',
          icon: 'Grid2x2',
          items: (['small', 'medium', 'large'] as const).map((value) => ({
            id: `size-${value}`,
            label: value[0].toUpperCase() + value.slice(1),
            checked: iconSize === value,
            onSelect: () => useSettingsStore.getState().set('desktopIconSize', value),
          })),
        },
        {
          id: 'sort',
          label: 'Sort by',
          icon: 'ListFilter',
          items: [
            { id: 'sort-name', label: 'Name', checked: sortMode === 'name', onSelect: () => setSortMode('name') },
            { id: 'sort-type', label: 'Type', checked: sortMode === 'type', onSelect: () => setSortMode('type') },
            {
              id: 'sort-modified',
              label: 'Date modified',
              checked: sortMode === 'modified',
              onSelect: () => setSortMode('modified'),
            },
            { id: 'sort-sep', separator: true },
            {
              id: 'sort-manual',
              label: 'Free placement',
              checked: sortMode === 'manual',
              onSelect: () => setSortMode('manual'),
            },
          ],
        },
        {
          id: 'show-icons',
          label: 'Show desktop icons',
          checked: showIcons,
          onSelect: () => useSettingsStore.getState().set('showDesktopIcons', !showIcons),
        },
        { id: 'reset-layout', label: 'Reset icon layout', icon: 'RotateCcw', onSelect: resetLayout },
        { id: 'sep-2', separator: true },
        {
          id: 'terminal',
          label: 'Open Terminal here',
          icon: 'Terminal',
          onSelect: () => OS.openApp('terminal', { params: { cwd: '/Desktop' } }),
        },
        {
          id: 'personalise',
          label: 'Change wallpaper',
          icon: 'Palette',
          onSelect: () => OS.openApp('settings', { params: { section: 'personalization' } }),
        },
        {
          id: 'display-settings',
          label: 'Display settings',
          icon: 'Monitor',
          onSelect: () => OS.openApp('settings', { params: { section: 'display' } }),
        },
      ];
      openContextMenu({ x: event.clientX, y: event.clientY, items, label: 'Desktop menu' });
    },
    [clipboardPayload, createItem, iconSize, openContextMenu, pasteHere, resetLayout, setSortMode, showIcons, sortMode],
  );

  const iconMenu = useCallback(
    (event: React.MouseEvent, model: DesktopIconModel) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selection.includes(model.key)) setSelection([model.key]);

      const targets = selection.includes(model.key) ? selection : [model.key];
      const nodes = targets
        .map((key) => iconByKey.get(key)?.node)
        .filter((node): node is NonNullable<typeof node> => Boolean(node));

      const items: ContextMenuItem[] = [
        { id: 'open', label: 'Open', icon: 'FolderOpen', onSelect: () => openIcon(model) },
      ];

      if (model.node && model.node.kind === 'file') {
        items.push({
          id: 'open-with-editor',
          label: 'Open with Text Editor',
          icon: 'FileText',
          onSelect: () => OS.openApp('text-editor', { params: { path: vfs.pathOf(model.node!.id) } }),
        });
      }

      if (nodes.length > 0) {
        items.push(
          { id: 'sep-1', separator: true },
          {
            id: 'copy',
            label: 'Copy',
            icon: 'Copy',
            hint: 'Ctrl + C',
            onSelect: () => OS.clipboard.copyFiles(nodes.map((n) => n.id), vfs.nodeAt('/Desktop')?.id ?? null),
          },
          {
            id: 'cut',
            label: 'Cut',
            icon: 'Scissors',
            hint: 'Ctrl + X',
            onSelect: () => OS.clipboard.cutFiles(nodes.map((n) => n.id), vfs.nodeAt('/Desktop')?.id ?? null),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: 'Files',
            onSelect: async () => {
              for (const node of nodes) await vfs.duplicate(node.id);
            },
          },
          { id: 'sep-2', separator: true },
          {
            id: 'rename',
            label: 'Rename',
            icon: 'Pencil',
            hint: 'F2',
            disabled: nodes.length !== 1 || !model.renamable,
            onSelect: () => setRenaming(model.key),
          },
          {
            id: 'delete',
            label: nodes.length > 1 ? `Move ${nodes.length} items to Trash` : 'Move to Trash',
            icon: 'Trash2',
            hint: 'Del',
            danger: true,
            disabled: !model.deletable,
            onSelect: () => void trashSelected(),
          },
          { id: 'sep-3', separator: true },
          {
            id: 'properties',
            label: 'Properties',
            icon: 'Info',
            disabled: nodes.length !== 1,
            onSelect: () =>
              OS.openApp('files', { params: { path: '/Desktop', properties: nodes[0].id } }),
          },
        );
      }

      if (model.key === 'shortcut:trash') {
        items.push(
          { id: 'sep-trash', separator: true },
          {
            id: 'empty-trash',
            label: 'Empty Recycle Bin',
            icon: 'Trash2',
            danger: true,
            disabled: vfs.listTrash().length === 0,
            onSelect: () => OS.openApp('files', { params: { view: 'trash' } }),
          },
        );
      }

      openContextMenu({ x: event.clientX, y: event.clientY, items, label: `${model.label} menu` });
    },
    [iconByKey, openContextMenu, openIcon, selection, setRenaming, setSelection, trashSelected],
  );

  /* ------------------------------- Keyboard ------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Only act when the desktop itself has focus, not a window or a field.
      const active = document.activeElement;
      if (active && active !== document.body && !surfaceRef.current?.contains(active)) return;
      if (useShellStore.getState().panel || useShellStore.getState().contextMenu) return;

      const state = useDesktopStore.getState();

      if (event.key === 'F2' && state.selection.length === 1) {
        const icon = iconByKey.get(state.selection[0]);
        if (icon?.renamable) {
          event.preventDefault();
          setRenaming(state.selection[0]);
        }
      } else if (event.key === 'Delete' && state.selection.length > 0) {
        event.preventDefault();
        void trashSelected();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(icons.map((icon) => icon.key));
      } else if (event.key === 'Escape') {
        setSelection([]);
        setRenaming(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedNodes.length > 0) {
          OS.clipboard.copyFiles(selectedNodes.map((n) => n.id), vfs.nodeAt('/Desktop')?.id ?? null);
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        if (selectedNodes.length > 0) {
          OS.clipboard.cutFiles(selectedNodes.map((n) => n.id), vfs.nodeAt('/Desktop')?.id ?? null);
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        void pasteHere();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [iconByKey, icons, pasteHere, selectedNodes, setRenaming, setSelection, trashSelected]);

  /* ------------------------------ Drop target ----------------------------- */

  const onDragOver = useCallback((event: React.DragEvent) => {
    const types = event.dataTransfer.types;
    if (types.includes(DROP_MIME) || types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = types.includes(DROP_MIME) ? 'move' : 'copy';
      setDropActive(true);
    }
  }, []);

  const onDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const desktop = vfs.nodeAt('/Desktop');
    if (!desktop) return;

    const nodeIds = readDroppedNodes(event.dataTransfer);
    if (nodeIds.length > 0) {
      for (const id of nodeIds) {
        try {
          await vfs.move(id, desktop.id);
        } catch {
          /* moving into its own parent is a no-op */
        }
      }
      return;
    }
    await importDroppedFiles(event.dataTransfer, desktop.id);
  }, []);

  /* -------------------------------- Render -------------------------------- */

  return (
    <div
      ref={surfaceRef}
      role="region"
      aria-label="Desktop"
      className={cn('absolute inset-x-0 top-0 overflow-hidden', dropActive && 'ring-2 ring-inset ring-accent/60')}
      style={{ height }}
      onPointerDown={onSurfacePointerDown}
      onContextMenu={desktopMenu}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <Wallpaper />

      {showIcons ? (
        <div role="listbox" aria-label="Desktop icons" aria-multiselectable="true" className="absolute inset-0">
          {icons.map((model) => (
            <DesktopIcon
              key={model.key}
              model={model}
              size={iconSize}
              selected={selection.includes(model.key)}
              renaming={renaming === model.key}
              onPointerDown={onIconPointerDown}
              onOpen={openIcon}
              onContextMenu={iconMenu}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenaming(null)}
            />
          ))}
        </div>
      ) : null}

      {marquee ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border border-accent/70 bg-accent/20"
          style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
        />
      ) : null}
    </div>
  );
}
