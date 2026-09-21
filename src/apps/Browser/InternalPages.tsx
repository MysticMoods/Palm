import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { OS_NAME, OS_VERSION } from '../../core/settings/defaults';
import { formatRelative } from '../../utils/format';
import type { Bookmark, DownloadRecord, HistoryEntry } from './state';
import { EMBEDDABLE_SUGGESTIONS, hostOf } from './url';

interface InternalPageProps {
  page: string;
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  downloads: DownloadRecord[];
  onNavigate: (url: string) => void;
  onRemoveBookmark: (id: string) => void;
  onClearHistory: () => void;
  onRemoveHistory: (id: string) => void;
  onClearDownloads: () => void;
}

/**
 * The `palm:` pages.
 *
 * These are real React views rather than HTML strings — nothing user-supplied
 * is ever interpreted as markup, so a page title cannot smuggle script into
 * the browser chrome.
 */
export function InternalPage(props: InternalPageProps) {
  switch (props.page) {
    case 'palm:bookmarks':
      return <BookmarksPage {...props} />;
    case 'palm:history':
      return <HistoryPage {...props} />;
    case 'palm:downloads':
      return <DownloadsPage {...props} />;
    case 'palm:about':
      return <AboutPage />;
    default:
      return <StartPage {...props} />;
  }
}

function PageShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="os-scroll h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[18px] font-semibold text-ink">{title}</h1>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

