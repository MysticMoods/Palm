/**
 * Namespaced key/value storage on top of IndexedDB.
 *
 * Keys are stored as `namespace:key` so a namespace can be enumerated or
 * wiped in one go (used by app data isolation and "clear app data").
 */

import { STORE, idb, transact } from './db';

export interface KVRecord<T = unknown> {
  key: string;
  namespace: string;
  value: T;
  updatedAt: number;
}

const composite = (namespace: string, key: string) => `${namespace}:${key}`;

export const kv = {
  async get<T>(namespace: string, key: string): Promise<T | undefined> {
    const record = await idb.get<KVRecord<T>>(STORE.kv, composite(namespace, key));
    return record?.value;
  },

  async set<T>(namespace: string, key: string, value: T): Promise<void> {
    const record: KVRecord<T> = {
      key: composite(namespace, key),
      namespace,
      value,
      updatedAt: Date.now(),
    };
    await idb.put(STORE.kv, record);
  },

  async remove(namespace: string, key: string): Promise<void> {
    await idb.delete(STORE.kv, composite(namespace, key));
  },

  async keys(namespace: string): Promise<string[]> {
    const all = await idb.getAll<KVRecord>(STORE.kv);
    const prefix = `${namespace}:`;
    return all.filter((r) => r.key.startsWith(prefix)).map((r) => r.key.slice(prefix.length));
  },

  async entries<T>(namespace: string): Promise<Array<[string, T]>> {
    const all = await idb.getAll<KVRecord<T>>(STORE.kv);
    const prefix = `${namespace}:`;
    return all
      .filter((r) => r.key.startsWith(prefix))
      .map((r) => [r.key.slice(prefix.length), r.value] as [string, T]);
  },

  async clearNamespace(namespace: string): Promise<void> {
    const all = await idb.getAll<KVRecord>(STORE.kv);
    const prefix = `${namespace}:`;
    const keys = all.filter((r) => r.key.startsWith(prefix)).map((r) => r.key);
    await idb.deleteMany(STORE.kv, keys);
  },

  /** Every record, used by the backup exporter. */
  async dump(): Promise<KVRecord[]> {
    return idb.getAll<KVRecord>(STORE.kv);
  },

  /** Replace the whole key/value space, used by the backup importer. */
  async restore(records: KVRecord[]): Promise<void> {
    await transact(STORE.kv, 'readwrite', (tx) => {
      const store = tx.objectStore(STORE.kv);
      store.clear();
      for (const record of records) store.put(record);
    });
  },
};

/** Reserved namespaces owned by the OS itself. */
export const NS = {
  settings: 'system.settings',
  desktop: 'system.desktop',
  taskbar: 'system.taskbar',
  apps: 'system.apps',
  permissions: 'system.permissions',
  notifications: 'system.notifications',
  windows: 'system.windows',
  user: 'system.user',
} as const;

/** Namespace used for a given application's private storage. */
export const appNamespace = (appId: string) => `app.${appId}`;
