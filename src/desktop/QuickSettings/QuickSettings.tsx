import { useRef } from 'react';
import { Icon } from '../../components/icons';
import { Slider } from '../../components/ui/Slider';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { effectiveTheme } from '../../core/settings/apply';
import { useShellStore } from '../../core/shell/store';
import { playSound } from '../../core/sound';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useBattery, useFullscreen, useNetwork } from '../../hooks/useSystem';
import { cn } from '../../utils/cn';
import { formatDuration } from '../../utils/format';
import { panelAnchor, useTaskbarThickness } from '../panel-anchor';

export function QuickSettings() {
  const panelRef = useRef<HTMLDivElement>(null);
  const closePanel = useShellStore((s) => s.closePanel);

  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.set);

  const network = useNetwork();
  const battery = useBattery();
  const { isFullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } = useFullscreen();

  const taskbarThickness = useTaskbarThickness();

  useClickOutside(panelRef, closePanel);

  const isDark = effectiveTheme() === 'dark';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Quick settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closePanel();
      }}
      className={cn(
        'anim-pop os-glass-strong absolute z-[600] w-[min(340px,calc(100vw-1.5rem))]',
        'overflow-hidden rounded-xl shadow-[var(--shadow-panel)]',
      )}
      style={panelAnchor(settings.taskbarPosition, 'tray', taskbarThickness)}
    >
      {/* ------------------------------- Tiles -------------------------------- */}
      <div className="grid grid-cols-2 gap-2 p-3">
        <Tile
          icon={isDark ? 'MoonStar' : 'Sun'}
          label={isDark ? 'Dark mode' : 'Light mode'}
          sublabel={settings.theme === 'system' ? 'Following system' : 'Manual'}
          active={isDark}
          onClick={() => {
            setSetting('theme', isDark ? 'light' : 'dark');
            playSound('click');
          }}
        />
        <Tile
          icon={network.online ? 'Wifi' : 'WifiOff'}
          label={network.online ? 'Connected' : 'Offline'}
          sublabel={network.effectiveType ? network.effectiveType.toUpperCase() : 'Network'}
          active={network.online}
          onClick={() => {
            closePanel();
            OS.openApp('settings', { params: { section: 'network' } });
          }}
        />
        <Tile
          icon={settings.doNotDisturb ? 'BellOff' : 'Bell'}
          label="Do not disturb"
          sublabel={settings.doNotDisturb ? 'On' : 'Off'}
          active={settings.doNotDisturb}
          onClick={() => setSetting('doNotDisturb', !settings.doNotDisturb)}
        />
        <Tile
          icon={isFullscreen ? 'Minimize2' : 'Maximize2'}
          label="Fullscreen"
          sublabel={fullscreenSupported ? (isFullscreen ? 'On' : 'Off') : 'Unavailable'}
          active={isFullscreen}
          disabled={!fullscreenSupported}
          onClick={toggleFullscreen}
        />
        <Tile
          icon="Contrast"
          label="High contrast"
          sublabel={settings.highContrast ? 'On' : 'Off'}
          active={settings.highContrast}
          onClick={() => setSetting('highContrast', !settings.highContrast)}
        />
        <Tile
          icon="Sparkles"
          label="Reduce motion"
          sublabel={settings.motion === 'reduced' ? 'On' : settings.motion === 'full' ? 'Off' : 'System'}
          active={settings.motion === 'reduced'}
          onClick={() => setSetting('motion', settings.motion === 'reduced' ? 'system' : 'reduced')}
        />
      </div>

      {/* ------------------------------ Sliders ------------------------------- */}
      <div className="flex flex-col gap-3.5 border-t border-edge/8 px-3.5 py-3">
        <Slider
          label="Volume"
          value={settings.muted ? 0 : settings.volume}
          valueLabel={settings.muted ? 'Muted' : `${settings.volume}%`}
          onChange={(value) => {
            setSetting('volume', value);
            if (value > 0 && settings.muted) setSetting('muted', false);
          }}
          icon={
            <button
              type="button"
              onClick={() => setSetting('muted', !settings.muted)}
              aria-label={settings.muted ? 'Unmute' : 'Mute'}
              className="shrink-0 rounded-md p-1 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Icon
                name={settings.muted || settings.volume === 0 ? 'VolumeX' : settings.volume < 50 ? 'Volume1' : 'Volume2'}
                size={15}
              />
            </button>
          }
        />
        <Slider
          label="Interface scale"
          min={0.8}
          max={1.4}
          step={0.05}
          value={settings.uiScale}
          valueLabel={`${Math.round(settings.uiScale * 100)}%`}
          onChange={(value) => setSetting('uiScale', value)}
          icon={<Icon name="Type" size={15} className="shrink-0 text-ink-2" />}
        />
      </div>

      {/* ------------------------------- Status ------------------------------- */}
      <div className="border-t border-edge/8 px-3.5 py-2.5 text-[11.5px] text-ink-3">
        {battery.supported ? (
          <span className="flex items-center gap-1.5">
            <Icon name={battery.charging ? 'BatteryCharging' : 'Battery'} size={13} />
            {Math.round((battery.level ?? 0) * 100)}%
            {battery.charging
              ? battery.chargingTime
                ? ` · full in ${formatDuration(battery.chargingTime)}`
                : ' · charging'
              : battery.dischargingTime
                ? ` · ${formatDuration(battery.dischargingTime)} remaining`
                : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Icon name="Battery" size={13} />
            Battery status is not exposed by this browser.
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-edge/8 bg-surface-2/40 px-2 py-2">
        <FooterAction
          icon="Contrast"
          label="Accessibility"
          onClick={() => {
            closePanel();
            OS.openApp('settings', { params: { section: 'accessibility' } });
          }}
        />
        <FooterAction
          icon="Bell"
          label="Notifications"
          onClick={() => useShellStore.getState().openPanel('notifications')}
        />
        <FooterAction
          icon="Settings"
          label="All settings"
          onClick={() => {
            closePanel();
            OS.openApp('settings');
          }}
        />
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  sublabel,
  active,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  sublabel: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150',
        'disabled:opacity-40 disabled:pointer-events-none',
        active
          ? 'border-accent/40 bg-accent-soft text-accent-ink'
          : 'border-edge/10 bg-surface-2/60 text-ink-2 hover:bg-surface-3',
      )}
    >
      <Icon name={icon} size={16} />
      <span className="min-w-0">
        <span className={cn('block truncate text-[12px] font-medium', active ? 'text-accent-ink' : 'text-ink')}>
          {label}
        </span>
        <span className="block truncate text-[10.5px] text-ink-3">{sublabel}</span>
      </span>
    </button>
  );
}

function FooterAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
