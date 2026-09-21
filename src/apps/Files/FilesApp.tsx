import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ConfirmDialog } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/Feedback';
import { useClipboardStore } from '../../core/clipboard/store';
import { useDirectory, useFsRevision } from '../../core/filesystem/useFs';
import { FSError, vfs } from '../../core/filesystem/vfs';
import type { FSNode } from '../../core/filesystem/types';
import { downloadBlob } from '../../core/filesystem/transfer';
import { DEFAULT_FOLDERS } from '../../core/filesystem/seed';
import { notifications } from '../../core/notifications/store';
import { OS } from '../../core/os';
import { appsForFile } from '../../core/app-manager/registry';
import { categoryForMime } from '../../core/filesystem/mime';
import { useShellStore } from '../../core/shell/store';
import type { ContextMenuItem } from '../../core/shell/store';
import type { AppProps } from '../../core/app-manager/types';
import { DROP_MIME, importDroppedFiles, moveNodesInto, readDroppedNodes, writeDraggedNodes } from '../../desktop/dnd';
import { useDiskStore } from '../../core/filesystem/disk-store';
import { useOpenDiskFile } from './useDisk';
import { useIsNarrow } from '../../hooks/useElementWidth';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { formatBytes, pluralize } from '../../utils/format';
import { sortNodes } from './file-icons';
import type { SortDirection, SortKey } from './file-icons';
import { GridView, ListView } from './FileViews';
import { DiskView } from './DiskView';
import { PropertiesDialog } from './PropertiesDialog';
import { Sidebar } from './Sidebar';
import type { FilesParams, FilesView, ViewMode } from './types';

