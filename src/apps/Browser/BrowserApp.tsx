import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import { vfs } from '../../core/filesystem/vfs';
import { notifications } from '../../core/notifications/store';
import { useShellStore } from '../../core/shell/store';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { uid } from '../../utils/misc';
import { InternalPage } from './InternalPages';
import {
  MAX_HISTORY_ENTRIES,
  createTab,
  navigateTab,
  stepTab,
} from './state';
import type { Bookmark, BrowserTab, DownloadRecord, HistoryEntry } from './state';
import {
  INTERNAL_PAGES,
  SEARCH_ENGINE_LIST,
  displayAddress,
  hostOf,
  isInternal,
  resolveAddress,
} from './url';
import type { SearchEngineId } from './url';

/** How long to wait for an embedded page before assuming it was blocked. */
const LOAD_TIMEOUT_MS = 7000;

export default function BrowserApp({ params }: AppProps<{ url?: string }>) {
  const { os } = useOS();
  const openContextMenu = useShellStore((s) => s.openContextMenu);

  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createTab(params?.url ?? INTERNAL_PAGES.start)]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [address, setAddress] = useState('');
  const [engine, setEngine] = useState<SearchEngineId>('duckduckgo');

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const addressRef = useRef<HTMLInputElement>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  /* ------------------------------ Persistence ----------------------------- */

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      os.storage.get<HistoryEntry[]>('history', []),
      os.storage.get<Bookmark[]>('bookmarks', []),
      os.storage.get<DownloadRecord[]>('downloads', []),
      os.storage.get<SearchEngineId>('engine'),
    ]).then(([storedHistory, storedBookmarks, storedDownloads, storedEngine]) => {
      if (cancelled) return;
      if (Array.isArray(storedHistory)) setHistory(storedHistory);
      if (Array.isArray(storedBookmarks)) setBookmarks(storedBookmarks);
      if (Array.isArray(storedDownloads)) setDownloads(storedDownloads);
      if (storedEngine) setEngine(storedEngine);
    });
    return () => {
      cancelled = true;
    };
  }, [os]);

  const persistHistory = useCallback(
    (entries: HistoryEntry[]) => {
      setHistory(entries);
      void os.storage.set('history', entries.slice(0, MAX_HISTORY_ENTRIES));
    },
    [os],
  );
  const persistBookmarks = useCallback(
    (entries: Bookmark[]) => {
      setBookmarks(entries);
      void os.storage.set('bookmarks', entries);
    },
    [os],
  );
  const persistDownloads = useCallback(
    (entries: DownloadRecord[]) => {
      setDownloads(entries);
      void os.storage.set('downloads', entries.slice(0, 100));
    },
    [os],
  );

  /* -------------------------------- Address ------------------------------- */

  useEffect(() => {
    setAddress(isInternal(active.url) ? active.url : displayAddress(active.url));
    setAddressError(null);
  }, [active.url, active.id]);

  useEffect(() => {
    os.window.setTitle(`${hostOf(active.url)} — Browser`);
  }, [active.url, os]);

  const updateTab = useCallback((id: string, updater: (tab: BrowserTab) => BrowserTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? updater(tab) : tab)));
  }, []);

  const go = useCallback(
    (input: string, tabId = activeId) => {
      const resolved = resolveAddress(input, engine);
      if (resolved.kind === 'rejected') {
        setAddressError(resolved.reason ?? 'That address cannot be opened.');
        return;
      }
      setAddressError(null);
      updateTab(tabId, (tab) => navigateTab(tab, resolved.url));

      if (!isInternal(resolved.url)) {
        persistHistory(
          [
            { id: uid('h'), url: resolved.url, title: hostOf(resolved.url), visitedAt: Date.now() },
            ...history.filter((entry) => entry.url !== resolved.url),
          ].slice(0, MAX_HISTORY_ENTRIES),
        );
      }
    },
    [activeId, engine, history, persistHistory, updateTab],
  );

  /* ---------------------------- Embedding status --------------------------- */

  useEffect(() => {
    clearTimeout(loadTimer.current);
    if (isInternal(active.url) || active.status !== 'loading') return;

    // A blocked frame usually never fires `load`; treat silence as a refusal.
    loadTimer.current = setTimeout(() => {
      updateTab(active.id, (tab) => (tab.status === 'loading' ? { ...tab, status: 'blocked' } : tab));
    }, LOAD_TIMEOUT_MS);

    return () => clearTimeout(loadTimer.current);
  }, [active.url, active.status, active.id, updateTab]);

  /* --------------------------------- Tabs --------------------------------- */

  const newTab = (url: string = INTERNAL_PAGES.start) => {
    const tab = createTab(url);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
    requestAnimationFrame(() => addressRef.current?.focus());
  };

  const closeTab = (id: string) => {
    setTabs((current) => {
      if (current.length === 1) return [createTab()];
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeId) {
        const index = current.findIndex((tab) => tab.id === id);
        setActiveId(next[Math.min(index, next.length - 1)].id);
      }
      return next;
    });
  };

  /* ------------------------------- Bookmarks ------------------------------- */

  const isBookmarked = bookmarks.some((bookmark) => bookmark.url === active.url);

  const toggleBookmark = () => {
    if (isInternal(active.url)) return;
    if (isBookmarked) {
      persistBookmarks(bookmarks.filter((bookmark) => bookmark.url !== active.url));
    } else {
      persistBookmarks([
        { id: uid('bm'), url: active.url, title: hostOf(active.url), addedAt: Date.now() },
        ...bookmarks,
      ]);
    }
  };

  /* ------------------------------- Downloads ------------------------------- */

  const downloadCurrent = async () => {
    if (isInternal(active.url)) return;
    setDownloading(true);
    const filename = active.url.split('/').pop()?.split('?')[0] || `${hostOf(active.url)}.html`;

    try {
      // Same-origin policy means most fetches fail here; that is expected, and
      // the fallback hands the URL to the real browser instead.
      const response = await fetch(active.url, { mode: 'cors' });
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      const blob = await response.blob();

      const folder = vfs.nodeAt('/Downloads') ?? (await vfs.mkdirp('/Downloads'));
      const name = vfs.uniqueName(folder.id, filename);
      const created = await vfs.createFile(folder.id, name, blob, blob.type || undefined);
      const savedTo = vfs.pathOf(created.id);

      persistDownloads([
        { id: uid('dl'), url: active.url, filename: name, startedAt: Date.now(), savedTo, status: 'complete' },
        ...downloads,
      ]);
      notifications.push('browser', {
        title: `Downloaded "${name}"`,
        body: `Saved to ${savedTo}`,
        actions: [{ id: 'open', label: 'Show in Files', onClick: () => os.openApp('files', { params: { path: '/Downloads' } }) }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      persistDownloads([
        {
          id: uid('dl'),
          url: active.url,
          filename,
          startedAt: Date.now(),
          status: 'failed',
          error: `Blocked by the server (${message})`,
        },
        ...downloads,
      ]);
      // Fall back to a real browser download, which is not CORS-restricted.
      window.open(active.url, '_blank', 'noopener,noreferrer');
      notifications.push('browser', {
        title: 'Handed the download to your browser',
        body: 'The server did not allow Palm OS to read the file directly.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const openExternally = () => {
    if (isInternal(active.url)) return;
    window.open(active.url, '_blank', 'noopener,noreferrer');
  };

  /* ------------------------------ Context menu ----------------------------- */

  const tabMenu = (tab: BrowserTab, event: React.MouseEvent) => {
    event.preventDefault();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      label: 'Tab menu',
      items: [
        { id: 'reload', label: 'Reload', icon: 'RefreshCw', onSelect: () => updateTab(tab.id, (t) => ({ ...t, status: 'loading' })) },
        { id: 'duplicate', label: 'Duplicate tab', icon: 'Copy', onSelect: () => newTab(tab.url) },
        { id: 'sep', separator: true },
        {
          id: 'copy-url',
          label: 'Copy',
          icon: 'Link',
          disabled: isInternal(tab.url),
          onSelect: () => void os.clipboard.writeText(tab.url).catch(() => undefined),
        },
        {
          id: 'external',
          label: 'Open in a real browser tab',
          icon: 'Share2',
          disabled: isInternal(tab.url),
          onSelect: () => window.open(tab.url, '_blank', 'noopener,noreferrer'),
        },
        { id: 'sep-2', separator: true },
        { id: 'close', label: 'Close tab', icon: 'X', danger: true, onSelect: () => closeTab(tab.id) },
      ],
    });
  };

  const canGoBack = active.historyIndex > 0;
  const canGoForward = active.historyIndex < active.history.length - 1;

  const internalProps = useMemo(
    () => ({
      page: active.url,
      bookmarks,
      history,
      downloads,
      onNavigate: (url: string) => go(url),
      onRemoveBookmark: (id: string) => persistBookmarks(bookmarks.filter((b) => b.id !== id)),
      onClearHistory: () => persistHistory([]),
      onRemoveHistory: (id: string) => persistHistory(history.filter((h) => h.id !== id)),
      onClearDownloads: () => persistDownloads([]),
    }),
    [active.url, bookmarks, downloads, go, history, persistBookmarks, persistDownloads, persistHistory],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* --------------------------------- Tabs -------------------------------- */}
      <div
        role="tablist"
        aria-label="Browser tabs"
        className="os-scroll flex shrink-0 items-end gap-1 overflow-x-auto border-b border-edge/8 bg-surface-2/50 px-1.5 pt-1.5"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveId(tab.id);
              }
            }}
            onContextMenu={(event) => tabMenu(tab, event)}
            className={cn(
              'group flex h-8 min-w-0 max-w-[190px] flex-1 cursor-default items-center gap-1.5 rounded-t-lg px-2.5 text-[12px] transition-colors',
              tab.id === activeId ? 'bg-surface text-ink' : 'text-ink-3 hover:bg-surface/60',
            )}
          >
            <Icon
              name={tab.status === 'loading' ? 'Loader' : isInternal(tab.url) ? 'House' : 'Globe'}
              size={12}
              className={cn('shrink-0', tab.status === 'loading' && 'anim-spin')}
            />
            <span className="min-w-0 flex-1 truncate">
              {isInternal(tab.url) ? tab.url.replace('palm:', '') || 'New tab' : hostOf(tab.url)}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label={`Close tab ${hostOf(tab.url)}`}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-3 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Icon name="X" size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => newTab()}
          aria-label="New tab"
          title="New tab"
          className="mb-1 ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <Icon name="Plus" size={14} />
        </button>
      </div>

      {/* ------------------------------ Address bar ----------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge/8 px-2 py-1.5">
        <IconButton
          icon="ArrowLeft"
          label="Back"
          size="sm"
          disabled={!canGoBack}
          onClick={() => updateTab(active.id, (tab) => stepTab(tab, -1))}
        />
        <IconButton
          icon="ArrowRight"
          label="Forward"
          size="sm"
          disabled={!canGoForward}
          onClick={() => updateTab(active.id, (tab) => stepTab(tab, 1))}
        />
        <IconButton
          icon="RefreshCw"
          label="Reload"
          size="sm"
          onClick={() => updateTab(active.id, (tab) => ({ ...tab, status: 'loading' }))}
        />
        <IconButton icon="House" label="Home" size="sm" onClick={() => go(INTERNAL_PAGES.start)} />

        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            go(address);
          }}
        >
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-ink-3">
              <Icon
                name={isInternal(active.url) ? 'House' : active.url.startsWith('https://') ? 'Lock' : 'Globe'}
                size={13}
              />
            </span>
            <input
              ref={addressRef}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onFocus={(event) => event.target.select()}
              placeholder="Search or enter an address"
              aria-label="search bar"
              aria-invalid={addressError ? true : undefined}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'h-8 w-full rounded-full border bg-surface-2 pl-8 pr-8 text-[12.5px] text-ink outline-none transition-colors',
                'placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/30',
                addressError ? 'border-danger' : 'border-edge/10',
              )}
            />
            <button
              type="button"
              onClick={toggleBookmark}
              disabled={isInternal(active.url)}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              className="absolute right-1.5 rounded p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-30"
            >
              <Icon name={isBookmarked ? 'Star' : 'BookmarkPlus'} size={13} />
            </button>
          </div>
        </form>

        <IconButton
          icon="Download"
          label="Download this page"
          size="sm"
          disabled={isInternal(active.url) || downloading}
          onClick={() => void downloadCurrent()}
        />
        <IconButton
          icon="Share2"
          label="Open in a real browser tab"
          size="sm"
          disabled={isInternal(active.url)}
          onClick={openExternally}
        />
        <IconButton icon="Bookmark" label="Bookmarks" size="sm" onClick={() => go(INTERNAL_PAGES.bookmarks)} />
        <IconButton icon="History" label="History" size="sm" onClick={() => go(INTERNAL_PAGES.history)} />
        <IconButton icon="Package" label="Downloads" size="sm" onClick={() => go(INTERNAL_PAGES.downloads)} />
        <IconButton icon="Info" label="About Palm Browser" size="sm" onClick={() => go(INTERNAL_PAGES.about)} />
      </div>

      {addressError ? (
        <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger" role="alert">
          {addressError}
        </div>
      ) : null}

      {/* -------------------------------- Content ------------------------------- */}
      <div className="relative min-h-0 flex-1 bg-surface">
        {isInternal(active.url) ? (
          <InternalPage {...internalProps} />
        ) : active.status === 'blocked' ? (
          <BlockedPanel url={active.url} onOpenExternally={openExternally} onRetry={() => updateTab(active.id, (tab) => ({ ...tab, status: 'loading' }))} />
        ) : (
          <>
            <iframe
              key={`${active.id}:${active.url}:${active.status}`}
              src={active.url}
              title={`Web content: ${hostOf(active.url)}`}
              onLoad={() => updateTab(active.id, (tab) => ({ ...tab, status: 'loaded' }))}
              /* Scripts and forms are allowed so real sites work, but the frame
                 is denied same-origin access and top-level navigation, so an
                 embedded page cannot reach into or replace Palm OS. */
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-white"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-edge/12 bg-surface/90 px-3 py-1.5 text-[11px] text-ink-3 shadow-[var(--shadow-pop)] backdrop-blur">
                <Icon name="Info" size={12} />
                <span>Blank page? The site is refusing to be embedded.</span>
                <button
                  type="button"
                  onClick={openExternally}
                  className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg"
                >
                  Open properly
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------ Status bar ------------------------------ */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge/8 bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">{active.url}</span>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only-focusable">Search engine</span>
          <Icon name="Search" size={11} />
          <select
            value={engine}
            onChange={(event) => {
              const value = event.target.value as SearchEngineId;
              setEngine(value);
              void os.storage.set('engine', value);
            }}
            aria-label="Default search engine"
            className="cursor-pointer bg-transparent text-[11px] text-ink-3 outline-none"
          >
            {SEARCH_ENGINE_LIST.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function BlockedPanel({
  url,
  onOpenExternally,
  onRetry,
}: {
  url: string;
  onOpenExternally: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="os-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/15 text-warn">
          <Icon name="Shield" size={26} />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-ink">{hostOf(url)} refuses to be embedded</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            The website has a security policy that prevents it from being displayed inside another webpage.
            This protection is designed to prevent clickjacking attacks and cannot be bypassed using JavaScript.
          </p>
        </div>

        <Notice tone="neutral" icon="Info" className="w-full text-left">
          Palm Browser can still bookmark the page, keep it in history and hand it to your real
          browser, which is the only place it is allowed to render.
        </Notice>

        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon="Share2" onClick={onOpenExternally}>
            Open in a real browser
          </Button>
          <Button variant="ghost" icon="RefreshCw" onClick={onRetry}>
            Re-Try
          </Button>
        </div>

        <p className="break-all font-mono text-[11px] text-ink-3">{url}</p>
      </div>
    </div>
  );
}
