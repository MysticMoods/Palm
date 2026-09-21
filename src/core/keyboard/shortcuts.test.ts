// @vitest-environment jsdom
// `isEditableTarget` narrows with `instanceof HTMLElement`, so this file needs
// a DOM; the rest of the module is pure and would run fine in Node.
import { describe, expect, it } from 'vitest';
import { formatShortcut, isEditableTarget, matchesShortcut, parseShortcut } from './shortcuts';

/** Minimal stand-in for the fields `matchesShortcut` reads. */
const press = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe('parseShortcut', () => {
  it('reads modifiers and the key', () => {
    expect(parseShortcut('Ctrl+Shift+N')).toEqual({
      key: 'n', ctrl: true, alt: false, shift: true, meta: false,
    });
  });

  it('accepts aliases for the platform modifier names', () => {
    expect(parseShortcut('Super+D').meta).toBe(true);
    expect(parseShortcut('Win+D').meta).toBe(true);
    expect(parseShortcut('Cmd+D').meta).toBe(true);
  });

  it('normalises key aliases', () => {
    expect(parseShortcut('Ctrl+Space').key).toBe(' ');
    expect(parseShortcut('Esc').key).toBe('escape');
    expect(parseShortcut('Meta+Left').key).toBe('arrowleft');
  });

  it('parses a bare modifier with no key', () => {
    expect(parseShortcut('Meta')).toMatchObject({ key: '', meta: true });
  });
});

describe('matchesShortcut', () => {
  it('matches an exact combination', () => {
    const shortcut = parseShortcut('Ctrl+Space');
    expect(matchesShortcut(press({ key: ' ', ctrlKey: true }), shortcut)).toBe(true);
  });

  it('does not match when an extra modifier is held', () => {
    const shortcut = parseShortcut('Ctrl+Space');
    expect(matchesShortcut(press({ key: ' ', ctrlKey: true, shiftKey: true }), shortcut)).toBe(false);
  });

  it('does not match when a required modifier is missing', () => {
    const shortcut = parseShortcut('Ctrl+Space');
    expect(matchesShortcut(press({ key: ' ' }), shortcut)).toBe(false);
  });

  it('falls back to the physical key, so layouts that remap Shift still work', () => {
    const shortcut = parseShortcut('Ctrl+Shift+Z');
    expect(matchesShortcut(press({ key: 'Y', code: 'KeyZ', ctrlKey: true, shiftKey: true }), shortcut)).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('renders a combination for display', () => {
    expect(formatShortcut('Ctrl+Space')).toBe('Ctrl + Space');
    expect(formatShortcut('Alt+Shift+Tab')).toBe('Alt + Shift + Tab');
  });

  it('uses arrow glyphs', () => {
    expect(formatShortcut('Meta+ArrowLeft')).toBe('Super + ←');
  });

  /*
   * Regression: a bare modifier used to render with a dangling separator
   * ("Super + "), which showed in the welcome tips and the settings list.
   */
  it('renders a bare modifier with no trailing separator', () => {
    expect(formatShortcut('Meta')).toBe('Super');
    expect(formatShortcut('Ctrl')).toBe('Ctrl');
  });
});

describe('isEditableTarget', () => {
  const el = (tag: string, props: Record<string, unknown> = {}) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    return node;
  };

  it('treats text inputs as editable', () => {
    expect(isEditableTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
  });

  it('does not treat buttons and checkboxes as editable', () => {
    expect(isEditableTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
  });

  it('treats contenteditable regions as editable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    // jsdom does not implement the isContentEditable getter.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableTarget(div)).toBe(true);
  });

  it('handles a null target', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
