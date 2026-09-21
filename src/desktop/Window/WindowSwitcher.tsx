import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../../components/icons';
import { getApp } from '../../core/app-manager/registry';
import { useWindowStore } from '../../core/window-manager/store';
import { cn } from '../../utils/cn';

/**
 * The Alt+Tab window switcher.
 *
 * Two interaction models share one component, because Alt+Tab is unreliable on
 * the web: most desktop window managers grab it before the browser sees it.
 *
 *  • Hold mode — Alt held, Tab steps, release commits. Driven by the global
 *    key handlers, so the overlay must not take focus or the modifier release
 *    would land somewhere else.
 *  • Sticky mode — opened with Ctrl+Alt+W on hosts that swallow Alt+Tab. The
 *    overlay takes focus and is driven with the arrow keys and Enter.
 */
export function WindowSwitcher() {
  const switcher = useWindowStore((s) => s.switcher);
  const windows = useWindowStore((s) => s.windows);
  const moveSwitch = useWindowStore((s) => s.moveSwitch);
  const setSwitchIndex = useWindowStore((s) => s.setSwitchIndex);
  const commitSwitch = useWindowStore((s) => s.commitSwitch);
  const cancelSwitch = useWindowStore((s) => s.cancelSwitch);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    if (!switcher) return [];
    return switcher.order
      .map((id) => windows.find((w) => w.id === id))
      .filter((win): win is NonNullable<typeof win> => Boolean(win));
  }, [switcher, windows]);

  /* Sticky mode drives itself from the keyboard, so it needs focus. */
  useEffect(() => {
    if (switcher?.sticky) listRef.current?.focus({ preventScroll: true });
  }, [switcher?.sticky]);

  if (!switcher || entries.length < 2) return null;

  const selected = entries[Math.min(switcher.index, entries.length - 1)];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!switcher.sticky) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        moveSwitch(event.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        event.stopPropagation();
        moveSwitch(-1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        commitSwitch();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        cancelSwitch();
        break;
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[8000] flex items-center justify-center p-4">
      <div
        ref={listRef}
        role="listbox"
        aria-label="Switch window"
        aria-activedescendant={`switcher-${selected.id}`}
        tabIndex={switcher.sticky ? -1 : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          'os-glass-strong anim-pop pointer-events-auto max-w-[min(92vw,42rem)] rounded-2xl p-3',
          'shadow-[var(--shadow-panel)] outline-none',
        )}
      >
        <div className="os-scroll flex max-w-full gap-1.5 overflow-x-auto">
          {entries.map((win, index) => {
            const app = getApp(win.appId);
            const active = index === switcher.index;
            return (
              <button
                key={win.id}
                id={`switcher-${win.id}`}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                onPointerEnter={() => setSwitchIndex(index)}
                onClick={commitSwitch}
                className={cn(
                  'flex w-[104px] shrink-0 flex-col items-center gap-2 rounded-xl p-3 transition-colors',
                  active ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-2',
                )}
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${app?.color ?? '#8b94a8'}26`, color: app?.color ?? '#8b94a8' }}
                >
                  <Icon name={win.icon} size={24} />
                </span>
                <span className="w-full truncate text-center text-[11.5px] leading-tight text-ink-2">
                  {win.title}
                </span>
                {win.mode === 'minimized' ? (
                  <span className="text-[10px] text-ink-3">Minimised</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-center text-[11px] text-ink-3">
          {switcher.sticky ? '← → to choose · Enter to switch · Esc to cancel' : 'Hold Alt and press Tab'}
        </p>

        {/* The overlay only takes focus in sticky mode, so the selection is
            announced explicitly rather than relying on activedescendant. */}
        <p aria-live="assertive" className="sr-only-focusable absolute">
          {selected.title}, {switcher.index + 1} of {entries.length}
        </p>
      </div>
    </div>
  );
}
