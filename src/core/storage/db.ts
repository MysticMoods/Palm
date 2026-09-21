/**
 * Low-level IndexedDB access for Palm OS.
 *
 * Everything the OS persists lives in a single database with a handful of
 * object stores. The wrapper is deliberately tiny — promise-ifying the IDB
 * request API and centralising schema upgrades — so the rest of the system
 * never touches raw IndexedDB events.
 */

export const DB_NAME = 'palm-os';
export const DB_VERSION = 1;

export const STORE = {
  /** Filesystem node metadata (see core/filesystem). */
  nodes: 'nodes',
  /** File payloads, keyed by node id. Split out so listings stay cheap. */
  contents: 'contents',
  /** Generic namespaced key/value records: settings, desktop layout, app data. */
  kv: 'kv',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** Raised when IndexedDB is unavailable or a transaction fails. */
export class StorageError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE.nodes)) {
    const nodes = db.createObjectStore(STORE.nodes, { keyPath: 'id' });
    nodes.createIndex('parentId', 'parentId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE.contents)) {
    db.createObjectStore(STORE.contents, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORE.kv)) {
    db.createObjectStore(STORE.kv, { keyPath: 'key' });
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('IndexedDB is not available in this browser.'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new StorageError('Could not open the Palm OS database.', err));
      return;
    }

    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // If another tab requests a newer schema, step aside so it can upgrade.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(new StorageError('Could not open the Palm OS database.', request.error));
    request.onblocked = () =>
      reject(new StorageError('The database is blocked by another open tab.'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError('Database request failed.', request.error));
  });
}

/** Run `fn` inside a transaction and resolve once the transaction commits. */
export async function transact<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (err) {
      reject(new StorageError('Could not start a database transaction.', err));
      return;
    }
    let result: T;
    let settled = false;

    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new StorageError('Database transaction failed.', tx.error));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(new StorageError('Database transaction aborted.', tx.error));
      }
    };

    Promise.resolve(fn(tx)).then(
      (value) => {
        result = value;
      },
      (err) => {
        settled = true;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(err instanceof StorageError ? err : new StorageError(String(err), err));
      },
    );
  });
}

export const idb = {
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return transact(store, 'readonly', (tx) =>
      promisify<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>),
    );
  },

  async getAll<T>(store: StoreName): Promise<T[]> {
    return transact(store, 'readonly', (tx) =>
      promisify<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>),
    );
  },

  async put<T>(store: StoreName, value: T): Promise<void> {
    await transact(store, 'readwrite', (tx) => promisify(tx.objectStore(store).put(value)));
  },

  async putMany<T>(store: StoreName, values: T[]): Promise<void> {
    if (values.length === 0) return;
    await transact(store, 'readwrite', (tx) => {
      const os = tx.objectStore(store);
      for (const value of values) os.put(value);
    });
  },

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await transact(store, 'readwrite', (tx) => promisify(tx.objectStore(store).delete(key)));
  },

  async deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return;
    await transact(store, 'readwrite', (tx) => {
      const os = tx.objectStore(store);
      for (const key of keys) os.delete(key);
    });
  },

  async clear(store: StoreName): Promise<void> {
    await transact(store, 'readwrite', (tx) => promisify(tx.objectStore(store).clear()));
  },

  async count(store: StoreName): Promise<number> {
    return transact(store, 'readonly', (tx) => promisify(tx.objectStore(store).count()));
  },
};

/** Drop the entire database — used by "Reset Palm OS". */
export async function destroyDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new StorageError('Could not delete the database.'));
    // A blocked delete still succeeds once other tabs close; don't hang the UI.
    request.onblocked = () => resolve();
  });
}

/** Best-effort storage quota report for the Storage settings pane. */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
