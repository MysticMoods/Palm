import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The store is the permission dance around the volume. Storage is stubbed
 * rather than faked through IndexedDB so each test can say exactly what was
 * remembered from a previous session — including a husk, which is what a
 * corrupted or downgraded record would look like.
 */
const store = new Map<string, unknown>();

vi.mock('../storage/kv', () => ({
  kv: {
    get: async (_ns: string, key: string) => store.get(key),
    set: async (_ns: string, key: string, value: unknown) => {
      store.set(key, value);
    },
    remove: async (_ns: string, key: string) => {
      store.delete(key);
    },
  },
}));

const { useDiskStore } = await import('./disk-store');
const { disk } = await import('./disk');
const { fakeDirectory } = await import('./fake-handles');

const withPermission = (handle: object, state: PermissionState = 'granted') =>
  Object.assign(handle, {
    queryPermission: async () => state,
    requestPermission: async () => state,
  });

const reset = () => {
  store.clear();
  disk.detach();
  useDiskStore.setState({
    status: 'unmounted',
    label: '',
    error: null,
    revision: 0,
    writable: false,
  });
};

beforeEach(reset);
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Stand in for a browser that implements the File System Access API. */
function installPicker(result: unknown | (() => never)) {
  (globalThis as { window?: unknown }).window = {
    showDirectoryPicker: async () => (typeof result === 'function' ? result() : result),
  };
}

describe('mounting', () => {
  it('mounts the chosen folder and remembers it', async () => {
    const handle = withPermission(fakeDirectory('my-project', { 'a.txt': 'x' }));
    installPicker(handle);

    await useDiskStore.getState().choose();

    expect(useDiskStore.getState().status).toBe('ready');
    expect(useDiskStore.getState().label).toBe('my-project');
    expect(disk.mounted).toBe(true);
    expect(store.get('root-handle')).toBe(handle);
  });

  it('treats a cancelled picker as no change, not an error', async () => {
    installPicker(() => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });

    await useDiskStore.getState().choose();

    expect(useDiskStore.getState().status).toBe('unmounted');
    expect(useDiskStore.getState().error).toBeNull();
  });

  it('surfaces a real failure', async () => {
    installPicker(() => {
      throw new Error('Something went wrong');
    });

    await useDiskStore.getState().choose();

    expect(useDiskStore.getState().status).toBe('error');
    expect(useDiskStore.getState().error).toMatch(/something went wrong/i);
  });

  it('still mounts when the folder cannot be remembered for next time', async () => {
    // Remembering is a convenience; failing at it must not block this session.
    const handle = withPermission(fakeDirectory('temp', {}));
    installPicker(handle);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = store.set.bind(store);
    store.set = () => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    };

    await useDiskStore.getState().choose();

    expect(useDiskStore.getState().status).toBe('ready');
    expect(disk.mounted).toBe(true);
    store.set = original;
    spy.mockRestore();
  });
});

describe('restoring a previous session', () => {
  it('reports unmounted when nothing was remembered', async () => {
    installPicker(null);
    await useDiskStore.getState().restore();
    expect(useDiskStore.getState().status).toBe('unmounted');
  });

  it('remounts silently when the browser still permits it', async () => {
    installPicker(null);
    store.set('root-handle', withPermission(fakeDirectory('kept', { 'a.txt': 'x' })));

    await useDiskStore.getState().restore();

    expect(useDiskStore.getState().status).toBe('ready');
    expect(disk.mounted).toBe(true);
  });

  it('asks for a reconnect when the permission has lapsed', async () => {
    // The usual case after a page reload: the handle survives, the grant does not.
    installPicker(null);
    store.set('root-handle', withPermission(fakeDirectory('kept', {}), 'prompt'));

    await useDiskStore.getState().restore();

    expect(useDiskStore.getState().status).toBe('needs-permission');
    expect(useDiskStore.getState().label).toBe('kept');
    expect(disk.mounted).toBe(false);
  });

  it('reconnect re-requests and mounts', async () => {
    installPicker(null);
    store.set('root-handle', withPermission(fakeDirectory('kept', { 'a.txt': 'x' }), 'granted'));

    await useDiskStore.getState().reconnect();

    expect(useDiskStore.getState().status).toBe('ready');
  });

  it('stays disconnected when the user refuses the reconnect', async () => {
    installPicker(null);
    store.set('root-handle', withPermission(fakeDirectory('kept', {}), 'denied'));

    await useDiskStore.getState().reconnect();

    expect(useDiskStore.getState().status).toBe('needs-permission');
    expect(disk.mounted).toBe(false);
  });

  it('ignores a stored value that is not a usable handle', async () => {
    // What a husk left by structured clone, or an older build, looks like.
    installPicker(null);
    store.set('root-handle', { kind: 'directory', name: 'ghost' });

    await useDiskStore.getState().restore();

    expect(useDiskStore.getState().status).toBe('unmounted');
    expect(disk.mounted).toBe(false);
  });
});

