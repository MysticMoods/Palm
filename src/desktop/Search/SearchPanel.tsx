import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { TextField } from '../../components/ui/Field';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import { SEARCH_GROUP_ORDER, runSearch } from '../../core/search';
import type { SearchGroup, SearchResult } from '../../core/search';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../utils/cn';
import { panelAnchor } from '../panel-anchor';

const DEBOUNCE_MS = 140;

export function SearchPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const closePanel = useShellStore((s) => s.closePanel);
  const position = useSettingsStore((s) => s.settings.taskbarPosition);

  useClickOutside(panelRef, closePanel);

  /* Debounced search; a stale response never overwrites a newer one. */
  useEffect(() => {
    const needle = query.trim();
    if (needle.length === 0) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      runSearch(needle)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setActiveIndex(0);
        })
        .catch((err) => {
          console.warn('[palm/search] failed', err);
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const grouped = useMemo(() => {
    const groups = new Map<SearchGroup, SearchResult[]>();
    for (const result of results) {
      const list = groups.get(result.group) ?? [];
      list.push(result);
      groups.set(result.group, list);
    }
    return SEARCH_GROUP_ORDER.filter((group) => groups.has(group)).map((group) => ({
      group,
      items: groups.get(group)!,
    }));
  }, [results]);

  /** Flat order matching what the user sees, for arrow-key navigation. */
  const flat = useMemo(() => grouped.flatMap((section) => section.items), [grouped]);

  const activate = (result: SearchResult) => {
    closePanel();
    result.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePanel();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = flat[activeIndex];
      if (result) activate(result);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Search"
      onKeyDown={onKeyDown}
      className={cn(
        'anim-pop os-glass-strong absolute z-[600] flex w-[min(620px,calc(100vw-1.5rem))] flex-col',
        'overflow-hidden rounded-xl shadow-[var(--shadow-panel)]',
        'max-h-[min(560px,calc(100vh-5rem))]',
      )}
      style={panelAnchor(position, 'search')}
    >
      <div className="border-b border-edge/8 p-3">
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search apps, files, notes and settings…"
          label="Search Palm OS"
          hideLabel
          icon="Search"
          autoFocus
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="palm-search-results"
          aria-activedescendant={flat[activeIndex] ? `search-result-${flat[activeIndex].id}` : undefined}
          trailing={busy ? <Spinner size={14} className="mr-1.5" /> : undefined}
        />
      </div>

      <div id="palm-search-results" className="os-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {query.trim().length === 0 ? (
          <EmptyState
            compact
            icon="Search"
            title="Search everything"
            description="Applications, files and folders, notes and settings — all at once."
          />
        ) : flat.length === 0 && !busy ? (
          <EmptyState compact icon="FileQuestion" title="No results" description={`Nothing matches "${query}".`} />
        ) : (
          grouped.map((section) => (
            <section key={section.group} className="mb-2 last:mb-0">
              <h2 className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {section.group}
              </h2>
              <ul role="listbox" aria-label={section.group} className="flex flex-col gap-0.5">
                {section.items.map((result) => {
                  const index = flat.indexOf(result);
                  const active = index === activeIndex;
                  return (
                    <li key={result.id}>
                      <button
                        type="button"
                        id={`search-result-${result.id}`}
                        role="option"
                        aria-selected={active}
                        onClick={() => activate(result)}
                        onPointerEnter={() => setActiveIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                          active ? 'bg-accent text-accent-fg' : 'hover:bg-surface-3',
                        )}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            backgroundColor: `${result.color ?? '#8b94a8'}26`,
                            color: active ? undefined : (result.color ?? '#8b94a8'),
                          }}
                        >
                          <Icon name={result.icon} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-[13px] font-medium',
                              active ? 'text-accent-fg' : 'text-ink',
                            )}
                          >
                            {result.title}
                          </span>
                          {result.subtitle ? (
                            <span
                              className={cn(
                                'block truncate text-[11px]',
                                active ? 'text-accent-fg/75' : 'text-ink-3',
                              )}
                            >
                              {result.subtitle}
                            </span>
                          ) : null}
                        </span>
                        {active ? (
                          <span className="shrink-0 text-[10px] opacity-75">↵</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