export default function FilesApp({ params }: AppProps<FilesParams>) {
  const { os } = useOS();
  const revision = useFsRevision();
  const openContextMenu = useShellStore((s) => s.openContextMenu);
  const clipboard = useClipboardStore((s) => s.payload);

  const [view, setView] = useState<FilesView>(params?.view ?? 'files');
  const [history, setHistory] = useState<string[]>([params?.path ?? '/Desktop']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selection, setSelection] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [propertiesId, setPropertiesId] = useState<string | null>(params?.properties ?? null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FSNode[] | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<FSNode[] | null>(null);
  const [dropActive, setDropActive] = useState(false);

  /* Palm Disk keeps its own cursor: it is a separate volume, not a folder. */
  const [diskPath, setDiskPath] = useState(params?.diskPath ?? '/');
  const [diskSelected, setDiskSelected] = useState<string | null>(null);
  const diskStatus = useDiskStore((s) => s.status);
  const diskLabel = useDiskStore((s) => s.label);
  const refreshDisk = useDiskStore((s) => s.refresh);
  const openDiskEntry = useOpenDiskFile();

  const path = history[historyIndex] ?? '/';
  const { node: folder, children } = useDirectory(view === 'files' ? path : null);

  /* Respond to a second launch of the app with new parameters. */
  useEffect(() => {
    if (params?.view && params.view !== view) setView(params.view);
    if (params?.diskPath) setDiskPath(params.diskPath);
    if (params?.path && params.path !== path) {
      setHistory((previous) => [...previous.slice(0, historyIndex + 1), params.path!]);
      setHistoryIndex((index) => index + 1);
    }
    if (params?.properties) setPropertiesId(params.properties);
    // Only react to identity changes of the launch payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    const title =
      view === 'trash'
        ? 'Trash — Files'
        : view === 'disk'
          ? diskPath === '/'
            ? `${diskLabel || 'Palm Disk'} — Palm Disk`
            : `${diskPath.split('/').pop()} — Palm Disk`
          : `${path === '/' ? 'This Computer' : path.split('/').pop()} — Files`;
    os.window.setTitle(title);
  }, [diskLabel, diskPath, os, path, view]);

  /* --------------------------------- Data -------------------------------- */

  const trash = useMemo(() => {
    void revision;
    return vfs.listTrash();
  }, [revision]);

  const rawItems = view === 'trash' ? trash : children;

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rawItems.filter((node) => node.name.toLowerCase().includes(needle))
      : rawItems;
    return sortNodes(filtered, sortKey, sortDirection);
  }, [rawItems, query, sortKey, sortDirection]);

  const selectedNodes = useMemo(
    () => selection.map((id) => vfs.getNode(id)).filter((node): node is FSNode => Boolean(node)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, revision],
  );

  const cutIds = clipboard?.kind === 'files' && clipboard.mode === 'cut' ? clipboard.ids : [];

  /* ------------------------------ Navigation ----------------------------- */

  const navigate = useCallback(
    (target: string) => {
      setHistory((previous) => [...previous.slice(0, historyIndex + 1), target]);
      setHistoryIndex((index) => index + 1);
      setSelection([]);
      setQuery('');
      setView('files');
    },
    [historyIndex],
  );

  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setSelection([]);
    }
  };
  const goForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setSelection([]);
    }
  };
  const goUp = () => {
    if (path === '/') return;
    navigate(path.slice(0, path.lastIndexOf('/')) || '/');
  };

  const diskCrumbs = useMemo(() => {
    const parts = diskPath.split('/').filter(Boolean);
    return [
      { label: diskLabel || 'Palm Disk', path: '/' },
      ...parts.map((part, index) => ({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })),
    ];
  }, [diskLabel, diskPath]);

  const breadcrumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    return [
      { label: 'This Computer', path: '/' },
      ...parts.map((part, index) => ({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })),
    ];
  }, [path]);

  /* ------------------------------ Operations ----------------------------- */

  const reportError = (title: string, err: unknown) => {
    notifications.push('files', {
      title,
      body: err instanceof FSError ? err.message : err instanceof Error ? err.message : String(err),
      urgency: 'critical',
    });
  };

  const openNode = useCallback(
    (node: FSNode) => {
      if (view === 'trash') {
        notifications.push('files', {
          title: 'Item is in the Trash',
          body: `Restore "${node.name}" before opening it.`,
        });
        return;
      }
      if (node.kind === 'folder') navigate(vfs.pathOf(node.id));
      else OS.openFile(node);
    },
    [navigate, view],
  );

  const createFolder = async () => {
    if (!folder) return;
    try {
      const created = await vfs.createFolder(folder.id, vfs.uniqueName(folder.id, 'New Folder'));
      setSelection([created.id]);
      setRenamingId(created.id);
    } catch (err) {
      reportError('Could not create folder', err);
    }
  };

  const createFile = async () => {
    if (!folder) return;
    try {
      const created = await vfs.createFile(
        folder.id,
        vfs.uniqueName(folder.id, 'New File.txt'),
        '',
        'text/plain',
      );
      setSelection([created.id]);
      setRenamingId(created.id);
    } catch (err) {
      reportError('Could not create file', err);
    }
  };

  const commitRename = async (node: FSNode, name: string) => {
    setRenamingId(null);
    if (!name.trim() || name.trim() === node.name) return;
    try {
      await vfs.rename(node.id, name);
    } catch (err) {
      reportError('Could not rename', err);
    }
  };

  /** Honour Accessibility ▸ "Confirm before moving to Trash". */
  const requestTrash = (nodes: FSNode[]) => {
    const targets = nodes.filter((node) => !node.system);
    if (targets.length === 0) return;
    if (OS.settings.get('confirmBeforeTrash')) setConfirmTrash(targets);
    else void trashSelection(targets);
  };

  const trashSelection = async (nodes: FSNode[]) => {
    const targets = nodes.filter((node) => !node.system);
    if (targets.length === 0) return;
    setConfirmTrash(null);
    try {
      for (const node of targets) await vfs.moveToTrash(node.id);
      setSelection([]);
      notifications.push('files', {
        title:
          targets.length === 1
            ? `"${targets[0].name}" moved to Trash`
            : `${targets.length} items moved to Trash`,
        actions: [
          {
            id: 'undo',
            label: 'Undo',
            onClick: () => {
              void Promise.all(targets.map((node) => vfs.restoreFromTrash(node.id)));
            },
          },
        ],
        tag: 'trash',
      });
    } catch (err) {
      reportError('Could not delete', err);
    }
  };

  const deleteForever = async (nodes: FSNode[]) => {
    try {
      for (const node of nodes) await vfs.deletePermanently(node.id);
      setSelection([]);
      setConfirmDelete(null);
    } catch (err) {
      reportError('Could not delete permanently', err);
    }
  };

  const restore = async (nodes: FSNode[]) => {
    try {
      for (const node of nodes) await vfs.restoreFromTrash(node.id);
      setSelection([]);
    } catch (err) {
      reportError('Could not restore', err);
    }
  };

  const paste = useCallback(async () => {
    const payload = useClipboardStore.getState().payload;
    if (payload?.kind !== 'files' || !folder) return;
    try {
      for (const id of payload.ids) {
        if (!vfs.getNode(id)) continue;
        if (payload.mode === 'cut') await vfs.move(id, folder.id);
        else await vfs.copy(id, folder.id);
      }
      if (payload.mode === 'cut') useClipboardStore.getState().clear();
    } catch (err) {
      reportError('Could not paste', err);
    }
  }, [folder]);

  const exportNode = async (node: FSNode) => {
    if (node.kind === 'folder') {
      notifications.push('files', {
        title: 'Folders cannot be downloaded',
        body: 'Download individual files, or use Settings ▸ System ▸ Export to back up everything.',
      });
      return;
    }
    try {
      const data = await vfs.readNode(node.id);
      downloadBlob(data, node.name, node.mime);
    } catch (err) {
      reportError('Could not save file', err);
    }
  };

  /* ------------------------------- Selection ----------------------------- */

  const onSelect = useCallback(
    (node: FSNode, event: React.MouseEvent | React.PointerEvent) => {
      if ('button' in event && event.button === 2) {
        if (!selection.includes(node.id)) setSelection([node.id]);
        return;
      }
      const additive = event.ctrlKey || event.metaKey;
      const range = event.shiftKey;

      if (range && selection.length > 0) {
        const ids = items.map((item) => item.id);
        const anchor = ids.indexOf(selection[selection.length - 1]);
        const target = ids.indexOf(node.id);
        if (anchor >= 0 && target >= 0) {
          const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
          setSelection(ids.slice(from, to + 1));
          return;
        }
      }
      if (additive) {
        setSelection((previous) =>
          previous.includes(node.id) ? previous.filter((id) => id !== node.id) : [...previous, node.id],
        );
        return;
      }
      if (!selection.includes(node.id)) setSelection([node.id]);
    },
    [items, selection],
  );

  /* ------------------------------ Context menu ---------------------------- */

  const itemMenu = useCallback(
    (node: FSNode, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const targets = selection.includes(node.id) ? selectedNodes : [node];
      const single = targets.length === 1;

      const items: ContextMenuItem[] = [];

      if (view === 'trash') {
        items.push(
          {
            id: 'restore',
            label: single ? 'Restore' : `Restore ${targets.length} items`,
            icon: 'Undo2',
            onSelect: () => void restore(targets),
          },
          { id: 'sep', separator: true },
          {
            id: 'delete-forever',
            label: 'Delete permanently',
            icon: 'Trash2',
            danger: true,
            onSelect: () => setConfirmDelete(targets),
          },
          { id: 'sep2', separator: true },
          {
            id: 'properties',
            label: 'Properties',
            icon: 'Info',
            disabled: !single,
            onSelect: () => setPropertiesId(node.id),
          },
        );
      } else {
        const openWith = node.kind === 'file' ? appsForFile(node.mime, categoryForMime(node.mime)) : [];
        items.push({ id: 'open', label: 'Open', icon: 'FolderOpen', onSelect: () => openNode(node) });

        if (openWith.length > 0) {
          items.push({
            id: 'open-with',
            label: 'Open with',
            icon: 'AppWindow',
            items: openWith.map((app) => ({
              id: `open-${app.id}`,
              label: app.name,
              icon: app.icon,
              onSelect: () => OS.openWith(app.id, node),
            })),
          });
        }

        items.push(
          { id: 'sep-1', separator: true },
          {
            id: 'copy',
            label: 'Copy',
            icon: 'Copy',
            hint: 'Ctrl + C',
            onSelect: () => OS.clipboard.copyFiles(targets.map((n) => n.id), folder?.id ?? null),
          },
          {
            id: 'cut',
            label: 'Cut',
            icon: 'Scissors',
            hint: 'Ctrl + X',
            onSelect: () => OS.clipboard.cutFiles(targets.map((n) => n.id), folder?.id ?? null),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: 'Files',
            onSelect: async () => {
              try {
                for (const target of targets) await vfs.duplicate(target.id);
              } catch (err) {
                reportError('Could not duplicate', err);
              }
            },
          },
          { id: 'sep-2', separator: true },
          {
            id: 'rename',
            label: 'Rename',
            icon: 'Pencil',
            hint: 'F2',
            disabled: !single || node.system,
            onSelect: () => setRenamingId(node.id),
          },
          {
            id: 'download',
            label: 'Save a copy to your computer',
            icon: 'Save',
            disabled: !single || node.kind === 'folder',
            onSelect: () => void exportNode(node),
          },
          {
            id: 'wallpaper',
            label: 'Set as wallpaper',
            icon: 'Palette',
            disabled: !single || !node.mime.startsWith('image/'),
            onSelect: () =>
              os.settings.set('wallpaper', { kind: 'image', src: `vfs:${node.id}`, fit: 'cover' }),
          },
          { id: 'sep-3', separator: true },
          {
            id: 'trash',
            label: single ? 'Move to Trash' : `Move ${targets.length} items to Trash`,
            icon: 'Trash2',
            hint: 'Del',
            danger: true,
            disabled: targets.every((target) => target.system),
            onSelect: () => requestTrash(targets),
          },
          { id: 'sep-4', separator: true },
          {
            id: 'properties',
            label: 'Properties',
            icon: 'Info',
            disabled: !single,
            onSelect: () => setPropertiesId(node.id),
          },
        );
      }

      openContextMenu({ x: event.clientX, y: event.clientY, items, label: `${node.name} menu` });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folder, openContextMenu, openNode, os, selectedNodes, selection, view],
  );

  const backgroundMenu = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('[role="option"]')) return;
      event.preventDefault();
      setSelection([]);

      const items: ContextMenuItem[] =
        view === 'trash'
          ? [
            {
              id: 'empty',
              label: 'Empty Trash',
              icon: 'Trash2',
              danger: true,
              disabled: trash.length === 0,
              onSelect: () => setConfirmEmpty(true),
            },
          ]
          : [
            {
              id: 'new',
              label: 'New',
              icon: 'Plus',
              items: [
                { id: 'new-folder', label: 'Folder', icon: 'FolderPlus', onSelect: () => void createFolder() },
                { id: 'new-file', label: 'Text file', icon: 'FilePlus', onSelect: () => void createFile() },
              ],
            },
            {
              id: 'paste',
              label: 'Paste',
              icon: 'ClipboardPaste',
              hint: 'Ctrl + V',
              disabled: clipboard?.kind !== 'files',
              onSelect: () => void paste(),
            },
            { id: 'sep-1', separator: true },
            {
              id: 'view',
              label: 'View',
              icon: 'Grid2x2',
              items: [
                { id: 'grid', label: 'Grid', checked: mode === 'grid', onSelect: () => setMode('grid') },
                { id: 'list', label: 'List', checked: mode === 'list', onSelect: () => setMode('list') },
              ],
            },
            {
              id: 'sort',
              label: 'Sort by',
              icon: 'ListFilter',
              items: (['name', 'type', 'size', 'modified'] as SortKey[]).map((key) => ({
                id: `sort-${key}`,
                label: key === 'modified' ? 'Date modified' : key[0].toUpperCase() + key.slice(1),
                checked: sortKey === key,
                onSelect: () => setSortKey(key),
              })),
            },
            { id: 'sep-2', separator: true },
            {
              id: 'terminal',
              label: 'Open Terminal here',
              icon: 'Terminal',
              onSelect: () => OS.openApp('terminal', { params: { cwd: path } }),
            },
            {
              id: 'refresh',
              label: 'Refresh',
              icon: 'RefreshCw',
              onSelect: () => setSelection([]),
            },
          ];

      openContextMenu({ x: event.clientX, y: event.clientY, items, label: 'Folder menu' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipboard, mode, openContextMenu, path, paste, sortKey, trash.length, view],
  );

  /* -------------------------------- Keyboard ------------------------------ */

  const surfaceRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef, 620);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const key = event.key.toLowerCase();

    if (event.key === 'F2' && selectedNodes.length === 1 && !selectedNodes[0].system) {
      event.preventDefault();
      setRenamingId(selectedNodes[0].id);
    } else if (event.key === 'Delete' && selectedNodes.length > 0) {
      event.preventDefault();
      if (view === 'trash') setConfirmDelete(selectedNodes);
      else requestTrash(selectedNodes);
    } else if (event.key === 'Enter' && selectedNodes.length === 1) {
      event.preventDefault();
      openNode(selectedNodes[0]);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      goUp();
    } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault();
      setSelection(items.map((item) => item.id));
    } else if ((event.ctrlKey || event.metaKey) && key === 'c' && selectedNodes.length > 0) {
      event.preventDefault();
      OS.clipboard.copyFiles(selectedNodes.map((n) => n.id), folder?.id ?? null);
    } else if ((event.ctrlKey || event.metaKey) && key === 'x' && selectedNodes.length > 0) {
      event.preventDefault();
      OS.clipboard.cutFiles(selectedNodes.map((n) => n.id), folder?.id ?? null);
    } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
      event.preventDefault();
      void paste();
    } else if (event.key === 'Escape') {
      setSelection([]);
      setRenamingId(null);
    }
  };

  /* ---------------------------- Drag and drop ----------------------------- */

  const onDragStart = (node: FSNode, event: React.DragEvent) => {
    const ids = selection.includes(node.id) ? selection : [node.id];
    writeDraggedNodes(event.dataTransfer, ids);
  };

  const onDropOnFolder = async (node: FSNode, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = readDroppedNodes(event.dataTransfer).filter((id) => id !== node.id);
    if (ids.length > 0) {
      await moveNodesInto(ids, node.id);
      return;
    }
    await importDroppedFiles(event.dataTransfer, node.id);
  };

  const onBackgroundDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    if (!folder || view !== 'files') return;
    const ids = readDroppedNodes(event.dataTransfer);
    if (ids.length > 0) {
      await moveNodesInto(ids, folder.id);
      return;
    }
    await importDroppedFiles(event.dataTransfer, folder.id);
  };

  /* --------------------------------- Render ------------------------------- */

  const totalSize = useMemo(
    () => items.reduce((sum, node) => sum + (node.kind === 'file' ? node.size : 0), 0),
    [items],
  );

  const handlers = {
    onSelect,
    onOpen: openNode,
    onContextMenu: itemMenu,
    onDragStart,
    onDropOnFolder,
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenamingId(null),
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <Sidebar
        hidden={narrow}
        view={view}
        currentPath={path}
        onNavigate={navigate}
        onOpenView={(next) => {
          setView(next);
          setSelection([]);
          setQuery('');
        }}
        trashCount={trash.length}
        diskStatus={diskStatus}
        diskLabel={diskLabel}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------ Toolbar ----------------------------- */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge/8 px-2 py-1.5">
          <IconButton icon="ArrowLeft" label="Back" size="sm" disabled={historyIndex === 0} onClick={goBack} />
          <IconButton
            icon="ArrowRight"
            label="Forward"
            size="sm"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
          />
          <IconButton
            icon="ArrowUp"
            label="Up one level"
            size="sm"
            disabled={view === 'disk' ? diskPath === '/' : view !== 'files' || path === '/'}
            onClick={() => {
              if (view === 'disk') setDiskPath(diskPath.slice(0, diskPath.lastIndexOf('/')) || '/');
              else goUp();
            }}
          />
          {narrow ? (
            <IconButton
              icon="Menu"
              label="Places"
              size="sm"
              onClick={(event) => {
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                openContextMenu({
                  x: rect.left,
                  y: rect.bottom + 4,
                  label: 'Places',
                  items: [
                    { id: 'root', label: 'This Computer', icon: 'HardDrive', onSelect: () => navigate('/') },
                    ...DEFAULT_FOLDERS.map((folder) => ({
                      id: folder.name,
                      label: folder.name,
                      icon: folder.icon,
                      onSelect: () => navigate(`/${folder.name}`),
                    })),
                    { id: 'sep', separator: true },
                    {
                      id: 'trash',
                      label: `Trash${trash.length > 0 ? ` (${trash.length})` : ''}`,
                      icon: 'Trash2',
                      onSelect: () => setView('trash'),
                    },
                    { id: 'disk', label: 'Palm Disk', icon: 'Database', onSelect: () => setView('disk') },
                  ],
                });
              }}
            />
          ) : null}

          <nav
            aria-label="Breadcrumb"
            className="os-scroll mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md border border-edge/8 bg-surface-2/60 px-2 py-1"
          >
            {view === 'trash' ? (
              <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <Icon name="Trash2" size={13} /> Trash
              </span>
            ) : view === 'disk' ? (
              <span className="flex min-w-0 items-center gap-0.5">
                <Icon name="Database" size={13} className="mr-1 shrink-0 text-warn" />
                {diskCrumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex shrink-0 items-center">
                    {index > 0 ? <Icon name="ChevronRight" size={11} className="mx-0.5 text-ink-3" /> : null}
                    <button
                      type="button"
                      onClick={() => setDiskPath(crumb.path)}
                      className={cn(
                        'rounded px-1 py-0.5 text-[12px] transition-colors hover:bg-surface-3',
                        index === diskCrumbs.length - 1 ? 'font-medium text-ink' : 'text-ink-2',
                      )}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </span>
            ) : (
              breadcrumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex shrink-0 items-center">
                  {index > 0 ? <Icon name="ChevronRight" size={11} className="mx-0.5 text-ink-3" /> : null}
                  <button
                    type="button"
                    onClick={() => navigate(crumb.path)}
                    className={cn(
                      'rounded px-1 py-0.5 text-[12px] transition-colors hover:bg-surface-3',
                      index === breadcrumbs.length - 1 ? 'font-medium text-ink' : 'text-ink-2',
                    )}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))
            )}
          </nav>

          {view !== 'disk' || diskStatus === 'ready' ? (
            <>
              <div className="w-40 shrink-0">
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this folder"
                  label="Search this folder"
                  hideLabel
                  icon="Search"
                  className="[&_input]:h-7 [&_input]:text-[12px]"
                />
              </div>
              <IconButton
                icon={mode === 'grid' ? 'List' : 'Grid2x2'}
                label={mode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                size="sm"
                onClick={() => setMode(mode === 'grid' ? 'list' : 'grid')}
              />
            </>
          ) : null}

          {view === 'files' ? (
            <>
              <IconButton icon="FolderPlus" label="New folder" size="sm" onClick={() => void createFolder()} />
              <IconButton icon="FilePlus" label="New text file" size="sm" onClick={() => void createFile()} />
            </>
          ) : null}

          {view === 'disk' && diskStatus === 'ready' ? (
            <IconButton
              icon="RefreshCw"
              label="Re-read this folder from disk"
              size="sm"
              onClick={() => refreshDisk(diskPath)}
            />
          ) : null}

          {view === 'trash' && trash.length > 0 ? (
            <Button size="sm" variant="danger" icon="Trash2" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          ) : null}
        </div>

        {/* ------------------------------ Content ----------------------------- */}
        <div
          ref={surfaceRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onContextMenu={backgroundMenu}
          onPointerDown={(event) => {
            if (!(event.target as HTMLElement).closest('[role="option"]')) setSelection([]);
          }}
          onDragOver={(event) => {
            if (view !== 'files') return;
            const types = event.dataTransfer.types;
            if (types.includes(DROP_MIME) || types.includes('Files')) {
              event.preventDefault();
              setDropActive(true);
            }
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onBackgroundDrop}
          className={cn(
            'os-scroll min-h-0 flex-1 overflow-y-auto outline-none',
            dropActive && 'ring-2 ring-inset ring-accent/60',
          )}
        >
          {view === 'disk' ? (
            <DiskView
              path={diskPath}
              query={query}
              mode={mode}
              sortKey={sortKey}
              sortDirection={sortDirection}
              selected={diskSelected}
              onSelect={setDiskSelected}
              onNavigate={(next) => {
                setDiskPath(next);
                setDiskSelected(null);
              }}
              onOpen={openDiskEntry}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={view === 'trash' ? 'Trash2' : query ? 'Search' : 'Folder'}
              title={
                view === 'trash'
                  ? 'The Trash is empty'
                  : query
                    ? 'No matching items'
                    : folder
                      ? 'This folder is empty'
                      : 'Folder not found'
              }
              description={
                view === 'trash'
                  ? 'Items you delete will appear here until you empty the Trash.'
                  : query
                    ? `Nothing in this folder matches "${query}".`
                    : folder
                      ? 'Create a folder or file, or drag items in from your computer.'
                      : `The path "${path}" no longer exists.`
              }
              action={
                view === 'files' && folder && !query ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon="FolderPlus" onClick={() => void createFolder()}>
                      New folder
                    </Button>
                    <Button size="sm" variant="ghost" icon="FilePlus" onClick={() => void createFile()}>
                      New file
                    </Button>
                  </div>
                ) : null
              }
            />
          ) : mode === 'grid' ? (
            <GridView
              nodes={items}
              selection={selection}
              renamingId={renamingId}
              cutIds={cutIds}
              {...handlers}
            />
          ) : (
            <ListView
              nodes={items}
              selection={selection}
              renamingId={renamingId}
              cutIds={cutIds}
              narrow={narrow}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key) => {
                if (key === sortKey) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                else {
                  setSortKey(key);
                  setSortDirection('asc');
                }
              }}
              {...handlers}
            />
          )}
        </div>

        {/* ----------------------------- Status bar ---------------------------- */}
        {view !== 'disk' ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 border-t border-edge/8 bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-3"
          >
            <span>
              {pluralize(items.length, 'item')}
              {selection.length > 0 ? ` · ${selection.length} selected` : ''}
            </span>
            <span className="tabular-nums">{formatBytes(totalSize)}</span>
          </div>
        ) : null}
      </div>

      <PropertiesDialog
        node={propertiesId ? (vfs.getNode(propertiesId) ?? null) : null}
        onClose={() => setPropertiesId(null)}
      />

      <ConfirmDialog
        open={confirmEmpty}
        title="Empty the Trash?"
        description={`${pluralize(trash.length, 'item')} will be permanently deleted. This cannot be undone.`}
        confirmLabel="Empty Trash"
        destructive
        onConfirm={async () => {
          setConfirmEmpty(false);
          try {
            const count = await vfs.emptyTrash();
            notifications.push('files', { title: `Deleted ${pluralize(count, 'item')} permanently` });
          } catch (err) {
            reportError('Task Failed', err);
          }
        }}
        onCancel={() => setConfirmEmpty(false)}
      />

      <ConfirmDialog
        open={confirmTrash !== null}
        title={
          confirmTrash?.length === 1
            ? `Move "${confirmTrash[0].name}" to the Trash?`
            : `Move ${confirmTrash?.length ?? 0} items to the Trash?`
        }
        description="You may restore items from the Trash until you empty it."
        confirmLabel="Move to Trash"
        onConfirm={() => confirmTrash && void trashSelection(confirmTrash)}
        onCancel={() => setConfirmTrash(null)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete?.length === 1
            ? `Permanently delete "${confirmDelete[0].name}"?`
            : `Permanently delete ${confirmDelete?.length ?? 0} items?`
        }
        description="This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => confirmDelete && void deleteForever(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
