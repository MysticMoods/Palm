import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, EmptyState, Notice } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import type { AppProps } from '../../core/app-manager/types';
import { statusLabel, statusSummary } from '../../core/sites/manifest';
import { appOrigin } from '../../core/sites/origin';
import { siteAppId, useSitesStore } from '../../core/sites/store';
import { APP_PERMISSION_INFO, ARCHIVE_STATUS } from '../../core/sites/types';
import type { AppManifest, AppPermission } from '../../core/sites/types';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { formatBytes, formatRelative } from '../../utils/format';
import { useBridge } from './useBridge';

/**
 * Runs an installed web application.
 *
 * The frame points at the application's *own* origin —
 * `app-7f31c2a4.palm.example` — where its own service worker serves its
 * archive out of its own storage. Because that origin is not Palm OS's, the
 * browser's same-origin policy is what keeps the application away from the
 * OS's IndexedDB, and no sandbox attribute is load-bearing for that.
 *
 * `allow-same-origin` is present and is *not* the mistake it would be on a
 * same-origin frame: here it means "keep your own origin", which the
 * application needs for storage and for its service worker. It grants nothing
 * over Palm OS, because Palm OS is somewhere else.
 */
export default function SiteViewerApp({ params }: AppProps<{ siteId?: string }>) {
  const { os } = useOS();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [generation, setGeneration] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Set when the user asks to see an application we expect not to work. */
  const [runAnyway, setRunAnyway] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);

  const installed = useSitesStore((s) => s.installed);
  const setPermissions = useSitesStore((s) => s.setPermissions);
  const revalidate = useSitesStore((s) => s.revalidate);
  const convertToLive = useSitesStore((s) => s.convertToLive);

  const manifest = useMemo(
    () => installed.find((candidate) => candidate.id === params?.siteId) ?? null,
    [installed, params?.siteId],
  );
  const origin = manifest ? appOrigin(manifest.id) : null;

  useBridge({ manifest, frame: frameRef, os, onRefusal: setRefusal });

  useEffect(() => {
    os.window.setTitle(manifest ? `${manifest.name} — Installed app` : 'Installed app');
  }, [os, manifest]);

  // A refusal is worth showing once, not forever.
  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setRefusal(null), 8000);
    return () => clearTimeout(timer);
  }, [refusal]);

  if (!manifest) {
    return (
      <EmptyState
        icon="Package"
        title="This application is no longer installed"
        description="It may have been removed from the App Store."
        action={
          <Button variant="secondary" icon="Package" onClick={() => os.openApp('app-store')}>
            Open the App Store
          </Button>
        }
      />
    );
  }

  if (!origin) {
    return (
      <EmptyState
        icon="ShieldAlert"
        title="This application cannot be run here"
        description="Palm OS is being reached at an address that cannot give applications their own origin, and it will not run downloaded code on its own origin instead."
        action={
          <Button variant="secondary" icon="Package" onClick={() => os.openApp('app-store')}>
            Open the App Store
          </Button>
        }
      />
    );
  }

  const online = manifest.permissions.includes('NETWORK');

  /*
   * An application that needs a server, with no network permission, will load
   * its own files and then fail at every request it makes — which looks like a
   * blank page for no reason. Palm OS knows both facts, so it should say so
   * rather than let someone watch it break.
   */
  const strandedOffline = manifest.networkRequired && !online && !runAnyway;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* -------------------------------- Toolbar ------------------------------- */}
      <div className="flex shrink-0 items-center gap-1 border-b border-edge/8 px-2 py-1.5">
        <IconButton
          icon="RefreshCw"
          label="Reload this application"
          size="sm"
          onClick={() => setGeneration((value) => value + 1)}
        />
        <span className="mx-2 flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-3">
          <Icon name="Package" size={12} className="shrink-0" />
          <span className="truncate">{manifest.primaryHost}</span>
          <StatusChip manifest={manifest} />
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium',
              online ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok',
            )}
            title={
              online
                ? 'This application may contact servers.'
                : 'Network access is blocked for this application.'
            }
          >
            {online ? 'Online' : 'Offline'}
          </span>
        </span>
        <IconButton
          icon="Info"
          label="About this application"
          size="sm"
          active={showDetails}
          onClick={() => setShowDetails(!showDetails)}
        />
        <IconButton
          icon="Share2"
          label="Open the live site in a real browser tab"
          size="sm"
          onClick={() => window.open(manifest.source, '_blank', 'noopener,noreferrer')}
        />
      </div>

      {refusal ? (
        <div
          role="status"
          className="shrink-0 border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn"
        >
          This application asked Palm OS for something it is not allowed: {refusal}
        </div>
      ) : null}

      {showDetails ? (
        <DetailsPanel
          manifest={manifest}
          origin={origin}
          onTogglePermission={(permission, enabled) => {
            const next = enabled
              ? [...manifest.permissions, permission]
              : manifest.permissions.filter((value) => value !== permission);
            /*
             * Reload only once the change has reached the application's own
             * service worker. Reloading first restarts the application under
             * the old policy, so a permission the user just granted appears
             * not to work until they reload again by hand.
             */
            void setPermissions(manifest.id, next).then(() =>
              setGeneration((value) => value + 1),
            );
          }}
          onRecheck={() => void revalidate(manifest.id)}
        />
      ) : null}

      {strandedOffline ? (
        <NeedsConnection
          manifest={manifest}
          onAllowNetwork={() => {
            void setPermissions(manifest.id, [...manifest.permissions, 'NETWORK']).then(() =>
              setGeneration((value) => value + 1),
            );
          }}
          onUseAsApp={() => setConfirmConvert(true)}
          onRunAnyway={() => setRunAnyway(true)}
        />
      ) : (
      <>
      {manifest.networkRequired ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn/25 bg-warn/8 px-3 py-1.5 text-[11.5px] text-warn">
          <span className="min-w-0 flex-1">
            This is a downloaded copy of {manifest.primaryHost}, and the part that does the work
            stays on their servers. Requests go through Palm OS without your cookies, so searching
            or signing in will not work here.
          </span>
          <button
            type="button"
            onClick={() => setConfirmConvert(true)}
            className="shrink-0 rounded-full bg-warn px-2.5 py-0.5 text-[11px] font-medium text-[var(--os-bg)]"
          >
            Use it as an app instead
          </button>
        </div>
      ) : null}
      {/*
        A cross-origin frame. `allow-same-origin` preserves the *application's*
        origin — which is not this one — so it keeps its storage and its
        service worker while reaching nothing of Palm OS's.
      */}
      <iframe
        ref={frameRef}
        key={generation}
        src={`${origin}${manifest.entry}`}
        title={manifest.name}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-same-origin"
        className="min-h-0 flex-1 border-0 bg-white"
      />
      </>
      )}

      <ConfirmDialog
        open={confirmConvert}
        title={`Use ${manifest.name} as an app instead?`}
        description={`${manifest.primaryHost} will open in its own browser window, where it has your session and works normally. Nothing is downloaded, so it needs a connection.`}
        confirmLabel="Use as an app"
        onConfirm={() => {
          setConfirmConvert(false);
          void convertToLive(manifest.id).then((live) => {
            if (live) os.openApp(siteAppId(live.id));
          });
        }}
        onCancel={() => setConfirmConvert(false)}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          The downloaded copy is removed. It cannot be made to work — the pages are here, but the
          server they talk to is not, and no archive can stand in for that. You can download it
          again later if you want to.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Shown instead of an application that cannot work as installed.
 *
 * Not a warning bar over a broken page — the page *is* the problem, so it is
 * replaced by something that says what is wrong and offers the three things
 * that might help. "Show it anyway" is there because being told no by software
 * that will not let you look is its own kind of broken.
 */
