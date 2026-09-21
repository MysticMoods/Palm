/**
 * The smaller Settings panes: display, sound, network, notifications,
 * accessibility and the local account.
 */

import { useEffect, useState } from 'react';
import { Icon } from '../../../components/icons';
import { Button } from '../../../components/ui/Button';
import { Segmented, TextField } from '../../../components/ui/Field';
import { Badge, Notice } from '../../../components/ui/Feedback';
import { Slider } from '../../../components/ui/Slider';
import { Toggle } from '../../../components/ui/Toggle';
import { listShortcuts } from '../../../core/keyboard/manager';
import { formatShortcut } from '../../../core/keyboard/shortcuts';
import { launchableApps } from '../../../core/app-manager/registry';
import { useNotificationStore } from '../../../core/notifications/store';
import { playSound } from '../../../core/sound';
import { useSettingsStore } from '../../../core/settings/store';
import { useBattery, useFullscreen, useNetwork, useViewport } from '../../../hooks/useSystem';
import { AVATARS } from '../../../desktop/Welcome/avatars';
import { formatDuration } from '../../../utils/format';
import { InfoList, Row, Section } from '../Layout';

/* --------------------------------- Display -------------------------------- */

export function DisplaySection() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);
  const viewport = useViewport();
  const { isFullscreen, toggle, supported } = useFullscreen();

  return (
    <>
      <Section title="Screen" description="What the browser reports about your display.">
        <InfoList
          rows={[
            ['Screen resolution', `${window.screen.width} × ${window.screen.height}`],
            [
              'Available screen area',
              `${window.screen.availWidth} × ${window.screen.availHeight}`,
            ],
            ['Browser viewport', `${viewport.width} × ${viewport.height}`],
            ['Device pixel ratio', `${window.devicePixelRatio}×`],
            ['Colour depth', `${window.screen.colorDepth}-bit`],
            [
              'Orientation',
              window.screen.orientation?.type ?? (viewport.width > viewport.height ? 'landscape' : 'portrait'),
            ],
          ]}
        />
      </Section>

      <Section title="Scaling" description="Make everything in Palm OS larger or smaller.">
        <Row stacked>
          <Slider
            label="Interface scale"
            min={0.8}
            max={1.4}
            step={0.05}
            value={settings.uiScale}
            valueLabel={`${Math.round(settings.uiScale * 100)}%`}
            onChange={(value) => set('uiScale', value)}
          />
        </Row>
        <Row
          label="Reset scaling"
          control={
            <Button size="sm" variant="ghost" onClick={() => set('uiScale', 1)}>
              Set to 100%
            </Button>
          }
        />
      </Section>

      <Section title="Fullscreen">
        <Row
          label="Fullscreen mode"
          description={
            supported
              ? 'Hide the browser chrome so Palm OS fills the screen.'
              : 'Your browser does not allow this page to enter fullscreen.'
          }
          control={
            <Button
              size="sm"
              variant={isFullscreen ? 'secondary' : 'primary'}
              icon={isFullscreen ? 'Minimize2' : 'Maximize2'}
              disabled={!supported}
              onClick={toggle}
            >
              {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            </Button>
          }
        />
      </Section>

      <Notice tone="neutral" icon="Info" title="Why resolution cannot be changed">
        A web page cannot change your monitor's resolution — only your operating system can. Interface
        scaling is the browser-side equivalent, and it affects every part of Palm OS.
      </Notice>
    </>
  );
}

/* ---------------------------------- Sound --------------------------------- */

export function SoundSection() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);

  return (
    <>
      <Section title="Output" description="Volume applies to Palm OS interface sounds and the media player.">
        <Row stacked>
          <Slider
            label="Volume"
            value={settings.muted ? 0 : settings.volume}
            valueLabel={settings.muted ? 'Muted' : `${settings.volume}%`}
            onChange={(value) => {
              set('volume', value);
              if (value > 0 && settings.muted) set('muted', false);
            }}
            icon={
              <Icon
                name={settings.muted || settings.volume === 0 ? 'VolumeX' : 'Volume2'}
                size={16}
                className="shrink-0 text-ink-2"
              />
            }
          />
        </Row>
        <Row
          label="Mute"
          control={
            <Toggle checked={settings.muted} onChange={(value) => set('muted', value)} label="Mute" hideLabel />
          }
        />
      </Section>

      <Section title="Interface sounds">
        <Row
          label="Play interface sounds"
          description="Short tones for notifications and confirmations, synthesised in the browser."
          control={
            <Toggle
              checked={settings.uiSounds}
              onChange={(value) => set('uiSounds', value)}
              label="Interface sounds"
              hideLabel
            />
          }
        />
        <Row
          label="Test sound"
          control={
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => playSound('click')}>
                Click
              </Button>
              <Button size="sm" variant="ghost" onClick={() => playSound('notify')}>
                Notify
              </Button>
              <Button size="sm" variant="ghost" onClick={() => playSound('error')}>
                Error
              </Button>
            </div>
          }
        />
      </Section>

      <Notice tone="neutral" icon="Info" title="Audio needs a click first">
        Browsers block audio until you interact with the page. If a test sound is silent, click
        anywhere and try again.
      </Notice>
    </>
  );
}

