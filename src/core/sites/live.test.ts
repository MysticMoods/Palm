// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeAllManaged,
  closeManaged,
  focusManaged,
  isManagedOpen,
  onManagedChange,
  openManaged,
  resetManaged,
} from './live';

/** A stand-in for the cross-origin handle `window.open` hands back. */
function fakeWindow() {
  return { closed: false, focus: vi.fn(), close: vi.fn() } as unknown as Window & {
    closed: boolean;
    focus: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

let opened: Array<{ url: string; name: string }>;
let handle: ReturnType<typeof fakeWindow> | null;

beforeEach(() => {
  resetManaged();
  vi.useFakeTimers();
  opened = [];
  handle = fakeWindow();
  vi.stubGlobal('open', (url: string, name: string) => {
    opened.push({ url, name });
    return handle;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openManaged', () => {
  it('opens the real address in a named window', () => {
    expect(openManaged('app-a', 'https://www.youtube.com').ok).toBe(true);
    expect(opened).toEqual([{ url: 'https://www.youtube.com', name: 'palm-app-a' }]);
    expect(isManagedOpen('app-a')).toBe(true);
  });

  it('focuses the existing window instead of opening a second one', () => {
    openManaged('app-a', 'https://www.youtube.com');
    openManaged('app-a', 'https://www.youtube.com');
    // A stable name would reuse the window anyway, but opening twice would
    // still flash and re-navigate it.
    expect(opened).toHaveLength(1);
    expect(handle!.focus).toHaveBeenCalled();
  });

  it('opens again once the old window is gone', () => {
    openManaged('app-a', 'https://www.youtube.com');
    handle!.closed = true;
    openManaged('app-a', 'https://www.youtube.com');
    expect(opened).toHaveLength(2);
  });

  it('reports a blocked pop-up rather than failing silently', () => {
    vi.stubGlobal('open', () => null);
    const result = openManaged('app-b', 'https://www.youtube.com');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('pop-ups');
    expect(isManagedOpen('app-b')).toBe(false);
  });

  it('keeps applications apart', () => {
    const second = fakeWindow();
    openManaged('app-a', 'https://a.test');
    handle = second;
    openManaged('app-b', 'https://b.test');
    expect(isManagedOpen('app-a')).toBe(true);
    expect(isManagedOpen('app-b')).toBe(true);
    closeManaged('app-a');
    expect(isManagedOpen('app-a')).toBe(false);
    expect(isManagedOpen('app-b')).toBe(true);
  });
});

describe('noticing the user closed it', () => {
  it('reports the window as closed, and tells subscribers', () => {
    const changes: Array<[string, boolean]> = [];
    onManagedChange((id, open) => changes.push([id, open]));

    openManaged('app-a', 'https://www.youtube.com');
    expect(changes).toEqual([['app-a', true]]);

    // There is no event for this; `closed` is all a cross-origin opener gets.
    handle!.closed = true;
    vi.advanceTimersByTime(1000);

    expect(isManagedOpen('app-a')).toBe(false);
    expect(changes).toEqual([
      ['app-a', true],
      ['app-a', false],
    ]);
  });

  it('treats a handle that throws as closed rather than holding a dead entry', () => {
    openManaged('app-a', 'https://www.youtube.com');
    Object.defineProperty(handle!, 'closed', {
      get() {
        throw new Error('severed');
      },
    });
    vi.advanceTimersByTime(1000);
    expect(isManagedOpen('app-a')).toBe(false);
  });

  it('stops polling once nothing is open', () => {
    const spy = vi.spyOn(globalThis, 'clearInterval');
    openManaged('app-a', 'https://www.youtube.com');
    handle!.closed = true;
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalled();
  });
});

describe('focus and close', () => {
  it('focuses an open window and refuses a closed one', () => {
    openManaged('app-a', 'https://www.youtube.com');
    expect(focusManaged('app-a')).toBe(true);
    handle!.closed = true;
    expect(focusManaged('app-a')).toBe(false);
  });

  it('closes on request and reports it', () => {
    const changes: Array<[string, boolean]> = [];
    onManagedChange((id, open) => changes.push([id, open]));
    openManaged('app-a', 'https://www.youtube.com');
    expect(closeManaged('app-a')).toBe(true);
    expect(handle!.close).toHaveBeenCalled();
    expect(changes.at(-1)).toEqual(['app-a', false]);
  });

  it('closes everything at once', () => {
    const second = fakeWindow();
    openManaged('app-a', 'https://a.test');
    handle = second;
    openManaged('app-b', 'https://b.test');
    closeAllManaged();
    expect(isManagedOpen('app-a')).toBe(false);
    expect(isManagedOpen('app-b')).toBe(false);
  });

  it('is a no-op for an application that was never opened', () => {
    expect(focusManaged('nope')).toBe(false);
    expect(closeManaged('nope')).toBe(false);
  });
});
