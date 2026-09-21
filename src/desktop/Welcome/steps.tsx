/** The individual panes of the first-run tour. */

import { useState } from 'react';
import { Icon } from '../../components/icons';
import { PalmMark } from '../../components/PalmMark';
import { Segmented, TextField } from '../../components/ui/Field';
import { launchableApps } from '../../core/app-manager/registry';
import { formatShortcut } from '../../core/keyboard/shortcuts';
import {
  ACCENT_PRESETS,
  DEFAULT_PROFILE,
  OS_CODENAME,
  OS_NAME,
  OS_VERSION,
} from '../../core/settings/defaults';
import type { Settings, UserProfile, Wallpaper } from '../../core/settings/types';
import {
  COLOR_WALLPAPERS,
  GRADIENT_WALLPAPERS,
  IMAGE_WALLPAPERS,
  wallpaperPreviewStyle,
} from '../../core/settings/wallpapers';
import { cn } from '../../utils/cn';
import { AVATARS } from './avatars';

/* ------------------------------- 1. Hello -------------------------------- */

export function HelloStep() {
  return (
    <div className="anim-rise flex flex-col items-center text-center">
      <div style={{ ['--step' as string]: 0 }} className="relative mb-5">
        <span
          aria-hidden="true"
          className="anim-halo absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/30 blur-2xl"
        />
        <span className="anim-float relative flex h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-gradient-to-br from-accent to-accent/75 text-accent-fg shadow-[0_18px_44px_-12px_rgb(var(--os-accent)/0.85)]">
          <PalmMark size={54} animated />
        </span>
      </div>
      <h1
        style={{ ['--step' as string]: 1 }}
        className="text-[30px] font-semibold leading-tight tracking-tight text-ink"
      >
        Welcome to {OS_NAME}
      </h1>
      <p
        style={{ ['--step' as string]: 2 }}
        className="mt-2.5 max-w-sm text-[14px] leading-relaxed text-ink-2"
      >
        A desktop environment that runs entirely in your browser — windows, a filesystem, a shell
        and twelve applications, with no server behind any of it.
      </p>
      <p
        style={{ ['--step' as string]: 3 }}
        className="mt-4 flex items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1.5 text-[11.5px] text-ink-3"
      >
        <Icon name="Shield" size={12} />
        Everything you make stays on this device
      </p>
    </div>
  );
}

/* ------------------------------ 2. Identity ------------------------------ */

