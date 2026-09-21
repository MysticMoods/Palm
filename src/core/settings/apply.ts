/**
 * Projects settings onto the document element.
 *
 * Theme, accent, scaling, contrast and motion are all expressed as data
 * attributes and custom properties on `<html>`, so the whole UI (including
 * portals and windows) picks them up without prop drilling.
 */

import { hexToTriplet, readableAccentTriplet, readableForeground } from '../../utils/color';
import { useSettingsStore } from './store';
import type { Settings, ThemeMode } from './types';

let mediaQuery: MediaQueryList | null = null;

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The theme actually in effect right now, after resolving `system`. */
export function effectiveTheme(): 'light' | 'dark' {
  return resolveTheme(useSettingsStore.getState().settings.theme);
}

export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  const theme = resolveTheme(settings.theme);

  root.dataset.theme = theme;
  root.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  root.dataset.motion = settings.motion;

  root.style.setProperty('--os-accent', hexToTriplet(settings.accent));
  root.style.setProperty('--os-accent-fg', readableForeground(settings.accent));
  // A user-chosen accent is not guaranteed to be legible as text, so derive a
  // variant that clears WCAG AA against the surface this theme uses.
  root.style.setProperty(
    '--os-accent-ink',
    readableAccentTriplet(settings.accent, theme, settings.highContrast ? 7 : 4.5),
  );
  root.style.setProperty('--os-scale', String(settings.uiScale * settings.fontScale));

  if (settings.alwaysShowFocusRing) root.dataset.focusRing = 'always';
  else delete root.dataset.focusRing;

  // Keep the browser UI (address bar, scrollbars) in step with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolveTheme(settings.theme) === 'light' ? '#e8eaf1' : '#080a10');
  }
}

/** Subscribe to settings changes and to the OS colour-scheme preference. */
export function startSettingsEffects(): () => void {
  applySettings(useSettingsStore.getState().settings);

  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.settings !== previous.settings) applySettings(state.settings);
  });

  if (typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (useSettingsStore.getState().settings.theme === 'system') {
        applySettings(useSettingsStore.getState().settings);
      }
    };
    mediaQuery.addEventListener('change', onChange);
    return () => {
      unsubscribe();
      mediaQuery?.removeEventListener('change', onChange);
    };
  }

  return unsubscribe;
}
