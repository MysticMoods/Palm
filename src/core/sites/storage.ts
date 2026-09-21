/**
 * What Palm OS keeps about an installed application.
 *
 * Manifests only. The archived bytes are in the application's own origin,
 * written there by the installer frame, and the OS has no way to read them
 * back — which is the arrangement working as intended, not a gap. What is kept
 * here is what the launcher, the App Store and the manager need: name, origin,
 * status, permissions, and the resource list the status was computed from.
 */

import { STORE, idb, transact } from '../storage/db';
import type { AppManifest } from './types';

export const installedApps = {
  async list(): Promise<AppManifest[]> {
    const all = await idb.getAll<AppManifest>(STORE.apps);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id: string): Promise<AppManifest | undefined> {
    return idb.get<AppManifest>(STORE.apps, id);
  },

  async save(manifest: AppManifest): Promise<void> {
    await idb.put(STORE.apps, manifest);
  },

  async remove(id: string): Promise<void> {
    await idb.delete(STORE.apps, id);
  },

  async totalBytes(): Promise<number> {
    const all = await idb.getAll<AppManifest>(STORE.apps);
    return all.reduce((sum, manifest) => sum + manifest.bytes, 0);
  },
};

/* --------------------------------------------------------------------- *
 * Legacy (schema 2)
 * --------------------------------------------------------------------- *
 *
 * Applications installed before the move to isolated origins were stored on
 * the Palm OS origin, bytes and all. They are read from here once, migrated,
 * and deleted — see migrate.ts. Nothing else in the OS reads these stores.
 */

export interface LegacySitePackage {
  id: string;
  name: string;
  url: string;
  host: string;
  entry: string;
  icon: string;
  color: string;
  installedAt: number;
  updatedAt: number;
  bytes: number;
  fileCount: number;
  missing: string[];
}

export interface LegacySiteFile {
  key: string;
  siteId: string;
  path: string;
  mime: string;
  data: Blob;
}

export const legacySites = {
  async list(): Promise<LegacySitePackage[]> {
    if (!(await hasStore(STORE.sites))) return [];
    return idb.getAll<LegacySitePackage>(STORE.sites);
  },

  async filesOf(siteId: string): Promise<LegacySiteFile[]> {
    if (!(await hasStore(STORE.siteFiles))) return [];
    return transact(STORE.siteFiles, 'readonly', (tx) => {
      const index = tx.objectStore(STORE.siteFiles).index('siteId');
      return new Promise<LegacySiteFile[]>((resolve, reject) => {
        const request = index.getAll(siteId);
        request.onsuccess = () => resolve(request.result as LegacySiteFile[]);
        request.onerror = () => reject(request.error);
      });
    });
  },

  /** Drop one legacy package and everything it owned. */
  async remove(siteId: string): Promise<void> {
    if (!(await hasStore(STORE.sites))) return;
    const files = await legacySites.filesOf(siteId);
    await transact([STORE.sites, STORE.siteFiles], 'readwrite', (tx) => {
      tx.objectStore(STORE.sites).delete(siteId);
      const store = tx.objectStore(STORE.siteFiles);
      for (const file of files) store.delete(file.key);
    });
  },
};

/** Older databases may predate a store; asking is cheaper than failing. */
async function hasStore(name: string): Promise<boolean> {
  const { openDatabase } = await import('../storage/db');
  const db = await openDatabase();
  return db.objectStoreNames.contains(name);
}