function StartPage({ bookmarks, history, onNavigate }: InternalPageProps) {
  const recent = history.slice(0, 8);
  return (
    <div className="os-scroll h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
            <Icon name="Compass" size={26} />
          </div>
          <h1 className="text-[20px] font-semibold text-ink">Palm Browser</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Surf the internt by using the address bar above.
          </p>
        </div>

        <Notice tone="warn" icon="Info" title="Most websites refuse to be embedded" className="mb-6">
          A page inside another page is an iframe, and the majority of sites send{' '}
          <code className="font-mono text-[11px]">X-Frame-Options: DENY</code> or a restrictive{' '}
          <code className="font-mono text-[11px]">frame-ancestors</code> policy to prevent it. No
          browser-based application can override that — it is a security boundary enforced by your
          browser. When a site refuses, Palm Browser offers to open it in a real browser tab instead.
        </Notice>

        {bookmarks.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Bookmarks</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {bookmarks.slice(0, 12).map((bookmark) => (
                <Tile
                  key={bookmark.id}
                  title={bookmark.title}
                  subtitle={hostOf(bookmark.url)}
                  onClick={() => onNavigate(bookmark.url)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Suggested sites
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {EMBEDDABLE_SUGGESTIONS.map((site) => (
              <Tile
                key={site.url}
                title={site.name}
                subtitle={site.description}
                onClick={() => onNavigate(site.url)}
              />
            ))}
          </div>
        </section>

        {recent.length > 0 ? (
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Recent</h2>
            <ul className="flex flex-col gap-px">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(entry.url)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Icon name="Clock" size={13} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{entry.title}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">{formatRelative(entry.visitedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-edge/10 bg-surface-2/50 p-3 text-left transition-colors hover:border-edge/20 hover:bg-surface-2"
    >
      <span className="block truncate text-[12.5px] font-medium text-ink">{title}</span>
      <span className="mt-0.5 block truncate text-[11px] text-ink-3">{subtitle}</span>
    </button>
  );
}

function BookmarksPage({ bookmarks, onNavigate, onRemoveBookmark }: InternalPageProps) {
  return (
    <PageShell title="Bookmarks">
      {bookmarks.length === 0 ? (
        <EmptyState
          icon="Bookmark"
          title="No bookmarks yet"
          description="Use the star in the address bar to save a page."
        />
      ) : (
        <ul className="flex flex-col gap-px">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-2">
              <Icon name="Bookmark" size={14} className="shrink-0 text-accent-ink" />
              <button
                type="button"
                onClick={() => onNavigate(bookmark.url)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[12.5px] text-ink">{bookmark.title}</span>
                <span className="block truncate text-[11px] text-ink-3">{bookmark.url}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemoveBookmark(bookmark.id)}
                aria-label={`Remove bookmark "${bookmark.title}"`}
                className="shrink-0 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon name="X" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function HistoryPage({ history, onNavigate, onClearHistory, onRemoveHistory }: InternalPageProps) {
  return (
    <PageShell
      title="History"
      action={
        history.length > 0 ? (
          <Button size="sm" variant="ghost" icon="Trash2" onClick={onClearHistory}>
            Clear history
          </Button>
        ) : null
      }
    >
      {history.length === 0 ? (
        <EmptyState icon="History" title="No history" description="Pages you visit will be listed here." />
      ) : (
        <ul className="flex flex-col gap-px">
          {history.map((entry) => (
            <li key={entry.id} className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-2">
              <Icon name="Clock" size={14} className="shrink-0 text-ink-3" />
              <button type="button" onClick={() => onNavigate(entry.url)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] text-ink">{entry.title}</span>
                <span className="block truncate text-[11px] text-ink-3">{entry.url}</span>
              </button>
              <span className="shrink-0 text-[11px] text-ink-3">{formatRelative(entry.visitedAt)}</span>
              <button
                type="button"
                onClick={() => onRemoveHistory(entry.id)}
                aria-label="Remove from history"
                className="shrink-0 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon name="X" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function DownloadsPage({ downloads, onClearDownloads }: InternalPageProps) {
  return (
    <PageShell
      title="Downloads"
      action={
        downloads.length > 0 ? (
          <Button size="sm" variant="ghost" icon="Trash2" onClick={onClearDownloads}>
            Clear list
          </Button>
        ) : null
      }
    >
      <Notice tone="neutral" icon="Info" title="How downloads work here" className="mb-4">
        saves it into your Palm OS <code className="font-mono">/Downloads</code>{' '}
        folder. That only works when the server allows cross-origin reads (CORS); most do not, so the
        file is handed to your real browser's downloads instead.
      </Notice>

      {downloads.length === 0 ? (
        <EmptyState compact icon="Download" title="Nothing downloaded yet" />
      ) : (
        <ul className="flex flex-col gap-1">
          {downloads.map((download) => (
            <li
              key={download.id}
              className="flex items-center gap-2.5 rounded-lg border border-edge/10 bg-surface-2/40 px-3 py-2"
            >
              <Icon
                name={download.status === 'complete' ? 'CircleCheck' : 'CircleAlert'}
                size={15}
                className={download.status === 'complete' ? 'shrink-0 text-ok' : 'shrink-0 text-danger'}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{download.filename}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {download.savedTo ?? download.error ?? download.url}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-ink-3">{formatRelative(download.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function AboutPage() {
  return (
    <PageShell title="About Palm Browser">
      <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink-2">
        <p>
          Palm Browser is part of {OS_NAME} {OS_VERSION}. It provides tabs, an address bar, history,
          bookmarks and downloads, all stored locally in this browser.
        </p>
        <Notice tone="neutral" icon="Shield" title="What it is, honestly">
          It isn't a standalone browser engine. Instead, it operates within your existing browser and displays external websites through an iframe.
          This means it is subject to all browser security restrictions, including a website's ability to prevent itself from being embedded.
          When a website blocks embedding, Palm Browser clearly informs you and provides an option to open the site normally rather than displaying an empty frame.

        </Notice>
        <Notice tone="neutral" icon="Lock" title="What it will not do">
          The address bar rejects <code className="font-mono">javascript:</code>,{' '}
          <code className="font-mono">data:</code> and <code className="font-mono">file:</code>{' '}
          addresses, embedded pages are sandboxed, and no page content is ever inserted into the Palm
          OS interface as HTML.
        </Notice>
      </div>
    </PageShell>
  );
}
