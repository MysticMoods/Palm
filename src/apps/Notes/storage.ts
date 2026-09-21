import { appNamespace, kv } from '../../core/storage/kv';

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export const NOTES_NAMESPACE = appNamespace('notes');
export const NOTES_KEY = 'notes';

export const NOTE_COLORS = ['#f0b429', '#5884ff', '#2bc4b0', '#f25ec0', '#a06bff', '#69c94a'];

export async function loadNotes(): Promise<Note[]> {
  return (await kv.get<Note[]>(NOTES_NAMESPACE, NOTES_KEY)) ?? [];
}

export async function saveNotes(notes: Note[]): Promise<void> {
  await kv.set(NOTES_NAMESPACE, NOTES_KEY, notes);
}

/** First line of the body, used when a note has no explicit title. */
export function derivedTitle(note: Note): string {
  if (note.title.trim()) return note.title.trim();
  const firstLine = note.body.split('\n').find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 60) ?? 'Untitled note';
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
