import { memo } from 'react';
import { Icon } from '../../components/icons';
import { Tooltip } from '../../components/ui/Tooltip';
import { useUnreadCount } from '../../core/notifications/store';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import { useBattery, useNetwork } from '../../hooks/useSystem';
import { useClock } from '../../hooks/useClock';
import { formatTime } from '../../utils/format';
import { cn } from '../../utils/cn';

function trayButton(active: boolean) {
  return cn(
    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-ink-2',
    'transition-colors duration-150 hover:bg-white/10 hover:text-ink',
    active && 'bg-white/14 text-ink',
  );
}

export const SystemTray = memo(function SystemTray({ vertical = false }: { vertical?: boolean }) {
  const panel = useShellStore((s) => s.panel);
  const togglePanel = useShellStore((s) => s.togglePanel);

  const settings = useSettingsStore((s) => s.settings);
  const network = useNetwork();
  const battery = useBattery();
  const unread = useUnreadCount();
  const now = useClock(settings.showClockSeconds);

  const volumeIcon = settings.muted || settings.volume === 0 ? 'VolumeX' : settings.volume < 50 ? 'Volume1' : 'Volume2';
  const volumeLabel = settings.muted ? 'Muted' : `Volume ${settings.volume}%`;

  const batteryIcon = !battery.supported
    ? 'Battery'
    : battery.charging
      ? 'BatteryCharging'
      : (battery.level ?? 1) <= 0.2
        ? 'BatteryLow'
        : 'Battery';
  const batteryLabel = battery.supported
    ? `Battery ${Math.round((battery.level ?? 0) * 100)}%${battery.charging ? ', charging' : ''}`
    : 'Battery status unavailable in this browser';

  return (
    <div
      className={cn('flex items-center gap-0.5', vertical && 'flex-col')}
      role="group"
      aria-label="System tray"
    >
      <Tooltip content="Notifications" side={vertical ? 'right' : 'top'}>
        <button
          type="button"
          onClick={() => togglePanel('notifications')}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          aria-expanded={panel === 'notifications'}
          className={cn(trayButton(panel === 'notifications'), 'relative')}
        >
          <Icon name={settings.doNotDisturb ? 'BellOff' : unread > 0 ? 'BellRing' : 'Bell'} size={15} />
          {unread > 0 ? (
            <span className="absolute right-1 top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold leading-none text-accent-fg">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </Tooltip>

      <Tooltip
        content={
          <span className="flex flex-col gap-0.5">
            <span>{volumeLabel}</span>
            <span>{network.online ? 'Connected' : 'Offline'}</span>
            <span>{batteryLabel}</span>
          </span>
        }
        side={vertical ? 'right' : 'top'}
      >
        <button
          type="button"
          onClick={() => togglePanel('quick-settings')}
          aria-label={`Quick settings — ${volumeLabel}, ${network.online ? 'connected' : 'offline'}, ${batteryLabel}`}
          aria-expanded={panel === 'quick-settings'}
          className={cn(trayButton(panel === 'quick-settings'), vertical && 'flex-col gap-1')}
        >
          <Icon name={network.online ? 'Wifi' : 'WifiOff'} size={15} />
          <Icon name={volumeIcon} size={15} />
          <span className="flex items-center gap-0.5">
            <Icon name={batteryIcon} size={15} className={battery.supported ? undefined : 'opacity-45'} />
            {battery.supported && battery.level !== null ? (
              <span className="text-[10.5px] tabular-nums">{Math.round(battery.level * 100)}</span>
            ) : null}
          </span>
        </button>
      </Tooltip>

      <Tooltip content={now.toLocaleDateString(undefined, { dateStyle: 'full' })} side={vertical ? 'right' : 'top'}>
        <button
          type="button"
          onClick={() => togglePanel('calendar')}
          aria-label={`Clock and calendar — ${formatTime(now, { hour24: settings.use24HourClock })}`}
          aria-expanded={panel === 'calendar'}
          className={cn(
            trayButton(panel === 'calendar'),
            'text-[11.5px] leading-tight tabular-nums',
            vertical ? 'flex-col px-1' : 'flex-col items-end gap-0 px-2.5',
          )}
        >
          <span className="font-medium text-ink">
            {formatTime(now, { seconds: settings.showClockSeconds, hour24: settings.use24HourClock })}
          </span>
          {!vertical ? (
            <span className="text-[10.5px] text-ink-3">
              {now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          ) : null}
        </button>
      </Tooltip>
    </div>
  );
});