describe('ejecting', () => {
  it('detaches and forgets the folder', async () => {
    const handle = withPermission(fakeDirectory('my-project', {}));
    installPicker(handle);
    await useDiskStore.getState().choose();

    await useDiskStore.getState().eject();

    expect(useDiskStore.getState().status).toBe('unmounted');
    expect(useDiskStore.getState().label).toBe('');
    expect(disk.mounted).toBe(false);
    expect(store.has('root-handle')).toBe(false);
  });
});

describe('refresh', () => {
  it('bumps the revision so listings re-read', async () => {
    installPicker(withPermission(fakeDirectory('r', {})));
    await useDiskStore.getState().choose();
    const before = useDiskStore.getState().revision;

    useDiskStore.getState().refresh();

    expect(useDiskStore.getState().revision).toBeGreaterThan(before);
  });
});

describe('write permission', () => {
  it('mounts read-only and only asks for write when something is written', async () => {
    const handle = withPermission(fakeDirectory('my-project', { 'a.txt': 'x' }));
    installPicker(handle);
    await useDiskStore.getState().choose();

    // Connecting a folder must not have asked for write access.
    expect(useDiskStore.getState().writable).toBe(false);

    const granted = await useDiskStore.getState().requestWrite();
    expect(granted).toBe(true);
    expect(useDiskStore.getState().writable).toBe(true);
  });

  it('stays read-only when the user refuses', async () => {
    const handle = withPermission(fakeDirectory('my-project', {}), 'denied');
    installPicker(handle);
    await useDiskStore.getState().choose();

    expect(await useDiskStore.getState().requestWrite()).toBe(false);
    expect(useDiskStore.getState().writable).toBe(false);
  });

  it('does not ask twice once granted', async () => {
    const handle = fakeDirectory('my-project', {});
    let requests = 0;
    Object.assign(handle, {
      queryPermission: async () => 'prompt' as PermissionState,
      requestPermission: async () => {
        requests += 1;
        return 'granted' as PermissionState;
      },
    });
    installPicker(handle);
    await useDiskStore.getState().choose();

    await useDiskStore.getState().requestWrite();
    await useDiskStore.getState().requestWrite();
    expect(requests).toBe(1);
  });

  it('never inherits write access across a reload', async () => {
    // The handle survives, but agreeing to write once should not mean
    // agreeing forever without being asked again.
    installPicker(null);
    store.set('root-handle', withPermission(fakeDirectory('kept', {}), 'granted'));

    await useDiskStore.getState().restore();

    expect(useDiskStore.getState().status).toBe('ready');
    expect(useDiskStore.getState().writable).toBe(false);
  });

  it('drops write access when the folder is ejected', async () => {
    const handle = withPermission(fakeDirectory('my-project', {}));
    installPicker(handle);
    await useDiskStore.getState().choose();
    await useDiskStore.getState().requestWrite();

    await useDiskStore.getState().eject();
    expect(useDiskStore.getState().writable).toBe(false);
  });
});

describe('write permission when the folder could not be remembered', () => {
  it('still escalates, using the mounted handle rather than storage', async () => {
    // Regression: requestWrite read the handle back from storage, so a failed
    // "remember this folder" left a working volume permanently unwritable.
    const handle = withPermission(fakeDirectory('ephemeral', { 'a.txt': 'x' }));
    installPicker(handle);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = store.set.bind(store);
    store.set = () => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    };

    await useDiskStore.getState().choose();
    expect(useDiskStore.getState().status).toBe('ready');
    expect(store.has('root-handle')).toBe(false);

    expect(await useDiskStore.getState().requestWrite()).toBe(true);

    store.set = original;
    spy.mockRestore();
  });

  it('refuses when nothing is mounted at all', async () => {
    installPicker(null);
    expect(await useDiskStore.getState().requestWrite()).toBe(false);
  });
});
