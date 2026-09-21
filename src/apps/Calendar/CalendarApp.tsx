import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { Select, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import {
  EVENT_COLORS,
  WEEKDAY_LABELS,
  dateKey,
  monthGrid,
  parseDateKey,
  useCalendarStore,
} from '../../core/calendar/store';
import type { CalendarEvent } from '../../core/calendar/store';
import type { AppProps } from '../../core/app-manager/types';
import { useShellStore } from '../../core/shell/store';
import { useIsNarrow } from '../../hooks/useElementWidth';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';

export default function CalendarApp({ params }: AppProps<{ date?: string }>) {
  const { os } = useOS();
  const events = useCalendarStore((s) => s.events);
  const addEvent = useCalendarStore((s) => s.add);
  const updateEvent = useCalendarStore((s) => s.update);
  const removeEvent = useCalendarStore((s) => s.remove);
  const openContextMenu = useShellStore((s) => s.openContextMenu);

  const [selected, setSelected] = useState(() => params?.date ?? dateKey(new Date()));
  const [cursor, setCursor] = useState(() => parseDateKey(params?.date ?? dateKey(new Date())));
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef, 720);

  useEffect(() => {
    if (params?.date) {
      setSelected(params.date);
      setCursor(parseDateKey(params.date));
    }
  }, [params?.date]);

  useEffect(() => {
    os.window.setTitle(
      `${cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} — Calendar`,
    );
  }, [cursor, os]);

  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
    }
    return map;
  }, [events]);

  const selectedEvents = eventsByDay.get(selected) ?? [];
  const todayKey = dateKey(new Date());

  const eventMenu = (event: CalendarEvent, mouseEvent: React.MouseEvent) => {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    openContextMenu({
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      label: `${event.title} menu`,
      items: [
        { id: 'edit', label: 'Edit event', icon: 'Pencil', onSelect: () => setEditing(event) },
        { id: 'sep', separator: true },
        {
          id: 'delete',
          label: 'Delete event',
          icon: 'Trash2',
          danger: true,
          onSelect: () => setConfirmDelete(event),
        },
      ],
    });
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {/* -------------------------------- Toolbar ------------------------------ */}
      <div className="flex shrink-0 items-center gap-2 border-b border-edge/8 px-3 py-2">
        <IconButton
          icon="ChevronLeft"
          label="Previous month"
          size="sm"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        />
        <IconButton
          icon="ChevronRight"
          label="Next month"
          size="sm"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        />
        <h1 aria-live="polite" className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h1>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const now = new Date();
            setCursor(now);
            setSelected(dateKey(now));
          }}
        >
          Today
        </Button>
        <Button size="sm" variant="primary" icon="Plus" onClick={() => setEditing('new')}>
          New event
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* -------------------------------- Month ------------------------------ */}
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <div role="row" className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} role="columnheader" className="text-center text-[11px] font-medium text-ink-3">
                {label}
              </div>
            ))}
          </div>
          <div role="grid" aria-label="Month view" className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
            {grid.map((date) => {
              const key = dateKey(date);
              const outside = date.getMonth() !== cursor.getMonth();
              const dayEvents = eventsByDay.get(key) ?? [];
              const isSelected = key === selected;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${date.toLocaleDateString(undefined, { dateStyle: 'full' })}, ${dayEvents.length} events`}
                  onClick={() => setSelected(key)}
                  onDoubleClick={() => {
                    setSelected(key);
                    setEditing('new');
                  }}
                  className={cn(
                    'flex min-h-0 flex-col items-stretch overflow-hidden rounded-lg border p-1 text-left transition-colors',
                    outside ? 'border-transparent opacity-45' : 'border-edge/8',
                    isSelected ? 'border-accent bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'mb-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] tabular-nums',
                      isToday ? 'bg-accent font-bold text-accent-fg' : 'text-ink-2',
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <span className="os-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className="flex items-center gap-1 truncate rounded px-1 py-px text-[10px] leading-tight"
                        style={{ backgroundColor: `${event.color}2a`, color: event.color }}
                      >
                        <span className="h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
                        <span className="truncate">{event.title}</span>
                      </span>
                    ))}
                    {dayEvents.length > 3 ? (
                      <span className="px-1 text-[10px] text-ink-3">+{dayEvents.length - 3} more</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* --------------------------------- Day -------------------------------- */}
        <aside
          aria-label="Selected day"
          className={cn(
            'w-64 shrink-0 flex-col border-l border-edge/8 bg-surface-2/30',
            narrow ? 'hidden' : 'flex',
          )}
        >
          <div className="shrink-0 border-b border-edge/8 px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ink">
              {parseDateKey(selected).toLocaleDateString(undefined, { weekday: 'long' })}
            </p>
            <p className="text-[11.5px] text-ink-3">
              {parseDateKey(selected).toLocaleDateString(undefined, { dateStyle: 'long' })}
            </p>
          </div>

          <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {selectedEvents.length === 0 ? (
              <EmptyState
                compact
                icon="Calendar"
                title="Nothing scheduled"
                description="Double-click a day, or use New event."
              />
            ) : (
              <ul className="flex flex-col gap-1">
                {selectedEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(event)}
                      onContextMenu={(mouseEvent) => eventMenu(event, mouseEvent)}
                      className="w-full rounded-lg border-l-[3px] bg-surface-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-3"
                      style={{ borderLeftColor: event.color }}
                    >
                      <span className="block truncate text-[12.5px] font-medium text-ink">{event.title}</span>
                      <span className="block text-[11px] text-ink-3">{event.time || 'All day'}</span>
                      {event.notes ? (
                        <span className="mt-0.5 block line-clamp-2 text-[11px] text-ink-3">{event.notes}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-edge/8 p-2">
            <Button size="sm" variant="secondary" icon="Plus" fullWidth onClick={() => setEditing('new')}>
              Add event
            </Button>
          </div>
        </aside>
      </div>

      {editing ? (
        <EventDialog
          event={editing === 'new' ? null : editing}
          date={selected}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            if (editing === 'new') addEvent(values);
            else updateEvent(editing.id, values);
            setEditing(null);
          }}
          onDelete={editing === 'new' ? undefined : () => setConfirmDelete(editing)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        description="The event will be removed from your calendar."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDelete) removeEvent(confirmDelete.id);
          setConfirmDelete(null);
          setEditing(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function EventDialog({
  event,
  date,
  onClose,
  onSave,
  onDelete,
}: {
  event: CalendarEvent | null;
  date: string;
  onClose: () => void;
  onSave: (values: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [day, setDay] = useState(event?.date ?? date);
  const [time, setTime] = useState(event?.time ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [color, setColor] = useState(event?.color ?? EVENT_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!title.trim()) {
      setError('Give the event a title.');
      return;
    }
    onSave({ title: title.trim(), date: day, time, notes: notes.trim(), color });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      icon="CalendarDays"
      size="sm"
      footer={
        <>
          {onDelete ? (
            <Button variant="ghost" icon="Trash2" onClick={onDelete} className="mr-auto text-danger">
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {event ? 'Save changes' : 'Add event'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <TextField
          label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          placeholder="Team sync"
          autoFocus
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="flex gap-2">
          <TextField label="Date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <TextField
            label="Time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            hint="Leave empty for all day"
          />
        </div>
        <Select
          label="Colour"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          options={EVENT_COLORS.map((value, index) => ({
            value,
            label: ['Blue', 'Teal', 'Amber', 'Pink', 'Violet', 'Green'][index],
          }))}
        />
        <div>
          <label htmlFor="event-notes" className="mb-1.5 block text-sm font-medium text-ink-2">
            Notes
          </label>
          <textarea
            id="event-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional details"
            className="os-scroll w-full resize-y rounded-lg border border-edge/12 bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/35"
          />
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Icon name="Info" size={12} />
          Events are stored locally in this browser.
        </p>
      </div>
    </Modal>
  );
}
