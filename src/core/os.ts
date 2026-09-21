/**
 * The OS API.
 *
 * This is the single surface applications use to talk to the system. Apps
 * never import the window store or the filesystem directly — they go through
 * here, which is what lets the OS enforce permissions, record usage and keep
 * app code decoupled from the shell's internals.
 *
 * `OS` is the system-level API (used by the shell itself). Applications get a
 * scoped instance from `createAppAPI(appId)` where filesystem, clipboard and
 * notification calls are permission-checked against that app's grants.
 */

import { getApp, launchableApps } from './app-manager/registry';
import { useAppStore } from './app-manager/store';
import { clipboard, useClipboardStore } from './clipboard/store';
import type { DiskEntry } from './filesystem/disk';
import { categoryForMime, isTextMime } from './filesystem/mime';
import * as path from './filesystem/path';
import { FSError, ROOT_ID, vfs } from './filesystem/vfs';
import type { FSNode, FileData } from './filesystem/types';
import { notifications } from './notifications/store';
import type { NotifyOptions } from './notifications/store';
import { permissions } from './permissions/store';
import type { Permission } from './permissions/types';
import { getProfile, getSettings, useSettingsStore } from './settings/store';
import type { Settings } from './settings/types';
import { shell } from './shell/store';
import { appNamespace, kv } from './storage/kv';
import { useWindowStore } from './window-manager/store';
import type { OpenWindowOptions } from './window-manager/types';
import { COMPACT_BREAKPOINT } from './window-manager/store';

export class PermissionDeniedError extends Error {
  constructor(appId: string, permission: Permission) {
    super(`"${appId}" was not granted the "${permission}" permission.`);
    this.name = 'PermissionDeniedError';
  }
}

/* --------------------------------------------------------------------- *
 * App launching
 * --------------------------------------------------------------------- */

export interface LaunchOptions {
  params?: Record<string, unknown>;
  /** Force a new window even for singleton apps. */
  forceNew?: boolean;
}

export function openApp(appId: string, options: LaunchOptions = {}): string | null {
  const app = getApp(appId);
  if (!app) {
    console.warn(`[palm/os] unknown app "${appId}"`);
    return null;
  }
  if (!useAppStore.getState().isInstalled(appId)) {
    console.warn(`[palm/os] "${appId}" is not installed`);
    return null;
  }

  useAppStore.getState().noteLaunch(appId);
  shell.closePanel();

  const defaults = app.window ?? {};
  const compact = window.innerWidth < COMPACT_BREAKPOINT;

  const windowOptions: OpenWindowOptions = {
    appId,
    title: app.name,
    icon: app.icon,
    width: defaults.width,
    height: defaults.height,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    resizable: defaults.resizable ?? true,
    props: { ...app.props, ...options.params },
    singleton: options.forceNew ? false : (defaults.singleton ?? false),
    maximized: compact,
  };

  return useWindowStore.getState().open(windowOptions);
}

/** Choose the best app for a file and open it there. */
export function openFile(target: string | FSNode): string | null {
  const node = typeof target === 'string' ? vfs.nodeAt(target) : target;
  if (!node) {
    console.warn(`[palm/os] cannot open missing path "${String(target)}"`);
    return null;
  }

  if (node.kind === 'folder') {
    return openApp('files', { params: { path: vfs.pathOf(node.id) } });
  }

  const category = categoryForMime(node.mime);
  const settings = getSettings();
  const preferred = settings.defaultApps[category];
  const appId =
    (preferred && getApp(preferred) && useAppStore.getState().isInstalled(preferred)
      ? preferred
      : undefined) ??
    launchableApps().find(
      (app) =>
        useAppStore.getState().isInstalled(app.id) &&
        (app.handlesMime?.includes(node.mime) || app.handles?.includes(category)),
    )?.id ??
    (isTextMime(node.mime) ? 'text-editor' : undefined);

  if (!appId) {
    notifications.push('system', {
      title: 'No application available',
      body: `Nothing installed can open "${node.name}".`,
      urgency: 'normal',
    });
    return null;
  }

  return openApp(appId, { params: { path: vfs.pathOf(node.id), nodeId: node.id } });
}