function NeedsConnection({
  manifest,
  onAllowNetwork,
  onUseAsApp,
  onRunAnyway,
}: {
  manifest: AppManifest;
  onAllowNetwork: () => void;
  onUseAsApp: () => void;
  onRunAnyway: () => void;
}) {
  const reasons = manifest.diagnostics;

  return (
    <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/15 text-warn">
          <Icon name="CloudOff" size={26} />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-ink">
            {manifest.name} needs a live connection
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            Its files were downloaded and are here. What could not be downloaded is the server they
            talk to — {manifest.primaryHost} does the actual work, and no archive can stand in for
            that. Network access is off for this application, so it would load and then fail at
            every request.
          </p>
        </div>

        <Notice tone="neutral" icon="Info" className="w-full text-left">
          {reasons.websockets.length > 0
            ? 'It opens a live connection, which only works against the real service. '
            : ''}
          {reasons.backendHints.length > 0
            ? `It calls ${reasons.backendHints.slice(0, 3).join(', ')} on its own server. `
            : ''}
          Turning network access on lets it reach that server through Palm OS — but without your
          cookies, so anything behind a sign-in still will not work.
        </Notice>

        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon="ExternalLink" onClick={onUseAsApp}>
            Use it as an app instead
          </Button>
          <Button variant="secondary" icon="Wifi" onClick={onAllowNetwork}>
            Allow network access
          </Button>
          <Button variant="ghost" icon="Eye" onClick={onRunAnyway}>
            Show it anyway
          </Button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-3">
          “Use it as an app” keeps it in your start menu but opens the real site in its own window —
          where it has your session and works properly. Nothing is downloaded, so it needs a
          connection.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- *
 * Pieces
 * --------------------------------------------------------------------- */

function StatusChip({ manifest }: { manifest: AppManifest }) {
  const tone =
    manifest.status === ARCHIVE_STATUS.complete
      ? 'bg-ok/15 text-ok'
      : manifest.status === ARCHIVE_STATUS.partial
        ? 'bg-warn/15 text-warn'
        : 'bg-danger/15 text-danger';

  return (
    <span
      className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium', tone)}
      title={statusSummary(manifest)}
    >
      {statusLabel(manifest.status)}
    </span>
  );
}

function DetailsPanel({
  manifest,
  origin,
  onTogglePermission,
  onRecheck,
}: {
  manifest: AppManifest;
  origin: string;
  onTogglePermission: (permission: AppPermission, enabled: boolean) => void;
  onRecheck: () => void;
}) {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <div className="os-scroll max-h-[45%] shrink-0 overflow-y-auto border-b border-edge/8 bg-surface-2/50 p-3">
      <Notice
        tone={
          manifest.status === ARCHIVE_STATUS.complete
            ? 'ok'
            : manifest.status === ARCHIVE_STATUS.partial
              ? 'warn'
              : 'neutral'
        }
        icon="Package"
        title={`${manifest.name} — ${statusLabel(manifest.status)}`}
      >
        {statusSummary(manifest)}
      </Notice>

      <p className="mt-2 text-[11.5px] text-ink-3">
        {manifest.fileCount} files · {formatBytes(manifest.bytes)} · installed{' '}
        {formatRelative(manifest.createdAt)}
      </p>

      {/* ----------------------------- Permissions ---------------------------- */}
      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        What this application may do
      </h4>
      <ul className="mt-1.5 flex flex-col gap-1">
        {Object.values(APP_PERMISSION_INFO).map((permission) => {
          const granted = manifest.permissions.includes(permission.id);
          return (
            <li key={permission.id} className="flex items-start gap-2 text-[11.5px]">
              <label className="flex flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={granted}
                  disabled={permission.inherent}
                  onChange={(event) => onTogglePermission(permission.id, event.target.checked)}
                  className="mt-0.5 accent-[var(--os-accent)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    <Icon name={permission.icon} size={11} />
                    {permission.label}
                    {permission.inherent ? <Badge tone="neutral">Always</Badge> : null}
                  </span>
                  <span className="block text-ink-3">{permission.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* ------------------------------ Technical ----------------------------- */}
      <button
        type="button"
        onClick={() => setShowTechnical(!showTechnical)}
        aria-expanded={showTechnical}
        className="mt-3 flex items-center gap-1 text-[11.5px] font-medium text-ink-2 hover:text-ink"
      >
        <Icon name={showTechnical ? 'ChevronDown' : 'ChevronRight'} size={12} />
        Details
      </button>

      {showTechnical ? (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-surface-3/50 p-2.5 text-[11px] text-ink-3">
          <p>
            <span className="text-ink-2">Runs on</span>{' '}
            <code className="break-all font-mono">{origin}</code>
          </p>
          <p>
            <span className="text-ink-2">Archived from</span>{' '}
            <code className="break-all font-mono">{manifest.source}</code>
          </p>
          <p>
            Its storage, cookies and service worker belong to that origin. Palm OS cannot read them,
            and it cannot read Palm OS's.
          </p>

          {manifest.missingResources.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-ink-2">
                {manifest.missingResources.length} resource
                {manifest.missingResources.length === 1 ? '' : 's'} not archived
              </summary>
              <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
                {manifest.missingResources.slice(0, 50).map((entry) => (
                  <li key={entry.url} className="break-all font-mono text-[10px]">
                    {entry.url} <span className="text-danger">({entry.reason})</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {manifest.diagnostics.websockets.length > 0 ? (
            <p className="text-warn">
              Uses a live connection ({manifest.diagnostics.websockets.slice(0, 3).join(', ')}), which
              no archive can stand in for.
            </p>
          ) : null}
          {manifest.diagnostics.backendHints.length > 0 ? (
            <p className="text-warn">
              Calls a server at {manifest.diagnostics.backendHints.slice(0, 3).join(', ')}.
            </p>
          ) : null}
          {manifest.diagnostics.serviceWorker ? (
            <p>
              The original site registers its own service worker. Palm OS serves this application
              instead, so that registration is refused.
            </p>
          ) : null}

          <Button size="sm" variant="ghost" icon="RefreshCw" onClick={onRecheck}>
            Check again for missing resources
          </Button>
        </div>
      ) : null}
    </div>
  );
}
