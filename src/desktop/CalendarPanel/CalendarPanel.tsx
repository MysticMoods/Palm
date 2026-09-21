import { useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import {
  WEEKDAY_LABELS,
  dateKey,
  monthGrid,
  useCalendarStore,
} from '../../core/calendar/store';
import { OS } from '../../core/os';
import { useSettingsStore } from '../../core/settings/store';
import { useShellStore } from '../../core/shell/store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useClock } from '../../hooks/useClock';
import { cn } from '../../utils/cn';
import { formatDayDate, formatTime } from '../../utils/format';
import { panelAnchor } from '../panel-anchor';

export function CalendarPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const closePanel = useShellStore((s) => s.closePanel);
  const settings = useSettingsStore((s) => s.settings);
  const now = useClock(settings.showClockSeconds);

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));

  const events = useCalendarStore((s) => s.events);
  useClickOutside(panelRef, closePanel);

  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const eventDays = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.date, (counts.get(event.date) ?? 0) + 1);
    return counts;
  }, [events]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((event) => event.date === selected)
        .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00')),
    [events, selected],
  );

  const todayKey = dateKey(new Date());

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Calendar"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closePanel();
      }}
      className={cn(
        'anim-pop os-glass-strong absolute z-[600] w-[min(340px,calc(100vw-1.5rem))]',
        'overflow-hidden rounded-xl shadow-[var(--shadow-panel)]',
      )}
      style={panelAnchor(settings.taskbarPosition, 'tray')}
    >
      <header className="border-b border-edge/8 px-4 py-3 text-center">
        <p className="text-2xl font-light tabular-nums text-ink">
          {formatTime(now, { seconds: settings.showClockSeconds, hour24: settings.use24HourClock })}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-3">{formatDayDate(now)}</p>
      </header>

      <div className="px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="ChevronLeft" size={15} />
          </button>
          <p aria-live="polite" className="text-[13px] font-semibold text-ink">
            {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </p>
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Next month"
            className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="ChevronRight" size={15} />
          </button>
        </div>

        <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-0.5">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} role="columnheader" className="pb-1 text-center text-[10.5px] font-medium text-ink-3">
              {label}
            </div>
          ))}
          {grid.map((date) => {
            const key = dateKey(date);
            const outside = date.getMonth() !== cursor.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selected;
            const count = eventDays.get(key) ?? 0;
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${date.toLocaleDateString(undefined, { dateStyle: 'full' })}${count > 0 ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`}
                onClick={() => setSelected(key)}
                className={cn(
                  'relative flex h-8 items-center justify-center rounded-md text-[12px] tabular-nums transition-colors',
                  outside ? 'text-ink-3/50' : 'text-ink-2',
                  isSelected && 'bg-accent text-accent-fg',
                  !isSelected && isToday && 'font-bold text-accent ring-1 ring-accent/50',
                  !isSelected && 'hover:bg-surface-3',
                )}
              >
                {date.getDate()}
                {count > 0 ? (
                  <span
                    className={cn(
                      'absolute bottom-1 h-1 w-1 rounded-full',
                      isSelected ? 'bg-accent-fg' : 'bg-accent',
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="os-scroll max-h-44 overflow-y-auto border-t border-edge/8 px-3 py-2.5">
        {dayEvents.length === 0 ? (
          <p className="py-2 text-center text-[12px] text-ink-3">No events on this day.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dayEvents.map((event) => (
              <li key={event.id} className="flex items-start gap-2 rounded-md px-1.5 py-1">
                <span
                  aria-hidden="true"
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: event.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{event.title}</span>
                  <span className="block text-[11px] text-ink-3">{event.time || 'All day'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-edge/8 bg-surface-2/40 p-2.5">
        <Button
          size="sm"
          variant="ghost"
          icon="CalendarDays"
          fullWidth
          onClick={() => {
            closePanel();
            OS.openApp('calendar', { params: { date: selected } });
          }}
        >
          Open Calendar
        </Button>
      </div>
    </div>
  );
}