export function openWith(appId: string, node: FSNode): string | null {
  return openApp(appId, { params: { path: vfs.pathOf(node.id), nodeId: node.id } });
}

/**
 * Open a file that lives on Palm Disk rather than in the virtual filesystem.
 *
 * Applications receive `volume: 'disk'` alongside the path so they read
 * through the right filesystem, and so they can say plainly that the file is
 * a real one on the user's machine — currently opened read-only.
 */
export function openDiskFile(entry: DiskEntry): string | null {
  if (entry.kind === 'folder') {
    return openApp('files', { params: { view: 'disk', diskPath: entry.path } });
  }

  const category = categoryForMime(entry.mime);
  const settings = getSettings();
  const store = useAppStore.getState();
  const preferred = settings.defaultApps[category];

  const appId =
    (preferred && getApp(preferred) && store.isInstalled(preferred) ? preferred : undefined) ??
    launchableApps().find(
      (app) =>
        store.isInstalled(app.id) &&
        (app.handlesMime?.includes(entry.mime) || app.handles?.includes(category)),
    )?.id ??
    (isTextMime(entry.mime) ? 'text-editor' : undefined);

  if (!appId) {
    notifications.push('system', {
      title: 'No application available',
      body: `Nothing installed can open "${entry.name}".`,
    });
    return null;
  }

  return openApp(appId, { params: { path: entry.path, volume: 'disk', readOnly: true } });
}

/* --------------------------------------------------------------------- *
 * System-level API
 * --------------------------------------------------------------------- */

export const OS = {
  openApp,
  openFile,
  openWith,
  openDiskFile,

  notify: (options: NotifyOptions & { appId?: string }) =>
    notifications.push(options.appId ?? 'system', options),

  filesystem: {
    read: (target: string) => vfs.readFile(target),
    readText: (target: string) => vfs.readText(vfs.requireNode(target).id),
    write: (target: string, data: FileData, mime?: string) =>
      vfs.writeFile(target, data, { mime, recursive: true }),
    list: (target: string) => vfs.list(target),
    exists: (target: string) => vfs.exists(target),
    mkdir: (target: string) => vfs.mkdirp(target),
    remove: (target: string) => vfs.moveToTrash(vfs.requireNode(target).id),
    stat: (target: string) => vfs.nodeAt(target) ?? null,
    pathOf: (id: string) => vfs.pathOf(id),
    node: (id: string) => vfs.getNode(id) ?? null,
    search: (query: string, options?: { limit?: number; root?: string }) =>
      vfs.search(query, options),
    root: ROOT_ID,
    path,
  },

  settings: {
    get: <K extends keyof Settings>(key: K): Settings[K] => getSettings()[key],
    set: <K extends keyof Settings>(key: K, value: Settings[K]) =>
      useSettingsStore.getState().set(key, value),
    all: getSettings,
    profile: getProfile,
  },

  window: {
    create: (options: OpenWindowOptions) => useWindowStore.getState().open(options),
    close: (id: string) => useWindowStore.getState().close(id),
    focus: (id: string) => useWindowStore.getState().focus(id),
    setTitle: (id: string, title: string) => useWindowStore.getState().setTitle(id, title),
    setCloseGuard: (id: string, guard: boolean) =>
      useWindowStore.getState().setCloseGuard(id, guard),
    list: () => useWindowStore.getState().windows,
  },

  permissions: {
    request: permissions.request,
    check: permissions.check,
  },

  clipboard,

  shell,
} as const;

/* --------------------------------------------------------------------- *
 * Per-application scoped API
 * --------------------------------------------------------------------- */

export interface AppAPI {
  readonly appId: string;
  readonly windowId: string;

  openApp: (appId: string, options?: LaunchOptions) => string | null;
  openFile: (target: string | FSNode) => string | null;

  notify: (options: NotifyOptions) => Promise<string | null>;

  /** All filesystem access is gated on the `filesystem` permission. */
  fs: {
    read: (target: string) => Promise<FileData>;
    readText: (target: string) => Promise<string>;
    write: (target: string, data: FileData, mime?: string) => Promise<FSNode>;
    list: (target: string) => Promise<FSNode[]>;
    mkdir: (target: string) => Promise<FSNode>;
    remove: (target: string) => Promise<void>;
    stat: (target: string) => Promise<FSNode | null>;
    search: (query: string, options?: { limit?: number; root?: string }) => Promise<FSNode[]>;
  };

