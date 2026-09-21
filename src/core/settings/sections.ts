/**
 * Settings section catalogue.
 *
 * Shared between the Settings app (which renders it) and system search (which
 * indexes it), so a new pane becomes searchable automatically.
 */

export interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Extra terms the search index should match on. */
  keywords: string[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'personalization',
    label: 'Personalisation',
    icon: 'Palette',
    description: 'Wallpaper, theme, accent colour, taskbar and desktop icons.',
    keywords: ['wallpaper', 'background', 'theme', 'dark mode', 'light mode', 'accent', 'colour', 'color', 'taskbar', 'icons', 'appearance'],
  },
  {
    id: 'display',
    label: 'Display',
    icon: 'Monitor',
    description: 'Resolution, viewport, UI scaling and fullscreen.',
    keywords: ['resolution', 'scaling', 'zoom', 'fullscreen', 'screen', 'viewport', 'dpi'],
  },
  {
    id: 'sound',
    label: 'Sound',
    icon: 'Volume2',
    description: 'Output volume, mute and interface sounds.',
    keywords: ['volume', 'audio', 'mute', 'sound effects', 'beep'],
  },
  {
    id: 'network',
    label: 'Network',
    icon: 'Wifi',
    description: 'Connection status and reported link information.',
    keywords: ['wifi', 'internet', 'offline', 'online', 'connection', 'ethernet'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'Bell',
    description: 'Do not disturb and per-application notification settings.',
    keywords: ['alerts', 'do not disturb', 'dnd', 'toasts', 'banner'],
  },
  {
    id: 'apps',
    label: 'Applications',
    icon: 'LayoutGrid',
    description: 'Installed applications, defaults and permissions.',
    keywords: ['default apps', 'uninstall', 'install', 'permissions', 'programs'],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'HardDrive',
    description: 'Filesystem usage, Trash size and temporary data.',
    keywords: ['disk', 'space', 'quota', 'indexeddb', 'trash', 'cache', 'cleanup'],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: 'Shield',
    description: 'Local data, permissions and clearing stored information.',
    keywords: ['data', 'clear', 'reset', 'tracking', 'security', 'permissions'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    icon: 'Contrast',
    description: 'Text size, contrast, motion and keyboard navigation.',
    keywords: ['a11y', 'contrast', 'font size', 'reduced motion', 'screen reader', 'keyboard', 'focus'],
  },
  {
    id: 'accounts',
    label: 'Account',
    icon: 'User',
    description: 'Your local profile name and avatar.',
    keywords: ['profile', 'user', 'avatar', 'name', 'sign in', 'login'],
  },
  {
    id: 'system',
    label: 'System',
    icon: 'Info',
    description: 'Version, browser information, backup and reset.',
    keywords: ['about', 'version', 'export', 'import', 'backup', 'restore', 'reset', 'browser'],
  },
];

export function findSection(id: string | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0];
}