export function IdentityStep({
  profile,
  onChange,
  onSubmit,
}: {
  profile: UserProfile;
  onChange: (values: Partial<UserProfile>) => void;
  onSubmit: () => void;
}) {
  /*
   * The field starts empty rather than pre-filled with the placeholder name,
   * so typing does not append to "Palm User". The default is still what gets
   * stored if the field is left blank.
   */
  const [draft, setDraft] = useState(() =>
    profile.displayName === DEFAULT_PROFILE.displayName ? '' : profile.displayName,
  );

  const rename = (value: string) => {
    setDraft(value);
    const displayName = value.trim() ? value : DEFAULT_PROFILE.displayName;
    const username =
      displayName
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 16) || DEFAULT_PROFILE.username;
    onChange({ displayName, username });
  };

  return (
    <div className="anim-rise">
      <div style={{ ['--step' as string]: 0 }} className="text-center">
        <h2 className="text-[22px] font-semibold tracking-tight text-ink">
          Who's using this computer?
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-2">
          There's no account and no password — this is just how {OS_NAME} greets you.
        </p>
      </div>

      <div
        style={{ ['--step' as string]: 1 }}
        className="mx-auto mt-6 flex max-w-xs items-center gap-3 rounded-2xl border border-edge/12 bg-surface-2/60 p-3"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[26px]">
          {profile.avatar}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">
            {profile.displayName.trim() || 'Palm User'}
          </p>
          <p className="truncate font-mono text-[11.5px] text-ink-3">@{profile.username || 'palm'}</p>
        </div>
      </div>

      <div style={{ ['--step' as string]: 2 }} className="mx-auto mt-4 max-w-xs">
        <TextField
          label="Your name"
          value={draft}
          placeholder={DEFAULT_PROFILE.displayName}
          hint="Used to greet you, and as the terminal's prompt."
          autoFocus
          data-autofocus
          maxLength={40}
          onChange={(event) => rename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>

      <fieldset style={{ ['--step' as string]: 3 }} className="mx-auto mt-5 max-w-sm">
        <legend className="mb-2 w-full text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Pick an avatar
        </legend>
        <div className="flex flex-wrap justify-center gap-1.5">
          {AVATARS.map((avatar) => (
            <button
              key={avatar}
              type="button"
              onClick={() => onChange({ avatar })}
              aria-label={`Use ${avatar} as your avatar`}
              aria-pressed={profile.avatar === avatar}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl text-[20px] transition-transform',
                'hover:scale-110 active:scale-95',
                profile.avatar === avatar
                  ? 'bg-accent-soft ring-2 ring-accent'
                  : 'bg-surface-2/70 hover:bg-surface-3',
              )}
            >
              {avatar}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/* ----------------------------- 3. Appearance ----------------------------- */

const WALLPAPER_TABS = ['Gradients', 'Pictures', 'Colours'] as const;
export type WallpaperTab = (typeof WALLPAPER_TABS)[number];

export function AppearanceStep({
  settings,
  tab,
  onTabChange,
  onSet,
}: {
  settings: Settings;
  tab: WallpaperTab;
  onTabChange: (tab: WallpaperTab) => void;
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const options: Array<{ key: string; label: string; wallpaper: Wallpaper }> =
    tab === 'Gradients'
      ? GRADIENT_WALLPAPERS.map((preset) => ({
          key: preset.id,
          label: preset.name,
          wallpaper: { kind: 'gradient', from: preset.from, to: preset.to, angle: preset.angle },
        }))
      : tab === 'Pictures'
        ? IMAGE_WALLPAPERS.map((preset) => ({
            key: preset.id,
            label: preset.name,
            wallpaper: { kind: 'image', src: preset.src, fit: 'cover' },
          }))
        : COLOR_WALLPAPERS.map((preset) => ({
            key: preset.id,
            label: preset.name,
            wallpaper: { kind: 'color', color: preset.color },
          }));

  const current = JSON.stringify(settings.wallpaper);

  return (
    <div className="anim-rise">
      <div style={{ ['--step' as string]: 0 }} className="text-center">
        <h2 className="text-[22px] font-semibold tracking-tight text-ink">Make it yours</h2>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Every change applies straight away — the background behind this card is the real one.
        </p>
      </div>

      <div style={{ ['--step' as string]: 1 }} className="mt-5 flex flex-wrap items-center justify-center gap-4">
        <div>
          <p className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Appearance
          </p>
          <Segmented
            size="sm"
            label="Appearance"
            value={settings.theme}
            onChange={(value) => onSet('theme', value)}
            options={[
              { value: 'light', label: 'Light', icon: 'Sun' },
              { value: 'dark', label: 'Dark', icon: 'MoonStar' },
              { value: 'system', label: 'Auto', icon: 'MonitorCog' },
            ]}
          />
        </div>

        <div>
          <p className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Accent
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => onSet('accent', preset.value)}
                aria-label={preset.name}
                aria-pressed={settings.accent.toLowerCase() === preset.value.toLowerCase()}
                title={preset.name}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-115',
                  settings.accent.toLowerCase() === preset.value.toLowerCase() &&
                    'ring-2 ring-ink ring-offset-2 ring-offset-[rgb(var(--os-surface))]',
                )}
                style={{ backgroundColor: preset.value }}
              >
                {settings.accent.toLowerCase() === preset.value.toLowerCase() ? (
                  <Icon name="Check" size={13} className="text-white drop-shadow" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ['--step' as string]: 2 }} className="mt-5">
        <div className="mb-2 flex justify-center">
          <Segmented
            size="sm"
            label="Wallpaper type"
            value={tab}
            onChange={onTabChange}
            options={WALLPAPER_TABS.map((value) => ({ value, label: value }))}
          />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {options.map((option) => {
            const selected = JSON.stringify(option.wallpaper) === current;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onSet('wallpaper', option.wallpaper)}
                aria-pressed={selected}
                className={cn(
                  'group overflow-hidden rounded-lg border text-left transition-all',
                  selected
                    ? 'border-accent ring-2 ring-accent/40'
                    : 'border-edge/12 hover:border-edge/30',
                )}
              >
                <span
                  className="relative block h-11 w-full"
                  style={wallpaperPreviewStyle(option.wallpaper)}
                >
                  {selected ? (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Icon name="Check" size={10} />
                    </span>
                  ) : null}
                </span>
                <span className="block truncate px-1.5 py-1 text-[10.5px] text-ink-2">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[11px] text-ink-3">
          More options, plus your own pictures, live in Settings ▸ Personalisation.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- 4. Ready ------------------------------- */

const HIGHLIGHT_IDS = ['files', 'terminal', 'text-editor', 'browser', 'notes', 'calculator'];

export function ReadyStep({ profile, searchShortcut }: { profile: UserProfile; searchShortcut: string }) {
  const highlights = HIGHLIGHT_IDS.map((id) => launchableApps().find((app) => app.id === id)).filter(
    (app): app is NonNullable<typeof app> => Boolean(app),
  );

  const tips: Array<{ keys: string; label: string }> = [
    { keys: formatShortcut(searchShortcut), label: 'Search everything' },
    { keys: formatShortcut('Meta'), label: 'Open the menu' },
    { keys: 'Drag to an edge', label: 'Snap a window' },
  ];

  return (
    <div className="anim-rise">
      <div style={{ ['--step' as string]: 0 }} className="text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ok/15 text-ok">
          <Icon name="Check" size={24} strokeWidth={2.5} />
        </span>
        <h2 className="text-[22px] font-semibold tracking-tight text-ink">
          You're all set{profile.displayName.trim() ? `, ${profile.displayName.trim().split(' ')[0]}` : ''}
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-2">Here's what's waiting on the other side.</p>
      </div>

      <ul style={{ ['--step' as string]: 1 }} className="mt-5 grid grid-cols-3 gap-2">
        {highlights.map((app) => (
          <li
            key={app.id}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-edge/10 bg-surface-2/50 p-2.5 text-center"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${app.color}26`, color: app.color }}
            >
              <Icon name={app.icon} size={18} />
            </span>
            <span className="text-[11.5px] font-medium text-ink">{app.name}</span>
          </li>
        ))}
      </ul>

      <ul style={{ ['--step' as string]: 2 }} className="mt-4 flex flex-wrap justify-center gap-2">
        {tips.map((tip) => (
          <li
            key={tip.label}
            className="flex items-center gap-1.5 rounded-full bg-surface-2/70 px-2.5 py-1.5 text-[11.5px] text-ink-2"
          >
            <kbd className="rounded border border-edge/15 bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
              {tip.keys}
            </kbd>
            {tip.label}
          </li>
        ))}
      </ul>

      <p style={{ ['--step' as string]: 3 }} className="mt-4 text-center text-[11px] text-ink-3">
        {OS_NAME} {OS_VERSION} “{OS_CODENAME}” · Open <strong className="font-medium text-ink-2">Welcome.txt</strong> on
        the desktop for a tour you can read later.
      </p>
    </div>
  );
}
