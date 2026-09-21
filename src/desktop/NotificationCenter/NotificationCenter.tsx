import { useRef } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Toggle } from '../../components/ui/Toggle';
import { useNotificationStore } from '../../core/notifications/store';
import type { OSNotification } from '../../core/notifications/store';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../utils/cn';
import { formatRelative } from '../../utils/format';
import { panelAnchor, useTaskbarThickness } from '../panel-anchor';

export function NotificationCenter() {
  const panelRef = useRef<HTMLDivElement>(null);
  const closePanel = useShellStore((s) => s.closePanel);
  const position = useSettingsStore((s) => s.settings.taskbarPosition);
  const doNotDisturb = useSettingsStore((s) => s.settings.doNotDisturb);
  const setSetting = useSettingsStore((s) => s.set);

  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);

  const taskbarThickness = useTaskbarThickness();

  useClickOutside(panelRef, closePanel);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notification centre"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closePanel();
      }}
      className={cn(
        'anim-pop os-glass-strong absolute z-[600] flex w-[min(390px,calc(100vw-1.5rem))] flex-col',
        'overflow-hidden rounded-xl shadow-[var(--shadow-panel)]',
        'max-h-[min(620px,calc(100vh-5rem))]',
      )}
      style={panelAnchor(position, 'tray', taskbarThickness)}
    >
      <header className="flex items-center justify-between gap-2 border-b border-edge/8 px-3.5 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Notifications</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={markAllRead}
            disabled={items.every((n) => n.read)}
            className="rounded-md px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={items.length === 0}
            className="rounded-md px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40"
          >
            Wipe  Out
          </button>
        </div>
      </header>

      <div className="border-b border-edge/8 px-3.5 py-2">
        <Toggle
          checked={doNotDisturb}
          onChange={(value) => setSetting('doNotDisturb', value)}
          label="Do not disturb"
          description="New notifications are recorded but not shown on screen."
        />
      </div>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <EmptyState
            compact
            icon="Bell"
            title="No notifications"
            description="Alerts from your applications will collect here."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationCard notification={item} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-edge/8 bg-surface-2/40 px-3 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          icon="Settings"
          fullWidth
          onClick={() => {
            closePanel();
            OS.openApp('settings', { params: { section: 'notifications' } });
          }}
        >
          Notification settings
        </Button>
      </footer>
    </div>
  );
}

function NotificationCard({ notification }: { notification: OSNotification }) {
  const remove = useNotificationStore((s) => s.remove);
  const markRead = useNotificationStore((s) => s.markRead);
  const runAction = useNotificationStore((s) => s.runAction);

  return (
    <article
      className={cn(
        'group relative rounded-lg border p-2.5 transition-colors',
        notification.read ? 'border-edge/8 bg-surface-2/40' : 'border-accent/25 bg-surface-2/80',
      )}
      onPointerEnter={() => {
        if (!notification.read) markRead(notification.id);
      }}
    >
      <div className="flex gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${notification.appColor}26`, color: notification.appColor }}
        >
          <Icon name={notification.appIcon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[11px] font-medium text-ink-3">{notification.appName}</span>
            <span className="shrink-0 text-[10.5px] text-ink-3">·</span>
            <time className="shrink-0 text-[10.5px] text-ink-3" dateTime={new Date(notification.timestamp).toISOString()}>
              {formatRelative(notification.timestamp)}
            </time>
            {!notification.read ? (
              <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-px text-[9px] font-bold uppercase text-accent-fg">
                New
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 break-words text-[13px] font-medium leading-snug text-ink">
            {notification.title}
          </p>
          {notification.body ? (
            <p className="mt-0.5 break-words text-[12px] leading-snug text-ink-2">{notification.body}</p>
          ) : null}

          {notification.actions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {notification.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runAction(notification.id, action.id)}
                  className="rounded-md border border-edge/12 bg-surface px-2 py-1 text-[11.5px] font-medium text-ink transition-colors hover:bg-surface-3"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => remove(notification.id)}
          aria-label={`Dismiss "${notification.title}"`}
          className="h-6 w-6 shrink-0 rounded-md text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="X" size={13} className="mx-auto" />
        </button>
      </div>
    </article>
  );
}
