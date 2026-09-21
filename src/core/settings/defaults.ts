import type { Settings, UserProfile, Wallpaper } from './types';

export const ACCENT_PRESETS = [
  { name: 'Cobalt', value: '#5884ff' },
  { name: 'Violet', value: '#a06bff' },
  { name: 'Magenta', value: '#f25ec0' },
  { name: 'Coral', value: '#ff6b5e' },
  { name: 'Amber', value: '#f0a030' },
  { name: 'Lime', value: '#69c94a' },
  { name: 'Teal', value: '#2bc4b0' },
  { name: 'Sky', value: '#38b6f0' },
] as const;

export const DEFAULT_WALLPAPER: Wallpaper = {
  kind: 'gradient',
  from: '#131a35',
  to: '#3a2255',
  angle: 135,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#5884ff',
  wallpaper: DEFAULT_WALLPAPER,
  uiScale: 1,
  taskbarPosition: 'bottom',
  showDesktopIcons: true,
  desktopIconSize: 'medium',
  showClockSeconds: false,
  use24HourClock: false,

  volume: 55,
  muted: false,
  uiSounds: true,

  notificationsEnabled: true,
  doNotDisturb: false,
  appNotifications: {},

  highContrast: false,
  motion: 'system',
  fontScale: 1,
  alwaysShowFocusRing: false,

  welcomeCompleted: false,
  searchShortcut: 'Ctrl+Space',
  snapAssist: true,
  confirmBeforeTrash: false,
  defaultApps: {
    text: 'text-editor',
    code: 'text-editor',
    image: 'image-viewer',
    audio: 'media-player',
    video: 'media-player',
    folder: 'files',
  },
};

export const DEFAULT_PROFILE: UserProfile = {
  id: 'local-user',
  username: 'palm',
  displayName: 'Palm User',
  avatar: '🌴',
  createdAt: Date.now(),
};

export const OS_NAME = 'Palm OS';
export const OS_VERSION = '1.0.0';
export const OS_CODENAME = 'Coconut';