  /** Private, namespaced key/value storage for this application. */
  storage: {
    get: <T>(key: string, fallback?: T) => Promise<T | undefined>;
    set: <T>(key: string, value: T) => Promise<void>;
    remove: (key: string) => Promise<void>;
    keys: () => Promise<string[]>;
    clear: () => Promise<void>;
  };

  clipboard: {
    writeText: (text: string) => Promise<boolean>;
    readText: () => Promise<string>;
  };

  settings: {
    get: <K extends keyof Settings>(key: K) => Settings[K];
    set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  };

  window: {
    setTitle: (title: string) => void;
    close: () => void;
    setCloseGuard: (guard: boolean) => void;
  };

  requestPermission: (permission: Permission, reason?: string) => Promise<boolean>;
  hasPermission: (permission: Permission) => boolean;
}

export function createAppAPI(appId: string, windowId: string): AppAPI {
  const namespace = appNamespace(appId);

  const require = async (permission: Permission, reason?: string) => {
    const granted = await permissions.request(appId, permission, reason);
    if (!granted) throw new PermissionDeniedError(appId, permission);
  };

  return {
    appId,
    windowId,

    openApp,
    openFile,

    notify: async (options) => {
      const granted = await permissions.request(
        appId,
        'notifications',
        'Show you notifications from this app.',
      );
      if (!granted) return null;
      return notifications.push(appId, options);
    },

    fs: {
      read: async (target) => {
        await require('filesystem', 'Read files you open in this app.');
        return vfs.readFile(target);
      },
      readText: async (target) => {
        await require('filesystem', 'Read files you open in this app.');
        return vfs.readText(vfs.requireNode(target).id);
      },
      write: async (target, data, mime) => {
        await require('filesystem', 'Save files to your Palm OS filesystem.');
        return vfs.writeFile(target, data, { mime, recursive: true });
      },
      list: async (target) => {
        await require('filesystem', 'Browse folders in your Palm OS filesystem.');
        return vfs.list(target);
      },
      mkdir: async (target) => {
        await require('filesystem', 'Create folders in your Palm OS filesystem.');
        return vfs.mkdirp(target);
      },
      remove: async (target) => {
        await require('filesystem', 'Move files to the Trash.');
        return vfs.moveToTrash(vfs.requireNode(target).id);
      },
      stat: async (target) => {
        await require('filesystem', 'Inspect files in your Palm OS filesystem.');
        return vfs.nodeAt(target) ?? null;
      },
      search: async (query, options) => {
        await require('filesystem', 'Search your Palm OS filesystem.');
        return vfs.search(query, options);
      },
    },

    storage: {
      get: async <T,>(key: string, fallback?: T) => {
        const value = await kv.get<T>(namespace, key);
        return value === undefined ? fallback : value;
      },
      set: (key, value) => kv.set(namespace, key, value),
      remove: (key) => kv.remove(namespace, key),
      keys: () => kv.keys(namespace),
      clear: () => kv.clearNamespace(namespace),
    },

    clipboard: {
      writeText: async (text) => {
        await require('clipboard', 'Copy text to your clipboard.');
        return clipboard.writeText(text);
      },
      readText: async () => {
        await require('clipboard', 'Paste text from your clipboard.');
        return clipboard.readText();
      },
    },

    settings: {
      get: (key) => getSettings()[key],
      set: (key, value) => useSettingsStore.getState().set(key, value),
    },

    window: {
      setTitle: (title) => useWindowStore.getState().setTitle(windowId, title),
      close: () => useWindowStore.getState().close(windowId),
      setCloseGuard: (guard) => useWindowStore.getState().setCloseGuard(windowId, guard),
    },

    requestPermission: (permission, reason) => permissions.request(appId, permission, reason),
    hasPermission: (permission) => permissions.check(appId, permission) === 'granted',
  };
}

export { vfs, FSError, useClipboardStore };
export type { FSNode };
