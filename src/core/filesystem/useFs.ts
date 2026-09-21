/**
 * React bindings for the virtual filesystem.
 *
 * The VFS is a plain object outside React; components subscribe to a revision
 * counter and derive what they need. Keeping the snapshot a number means
 * `useSyncExternalStore` never has to compare deep structures.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { vfs } from './vfs';
import type { FSNode } from './types';

let revision = 0;
const subscribers = new Set<() => void>();

vfs.subscribe(() => {
  revision += 1;
  for (const notify of subscribers) notify();
});

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

const getSnapshot = () => revision;

/** Bumps whenever anything in the filesystem changes. */
export function useFsRevision(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Children of a folder path, or `null` when the path does not exist. */
export function useDirectory(path: string | null): { node: FSNode | null; children: FSNode[] } {
  const rev = useFsRevision();
  return useMemo(() => {
    void rev;
    if (!path) return { node: null, children: [] };
    const node = vfs.nodeAt(path);
    if (!node || node.kind !== 'folder') return { node: node ?? null, children: [] };
    return { node, children: vfs.list(node.id) };
  }, [path, rev]);
}

export function useNode(id: string | null | undefined): FSNode | null {
  const rev = useFsRevision();
  return useMemo(() => {
    void rev;
    return id ? (vfs.getNode(id) ?? null) : null;
  }, [id, rev]);
}

export function useNodeAt(path: string | null | undefined): FSNode | null {
  const rev = useFsRevision();
  return useMemo(() => {
    void rev;
    return path ? (vfs.nodeAt(path) ?? null) : null;
  }, [path, rev]);
}

export function useTrash(): FSNode[] {
  const rev = useFsRevision();
  return useMemo(() => {
    void rev;
    return vfs.listTrash();
  }, [rev]);
}

/** Stable callback that resolves a node id to its absolute path. */
export function usePathOf(): (id: string) => string {
  const rev = useFsRevision();
  return useCallback(
    (id: string) => {
      void rev;
      return vfs.pathOf(id);
    },
    [rev],
  );
}
