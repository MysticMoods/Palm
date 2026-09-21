/**
 * Notification centre.
 *
 * `push()` adds to the persistent history and (unless Do Not Disturb is on)
 * raises a transient toast. Action callbacks live in a side map rather than in
 * the persisted record, because functions cannot be serialised — a restored
 * notification keeps its buttons' labels but loses their behaviour, so we drop
 * the buttons on rehydration instead of showing dead controls.
 */

import { create } from 'zustand';
import { uid } from '../../utils/misc';
import { getApp } from '../app-manager/registry';
import { getSettings } from '../settings/store';
import { NS, attachPersistence } from '../storage/persist';

export type NotificationUrgency = 'low' | 'normal' | 'critical';

export interface NotificationAction {
  id: string;
  label: string;
}

export interface OSNotification {
  id: string;
  appId: string;
  appName: string;
  appIcon: string;
  appColor: string;
  title: string;
  body?: string;
  timestamp: number;
  read: boolean;
  urgency: NotificationUrgency;
  actions: NotificationAction[];
  /** Toasts auto-dismiss after this many ms; 0 means "stay until dismissed". */
  timeout: number;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  urgency?: NotificationUrgency;
  actions?: Array<NotificationAction & { onClick?: () => void }>;
  timeout?: number;
  /** Replace an earlier notification with the same tag from the same app. */
  tag?: string;
}

const MAX_HISTORY = 200;

/** Action handlers, keyed `notificationId:actionId`. Not persisted. */
const handlers = new Map<string, () => void>();
/** Tag → notification id, so an app can update in place. */
const tags = new Map<string, string>();

interface NotificationState {
  items: OSNotification[];
  toasts: string[];
  push: (appId: string, options: NotifyOptions) => string;
  dismissToast: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
  runAction: (notificationId: string, actionId: string) => void;
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  items: [],
  toasts: [],

  push: (appId, options) => {
    const settings = getSettings();
    const app = getApp(appId);
    const allowedForApp = settings.appNotifications[appId] !== false;

    const tagKey = options.tag ? `${appId}:${options.tag}` : null;
    const existingId = tagKey ? tags.get(tagKey) : undefined;
    const id = existingId ?? uid('note');

    const notification: OSNotification = {
      id,
      appId,
      appName: app?.name ?? appId,
      appIcon: app?.icon ?? 'Bell',
      appColor: app?.color ?? '#5884ff',
      title: options.title,
      body: options.body,
      timestamp: Date.now(),
      read: false,
      urgency: options.urgency ?? 'normal',
      actions: (options.actions ?? []).map(({ id: actionId, label }) => ({ id: actionId, label })),
      timeout: options.timeout ?? (options.urgency === 'critical' ? 0 : 5200),
    };

    for (const action of options.actions ?? []) {
      if (action.onClick) handlers.set(`${id}:${action.id}`, action.onClick);
    }
    if (tagKey) tags.set(tagKey, id);

    // Notifications are always recorded in history; only the toast is gated,
    // so muting an app never silently loses information.
    const showToast = settings.notificationsEnabled && !settings.doNotDisturb && allowedForApp;

    set((state) => {
      const items = [notification, ...state.items.filter((n) => n.id !== id)].slice(0, MAX_HISTORY);
      const toasts = showToast ? [id, ...state.toasts.filter((t) => t !== id)].slice(0, 4) : state.toasts;
      return { items, toasts };
    });

    return id;
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t !== id) })),

  markRead: (id) =>
    set((state) => ({
      items: state.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),

  markAllRead: () =>
    set((state) => ({ items: state.items.map((n) => (n.read ? n : { ...n, read: true })) })),

  remove: (id) =>
    set((state) => ({
      items: state.items.filter((n) => n.id !== id),
      toasts: state.toasts.filter((t) => t !== id),
    })),

  clearAll: () => {
    handlers.clear();
    tags.clear();
    set({ items: [], toasts: [] });
  },

  runAction: (notificationId, actionId) => {
    const handler = handlers.get(`${notificationId}:${actionId}`);
    if (handler) {
      try {
        handler();
      } catch (err) {
        console.error('[palm/notifications] action handler failed', err);
      }
    }
    get().markRead(notificationId);
    get().dismissToast(notificationId);
  },

  unreadCount: () => get().items.reduce((count, n) => count + (n.read ? 0 : 1), 0),
}));

export const useUnreadCount = () =>
  useNotificationStore((s) => s.items.reduce((count, n) => count + (n.read ? 0 : 1), 0));

/** Non-React entry point used by the OS API. */
export const notifications = {
  push: (appId: string, options: NotifyOptions) =>
    useNotificationStore.getState().push(appId, options),
  remove: (id: string) => useNotificationStore.getState().remove(id),
};

export async function hydrateNotifications(): Promise<void> {
  await attachPersistence(useNotificationStore, {
    namespace: NS.notifications,
    key: 'history',
    pick: (state) => state.items.slice(0, 60),
    merge: (items) => {
      if (!Array.isArray(items)) return;
      useNotificationStore.setState({
        // Drop action buttons: their handlers did not survive the reload.
        items: items.map((n) => ({ ...n, actions: [] })),
        toasts: [],
      });
    },
    debounceMs: 800,
  });
}
