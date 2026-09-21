import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/Feedback';
import { useAppStore, useInstalledApps, useRecentApps } from '../../core/app-manager/store';
import type { AppDefinition } from '../../core/app-manager/types';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import { useWindowStore } from '../../core/window-manager/store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../utils/cn';
import { matches } from '../../utils/misc';
import { panelAnchor } from '../panel-anchor';

export function StartMenu() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const closePanel = useShellStore((s) => s.closePanel);
  const position = useSettingsStore((s) => s.settings.taskbarPosition);
  const profile = useSettingsStore((s) => s.profile);

  const apps = useInstalledApps();
  const recent = useRecentApps(6);
  const pinnedIds = useAppStore((s) => s.pinned);
  const usage = useAppStore((s) => s.usage);

  useClickOutside(panelRef, closePanel);

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return null;
    return apps
      .filter(
        (app) =>
          matches(app.name, needle) ||
          matches(app.description, needle) ||
          matches(app.category, needle) ||
          app.keywords?.some((keyword) => matches(keyword, needle)),
      )
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle.toLowerCase()) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(needle.toLowerCase()) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return (usage[b.id] ?? 0) - (usage[a.id] ?? 0);
      });
  }, [apps, query, usage]);

  const pinnedApps = useMemo(
    () => pinnedIds.map((id) => apps.find((app) => app.id === id)).filter((app): app is AppDefinition => Boolean(app)),
    [apps, pinnedIds],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, AppDefinition[]>();
    for (const app of apps) {
      const list = groups.get(app.category) ?? [];
      list.push(app);
      groups.set(app.category, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [apps]);

  useEffect(() => setActiveIndex(0), [query]);

  const launch = (app: AppDefinition) => {
    OS.openApp(app.id);
    closePanel();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePanel();
      return;
    }
    if (!filtered || filtered.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const app = filtered[activeIndex];
      if (app) launch(app);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Start menu"
      onKeyDown={onKeyDown}
      className={cn(
        'anim-pop os-glass-strong absolute z-[600] flex w-[min(560px,calc(100vw-1.5rem))] flex-col',
        'overflow-hidden rounded-xl shadow-[var(--shadow-panel)]',
        'max-h-[min(640px,calc(100vh-5rem))]',
      )}
      style={panelAnchor(position, 'start')}
    >
      {/* -------------------------------- Search ------------------------------- */}
      <div className="border-b border-edge/8 p-3">
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search applications…"
          label="Search applications"
          hideLabel
          icon="Search"
          autoFocus
          data-autofocus
          trailing={
            query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
              >
                <Icon name="X" size={13} />
              </button>
            ) : null
          }
        />
      </div>

      <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {filtered ? (
          filtered.length > 0 ? (
            <ul role="listbox" aria-label="Search results" className="flex flex-col gap-0.5">
              {filtered.map((app, index) => (
                <li key={app.id}>
                  <AppRow
                    app={app}
                    active={index === activeIndex}
                    onClick={() => launch(app)}
                    onPointerEnter={() => setActiveIndex(index)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon="Search"
              title="No applications found"
              description={`Nothing matches "${query}". Try the App Store to install more.`}
            />
          )
        ) : (
          <>
            {pinnedApps.length > 0 ? (
              <Section title="Pinned">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1">
                  {pinnedApps.map((app) => (
                    <AppTile key={app.id} app={app} onClick={() => launch(app)} />
                  ))}
                </div>
              </Section>
            ) : null}

            {recent.length > 0 ? (
              <Section title="Recent">
                <ul className="flex flex-col gap-0.5">
                  {recent.map((app) => (
                    <li key={app.id}>
                      <AppRow app={app} onClick={() => launch(app)} />
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {grouped.map(([category, list]) => (
              <Section key={category} title={category}>
                <ul className="flex flex-col gap-0.5">
                  {list.map((app) => (
                    <li key={app.id}>
                      <AppRow app={app} onClick={() => launch(app)} />
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </>
        )}
      </div>

      {/* -------------------------------- Footer ------------------------------- */}
      <div className="flex items-center justify-between gap-2 border-t border-edge/8 bg-surface-2/50 px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            OS.openApp('settings', { params: { section: 'accounts' } });
            closePanel();
          }}
          className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-3"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm">
            {profile.avatar}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">{profile.displayName}</span>
            <span className="block truncate text-[11px] text-ink-3">@{profile.username}</span>
          </span>
        </button>

        <div className="flex items-center gap-0.5">
          <FooterButton
            icon="Settings"
            label="Settings"
            onClick={() => {
              OS.openApp('settings');
              closePanel();
            }}
          />
          <FooterButton
            icon="Package"
            label="App Store"
            onClick={() => {
              OS.openApp('app-store');
              closePanel();
            }}
          />
          <FooterButton
            icon="Power"
            label="Close all windows"
            onClick={() => {
              for (const win of useWindowStore.getState().windows) {
                useWindowStore.getState().close(win.id);
              }
              closePanel();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="mb-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AppTile({ app, onClick }: { app: AppDefinition; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors hover:bg-surface-3"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${app.color}26`, color: app.color }}
      >
        <Icon name={app.icon} size={20} />
      </span>
      <span className="line-clamp-2 w-full text-[11px] leading-tight text-ink-2">{app.name}</span>
    </button>
  );
}

function AppRow({
  app,
  active,
  onClick,
  onPointerEnter,
}: {
  app: AppDefinition;
  active?: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
        active ? 'bg-accent text-accent-fg' : 'hover:bg-surface-3',
      )}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${app.color}26`, color: active ? undefined : app.color }}
      >
        <Icon name={app.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px] font-medium', active ? 'text-accent-fg' : 'text-ink')}>
          {app.name}
        </span>
        <span className={cn('block truncate text-[11px]', active ? 'text-accent-fg/75' : 'text-ink-3')}>
          {app.description}
        </span>
      </span>
    </button>
  );
}

function FooterButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
