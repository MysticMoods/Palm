/**
 * Per-application permission grants.
 *
 * Applications never receive capabilities implicitly: `request()` either
 * returns a remembered decision or queues a dialog for the user. The queue is
 * rendered by `desktop/PermissionDialog`.
 */

import { create } from 'zustand';
import { uid } from '../../utils/misc';
import { getApp } from '../app-manager/registry';
import { NS, attachPersistence } from '../storage/persist';
import { PERMISSIONS } from './types';
import type { Permission, PermissionDecision, PermissionRequest } from './types';

type Grants = Record<string, Partial<Record<Permission, PermissionDecision>>>;

interface PermissionState {
  grants: Grants;
  queue: PermissionRequest[];

  decision: (appId: string, permission: Permission) => PermissionDecision;
  set: (appId: string, permission: Permission, decision: PermissionDecision) => void;
  revokeAll: (appId: string) => void;
  request: (appId: string, permission: Permission, reason?: string) => Promise<boolean>;
  resolveTop: (granted: boolean, remember: boolean) => void;
  clear: () => void;
}

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  grants: {},
  queue: [],

  decision: (appId, permission) => {
    if (PERMISSIONS[permission]?.implicit) return 'granted';
    return get().grants[appId]?.[permission] ?? 'prompt';
  },

  set: (appId, permission, decision) =>
    set((state) => ({
      grants: {
        ...state.grants,
        [appId]: { ...state.grants[appId], [permission]: decision },
      },
    })),

  revokeAll: (appId) =>
    set((state) => {
      const next = { ...state.grants };
      delete next[appId];
      return { grants: next };
    }),

  request: (appId, permission, reason) => {
    const existing = get().decision(appId, permission);
    if (existing === 'granted') return Promise.resolve(true);
    if (existing === 'denied') return Promise.resolve(false);

    const app = getApp(appId);
    // Requesting something the manifest never declared is a programming error.
    if (app && !app.permissions.includes(permission)) {
      console.warn(
        `[palm/permissions] "${appId}" requested "${permission}" which is not in its manifest.`,
      );
    }

    // Collapse duplicate in-flight requests for the same capability.
    const pending = get().queue.find((r) => r.appId === appId && r.permission === permission);
    if (pending) {
      return new Promise<boolean>((resolve) => {
        const original = pending.resolve;
        pending.resolve = (granted) => {
          original(granted);
          resolve(granted);
        };
      });
    }

    return new Promise<boolean>((resolve) => {
      const request: PermissionRequest = {
        id: uid('perm'),
        appId,
        appName: app?.name ?? appId,
        appIcon: app?.icon ?? 'AppWindow',
        appColor: app?.color ?? '#5884ff',
        permission,
        reason,
        resolve,
      };
      set((state) => ({ queue: [...state.queue, request] }));
    });
  },

  resolveTop: (granted, remember) => {
    const [request, ...rest] = get().queue;
    if (!request) return;
    set({ queue: rest });
    if (remember) {
      get().set(request.appId, request.permission, granted ? 'granted' : 'denied');
    }
    request.resolve(granted);
  },

  clear: () => {
    for (const request of get().queue) request.resolve(false);
    set({ grants: {}, queue: [] });
  },
}));

export const permissions = {
  request: (appId: string, permission: Permission, reason?: string) =>
    usePermissionStore.getState().request(appId, permission, reason),
  check: (appId: string, permission: Permission) =>
    usePermissionStore.getState().decision(appId, permission),
};

export async function hydratePermissions(): Promise<void> {
  await attachPersistence(usePermissionStore, {
    namespace: NS.permissions,
    key: 'grants',
    pick: (state) => state.grants,
    merge: (grants) => usePermissionStore.setState({ grants: grants ?? {} }),
  });
}

export type { Permission, PermissionDecision };
