/**
 * Global keyboard shortcut manager.
 *
 * A single capture-phase listener owns every system shortcut. Handlers declare
 * whether they are allowed to fire while a text field has focus, so typing a
 * space in the Notes app never opens system search.
 *
 * Browser-reserved combinations (Ctrl+T, Ctrl+W, Ctrl+N, F5, …) are left
 * alone on purpose: hijacking them breaks the user's expectations of their own
 * browser, and several cannot be intercepted at all.
 */

import { matchesShortcut, parseShortcut } from './shortcuts';
import type { ParsedShortcut } from './shortcuts';
import { isEditableTarget } from './shortcuts';

export interface ShortcutBinding {
  id: string;
  /** e.g. `"Ctrl+Space"`, `"Alt+Tab"`, `"Mod+Z"`. */
  shortcut: string;
  description: string;
  handler: (event: KeyboardEvent) => void;
  /** Fire even when focus is inside a text field. Defaults to false. */
  allowInInputs?: boolean;
  /** Skip `preventDefault()` — used for shortcuts we only observe. */
  passive?: boolean;
}

interface Registered extends ShortcutBinding {
  parsed: ParsedShortcut;
}

const bindings = new Map<string, Registered>();
let attached = false;

export function registerShortcut(binding: ShortcutBinding): () => void {
  bindings.set(binding.id, { ...binding, parsed: parseShortcut(binding.shortcut) });
  return () => {
    bindings.delete(binding.id);
  };
}

export function registerShortcuts(list: ShortcutBinding[]): () => void {
  const disposers = list.map(registerShortcut);
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function updateShortcut(id: string, shortcut: string): void {
  const existing = bindings.get(id);
  if (!existing) return;
  bindings.set(id, { ...existing, shortcut, parsed: parseShortcut(shortcut) });
}

export function listShortcuts(): ShortcutBinding[] {
  return [...bindings.values()].map(({ parsed, ...rest }) => {
    void parsed;
    return rest;
  });
}

function onKeyDown(event: KeyboardEvent) {
  if (event.repeat && !event.altKey) return;
  const editable = isEditableTarget(event.target);

  for (const binding of bindings.values()) {
    if (!matchesShortcut(event, binding.parsed)) continue;
    if (editable && !binding.allowInInputs) continue;
    if (!binding.passive) {
      event.preventDefault();
      event.stopPropagation();
    }
    try {
      binding.handler(event);
    } catch (err) {
      console.error(`[palm/keyboard] "${binding.id}" failed`, err);
    }
    return;
  }
}

export function startKeyboardManager(): () => void {
  if (attached) return () => undefined;
  attached = true;
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    attached = false;
  };
}
