/** Shortcut string parsing and matching. */

import { isMacPlatform } from '../../utils/misc';

export interface ParsedShortcut {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  space: ' ',
  spacebar: ' ',
  plus: '+',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
};

/** Parse `"Ctrl+Shift+N"` into a comparable descriptor. */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const result: ParsedShortcut = { key: '', ctrl: false, alt: false, shift: false, meta: false };

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        result.ctrl = true;
        break;
      case 'alt':
      case 'option':
        result.alt = true;
        break;
      case 'shift':
        result.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'super':
      case 'win':
        result.meta = true;
        break;
      case 'mod':
        // "Mod" is Cmd on macOS and Ctrl elsewhere, matching editor convention.
        if (isMacPlatform()) result.meta = true;
        else result.ctrl = true;
        break;
      default:
        result.key = ALIASES[part] ?? part;
    }
  }
  return result;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ParsedShortcut): boolean {
  if (event.ctrlKey !== shortcut.ctrl) return false;
  if (event.altKey !== shortcut.alt) return false;
  if (event.shiftKey !== shortcut.shift) return false;
  if (event.metaKey !== shortcut.meta) return false;

  const key = event.key.toLowerCase();
  if (key === shortcut.key) return true;
  // Match on physical key too, so Ctrl+Shift+Z works on layouts where Shift
  // changes `event.key`, and so digits work on non-US layouts.
  const code = event.code.toLowerCase();
  return code === `key${shortcut.key}` || code === `digit${shortcut.key}`;
}

/** Human-readable label, using platform-appropriate symbols. */
export function formatShortcut(shortcut: string): string {
  const mac = isMacPlatform();
  const parsed = parseShortcut(shortcut);
  const parts: string[] = [];
  if (parsed.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (parsed.alt) parts.push(mac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push(mac ? '⇧' : 'Shift');
  if (parsed.meta) parts.push(mac ? '⌘' : 'Super');

  const keyLabels: Record<string, string> = {
    ' ': 'Space',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    escape: 'Esc',
    enter: mac ? '↩' : 'Enter',
    delete: 'Del',
    backspace: '⌫',
    tab: 'Tab',
  };
  parts.push(keyLabels[parsed.key] ?? parsed.key.toUpperCase());
  return parts.join(mac ? '' : ' + ');
}

/** True when the event target is a text field, where typing must win. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
