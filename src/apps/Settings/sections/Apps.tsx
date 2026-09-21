import { useMemo, useState } from 'react';
import { Icon } from '../../../components/icons';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Field';
import { Badge, Notice } from '../../../components/ui/Feedback';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { appsForFile, getApp, launchableApps } from '../../../core/app-manager/registry';
import { useAppStore } from '../../../core/app-manager/store';
import { usePermissionStore } from '../../../core/permissions/store';
import { PERMISSIONS } from '../../../core/permissions/types';
import type { Permission } from '../../../core/permissions/types';
import { useSettingsStore } from '../../../core/settings/store';
import { appNamespace, kv } from '../../../core/storage/kv';
import { notifications } from '../../../core/notifications/store';
import { useWindowStore } from '../../../core/window-manager/store';
import { cn } from '../../../utils/cn';
import { Row, Section } from '../Layout';

const FILE_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'text', label: 'Text files' },
  { id: 'code', label: 'Source code' },
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
];

export function AppsSection() {
  const apps = launchableApps();
  const installed = useAppStore((s) => s.installed);
  const uninstall = useAppStore((s) => s.uninstall);
  const install = useAppStore((s) => s.install);
  const pinned = useAppStore((s) => s.pinned);
  const togglePin = useAppStore((s) => s.togglePin);

  const defaults = useSettingsStore((s) => s.settings.defaultApps);
  const setDefaultApp = useSettingsStore((s) => s.setDefaultApp);

  const grants = usePermissionStore((s) => s.grants);
  const setGrant = usePermissionStore((s) => s.set);
  const revokeAll = usePermissionStore((s) => s.revokeAll);

  const windows = useWindowStore((s) => s.windows);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);

  const isInstalled = (id: string) => getApp(id)?.core === true || installed.includes(id);

  const runningCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const win of windows) counts.set(win.appId, (counts.get(win.appId) ?? 0) + 1);
    return counts;
  }, [windows]);

  const clearAppData = async (appId: string) => {
    await kv.clearNamespace(appNamespace(appId));
    setConfirmClear(null);
    notifications.push('settings', {
      title: `Cleared data for ${getApp(appId)?.name ?? appId}`,
      body: 'The application starts fresh next time it opens.',
    });
  };

  return (
    <>
      <Section title="Default applications" description="Which application opens each kind of file.">
        {FILE_CATEGORIES.map((category) => {
          const candidates = appsForFile('', category.id as never).filter((app) => isInstalled(app.id));
          return (
            <Row
              key={category.id}
              label={category.label}
              control={
                candidates.length > 0 ? (
                  <Select
                    label={`Default application for ${category.label}`}
                    hideLabel
                    value={defaults[category.id] ?? candidates[0]?.id ?? ''}
                    onChange={(event) => setDefaultApp(category.id, event.target.value)}
                    options={candidates.map((app) => ({ value: app.id, label: app.name }))}
                    className="w-48"
                  />
                ) : (
                  <span className="text-[12px] text-ink-3">No application installed</span>
                )
              }
            />
          );
        })}
      </Section>

      <Section title="Installed applications" description="Core applications ship with Palm OS and cannot be removed.">
        {apps.map((app) => {
          const running = runningCounts.get(app.id) ?? 0;
          const appGrants = grants[app.id] ?? {};
          return (
            <Row key={app.id} stacked>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${app.color}26`, color: app.color }}
                >
                  <Icon name={app.icon} size={19} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">
                    {app.name}
                    {app.core ? <Badge tone="neutral">Core</Badge> : null}
                    {running > 0 ? <Badge tone="ok">{running} running</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    {app.description} · v{app.version} · {app.developer}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={pinned.includes(app.id) ? 'PinOff' : 'Pin'}
                    onClick={() => togglePin(app.id)}
                  >
                    {pinned.includes(app.id) ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(app.id)}>
                    Clear data
                  </Button>
                  {app.core ? null : isInstalled(app.id) ? (
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => uninstall(app.id)}>
                      Uninstall
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => install(app.id)}>
                      Install
                    </Button>
                  )}
                </div>
              </div>

              {app.permissions.length > 0 ? (
                <div className="mt-3 rounded-lg border border-edge/8 bg-surface p-2.5">
                  <p className="mb-2 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                    Permissions
                    <button
                      type="button"
                      onClick={() => revokeAll(app.id)}
                      className="rounded px-1.5 py-0.5 text-[10.5px] normal-case tracking-normal text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                    >
                      Reset all
                    </button>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {app.permissions.map((permission) => (
                      <PermissionChip
                        key={permission}
                        permission={permission}
                        state={appGrants[permission] ?? 'prompt'}
                        onChange={(next) => setGrant(app.id, permission, next)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </Row>
          );
        })}
      </Section>

      <Notice tone="neutral" icon="Shield" title="How permissions work">
        Applications receive nothing implicitly. The first time an app needs the filesystem, the
        clipboard or notifications it asks, and your answer is remembered here. Camera, microphone and
        location also require your browser's own permission on top of this one.
      </Notice>

      <ConfirmDialog
        open={confirmClear !== null}
        title={`Clear data for ${confirmClear ? (getApp(confirmClear)?.name ?? confirmClear) : ''}?`}
        description="The application's own saved settings and content are deleted. Files in your filesystem are not affected."
        confirmLabel="Clear data"
        destructive
        onConfirm={() => confirmClear && void clearAppData(confirmClear)}
        onCancel={() => setConfirmClear(null)}
      />
    </>
  );
}

function PermissionChip({
  permission,
  state,
  onChange,
}: {
  permission: Permission;
  state: 'granted' | 'denied' | 'prompt';
  onChange: (next: 'granted' | 'denied' | 'prompt') => void;
}) {
  const descriptor = PERMISSIONS[permission];

  /*
   * Implicit permissions (an app's own private storage) cannot leak anything
   * outside the app and are always available, so they are shown as a static
   * label rather than a control that pretends to be adjustable.
   */
  if (descriptor.implicit) {
    return (
      <span
        title={descriptor.description}
        className="flex items-center gap-1.5 rounded-full border border-edge/15 bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-3"
      >
        <Icon name={descriptor.icon} size={11} />
        {descriptor.label}
        <span className="opacity-70">· Always allowed</span>
      </span>
    );
  }

  const next = state === 'granted' ? 'denied' : state === 'denied' ? 'prompt' : 'granted';
  const label = state === 'granted' ? 'Allowed' : state === 'denied' ? 'Blocked' : 'Ask';

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`${descriptor.label}: ${label}. Click to change.`}
      aria-label={`${descriptor.label} permission is set to ${label}. Activate to change.`}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
        state === 'granted'
          ? 'border-ok/40 bg-ok/12 text-ok'
          : state === 'denied'
            ? 'border-danger/40 bg-danger/12 text-danger'
            : 'border-edge/15 bg-surface-2 text-ink-3',
      )}
    >
      <Icon name={descriptor.icon} size={11} />
      {descriptor.label}
      <span className="opacity-70">· {label}</span>
    </button>
  );
}
