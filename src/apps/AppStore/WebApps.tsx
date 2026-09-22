import { useEffect, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { Badge, EmptyState, Notice } from '../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { statusLabel, statusSummary } from '../../core/sites/manifest';
import { appOrigin, isolationStatus } from '../../core/sites/origin';
import type { IsolationStatus } from '../../core/sites/origin';
import { siteAppId, useSitesStore } from '../../core/sites/store';
import { APP_PERMISSION_INFO, ARCHIVE_STATUS } from '../../core/sites/types';
import type { AppManifest, ArchiveStatus } from '../../core/sites/types';
import { useNetwork } from '../../hooks/useSystem';
import { cn } from '../../utils/cn';
import { formatBytes, formatRelative } from '../../utils/format';

/** Sites worth trying, including one that deliberately will not work. */
const SUGGESTIONS = [
  { name: 'Example.com', url: 'https://example.com', note: 'A tiny page, good for a first try' },
  { name: 'JSON Formatter', url: 'https://jsonformatter.org', note: 'Formats JSON in the browser' },
  { name: 'Excalidraw', url: 'https://excalidraw.com', note: 'Drawing, entirely client-side' },
  { name: 'TinyPNG', url: 'https://tinypng.com', note: 'Needs a server — a good counter-example' },
];

/** Badge tone per archive status, so the list can be scanned at a glance. */
const STATUS_TONE: Record<ArchiveStatus, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  [ARCHIVE_STATUS.complete]: 'ok',
  [ARCHIVE_STATUS.partial]: 'warn',
  [ARCHIVE_STATUS.onlineRequired]: 'neutral',
  [ARCHIVE_STATUS.failed]: 'danger',
};