/* --------------------------------- Network -------------------------------- */

export function NetworkSection() {
  const network = useNetwork();
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const testConnection = async () => {
    setChecking(true);
    try {
      // A no-cors HEAD to a well-known endpoint: we cannot read the response,
      // but a resolved promise means the request actually left the machine.
      await fetch('https://www.google.com/generate_204', { mode: 'no-cors', cache: 'no-store' });
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Section title="Status">
        <Row
          label="Connection"
          description="Reported by the browser's network interface."
          control={
            <Badge tone={network.online ? 'ok' : 'danger'} icon={network.online ? 'Wifi' : 'WifiOff'}>
              {network.online ? 'Connected' : 'Offline'}
            </Badge>
          }
        />
        <Row
          label="Test reachability"
          description="Sends one request to check the internet is actually reachable."
          control={
            <div className="flex items-center gap-2">
              {reachable !== null ? (
                <Badge tone={reachable ? 'ok' : 'warn'}>{reachable ? 'Reachable' : 'No response'}</Badge>
              ) : null}
              <Button size="sm" variant="secondary" loading={checking} onClick={testConnection}>
                Test
              </Button>
            </div>
          }
        />
      </Section>

      <Section title="Connection details">
        <InfoList
          rows={[
            ['Effective type', network.effectiveType ? network.effectiveType.toUpperCase() : 'not reported'],
            ['Downlink estimate', network.downlink !== null ? `${network.downlink} Mbps` : 'not reported'],
            ['Round-trip time', network.rtt !== null ? `${network.rtt} ms` : 'not reported'],
            ['Data saver', network.saveData === null ? 'not reported' : network.saveData ? 'on' : 'off'],
          ]}
        />
      </Section>

      <Notice tone="neutral" icon="Info" title="What a browser can see">
        Web pages have no access to network interfaces, IP addresses, Wi-Fi names or signal strength.
        The Network Information API above is Chromium-only, which is why several rows may say “not
        reported”. Palm OS itself works entirely offline.
      </Notice>
    </>
  );
}

/* ------------------------------ Notifications ----------------------------- */

export function NotificationsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);
  const setAppNotifications = useSettingsStore((s) => s.setAppNotifications);
  const items = useNotificationStore((s) => s.items);
  const clearAll = useNotificationStore((s) => s.clearAll);

  return (
    <>
      <Section title="General">
        <Row
          label="Show notifications"
          description="Turn off to stop banners appearing on screen."
          control={
            <Toggle
              checked={settings.notificationsEnabled}
              onChange={(value) => set('notificationsEnabled', value)}
              label="Show notifications"
              hideLabel
            />
          }
        />
        <Row
          label="Do not disturb"
          description="Notifications are still recorded in the notification centre."
          control={
            <Toggle
              checked={settings.doNotDisturb}
              onChange={(value) => set('doNotDisturb', value)}
              label="Do not disturb"
              hideLabel
            />
          }
        />
        <Row
          label="Notification history"
          description={`${items.length} notifications stored.`}
          control={
            <Button size="sm" variant="ghost" icon="Trash2" disabled={items.length === 0} onClick={clearAll}>
              Clear history
            </Button>
          }
        />
      </Section>

      <Section title="By application" description="Turn banners off for individual applications.">
        {launchableApps().map((app) => (
          <Row
            key={app.id}
            label={app.name}
            description={app.description}
            control={
              <Toggle
                checked={settings.appNotifications[app.id] !== false}
                onChange={(value) => setAppNotifications(app.id, value)}
                label={`${app.name} notifications`}
                hideLabel
              />
            }
          />
        ))}
      </Section>
    </>
  );
}

/* ------------------------------ Accessibility ----------------------------- */

