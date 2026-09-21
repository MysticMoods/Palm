/**
 * Calendar events.
 *
 * Shared between the Calendar application and the taskbar's clock panel, so it
 * lives in core rather than inside the app.
 */

import { create } from 'zustand';
import { uid } from '../../utils/misc';
import { appNamespace, kv } from '../storage/kv';
import { attachPersistence } from '../storage/persist';

export interface CalendarEvent {
  id: string;
  title: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, or empty for an all-day event. */
  time: string;
  notes: string;
  color: string;
  createdAt: number;
}

export const EVENT_COLORS = ['#5884ff', '#2bc4b0', '#f0a030', '#f25ec0', '#a06bff', '#69c94a'];

interface CalendarState {
  events: CalendarEvent[];
  add: (event: Omit<CalendarEvent, 'id' | 'createdAt'>) => CalendarEvent;
  update: (id: string, values: Partial<Omit<CalendarEvent, 'id'>>) => void;
  remove: (id: string) => void;
  forDate: (date: string) => CalendarEvent[];
  replaceAll: (events: CalendarEvent[]) => void;
}

/** `YYYY-MM-DD` in the *local* timezone (toISOString would shift the day). */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

const byTime = (a: CalendarEvent, b: CalendarEvent) => {
  if (a.time === b.time) return a.title.localeCompare(b.title);
  if (!a.time) return -1;
  if (!b.time) return 1;
  return a.time.localeCompare(b.time);
};

export const useCalendarStore = create<CalendarState>()((set, get) => ({
  events: [],

  add: (input) => {
    const event: CalendarEvent = { ...input, id: uid('evt'), createdAt: Date.now() };
    set((state) => ({ events: [...state.events, event] }));
    return event;
  },

  update: (id, values) =>
    set((state) => ({
      events: state.events.map((event) => (event.id === id ? { ...event, ...values } : event)),
    })),

  remove: (id) => set((state) => ({ events: state.events.filter((event) => event.id !== id) })),

  forDate: (date) => get().events.filter((event) => event.date === date).sort(byTime),

  replaceAll: (events) => set({ events }),
}));

export async function hydrateCalendar(): Promise<void> {
  await attachPersistence(useCalendarStore, {
    namespace: appNamespace('calendar'),
    key: 'events',
    pick: (state) => state.events,
    merge: (events) => {
      if (Array.isArray(events)) useCalendarStore.setState({ events });
    },
  });
}

/** Direct read for the exporter. */
export async function readStoredEvents(): Promise<CalendarEvent[]> {
  return (await kv.get<CalendarEvent[]>(appNamespace('calendar'), 'events')) ?? [];
}

/** Days in a month grid, padded to whole weeks starting on Monday. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
