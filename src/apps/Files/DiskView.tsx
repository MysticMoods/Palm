import { useCallback, useMemo, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { disk } from '../../core/filesystem/disk';
import { categoryForMime } from '../../core/filesystem/mime';
import type { DiskEntry } from '../../core/filesystem/disk';
import { useDiskStore } from '../../core/filesystem/disk-store';
import { pickFiles } from '../../core/filesystem/transfer';
import { vfs } from '../../core/filesystem/vfs';
import { notifications } from '../../core/notifications/store';
import { cn } from '../../utils/cn';
import { formatBytes, formatDate } from '../../utils/format';
import { useDiskListing, useDiskReconciliation } from './useDisk';
import type { SortDirection, SortKey } from './file-icons';

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

function entryIcon(entry: DiskEntry): string {
  if (entry.kind === 'folder') return 'Folder';
  return CATEGORY_ICON[categoryForMime(entry.mime)] ?? 'File';
}

function sortEntries(entries: DiskEntry[], key: SortKey, direction: SortDirection): DiskEntry[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    switch (key) {
      case 'size':
        return (a.size - b.size) * factor;
      case 'modified':
        return (a.modifiedAt - b.modifiedAt) * factor;
      case 'type':
        return a.mime.localeCompare(b.mime) * factor;
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true }) * factor;
    }
  });
}

export interface DiskViewProps {
  path: string;
  query: string;
  mode: 'grid' | 'list';
  sortKey: SortKey;
  sortDirection: SortDirection;
  selected: string | null;
  onSelect: (path: string | null) => void;
  onNavigate: (path: string) => void;
  onOpen: (entry: DiskEntry) => void;
}

/**
 * Palm Disk — a real folder on the user's machine.
 *
 * Kept visually distinct from the virtual filesystem throughout: a persistent
 * banner, a read-only badge, and no create/delete affordances. Confusing the
 * two is the one genuinely damaging mistake this app could invite.
 */