export function WebApps({ onOpen }: { onOpen: (appId: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [captureRuntime, setCaptureRuntime] = useState(true);
  const [pendingInstall, setPendingInstall] = useState<{ url: string; name: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AppManifest | null>(null);
  const [isolation, setIsolation] = useState<IsolationStatus | null>(null);

  const installed = useSitesStore((s) => s.installed);
  const downloading = useSitesStore((s) => s.downloading);
  const install = useSitesStore((s) => s.install);
  const uninstall = useSitesStore((s) => s.uninstall);
  const setPermissions = useSitesStore((s) => s.setPermissions);
  const reinstall = useSitesStore((s) => s.reinstall);
  const missingArchives = useSitesStore((s) => s.missingArchives);
  const network = useNetwork();

  useEffect(() => {
    let cancelled = false;
    void isolationStatus().then((status) => {
      if (!cancelled) setIsolation(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = Object.entries(downloading);
  const canInstall = isolation?.available === true && isolation.serviceWorkers;

  const begin = () => {
    const target = url.trim();
    if (!target) return;
    setPendingInstall({ url: target, name: name.trim() });
  };

  const confirmInstall = async () => {
    const request = pendingInstall;
    setPendingInstall(null);
    if (!request) return;
    setUrl('');
    setName('');
    await install(request.url, {
      name: request.name || undefined,
      captureRuntime,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="neutral" icon="Package" title="Install a web application to use it offline">
        Palm OS downloads the page and everything it needs to run, then installs it on an origin of
        its own. This suits things that do their work <strong>in the browser</strong> — an editor, a
        drawing tool, a calculator, a formatter.
        <br />
        <br />
        It cannot help a site whose work happens on a server. YouTube, Gmail, Google Docs, a social
        feed, anything you sign in to: the page is only the front of it, and the part that matters
        stays on their machines. Those install and then do nothing useful, so Palm OS checks and
        labels them <strong>Online required</strong> rather than letting you find out by opening a
        blank window.
      </Notice>

      <IsolationNotice isolation={isolation} />

      {/* -------------------------------- Install ------------------------------- */}
      <div className="rounded-xl border border-edge/10 bg-surface-2/40 p-3.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-[2]">
            <TextField
              label="Address"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://excalidraw.com"
              icon="Globe"
              disabled={!canInstall}
              onKeyDown={(event) => {
                if (event.key === 'Enter') begin();
              }}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <TextField
              label="Name (optional)"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Taken from the page"
              disabled={!canInstall}
            />
          </div>
          <Button
            variant="primary"
            icon="Download"
            disabled={!canInstall || !url.trim() || !network.online}
            onClick={begin}
          >
            Install
          </Button>
        </div>

        <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[11.5px] text-ink-2">
          <input
            type="checkbox"
            checked={captureRuntime}
            disabled={!canInstall}
            onChange={(event) => setCaptureRuntime(event.target.checked)}
            className="mt-0.5 accent-[var(--os-accent)]"
          />
          <span>
            <span className="font-medium text-ink">Start it once to see what else it loads</span>
            <span className="block text-ink-3">
              Modern applications decide what to download while they run, so this is the only way to
              catch those pieces. It runs the application once, on its own origin, with a connection.
              Without it, anything that loads code lazily will install incomplete.
            </span>
          </span>
        </label>

        {!network.online ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-warn">
            <Icon name="WifiOff" size={12} />
            Installing needs a connection. Applications you already have keep working.
          </p>
        ) : null}
      </div>

      {/* ------------------------------- Progress ------------------------------- */}
      {busy.length > 0 ? (
        <div className="flex flex-col gap-2">
          {busy.map(([target, progress]) => (
            <div key={target} className="rounded-lg border border-accent/30 bg-accent-soft p-3">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <Icon name="Loader" size={13} className="anim-spin" />
                Installing {target}
              </p>
              <p className="mt-1 truncate text-[11.5px] text-ink-2">{progress.message}</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${progress.total > 0 ? Math.min(100, (progress.fetched / progress.total) * 100) : 5}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ------------------------------- Installed ------------------------------ */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Installed applications
        </h3>
        {installed.length === 0 ? (
          <EmptyState
            compact
            icon="Package"
            title="Nothing installed yet"
            description="Paste an address above, or try one of the suggestions."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {installed.map((manifest) => (
              <InstalledRow
                key={manifest.id}
                manifest={manifest}
                filesMissing={missingArchives.includes(manifest.id)}
                onOpen={() => onOpen(siteAppId(manifest.id))}
                onReinstall={() => void reinstall(manifest.id)}
                onRemove={() => setConfirmRemove(manifest)}
                onToggleNetwork={(enabled) =>
                  void setPermissions(
                    manifest.id,
                    enabled
                      ? [...manifest.permissions, 'NETWORK']
                      : manifest.permissions.filter((permission) => permission !== 'NETWORK'),
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------ Suggestions ----------------------------- */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Try one of these
        </h3>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion.url}>
              <button
                type="button"
                disabled={!canInstall}
                onClick={() => setUrl(suggestion.url)}
                className={cn(
                  'w-full rounded-lg border border-edge/10 bg-surface-2/40 p-2.5 text-left transition-colors',
                  'hover:border-edge/25 hover:bg-surface-2 disabled:opacity-50',
                )}
              >
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {suggestion.name}
                </span>
                <span className="block truncate text-[11px] text-ink-3">{suggestion.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <InstallWarning
        request={pendingInstall}
        captureRuntime={captureRuntime}
        isolation={isolation}
        onCancel={() => setPendingInstall(null)}
        onConfirm={() => void confirmInstall()}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove “${confirmRemove?.name ?? ''}”?`}
        description="Everything it stored on its own origin is deleted with it. You can install it again while you have a connection."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirmRemove) void uninstall(confirmRemove.id);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

/* --------------------------------------------------------------------- *
 * Pieces
 * --------------------------------------------------------------------- */

function IsolationNotice({ isolation }: { isolation: IsolationStatus | null }) {
  if (!isolation) return null;

  if (!isolation.serviceWorkers) {
    return (
      <Notice tone="warn" icon="AlertTriangle" title="Applications cannot be installed here">
        Installed applications are served by a service worker, which this browser context does not
        allow — usually a private window, or a page served over plain http from a remote host.
      </Notice>
    );
  }

  if (!isolation.available) {
    return (
      <Notice tone="danger" icon="ShieldAlert" title="Applications cannot be installed here">
        {isolation.reason} Palm OS will not fall back to running downloaded code on its own origin:
        that would give it the same access to your files and settings as the OS itself. See
        docs/DEPLOYMENT.md for what a deployment needs.
      </Notice>
    );
  }

  return (
    <Notice tone="ok" icon="ShieldCheck" title="Each application gets its own origin">
      Applications are served from{' '}
      <code className="font-mono text-[11px]">{isolation.template}</code>, separate from Palm OS at{' '}
      <code className="font-mono text-[11px]">{isolation.osOrigin}</code>. The browser keeps their
      storage, cookies and service workers apart from the OS's, and from each other's.
    </Notice>
  );
}

function InstalledRow({
  manifest,
  filesMissing,
  onOpen,
  onReinstall,
  onRemove,
  onToggleNetwork,
}: {
  manifest: AppManifest;
  filesMissing: boolean;
  onOpen: () => void;
  onReinstall: () => void;
  onRemove: () => void;
  onToggleNetwork: (enabled: boolean) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const online = manifest.permissions.includes('NETWORK');
  const origin = appOrigin(manifest.id);

  return (
    <li className="rounded-xl border border-edge/10 bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${manifest.color}26`, color: manifest.color }}
        >
          <Icon name={manifest.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">
            {manifest.name}
            {filesMissing ? (
              <Badge tone="danger">Files missing</Badge>
            ) : (
              <>
                <Badge tone={STATUS_TONE[manifest.status]}>{statusLabel(manifest.status)}</Badge>
                <Badge tone={online ? 'warn' : 'ok'}>{online ? 'Online' : 'Offline'}</Badge>
              </>
            )}
            <Badge tone="neutral">Isolated</Badge>
          </p>
          <p className="truncate text-[11px] text-ink-3">
            {manifest.primaryHost} · {manifest.fileCount} files · {formatBytes(manifest.bytes)} ·
            installed {formatRelative(manifest.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {filesMissing ? (
            <Button size="sm" variant="primary" icon="Download" onClick={onReinstall}>
              Download again
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon="Play" onClick={onOpen}>
              Open
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="Info" onClick={() => setShowDetails(!showDetails)}>
            Details
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
        {filesMissing
          ? `The files for this application are no longer on its origin — either this is a restored backup, or the browser reclaimed the space. Palm OS still knows what it was, and can download it again from ${manifest.primaryHost}.`
          : statusSummary(manifest)}
      </p>

      {showDetails ? (
        <div className="mt-2.5 flex flex-col gap-2 rounded-lg bg-surface-3/40 p-2.5 text-[11px] text-ink-3">
          <p>
            <span className="text-ink-2">Runs on</span>{' '}
            <code className="break-all font-mono">{origin ?? 'unavailable'}</code>
          </p>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={online}
              onChange={(event) => onToggleNetwork(event.target.checked)}
              className="mt-0.5 accent-[var(--os-accent)]"
            />
            <span>
              <span className="font-medium text-ink">{APP_PERMISSION_INFO.NETWORK.label}</span>
              <span className="block">{APP_PERMISSION_INFO.NETWORK.description}</span>
            </span>
          </label>

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
        </div>
      ) : null}
    </li>
  );
}

/**
 * The dialog shown before anything is downloaded.
 *
 * It exists because installing one of these is a real decision: it runs code
 * somebody else wrote. Saying so plainly, once, is worth more than any number
 * of warnings buried in a settings panel.
 */
function InstallWarning({
  request,
  captureRuntime,
  isolation,
  onCancel,
  onConfirm,
}: {
  request: { url: string; name: string } | null;
  captureRuntime: boolean;
  isolation: IsolationStatus | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={request !== null}
      onClose={onCancel}
      title="Install this web application?"
      icon="ShieldAlert"
      tone="warn"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" icon="Download" onClick={onConfirm}>
            Install
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
        <p className="break-all font-mono text-[11.5px] text-ink-3">{request?.url}</p>

        <p>
          This downloads a web application and <strong className="text-ink">runs its JavaScript</strong>
          . It is code written by someone else, and Palm OS does not inspect what it does.
        </p>

        <ul className="flex flex-col gap-1.5 rounded-lg bg-surface-2 p-2.5 text-[12px]">
          <li className="flex gap-2">
            <Icon name="ShieldCheck" size={14} className="mt-px shrink-0 text-ok" />
            <span>
              It runs on <strong className="text-ink">its own origin</strong>
              {isolation?.template ? (
                <>
                  {' '}
                  (<code className="font-mono text-[11px]">{isolation.template}</code>)
                </>
              ) : null}
              , so the browser keeps it out of Palm OS's files, settings and storage — and out of
              every other installed application's.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="WifiOff" size={14} className="mt-px shrink-0 text-ok" />
            <span>
              Network access is <strong className="text-ink">off</strong> once it is installed. You
              can turn it on per application afterwards.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="Lock" size={14} className="mt-px shrink-0 text-ok" />
            <span>
              It gets no camera, microphone, location, or access to your files unless you grant it.
            </span>
          </li>
          {captureRuntime ? (
            <li className="flex gap-2">
              <Icon name="Play" size={14} className="mt-px shrink-0 text-warn" />
              <span>
                During installation it will be{' '}
                <strong className="text-ink">started once with a connection</strong>, so the pieces it
                loads while running can be captured.
              </span>
            </li>
          ) : null}
          <li className="flex gap-2">
            <Icon name="AlertTriangle" size={14} className="mt-px shrink-0 text-warn" />
            <span>
              The copy may be <strong className="text-ink">incomplete</strong> if the original relies
              on a server or loads code in ways that cannot be predicted. Palm OS will say which,
              afterwards.
            </span>
          </li>
        </ul>
      </div>
    </Modal>
  );
}
