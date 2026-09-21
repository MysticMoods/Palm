import { useMemo, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { Segmented, TextField } from '../../components/ui/Field';
import { Badge, EmptyState, Notice } from '../../components/ui/Feedback';
import { launchableApps } from '../../core/app-manager/registry';
import { useAppStore } from '../../core/app-manager/store';
import type { AppDefinition, AppProps } from '../../core/app-manager/types';
import { notifications } from '../../core/notifications/store';
import { PERMISSIONS } from '../../core/permissions/types';
import { useWindowStore } from '../../core/window-manager/store';
import { WebApps } from './WebApps';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { matches } from '../../utils/misc';

type Filter = 'all' | 'installed' | 'available';
type Tab = 'built-in' | 'web';

export default function AppStoreApp(_props: AppProps) {
  const { os } = useOS();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<string>('All');
  const [tab, setTab] = useState<Tab>('built-in');
  const [selected, setSelected] = useState<AppDefinition | null>(null);

  const installed = useAppStore((s) => s.installed);
  const install = useAppStore((s) => s.install);
  const uninstall = useAppStore((s) => s.uninstall);
  const pinned = useAppStore((s) => s.pinned);
  const togglePin = useAppStore((s) => s.togglePin);
  const windows = useWindowStore((s) => s.windows);

  const apps = launchableApps();
  const isInstalled = (app: AppDefinition) => app.core === true || installed.includes(app.id);

  const categories = useMemo(
    () => ['All', ...new Set(apps.map((app) => app.category))].sort((a, b) => (a === 'All' ? -1 : a.localeCompare(b))),
    [apps],
  );

  const filtered = useMemo(() => {
    const needle = query.trim();
    return apps.filter((app) => {
      if (category !== 'All' && app.category !== category) return false;
      if (filter === 'installed' && !isInstalled(app)) return false;
      if (filter === 'available' && isInstalled(app)) return false;
      if (!needle) return true;
      return (
        matches(app.name, needle) ||
        matches(app.description, needle) ||
        matches(app.developer, needle) ||
        (app.keywords?.some((keyword) => matches(keyword, needle)) ?? false)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, category, filter, query, installed]);

  const handleInstall = (app: AppDefinition) => {
    install(app.id);
    notifications.push('app-store', {
      title: `${app.name} installed`,
      body: 'It is now available in the start menu.',
      actions: [{ id: 'open', label: 'Open', onClick: () => os.openApp(app.id) }],
    });
  };

  const handleUninstall = (app: AppDefinition) => {
    useWindowStore.getState().closeApp(app.id);
    uninstall(app.id);
    notifications.push('app-store', {
      title: `${app.name} removed`,
      body: 'Its stored data is kept; clear it from Settings ▸ Applications.',
      actions: [{ id: 'undo', label: 'Reinstall', onClick: () => install(app.id) }],
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* --------------------------------- Header ------------------------------- */}
      <div className="shrink-0 border-b border-edge/8 px-4 py-3">
        <div className="mb-2 flex">
          <Segmented
            size="sm"
            label="Application source"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'built-in', label: 'Built in', icon: 'LayoutGrid' },
              { value: 'web', label: 'Web applications', icon: 'Package' },
            ]}
          />
        </div>
        {tab === 'web' ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[180px] flex-1">
            <TextField
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search applications"
              label="Search applications"
              hideLabel
              icon="Search"
            />
          </div>
          <Segmented
            size="sm"
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'installed', label: 'Installed' },
              { value: 'available', label: 'Available' },
            ]}
          />
        </div>
        )}
        {tab === 'web' ? null : (
        <div className="os-scroll mt-2 flex gap-1 overflow-x-auto pb-0.5">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
              aria-pressed={category === name}
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                category === name ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-ink-2 hover:bg-surface-3',
              )}
            >
              {name}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* -------------------------------- Listing ------------------------------- */}
      <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'web' ? (
          <WebApps onOpen={(appId) => os.openApp(appId)} />
        ) : (
        <>
        <Notice tone="neutral" icon="Shield" title="Applications that ship with Palm OS" className="mb-4">
          Every application listed here was compiled into Palm OS and runs on the OS's own origin,
          with access to your files and settings. Nothing on this tab is downloaded. Third-party
          applications live under <strong>Web applications</strong>, where each one is installed onto
          an origin of its own so the browser keeps it away from everything here.
        </Notice>

        {filtered.length === 0 ? (
          <EmptyState
            icon="Package"
            title="No applications match"
            description={query ? `Nothing matches "${query}".` : 'Try a different filter.'}
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            {filtered.map((app) => {
              const running = windows.filter((win) => win.appId === app.id).length;
              return (
                <li key={app.id}>
                  <article className="flex h-full flex-col rounded-xl border border-edge/10 bg-surface-2/40 p-3.5 transition-colors hover:border-edge/20">
                    <div className="flex items-start gap-3">
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${app.color}26`, color: app.color }}
                      >
                        <Icon name={app.icon} size={22} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[13.5px] font-semibold text-ink">{app.name}</h3>
                        <p className="truncate text-[11px] text-ink-3">
                          {app.developer} · v{app.version}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone="neutral">{app.category}</Badge>
                          {app.core ? <Badge tone="accent">Core</Badge> : null}
                          {running > 0 ? <Badge tone="ok">Running</Badge> : null}
                        </div>
                      </div>
                    </div>

                    <p className="mt-2.5 line-clamp-2 flex-1 text-[12px] leading-relaxed text-ink-2">
                      {app.description}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {isInstalled(app) ? (
                        <>
                          <Button size="sm" variant="primary" icon="Play" onClick={() => os.openApp(app.id)}>
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={pinned.includes(app.id) ? 'PinOff' : 'Pin'}
                            onClick={() => togglePin(app.id)}
                          >
                            {pinned.includes(app.id) ? 'Unpin' : 'Pin'}
                          </Button>
                          {app.core ? null : (
                            <Button size="sm" variant="ghost" className="text-danger" onClick={() => handleUninstall(app)}>
                              Uninstall
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button size="sm" variant="primary" icon="Download" onClick={() => handleInstall(app)}>
                          Install
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon="Info" onClick={() => setSelected(app)}>
                        Details
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
        </>
        )}
      </div>

      {/* -------------------------------- Details ------------------------------- */}
      {selected && tab === 'built-in' ? (
        <div className="shrink-0 border-t border-edge/8 bg-surface-2/50 p-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${selected.color}26`, color: selected.color }}
            >
              <Icon name={selected.icon} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] font-semibold text-ink">{selected.name}</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{selected.description}</p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                Requests these permissions
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {selected.permissions.length === 0 ? (
                  <span className="text-[11.5px] text-ink-3">None</span>
                ) : (
                  selected.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-2"
                      title={PERMISSIONS[permission].description}
                    >
                      <Icon name={PERMISSIONS[permission].icon} size={10} />
                      {PERMISSIONS[permission].label}
                    </span>
                  ))
                )}
              </div>
            </div>
            <Button size="sm" variant="ghost" icon="X" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
