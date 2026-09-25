/**
 * Web applications that run live, in a window Palm OS manages but does not own.
 *
 * Some sites cannot be archived and cannot be embedded, and no amount of
 * proxying changes either fact. YouTube is the worked example: the video is not
 * in the page, the API needs your session, and the site refuses to be framed.
 *
 * What a browser *does* allow is opening a real top-level window on the real
 * origin — where the site has its own cookies, its own session and no framing
 * restriction, so it simply works. Palm OS cannot see inside that window, and
 * should not be able to; what it can do is open it, notice it is open, focus
 * it and close it. That is enough to make it feel like an application: it lives
 * in the start menu, the taskbar and search like everything else.
 *
 * The honest shape of the trade: full functionality, in a window that is not
 * painted inside the desktop.
 */

export interface ManagedWindow {
  id: string;
  url: string;
  /** The handle. Cross-origin, so only `closed`, `focus()` and `close()`. */
  handle: Window;
  openedAt: number;
}

/** How often to notice that a window was closed by the user. */
const POLL_MS = 700;

const windows = new Map<string, ManagedWindow>();
const listeners = new Set<(id: string, open: boolean) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function notify(id: string, open: boolean) {
  for (const listener of listeners) listener(id, open);
}

/**
 * Watch for windows the user closed.
 *
 * There is no event for it — `closed` is the only signal a cross-origin opener
 * gets — so this polls, and only while something is actually open.
 */
function ensurePolling() {
  if (timer !== null) return;
  timer = setInterval(() => {
    for (const [id, entry] of windows) {
      let closed = true;
      try {
        closed = entry.handle.closed;
      } catch {
        // A handle can become unusable if the window navigated somewhere that
        // severed it; treat that as closed rather than holding a dead entry.
        closed = true;
      }
      if (closed) {
        windows.delete(id);
        notify(id, false);
      }
    }
    if (windows.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }, POLL_MS);
}

export interface OpenResult {
  ok: boolean;
  /** Set when the browser refused, which is almost always a popup blocker. */
  reason?: string;
}

/**
 * Open — or focus, if it is already open — the window for an application.
 *
 * Must be called from a user gesture the first time, or the browser will
 * refuse. Launching from the start menu or a button satisfies that.
 */
export function openManaged(id: string, url: string): OpenResult {
  const existing = windows.get(id);
  if (existing && !isClosed(existing)) {
    try {
      existing.handle.focus();
    } catch {
      /* focus can be refused; the window is still open, which is what matters */
    }
    return { ok: true };
  }

  // A stable window name means a second launch reuses the same window rather
  // than scattering duplicates across the screen.
  const handle = window.open(url, `palm-${id}`, 'noopener=no,width=1200,height=800');
  if (!handle) {
    return {
      ok: false,
      reason:
        'Your browser blocked the window. Allow pop-ups for Palm OS, then open the application again.',
    };
  }

  windows.set(id, { id, url, handle, openedAt: Date.now() });
  notify(id, true);
  ensurePolling();
  return { ok: true };
}

function isClosed(entry: ManagedWindow): boolean {
  try {
    return entry.handle.closed;
  } catch {
    return true;
  }
}

export function isManagedOpen(id: string): boolean {
  const entry = windows.get(id);
  return Boolean(entry && !isClosed(entry));
}

export function focusManaged(id: string): boolean {
  const entry = windows.get(id);
  if (!entry || isClosed(entry)) return false;
  try {
    entry.handle.focus();
    return true;
  } catch {
    return false;
  }
}

export function closeManaged(id: string): boolean {
  const entry = windows.get(id);
  if (!entry) return false;
  try {
    entry.handle.close();
  } catch {
    /* already gone */
  }
  windows.delete(id);
  notify(id, false);
  return true;
}

/** Called when an application is uninstalled, or the desktop is resetting. */
export function closeAllManaged(): void {
  for (const id of [...windows.keys()]) closeManaged(id);
}

export function onManagedChange(listener: (id: string, open: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget everything without touching real windows. */
export function resetManaged(): void {
  windows.clear();
  listeners.clear();
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
