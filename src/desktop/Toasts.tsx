import { useEffect } from 'react';
import { Icon } from '../components/icons';
import { useNotificationStore } from '../core/notifications/store';
import type { OSNotification } from '../core/notifications/store';
import { useSettingsStore } from '../core/settings/store';
import { playSound } from '../core/sound';
import { cn } from '../utils/cn';
import { useTaskbarThickness } from './panel-anchor';

/** Transient on-screen notifications, stacked away from the taskbar. */
export function Toasts() {
  const toastIds = useNotificationStore((s) => s.toasts);
  const items = useNotificationStore((s) => s.items);
  const position = useSettingsStore((s) => s.settings.taskbarPosition);
  const taskbarThickness = useTaskbarThickness();

  const toasts = toastIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is OSNotification => Boolean(item));

  const offset = taskbarThickness + 12;
  const style =
    position === 'top'
      ? { top: offset, right: 12 }
      : position === 'left'
        ? { bottom: 12, left: offset }
        : position === 'right'
          ? { bottom: 12, right: offset }
          : { bottom: offset, right: 12 };

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none absolute z-[700] flex w-[min(340px,calc(100vw-1.5rem))] flex-col gap-2"
      style={style}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} notification={toast} />
      ))}
    </div>
  );
}

function Toast({ notification }: { notification: OSNotification }) {
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const markRead = useNotificationStore((s) => s.markRead);
  const runAction = useNotificationStore((s) => s.runAction);

  useEffect(() => {
    playSound(notification.urgency === 'critical' ? 'error' : 'notify');
    // Sound plays once per toast; `id` is the identity of a toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification.id]);

  useEffect(() => {
    if (notification.timeout <= 0) return;
    const timer = setTimeout(() => dismiss(notification.id), notification.timeout);
    return () => clearTimeout(timer);
  }, [dismiss, notification.id, notification.timeout]);

  return (
    <article
      className={cn(
        'anim-slide-right os-glass-strong pointer-events-auto overflow-hidden rounded-xl p-3',
        'shadow-[var(--shadow-panel)]',
        notification.urgency === 'critical' && 'border-danger/40',
      )}
      onPointerEnter={() => markRead(notification.id)}
    >
      <div className="flex gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${notification.appColor}26`, color: notification.appColor }}
        >
          <Icon name={notification.appIcon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-ink-3">{notification.appName}</p>
          <p className="mt-0.5 break-words text-[13px] font-medium leading-snug text-ink">
            {notification.title}
          </p>
          {notification.body ? (
            <p className="mt-0.5 line-clamp-3 break-words text-[12px] leading-snug text-ink-2">
              {notification.body}
            </p>
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
          onClick={() => dismiss(notification.id)}
          aria-label={`Dismiss "${notification.title}"`}
          className="h-6 w-6 shrink-0 rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <Icon name="X" size={13} className="mx-auto" />
        </button>
      </div>
    </article>
  );
}
