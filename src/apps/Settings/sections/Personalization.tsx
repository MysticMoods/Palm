import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../../components/icons';
import { Button } from '../../../components/ui/Button';
import { Segmented, TextField } from '../../../components/ui/Field';
import { Slider } from '../../../components/ui/Slider';
import { Toggle } from '../../../components/ui/Toggle';
import { useFsRevision } from '../../../core/filesystem/useFs';
import { vfs } from '../../../core/filesystem/vfs';
import { ACCENT_PRESETS } from '../../../core/settings/defaults';
import { useSettingsStore } from '../../../core/settings/store';
import type { ImageFit, Wallpaper } from '../../../core/settings/types';
import {
  COLOR_WALLPAPERS,
  GRADIENT_WALLPAPERS,
  IMAGE_WALLPAPERS,
  wallpaperPreviewStyle,
} from '../../../core/settings/wallpapers';
import { isValidHex } from '../../../utils/color';
import { cn } from '../../../utils/cn';
import { Row, Section } from '../Layout';

type WallpaperTab = 'image' | 'gradient' | 'color' | 'mine';

export function PersonalizationSection() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);
  const revision = useFsRevision();

  const [tab, setTab] = useState<WallpaperTab>(
    settings.wallpaper.kind === 'image' ? 'image' : settings.wallpaper.kind,
  );
  const [customAccent, setCustomAccent] = useState(settings.accent);

  /** Images in the virtual filesystem that can be used as a wallpaper. */
  const myImages = useMemo(() => {
    void revision;
    const pictures = vfs.nodeAt('/Pictures');
    if (!pictures) return [];
    return vfs
      .descendants(pictures.id)
      .filter((node) => node.kind === 'file' && node.mime.startsWith('image/'));
  }, [revision]);

  const apply = (wallpaper: Wallpaper) => set('wallpaper', wallpaper);

  const isActive = (wallpaper: Wallpaper) =>
    JSON.stringify(settings.wallpaper) === JSON.stringify(wallpaper);

  return (
    <>
      <Section title="Wallpaper" description="Choose a picture, gradient or solid colour for the desktop.">
        <Row stacked>
          <Segmented
            size="sm"
            label="Wallpaper type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'image', label: 'Pictures', icon: 'Image' },
              { value: 'gradient', label: 'Gradients', icon: 'Palette' },
              { value: 'color', label: 'Colours', icon: 'Circle' },
              { value: 'mine', label: 'My pictures', icon: 'Folder' },
            ]}
          />

          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2">
            {tab === 'image'
              ? IMAGE_WALLPAPERS.map((preset) => {
                  const wallpaper: Wallpaper = { kind: 'image', src: preset.src, fit: 'cover' };
                  return (
                    <WallpaperSwatch
                      key={preset.id}
                      label={preset.name}
                      wallpaper={wallpaper}
                      active={isActive(wallpaper)}
                      onSelect={() => apply(wallpaper)}
                    />
                  );
                })
              : null}

            {tab === 'gradient'
              ? GRADIENT_WALLPAPERS.map((preset) => {
                  const wallpaper: Wallpaper = {
                    kind: 'gradient',
                    from: preset.from,
                    to: preset.to,
                    angle: preset.angle,
                  };
                  return (
                    <WallpaperSwatch
                      key={preset.id}
                      label={preset.name}
                      wallpaper={wallpaper}
                      active={isActive(wallpaper)}
                      onSelect={() => apply(wallpaper)}
                    />
                  );
                })
              : null}

            {tab === 'color'
              ? COLOR_WALLPAPERS.map((preset) => {
                  const wallpaper: Wallpaper = { kind: 'color', color: preset.color };
                  return (
                    <WallpaperSwatch
                      key={preset.id}
                      label={preset.name}
                      wallpaper={wallpaper}
                      active={isActive(wallpaper)}
                      onSelect={() => apply(wallpaper)}
                    />
                  );
                })
              : null}

            {tab === 'mine'
              ? myImages.length > 0
                ? myImages.map((node) => {
                    const wallpaper: Wallpaper = { kind: 'image', src: `vfs:${node.id}`, fit: 'cover' };
                    return (
                      <WallpaperSwatch
                        key={node.id}
                        label={node.name}
                        wallpaper={wallpaper}
                        active={isActive(wallpaper)}
                        onSelect={() => apply(wallpaper)}
                        vfsNodeId={node.id}
                      />
                    );
                  })
                : null
              : null}
          </div>

          {tab === 'mine' && myImages.length === 0 ? (
            <p className="mt-3 text-[12px] text-ink-3">
              No images in <span className="font-mono">/Pictures</span> yet. Add some through Files, then
              they will show up here.
            </p>
          ) : null}
        </Row>

        {settings.wallpaper.kind === 'image' ? (
          <Row
            label="Picture position"
            description="How the image fills the screen."
            control={
              <Segmented
                size="sm"
                label="Picture position"
                value={settings.wallpaper.fit}
                onChange={(fit: ImageFit) =>
                  settings.wallpaper.kind === 'image' && apply({ ...settings.wallpaper, fit })
                }
                options={[
                  { value: 'cover', label: 'Fill' },
                  { value: 'contain', label: 'Fit' },
                  { value: 'center', label: 'Centre' },
                  { value: 'tile', label: 'Tile' },
                ]}
              />
            }
          />
        ) : null}
      </Section>

      <Section title="Colours" description="Theme and accent colour.">
        <Row
          label="Appearance"
          description="Dark, light, or follow your operating system."
          control={
            <Segmented
              size="sm"
              label="Appearance"
              value={settings.theme}
              onChange={(value) => set('theme', value)}
              options={[
                { value: 'light', label: 'Light', icon: 'Sun' },
                { value: 'dark', label: 'Dark', icon: 'MoonStar' },
                { value: 'system', label: 'System', icon: 'MonitorCog' },
              ]}
            />
          }
        />

        <Row label="Accent colour" description="Used for highlights, selections and buttons." stacked>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  set('accent', preset.value);
                  setCustomAccent(preset.value);
                }}
                aria-label={preset.name}
                aria-pressed={settings.accent.toLowerCase() === preset.value.toLowerCase()}
                title={preset.name}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                  settings.accent.toLowerCase() === preset.value.toLowerCase() &&
                    'ring-2 ring-ink ring-offset-2 ring-offset-[rgb(var(--os-surface))]',
                )}
                style={{ backgroundColor: preset.value }}
              >
                {settings.accent.toLowerCase() === preset.value.toLowerCase() ? (
                  <Icon name="Check" size={14} className="text-white drop-shadow" />
                ) : null}
              </button>
            ))}

            <div className="ml-2 flex items-center gap-1.5">
              <TextField
                value={customAccent}
                onChange={(event) => {
                  setCustomAccent(event.target.value);
                  if (isValidHex(event.target.value)) set('accent', event.target.value);
                }}
                label="Custom accent colour"
                hideLabel
                placeholder="#5884ff"
                className="w-28 [&_input]:h-8 [&_input]:font-mono [&_input]:text-[12px]"
                error={isValidHex(customAccent) ? undefined : ' '}
              />
            </div>
          </div>
        </Row>
      </Section>

      <Section title="Taskbar and desktop">
        <Row
          label="Taskbar position"
          control={
            <Segmented
              size="sm"
              label="Taskbar position"
              value={settings.taskbarPosition}
              onChange={(value) => set('taskbarPosition', value)}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
            />
          }
        />
        <Row
          control={
            <Toggle
              checked={settings.showDesktopIcons}
              onChange={(value) => set('showDesktopIcons', value)}
              label="Show desktop icons"
              hideLabel
            />
          }
          label="Show desktop icons"
          description="Hide icons for a clean desktop; the files stay in /Desktop."
        />
        <Row
          label="Desktop icon size"
          control={
            <Segmented
              size="sm"
              label="Desktop icon size"
              value={settings.desktopIconSize}
              onChange={(value) => set('desktopIconSize', value)}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          }
        />
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
      </Section>

      <Section title="Clock">
        <Row
          label="24-hour time"
          control={
            <Toggle
              checked={settings.use24HourClock}
              onChange={(value) => set('use24HourClock', value)}
              label="24-hour time"
              hideLabel
            />
          }
        />
        <Row
          label="Show seconds"
          description="The clock updates every second instead of every minute."
          control={
            <Toggle
              checked={settings.showClockSeconds}
              onChange={(value) => set('showClockSeconds', value)}
              label="Show seconds"
              hideLabel
            />
          }
        />
      </Section>

      <Section title="Windows">
        <Row
          label="Snap assist"
          description="Show a preview when a window is dragged to a screen edge."
          control={
            <Toggle
              checked={settings.snapAssist}
              onChange={(value) => set('snapAssist', value)}
              label="Snap assist"
              hideLabel
            />
          }
        />
      </Section>

      <div className="pb-2">
        <Button
          variant="ghost"
          size="sm"
          icon="RotateCcw"
          onClick={() => {
            set('wallpaper', { kind: 'gradient', from: '#131a35', to: '#3a2255', angle: 135 });
            set('accent', '#5884ff');
            set('theme', 'dark');
            set('uiScale', 1);
            setCustomAccent('#5884ff');
          }}
        >
          Reset appearance to defaults
        </Button>
      </div>
    </>
  );
}

function WallpaperSwatch({
  label,
  wallpaper,
  active,
  onSelect,
  vfsNodeId,
}: {
  label: string;
  wallpaper: Wallpaper;
  active: boolean;
  onSelect: () => void;
  vfsNodeId?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  // Filesystem-backed previews need an object URL, revoked on unmount.
  useEffect(() => {
    if (!vfsNodeId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void vfs
      .createObjectURL(vfsNodeId)
      .then((created) => {
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vfsNodeId]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'group overflow-hidden rounded-lg border text-left transition-all',
        active ? 'border-accent ring-2 ring-accent/40' : 'border-edge/12 hover:border-edge/25',
      )}
    >
      <span
        className="relative block h-[60px] w-full"
        style={wallpaperPreviewStyle(wallpaper, url)}
        aria-hidden="true"
      >
        {active ? (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Icon name="Check" size={12} />
          </span>
        ) : null}
      </span>
      <span className="block truncate px-2 py-1.5 text-[11px] text-ink-2">{label}</span>
    </button>
  );
}
