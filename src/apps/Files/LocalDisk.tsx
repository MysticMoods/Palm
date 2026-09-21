import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice, Spinner } from '../../components/ui/Feedback';
import {
  downloadBlob,
  forgetLocalDirectory,
  handlePermission,
  localDiskSupport,
  pickFilesFallback,
  pickLocalDirectory,
  readLocalDirectory,
  restoreLocalDirectory,
} from '../../core/filesystem/local';
import type { LocalEntry } from '../../core/filesystem/local';
import { vfs } from '../../core/filesystem/vfs';
import { notifications } from '../../core/notifications/store';
import { cn } from '../../utils/cn';
import { formatBytes, formatDate } from '../../utils/format';

/**
 * Real-disk browser.
 *
 * Kept visually distinct from the virtual filesystem — a banner states plainly
 * that these are the user's actual files — because confusing the two is the
 * one genuinely dangerous mistake this app could invite.
 */
export function LocalDisk({ onImported }: { onImported: () => void }) {
  const support = localDiskSupport();
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [trail, setTrail] = useState<FileSystemDirectoryHandle[]>([]);
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const current = trail[trail.length - 1] ?? root;

  const load = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setStatus('loading');
    setError(null);
    try {
      const state = await handlePermission(handle, 'readwrite', true);
      if (state !== 'granted') {
        setStatus('denied');
        return;
      }
      setEntries(await readLocalDirectory(handle));
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  /* Try to restore a previously granted folder on mount. */
  useEffect(() => {
    if (support !== 'full') return;
    let cancelled = false;
    restoreLocalDirectory().then((handle) => {
      if (cancelled || !handle) return;
      setRoot(handle);
      void load(handle);
    });
    return () => {
      cancelled = true;
    };
  }, [load, support]);

  const choose = async () => {
    try {
      const handle = await pickLocalDirectory();
      setRoot(handle);
      setTrail([]);
      await load(handle);
    } catch (err) {
      // An AbortError just means the user closed the picker.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const importEntry = async (entry: LocalEntry) => {
    if (entry.kind !== 'file') return;
    const downloads = vfs.nodeAt('/Downloads');
    if (!downloads) return;
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      const isText = file.type.startsWith('text/') || file.type === 'application/json';
      const data = isText ? await file.text() : new Blob([await file.arrayBuffer()], { type: file.type });
      await vfs.createFile(downloads.id, vfs.uniqueName(downloads.id, file.name), data, file.type || undefined);
      notifications.push('files', {
        title: `Copied "${file.name}" into Palm OS`,
        body: 'Saved to /Downloads.',
      });
      onImported();
    } catch (err) {
      notifications.push('files', {
        title: 'Could not import file',
        body: err instanceof Error ? err.message : String(err),
        urgency: 'critical',
      });
    }
  };

  const importViaPicker = async () => {
    const files = await pickFilesFallback();
    if (files.length === 0) return;
    const downloads = vfs.nodeAt('/Downloads');
    if (!downloads) return;
    let count = 0;
    for (const file of files) {
      try {
        const isText = file.type.startsWith('text/') || file.type === 'application/json';
        const data = isText ? await file.text() : new Blob([await file.arrayBuffer()], { type: file.type });
        await vfs.createFile(downloads.id, vfs.uniqueName(downloads.id, file.name), data, file.type || undefined);
        count += 1;
      } catch {
        /* reported in aggregate below */
      }
    }
    notifications.push('files', {
      title: count > 0 ? `Imported ${count} file${count === 1 ? '' : 's'}` : 'Nothing imported',
      body: count > 0 ? 'Saved to /Downloads.' : undefined,
      urgency: count > 0 ? 'normal' : 'critical',
    });
    onImported();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-edge/8 bg-warn/8 px-3 py-2">
        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-2">
          <Icon name="AlertTriangle" size={13} className="mt-px shrink-0 text-warn" />
          <span>
            <strong className="font-medium text-ink">These are your real files.</strong> Anything you
            open here comes from your actual computer, not from the Palm OS virtual filesystem.
          </span>
        </p>
      </div>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {support !== 'full' ? (
          <div className="flex flex-col gap-3">
            <Notice tone="warn" icon="Info" title="Folder access is not available in this browser">
              The File System Access API is currently implemented by Chromium-based browsers
              (Chrome, Edge, Opera, Arc). Firefox and Safari do not expose it, so Palm OS falls back
              to importing files you pick and downloading files you export — which is the closest
              equivalent the platform allows.
            </Notice>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="Upload" onClick={importViaPicker}>
                Import files into Palm OS
              </Button>
            </div>
          </div>
        ) : !root ? (
          <EmptyState
            icon="Database"
            title="No folder connected"
            description="Choose a folder on your computer to browse. Palm OS can only see the folder you pick, and only for as long as your browser keeps the grant."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon="FolderOpen" onClick={choose}>
                  Choose folder…
                </Button>
                <Button variant="ghost" icon="Upload" onClick={importViaPicker}>
                  Import files instead
                </Button>
              </div>
            }
          />
        ) : status === 'denied' ? (
          <EmptyState
            icon="Lock"
            title="Permission needed"
            description="Your browser has not granted access to this folder. Grant it again to continue."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => current && load(current)}>
                  Request access
                </Button>
                <Button variant="ghost" onClick={choose}>
                  Choose another folder
                </Button>
              </div>
            }
          />
        ) : status === 'error' ? (
          <Notice tone="danger" icon="CircleAlert" title="Could not read the folder">
            {error}
          </Notice>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                icon="ArrowUp"
                disabled={trail.length === 0}
                onClick={() => {
                  const next = trail.slice(0, -1);
                  setTrail(next);
                  const handle = next[next.length - 1] ?? root;
                  void load(handle);
                }}
              >
                Up
              </Button>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">
                {[root.name, ...trail.map((handle) => handle.name)].join(' / ')}
              </span>
              <Button size="sm" variant="ghost" icon="RefreshCw" onClick={() => current && load(current)}>
                Refresh
              </Button>
              <Button size="sm" variant="ghost" icon="FolderOpen" onClick={choose}>
                Change
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="X"
                onClick={async () => {
                  await forgetLocalDirectory();
                  setRoot(null);
                  setTrail([]);
                  setEntries([]);
                }}
              >
                Disconnect
              </Button>
            </div>

            {status === 'loading' ? (
              <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
                <Spinner size={16} />
                <span className="text-xs">Reading folder…</span>
              </div>
            ) : entries.length === 0 ? (
              <EmptyState compact icon="Folder" title="This folder is empty" />
            ) : (
              <ul className="flex flex-col gap-px">
                {entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.name}`}>
                    <div
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] text-ink-2',
                        'transition-colors hover:bg-surface-2',
                      )}
                    >
                      <Icon
                        name={entry.kind === 'directory' ? 'Folder' : 'File'}
                        size={15}
                        className={entry.kind === 'directory' ? 'text-warn' : 'text-ink-3'}
                      />
                      {entry.kind === 'directory' ? (
                        <button
                          type="button"
                          onClick={() => {
                            const handle = entry.handle as FileSystemDirectoryHandle;
                            setTrail((previous) => [...previous, handle]);
                            void load(handle);
                          }}
                          className="min-w-0 flex-1 truncate text-left hover:text-ink hover:underline"
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      )}

                      <span className="hidden w-36 shrink-0 truncate text-[11px] text-ink-3 md:block">
                        {entry.modifiedAt ? formatDate(entry.modifiedAt) : ''}
                      </span>
                      <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
                        {entry.kind === 'file' ? formatBytes(entry.size ?? 0) : '—'}
                      </span>

                      {entry.kind === 'file' ? (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            onClick={() => void importEntry(entry)}
                            title="Copy into Palm OS"
                            aria-label={`Copy "${entry.name}" into Palm OS`}
                            className="rounded p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                          >
                            <Icon name="Download" size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const file = await (entry.handle as FileSystemFileHandle).getFile();
                              downloadBlob(file, file.name, file.type);
                            }}
                            title="Save a copy"
                            aria-label={`Save a copy of "${entry.name}"`}
                            className="rounded p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                          >
                            <Icon name="Save" size={13} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
