import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import {
  closeManaged,
  focusManaged,
  isManagedOpen,
  onManagedChange,
  openManaged,
} from '../../core/sites/live';
import { useSitesStore } from '../../core/sites/store';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';

/**
 * The controller for a web application that runs live.
 *
 * Some sites cannot be archived and cannot be framed, and nothing Palm OS does
 * changes either fact — YouTube is the example that prompted this. What a
 * browser *does* allow is opening the real site in its own top-level window,
 * where it has its own origin, its own cookies and your actual session, and
 * simply works.
 *
 * This window is the handle on that one. It cannot show the site — reading
 * across origins is exactly what must not be possible — so it does the honest
 * thing and says what it can: whether the window is open, and how to focus,
 * close or reopen it.
 */
export default function LiveAppApp({ params }: AppProps<{ siteId?: string }>) {
  const { os } = useOS();
  const installed = useSitesStore((s) => s.installed);
  const manifest = useMemo(
    () => installed.find((candidate) => candidate.id === params?.siteId) ?? null,
    [installed, params?.siteId],
  );

  const [open, setOpen] = useState(() => (manifest ? isManagedOpen(manifest.id) : false));
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    os.window.setTitle(manifest ? `${manifest.name} — Web app` : 'Web app');
  }, [os, manifest]);

  // The user can close the window directly; there is no event for that, so the
  // manager polls and tells us.
  useEffect(() => {
    if (!manifest) return;
    setOpen(isManagedOpen(manifest.id));
    return onManagedChange((id, nowOpen) => {
      if (id === manifest.id) setOpen(nowOpen);
    });
  }, [manifest]);

  const launch = useCallback(() => {
    if (!manifest) return;
    const result = openManaged(manifest.id, manifest.source);
    setBlocked(result.ok ? null : (result.reason ?? 'The window could not be opened.'));
    setOpen(result.ok);
  }, [manifest]);

  /*
   * Opening on launch is what makes this feel like an application rather than
   * a page about an application. It is inside the click that opened the window,
   * so the browser treats it as a user gesture and allows it.
   */
  useEffect(() => {
    if (manifest && !isManagedOpen(manifest.id)) launch();
    // Only ever on first mount for this application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.id]);

  if (!manifest) {
    return (
      <EmptyState
        icon="Globe"
        title="This web app is no longer installed"
        description="It may have been removed from the App Store."
        action={
          <Button variant="secondary" icon="Package" onClick={() => os.openApp('app-store')}>
            Open the App Store
          </Button>
        }
      />
    );
  }

  return (
    <div className="os-scroll flex h-full min-h-0 flex-col overflow-y-auto bg-surface">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-8 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${manifest.color}26`, color: manifest.color }}
        >
          <Icon name={manifest.icon} size={26} />
        </span>

        <div>
          <h2 className="text-[16px] font-semibold text-ink">{manifest.name}</h2>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-ink-3">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                open ? 'bg-ok' : 'bg-ink-3/50',
              )}
              aria-hidden="true"
            />
            {open ? 'Running in its own window' : 'Not running'}
          </p>
        </div>

        {blocked ? (
          <Notice tone="warn" icon="AlertTriangle" title="The window was blocked" className="w-full text-left">
            {blocked}
          </Notice>
        ) : null}

        <div className="flex flex-wrap justify-center gap-2">
          {open ? (
            <>
              <Button variant="primary" icon="Eye" onClick={() => focusManaged(manifest.id)}>
                Bring to front
              </Button>
              <Button
                variant="ghost"
                icon="X"
                onClick={() => {
                  closeManaged(manifest.id);
                  setOpen(false);
                }}
              >
                Close it
              </Button>
            </>
          ) : (
            <Button variant="primary" icon="ExternalLink" onClick={launch}>
              Open {manifest.name}
            </Button>
          )}
        </div>

        <Notice tone="neutral" icon="Info" className="w-full text-left">
          <strong className="text-ink">{manifest.primaryHost}</strong> runs in its own browser
          window rather than inside the desktop. That is not a limitation Palm OS can design around:
          a site that refuses to be framed cannot be drawn here, and a site inside a frame is a
          third-party context, so it would not have your sign-in even if it agreed.
          <br />
          <br />
          In its own window it is the real thing — your session, your history, video and downloads
          all working. Palm OS opens it, notices when you close it, and can bring it back; it cannot
          see what is inside, which is the same boundary that protects everything else here.
        </Notice>

        <p className="break-all font-mono text-[11px] text-ink-3">{manifest.source}</p>
      </div>
    </div>
  );
}
