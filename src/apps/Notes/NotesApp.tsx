import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import type { AppProps } from '../../core/app-manager/types';
import { useShellStore } from '../../core/shell/store';
import { vfs } from '../../core/filesystem/vfs';
import { notifications } from '../../core/notifications/store';
import { useIsNarrow } from '../../hooks/useElementWidth';
import { useOS } from '../../desktop/app-context';
import { usePermissionGate } from '../../desktop/use-permission';
import { cn } from '../../utils/cn';
import { formatRelative } from '../../utils/format';
import { uid } from '../../utils/misc';
import { NOTE_COLORS, derivedTitle, loadNotes, saveNotes, sortNotes } from './storage';
import type { Note } from './storage';

const AUTOSAVE_MS = 500;

export default function NotesApp({ params }: AppProps<{ noteId?: string }>) {
  const { os } = useOS();
  const ensureFilesystem = usePermissionGate(
    'filesystem',
    'Save a copy of a note into your Documents folder.',
  );
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params?.noteId ?? null);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef, 560);
  /** In single-pane mode, which pane is on screen. */
  const [pane, setPane] = useState<'list' | 'editor'>('list');
  const openContextMenu = useShellStore((s) => s.openContextMenu);

  /* --------------------------------- Load -------------------------------- */

  useEffect(() => {
    let cancelled = false;
    void loadNotes().then((stored) => {
      if (cancelled) return;
      setNotes(stored);
      setActiveId((current) => current ?? sortNotes(stored)[0]?.id ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (params?.noteId) setActiveId(params.noteId);
  }, [params?.noteId]);

  /* ------------------------------- Autosave ------------------------------ */

  const pendingRef = useRef<Note[] | null>(null);
  useEffect(() => {
    if (!loaded) return;
    pendingRef.current = notes;
    const timer = setTimeout(() => {
      const snapshot = pendingRef.current;
      if (!snapshot) return;
      void saveNotes(snapshot)
        .then(() => setSavedAt(Date.now()))
        .catch((err) =>
          notifications.push('notes', {
            title: 'Could not save notes',
            body: err instanceof Error ? err.message : String(err),
            urgency: 'critical',
          }),
        );
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [notes, loaded]);

  /* --------------------------------- Data -------------------------------- */

  const sorted = useMemo(() => sortNotes(notes), [notes]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle),
    );
  }, [sorted, query]);

  const active = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    os.window.setTitle(active ? `${derivedTitle(active)} — Notes` : 'Notes');
  }, [active, os]);

  /* -------------------------------- Actions ------------------------------ */

  const createNote = useCallback(() => {
    const note: Note = {
      id: uid('note'),
      title: '',
      body: '',
      pinned: false,
      color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setPane('editor');
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  const updateNote = useCallback((id: string, values: Partial<Note>) => {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, ...values, updatedAt: Date.now() } : note)),
    );
  }, []);

  const deleteNote = useCallback(
    (note: Note) => {
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setActiveId((current) => (current === note.id ? null : current));
      setConfirmDelete(null);
      notifications.push('notes', {
        title: `Deleted "${derivedTitle(note)}"`,
        actions: [
          {
            id: 'undo',
            label: 'Undo',
            onClick: () => {
              setNotes((current) => [note, ...current]);
              setActiveId(note.id);
            },
          },
        ],
      });
    },
    [],
  );

  const exportNote = useCallback(
    async (note: Note) => {
      if (!(await ensureFilesystem())) return;
      const documents = vfs.nodeAt('/Documents');
      if (!documents) return;
      const name = vfs.uniqueName(documents.id, `${derivedTitle(note).replace(/[/\\]/g, '-')}.md`);
      const content = `# ${derivedTitle(note)}\n\n${note.body}\n`;
      try {
        const created = await vfs.createFile(documents.id, name, content, 'text/markdown');
        notifications.push('notes', {
          title: `Saved "${name}" to Documents`,
          actions: [{ id: 'open', label: 'Open', onClick: () => os.openFile(vfs.pathOf(created.id)) }],
        });
      } catch (err) {
        notifications.push('notes', {
          title: 'Could not export note',
          body: err instanceof Error ? err.message : String(err),
          urgency: 'critical',
        });
      }
    },
    [ensureFilesystem, os],
  );

  const noteMenu = (note: Note, event: React.MouseEvent) => {
    event.preventDefault();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      label: `${derivedTitle(note)} menu`,
      items: [
        {
          id: 'pin',
          label: note.pinned ? 'Unpin' : 'Pin to top',
          icon: note.pinned ? 'PinOff' : 'Pin',
          onSelect: () => updateNote(note.id, { pinned: !note.pinned }),
        },
        {
          id: 'colour',
          label: 'Colour',
          icon: 'Palette',
          items: NOTE_COLORS.map((color, index) => ({
            id: `colour-${color}`,
            label: ['Amber', 'Blue', 'Teal', 'Pink', 'Violet', 'Green'][index],
            checked: note.color === color,
            onSelect: () => updateNote(note.id, { color }),
          })),
        },
        { id: 'sep', separator: true },
        {
          id: 'copy',
          label: 'Copy text',
          icon: 'Copy',
          onSelect: () => void os.clipboard.writeText(note.body).catch(() => undefined),
        },
        {
          id: 'export',
          label: 'Save to Documents',
          icon: 'Save',
          onSelect: () => void exportNote(note),
        },
        { id: 'sep-2', separator: true },
        {
          id: 'delete',
          label: 'Delete note',
          icon: 'Trash2',
          danger: true,
          onSelect: () => setConfirmDelete(note),
        },
      ],
    });
  };

  const words = active ? active.body.trim().split(/\s+/).filter(Boolean).length : 0;

  const showList = !narrow || pane === 'list';
  const showEditor = !narrow || pane === 'editor';

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      {/* -------------------------------- List -------------------------------- */}
      <div
        className={cn(
          'flex shrink-0 flex-col border-r border-edge/8 bg-surface-2/30',
          narrow ? 'w-full' : 'w-60',
          showList ? 'flex' : 'hidden',
        )}
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b border-edge/8 p-2">
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            label="Search notes"
            hideLabel
            icon="Search"
            className="[&_input]:h-8 [&_input]:text-[12px]"
          />
          <IconButton icon="Plus" label="New note" size="sm" variant="primary" onClick={createNote} />
        </div>

        <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {!loaded ? null : filtered.length === 0 ? (
            <EmptyState
              compact
              icon="Notebook"
              title={query ? 'No matching notes' : 'No notes yet'}
              description={query ? undefined : 'Create your first note to get started.'}
              action={
                query ? null : (
                  <Button size="sm" variant="secondary" icon="Plus" onClick={createNote}>
                    New note
                  </Button>
                )
              }
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(note.id);
                      setPane('editor');
                    }}
                    onContextMenu={(event) => noteMenu(note, event)}
                    aria-current={note.id === activeId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-lg border-l-[3px] px-2.5 py-2 text-left transition-colors',
                      note.id === activeId ? 'bg-surface-3' : 'hover:bg-surface-2',
                    )}
                    style={{ borderLeftColor: note.color }}
                  >
                    <span className="flex items-center gap-1">
                      {note.pinned ? <Icon name="Pin" size={10} className="shrink-0 text-ink-3" /> : null}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                        {derivedTitle(note)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                      {note.body.split('\n')[0]?.slice(0, 50) || 'No additional text'}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-3">
                      {formatRelative(note.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ------------------------------- Editor ------------------------------- */}
      <div className={cn('min-w-0 flex-1 flex-col', showEditor ? 'flex' : 'hidden')}>
        {active ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-edge/8 px-3 py-2">
              {narrow ? (
                <IconButton
                  icon="ArrowLeft"
                  label="Back to the note list"
                  size="sm"
                  onClick={() => setPane('list')}
                />
              ) : null}
              <input
                value={active.title}
                onChange={(event) => updateNote(active.id, { title: event.target.value })}
                placeholder={derivedTitle(active)}
                aria-label="Note title"
                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
              />
              <IconButton
                icon={active.pinned ? 'PinOff' : 'Pin'}
                label={active.pinned ? 'Unpin note' : 'Pin note'}
                size="sm"
                active={active.pinned}
                onClick={() => updateNote(active.id, { pinned: !active.pinned })}
              />
              <IconButton
                icon="Save"
                label="Save a copy to Documents"
                size="sm"
                onClick={() => void exportNote(active)}
              />
              <IconButton
                icon="Trash2"
                label="Delete note"
                size="sm"
                onClick={() => setConfirmDelete(active)}
              />
            </div>

            <textarea
              ref={bodyRef}
              value={active.body}
              onChange={(event) => updateNote(active.id, { body: event.target.value })}
              placeholder="Start typing…"
              aria-label="Note body"
              spellCheck
              className="os-scroll min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
            />

            <div
              role="status"
              className="flex shrink-0 items-center justify-between gap-3 border-t border-edge/8 bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-3"
            >
              <span>
                {words} {words === 1 ? 'word' : 'words'} · {active.body.length} characters
              </span>
              <span>{savedAt ? `Saved ${formatRelative(savedAt)}` : 'Saves automatically'}</span>
            </div>
          </>
        ) : (
          <EmptyState
            icon="Notebook"
            title="Select a note"
            description="Choose a note on the left, or create a new one."
            action={
              <Button variant="primary" icon="Plus" onClick={createNote}>
                New note
              </Button>
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete ? derivedTitle(confirmDelete) : ''}"?`}
        description="You can undo this from the notification that appears."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete && deleteNote(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
