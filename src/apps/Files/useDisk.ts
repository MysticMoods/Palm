import { useCallback, useEffect, useState } from 'react';
import { disk, useDiskStore } from '../../core/filesystem/disk-store';
import type { DiskEntry } from '../../core/filesystem/disk';

export interface DiskListing {
  entries: DiskEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Contents of a folder on Palm Disk.
 *
 * Re-reads whenever the store's revision changes, which is how an explicit
 * Refresh and the window-focus reconciliation both propagate: the web has no
 * file-watching API, so noticing an edit made outside the browser means
 * looking again rather than being told.
 */
export function useDiskListing(path: string | null): DiskListing {
  const status = useDiskStore((s) => s.status);
  const revision = useDiskStore((s) => s.revision);
  const [listing, setListing] = useState<DiskListing>({ entries: [], loading: false, error: null });

  useEffect(() => {
    if (path === null || status !== 'ready') {
      setListing({ entries: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setListing((current) => ({ ...current, loading: true, error: null }));

    disk
      .list(path)
      .then((entries) => {
        if (!cancelled) setListing({ entries, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListing({
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, status, revision]);

  return listing;
}

/**
 * Re-reads the mounted folder when the window regains focus.
 *
 * A file changed in an editor outside the browser should show up when the user
 * looks back at Palm OS, without them having to find a refresh button.
 */
export function useDiskReconciliation(active: boolean): void {
  const refresh = useDiskStore((s) => s.refresh);
  const status = useDiskStore((s) => s.status);

  useEffect(() => {
    if (!active || status !== 'ready') return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, refresh, status]);
}

/** Object URL for a file on Palm Disk, revoked when it changes or unmounts. */
export function useDiskObjectUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;

    disk
      .createObjectURL(path)
      .then((created) => {
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return url;
}

/** Stable callback that opens a disk file in whichever app handles it. */
export function useOpenDiskFile(): (entry: DiskEntry) => void {
  return useCallback((entry: DiskEntry) => {
    void import('../../core/os').then(({ openDiskFile }) => openDiskFile(entry));
  }, []);
}