export function AccessibilitySection() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);
  const [shortcuts, setShortcuts] = useState<Array<{ shortcut: string; description: string }>>([]);

  useEffect(() => {
    setShortcuts(listShortcuts().map(({ shortcut, description }) => ({ shortcut, description })));
  }, []);

  return (
    <>
      <Section title="Vision">
        <Row stacked>
          <Slider
            label="Text size"
            min={0.85}
            max={1.5}
            step={0.05}
            value={settings.fontScale}
            valueLabel={`${Math.round(settings.fontScale * 100)}%`}
            onChange={(value) => set('fontScale', value)}
          />
        </Row>
        <Row
          label="High contrast"
          description="Stronger borders and maximum text contrast throughout the interface."
          control={
            <Toggle
              checked={settings.highContrast}
              onChange={(value) => set('highContrast', value)}
              label="High contrast"
              hideLabel
            />
          }
        />
        <Row
          label="Always show focus outlines"
          description="Keep the focus ring visible even when navigating with a mouse."
          control={
            <Toggle
              checked={settings.alwaysShowFocusRing}
              onChange={(value) => set('alwaysShowFocusRing', value)}
              label="Always show focus outlines"
              hideLabel
            />
          }
        />
      </Section>

      <Section title="Motion">
        <Row
          label="Animations"
          description="“System” follows your operating system's reduced-motion preference."
          control={
            <Segmented
              size="sm"
              label="Animations"
              value={settings.motion}
              onChange={(value) => set('motion', value)}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'system', label: 'System' },
                { value: 'reduced', label: 'Reduced' },
              ]}
            />
          }
        />
      </Section>

      <Section title="Interaction">
        <Row
          label="Confirm before moving to Trash"
          description="Ask every time instead of showing an undo notification."
          control={
            <Toggle
              checked={settings.confirmBeforeTrash}
              onChange={(value) => set('confirmBeforeTrash', value)}
              label="Confirm before moving to Trash"
              hideLabel
            />
          }
        />
        <Row
          label="Search shortcut"
          control={
            <Segmented
              size="sm"
              label="Search shortcut"
              value={settings.searchShortcut}
              onChange={(value) => set('searchShortcut', value)}
              options={[
                { value: 'Ctrl+Space', label: 'Ctrl + Space' },
                { value: 'Ctrl+K', label: 'Ctrl + K' },
                { value: 'Alt+Space', label: 'Alt + Space' },
              ]}
            />
          }
        />
      </Section>

      <Section title="Keyboard shortcuts" description="Every global shortcut Palm OS listens for.">
        <InfoList
          rows={shortcuts.map((entry) => [
            entry.description,
            <kbd key={entry.shortcut} className="rounded border border-edge/15 bg-surface-3 px-1.5 py-0.5 font-mono text-[11px]">
              {formatShortcut(entry.shortcut)}
            </kbd>,
          ])}
        />
      </Section>

      <Notice tone="neutral" icon="Keyboard" title="Navigating without a mouse">
        Tab moves between controls, arrow keys move within menus and lists, Enter activates, and
        Escape closes menus and dialogs. Every icon-only button has a text label for screen readers.
      </Notice>
    </>
  );
}

/* --------------------------------- Account -------------------------------- */

export function AccountSection() {
  const profile = useSettingsStore((s) => s.profile);
  const updateProfile = useSettingsStore((s) => s.updateProfile);
  const battery = useBattery();

  return (
    <>
      <Section title="Local profile" description="Palm OS has no accounts — this is stored on this device only.">
        <Row stacked>
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-2xl">
              {profile.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink">{profile.displayName}</p>
              <p className="truncate text-[12px] text-ink-3">@{profile.username}</p>
            </div>
          </div>
        </Row>

        <Row stacked>
          <div className="flex flex-wrap gap-2">
            <TextField
              label="Display name"
              value={profile.displayName}
              onChange={(event) => updateProfile({ displayName: event.target.value })}
              className="min-w-[180px] flex-1"
            />
            <TextField
              label="Username"
              value={profile.username}
              onChange={(event) =>
                updateProfile({ username: event.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() })
              }
              hint="Used by the terminal prompt."
              className="min-w-[180px] flex-1"
            />
          </div>
        </Row>

        <Row label="Avatar" stacked>
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.map((avatar) => (
              <button
                key={avatar}
                type="button"
                onClick={() => updateProfile({ avatar })}
                aria-label={`Use ${avatar} as your avatar`}
                aria-pressed={profile.avatar === avatar}
                className={
                  profile.avatar === avatar
                    ? 'flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-lg ring-2 ring-accent'
                    : 'flex h-9 w-9 items-center justify-center rounded-lg bg-surface-3 text-lg transition-transform hover:scale-110'
                }
              >
                {avatar}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Device">
        <InfoList
          rows={[
            ['Profile created', new Date(profile.createdAt).toLocaleDateString()],
            ['CPU threads', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'not exposed'],
            [
              'Battery',
              battery.supported
                ? `${Math.round((battery.level ?? 0) * 100)}%${battery.charging ? ' (charging)' : battery.dischargingTime ? ` — ${formatDuration(battery.dischargingTime)} left` : ''}`
                : 'not exposed by this browser',
            ],
          ]}
        />
      </Section>

      <Notice tone="neutral" icon="Shield" title="Sign-in is intentionally absent">
        Version 1 of Palm OS is entirely local: no server, no account, no password. The profile above
        uses the same shape a real identity provider would return, so authentication can be added
        later without changing anything that consumes it.
      </Notice>
    </>
  );
}
