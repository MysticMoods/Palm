import { useCallback, useRef, useState } from 'react';

interface Snapshot {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const MAX_HISTORY = 200;
/** Keystrokes closer together than this are coalesced into one undo step. */
const COALESCE_MS = 550;

/**
 * Undo/redo for a controlled textarea.
 *
 * The browser's native undo stack is discarded the moment the value is set
 * programmatically (loading a file, replace-all), so the editor keeps its own.
 *
 * The stacks live in refs because they are large and change on every
 * keystroke; `canUndo`/`canRedo` are mirrored into state so the toolbar's
 * disabled state is driven by a render-safe value rather than by reading a ref
 * during render.
 */
export function useUndoHistory(initial: string) {
  const [text, setText] = useState(initial);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastPush = useRef(0);

  const syncFlags = useCallback(() => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }, []);

  /*
   * The stacks are mutated here, not inside a `setText` updater. React may run
   * an updater lazily, which would leave `canUndo`/`canRedo` reading a stack
   * that has not been touched yet — redo silently never became available.
   */
  const commit = useCallback(
    (next: string, selection?: { start: number; end: number }, options?: { coalesce?: boolean }) => {
      if (text === next) return;

      const now = Date.now();
      const coalesce = options?.coalesce !== false && now - lastPush.current < COALESCE_MS;

      if (!coalesce || past.current.length === 0) {
        past.current.push({
          text,
          selectionStart: selection?.start ?? text.length,
          selectionEnd: selection?.end ?? text.length,
        });
        if (past.current.length > MAX_HISTORY) past.current.shift();
      }
      lastPush.current = now;
      future.current = [];

      setText(next);
      syncFlags();
    },
    [syncFlags, text],
  );

  /** Replace the buffer without recording an undo step (e.g. on file load). */
  const reset = useCallback(
    (next: string) => {
      past.current = [];
      future.current = [];
      lastPush.current = 0;
      setText(next);
      syncFlags();
    },
    [syncFlags],
  );

  const undo = useCallback((): Snapshot | null => {
    const previous = past.current.pop();
    if (!previous) return null;
    future.current.push({
      text,
      selectionStart: previous.selectionStart,
      selectionEnd: previous.selectionEnd,
    });
    lastPush.current = 0;
    setText(previous.text);
    syncFlags();
    return previous;
  }, [syncFlags, text]);

  const redo = useCallback((): Snapshot | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push({
      text,
      selectionStart: next.selectionStart,
      selectionEnd: next.selectionEnd,
    });
    lastPush.current = 0;
    setText(next.text);
    syncFlags();
    return next;
  }, [syncFlags, text]);

  return { text, commit, reset, undo, redo, canUndo, canRedo };
}