export function DiskView({
  path,
  query,
  mode,
  sortKey,
  sortDirection,
  selected,
  onSelect,
  onNavigate,
  onOpen,
}: DiskViewProps) {
  const status = useDiskStore((s) => s.status);
  const label = useDiskStore((s) => s.label);
  const error = useDiskStore((s) => s.error);
  const choose = useDiskStore((s) => s.choose);
  const reconnect = useDiskStore((s) => s.reconnect);

  const writable = useDiskStore((s) => s.writable);
  const requestWrite = useDiskStore((s) => s.requestWrite);
  const refresh = useDiskStore((s) => s.refresh);
  const [pendingCreate, setPendingCreate] = useState<'file' | 'folder' | null>(null);

  const { entries, loading, error: listError } = useDiskListing(status === 'ready' ? path : null);
  useDiskReconciliation(status === 'ready');

  /**
   * Creating on a real disk is gated behind an explicit grant. The first
   * attempt escalates the browser permission and confirms; after that it is
   * a single click, because nothing is being destroyed — only added.
   */
  const create = useCallback(
    async (kind: 'file' | 'folder') => {
      setPendingCreate(null);
      try {
        if (!(await requestWrite())) {
          notifications.push('files', {
            title: 'Cannot write to Palm Disk',
            body: 'Your browser did not grant permission to modify that folder.',
            urgency: 'critical',
          });
          return;
        }
        const base = kind === 'folder' ? 'New Folder' : 'New File.txt';
        const name = await disk.uniqueName(path, base);
        const target = path === '/' ? `/${name}` : `${path}/${name}`;
        if (kind === 'folder') await disk.createFolder(target);
        else await disk.createFile(target, '');
        refresh(path);
        notifications.push('files', {
          title: `Created “${name}” on Palm Disk`,
          body: 'It now exists as a real file on your computer.',
        });
      } catch (error) {
        notifications.push('files', {
          title: 'Could not create it',
          body: error instanceof Error ? error.message : String(error),
          urgency: 'critical',
        });
      }
    },
    [path, refresh, requestWrite],
  );

  const startCreate = (kind: 'file' | 'folder') => {
    if (writable) void create(kind);
    else setPendingCreate(kind);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
      : entries;
    return sortEntries(filtered, sortKey, sortDirection);
  }, [entries, query, sortKey, sortDirection]);

  /* ----------------------------- Gate states ---------------------------- */

  if (status === 'unsupported') {
    return (
      <div className="p-4">
        <Notice tone="warn" icon="Info" title="This browser cannot connect to a folder">
          Palm Disk uses the File System Access API, which today is implemented only by
          Chromium-based browsers (Chrome, Edge, Opera, Arc). Firefox and Safari do not expose it,
          so Palm OS falls back to copying files in and downloading them out — the closest the
          platform allows.
        </Notice>
        <div className="mt-3">
          <Button variant="primary" icon="Upload" onClick={() => void importViaPicker()}>
            Import files into Palm OS
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'needs-permission') {
    return (
      <EmptyState
        icon="Lock"
        title={`Reconnect “${label}”`}
        description="Palm OS remembers the folder you chose, but your browser drops the permission when the page reloads. One click restores it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon="Database" onClick={() => void reconnect()}>
              Reconnect
            </Button>
            <Button variant="ghost" onClick={() => void choose()}>
              Choose a different folder
            </Button>
          </div>
        }
      />
    );
  }

  if (status === 'unmounted' || status === 'error') {
    return (
      <div className="p-4">
        {status === 'error' && error ? (
          <Notice tone="danger" icon="CircleAlert" title="Could not connect" className="mb-4">
            {error}
          </Notice>
        ) : null}
        <EmptyState
          icon="Database"
          title="Connect a folder"
          description="Choose a folder on your computer to browse it here. Palm OS can only see the folder you pick, and only while your browser allows it."
          action={
            <Button variant="primary" icon="FolderOpen" onClick={() => void choose()}>
              Choose folder…
            </Button>
          }
        />
      </div>
    );
  }

  if (status === 'mounting') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-3">
        <Spinner size={16} />
        <span className="text-xs">Connecting…</span>
      </div>
    );
  }

  /* ------------------------------- Contents ----------------------------- */

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge/8 bg-warn/8 px-3 py-2">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-[11.5px] leading-relaxed text-ink-2">
          <Icon name="AlertTriangle" size={13} className="mt-px shrink-0 text-warn" />
          <span>
            <strong className="font-medium text-ink">These are your real files</strong>, in{' '}
            <span className="font-mono">{label}</span> on your computer — not the Palm OS virtual
            filesystem.{' '}
            {writable
              ? 'Palm OS can add and edit files here.'
              : 'Palm OS will ask before changing anything.'}
          </span>
        </p>
        <span className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" icon="FolderPlus" onClick={() => startCreate('folder')}>
            New folder
          </Button>
          <Button size="sm" variant="ghost" icon="FilePlus" onClick={() => startCreate('file')}>
            New file
          </Button>
        </span>
      </div>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
        {listError ? (
          <div className="p-4">
            <Notice tone="danger" icon="CircleAlert" title="Could not read this folder">
              {listError}
            </Notice>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-3">
            <Spinner size={16} />
            <span className="text-xs">Reading folder…</span>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            icon={query ? 'Search' : 'Folder'}
            title={query ? 'No matching items' : 'This folder is empty'}
            description={query ? `Nothing here matches “${query}”.` : undefined}
          />
        ) : mode === 'grid' ? (
          <ul
            role="listbox"
            aria-label="Palm Disk"
            className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-1 p-2"
          >
            {visible.map((entry) => (
              <li key={entry.path}>
                <div
                  role="option"
                  aria-selected={entry.path === selected}
                  tabIndex={-1}
                  onPointerDown={() => onSelect(entry.path)}
                  onDoubleClick={() => (entry.kind === 'folder' ? onNavigate(entry.path) : onOpen(entry))}
                  className={cn(
                    'flex cursor-default flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors',
                    entry.path === selected ? 'bg-accent-soft ring-1 ring-accent/50' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-ink-2">
                    <Icon name={entryIcon(entry)} size={22} strokeWidth={1.8} />
                  </span>
                  <span className="line-clamp-2 w-full break-words text-[11.5px] leading-tight text-ink-2">
                    {entry.name}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2/90 text-[11px] font-medium text-ink-3 backdrop-blur">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Name</th>
                <th scope="col" className="hidden px-3 py-1.5 font-medium md:table-cell">Modified</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr
                  key={entry.path}
                  aria-selected={entry.path === selected}
                  onPointerDown={() => onSelect(entry.path)}
                  onDoubleClick={() => (entry.kind === 'folder' ? onNavigate(entry.path) : onOpen(entry))}
                  className={cn(
                    'cursor-default transition-colors',
                    entry.path === selected ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2',
                  )}
                >
                  <td className="flex items-center gap-2 px-3 py-1.5">
                    <Icon name={entryIcon(entry)} size={15} />
                    <span className="truncate">{entry.name}</span>
                  </td>
                  <td className="hidden px-3 py-1.5 text-[11.5px] text-ink-3 md:table-cell">
                    {entry.modifiedAt ? formatDate(entry.modifiedAt) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11.5px] tabular-nums text-ink-3">
                    {entry.kind === 'folder' ? '—' : formatBytes(entry.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={pendingCreate !== null}
        title={`Let Palm OS write to “${label}”?`}
        description="Your browser will ask for permission to modify this folder. Palm OS can then add and edit files here — it never deletes or renames anything on your real disk."
        confirmLabel="Continue"
        onConfirm={() => pendingCreate && void create(pendingCreate)}
        onCancel={() => setPendingCreate(null)}
      />
    </div>
  );
}

/** Fallback for browsers with no folder access: copy files in by hand. */
async function importViaPicker(): Promise<void> {
  const files = await pickFiles();
  if (files.length === 0) return;
  const downloads = vfs.nodeAt('/Downloads') ?? (await vfs.mkdirp('/Downloads'));
  let imported = 0;
  for (const file of files) {
    try {
      const isText = file.type.startsWith('text/') || file.type === 'application/json';
      const data = isText ? await file.text() : new Blob([await file.arrayBuffer()], { type: file.type });
      await vfs.createFile(downloads.id, vfs.uniqueName(downloads.id, file.name), data, file.type || undefined);
      imported += 1;
    } catch {
      /* reported in aggregate below */
    }
  }
  notifications.push('files', {
    title: imported > 0 ? `Imported ${imported} file${imported === 1 ? '' : 's'}` : 'Nothing imported',
    body: imported > 0 ? 'Saved to /Downloads.' : undefined,
    urgency: imported > 0 ? 'normal' : 'critical',
  });
}
