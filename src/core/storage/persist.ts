/**
 * Hydration + write-back glue between a Zustand store and IndexedDB.
 *
 * Zustand's bundled `persist` middleware is synchronous-first and assumes a
 * single blob per store; the OS needs namespaced async records and control
 * over exactly which slice of state is durable, so this does that job in a
 * few lines instead.
 */

import { NS, kv } from './kv';

type Unsubscribe = () => void;

export interface PersistOptions<S, P> {
  /** KV namespace (see `NS`). */
  namespace: string;
  /** Key within the namespace. */
  key: string;
  /** Pick the durable slice out of the full store state. */
  pick: (state: S) => P;
  /** Merge a previously stored slice back into the live store. */
  merge: (persisted: P) => void;
  /** Milliseconds to coalesce rapid writes. */
  debounceMs?: number;
}

interface StoreLike<S> {
  getState: () => S;
  subscribe: (listener: (state: S, prev: S) => void) => Unsubscribe;
}

/**
 * Loads the persisted slice (if any) and then mirrors future changes back to
 * storage. Returns once hydration has finished so boot can await it.
 */
export async function attachPersistence<S, P>(
  store: StoreLike<S>,
  options: PersistOptions<S, P>,
): Promise<Unsubscribe> {
  const { namespace, key, pick, merge, debounceMs = 250 } = options;

  try {
    const persisted = await kv.get<P>(namespace, key);
    if (persisted !== undefined) merge(persisted);
  } catch (err) {
    console.warn(`[palm] could not hydrate ${namespace}:${key}`, err);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSerialised = safeStringify(pick(store.getState()));

  const flush = () => {
    timer = undefined;
    const slice = pick(store.getState());
    const serialised = safeStringify(slice);
    if (serialised === lastSerialised) return;
    lastSerialised = serialised;
    void kv.set(namespace, key, slice).catch((err) => {
      console.warn(`[palm] could not persist ${namespace}:${key}`, err);
    });
  };

  const unsubscribe = store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  // Don't lose the tail of a debounce window when the tab goes away.
  const onHide = () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);

  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
    if (timer) clearTimeout(timer);
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(Math.random());
  }
}

export { NS };
