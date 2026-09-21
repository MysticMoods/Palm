/** Shape of every user-adjustable OS preference. */

export type ThemeMode = 'light' | 'dark' | 'system';
export type MotionMode = 'system' | 'full' | 'reduced';
export type TaskbarPosition = 'bottom' | 'top' | 'left' | 'right';
export type IconSize = 'small' | 'medium' | 'large';
export type ImageFit = 'cover' | 'contain' | 'center' | 'tile';

export type Wallpaper =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; src: string; fit: ImageFit };

export interface Settings {
  /* ----------------------------- Personalisation ---------------------- */
  theme: ThemeMode;
  accent: string;
  wallpaper: Wallpaper;
  uiScale: number;
  taskbarPosition: TaskbarPosition;
  showDesktopIcons: boolean;
  desktopIconSize: IconSize;
  showClockSeconds: boolean;
  use24HourClock: boolean;

  /* --------------------------------- Sound ---------------------------- */
  volume: number;
  muted: boolean;
  uiSounds: boolean;

  /* ----------------------------- Notifications ------------------------ */
  notificationsEnabled: boolean;
  doNotDisturb: boolean;
  /** Per-application override; absent means "allowed". */
  appNotifications: Record<string, boolean>;

  /* ----------------------------- Accessibility ------------------------ */
  highContrast: boolean;
  motion: MotionMode;
  /** Extra multiplier applied on top of `uiScale`, for text only. */
  fontScale: number;
  alwaysShowFocusRing: boolean;

  /* --------------------------------- System --------------------------- */
  /** False until the first-run welcome has been completed or skipped. */
  welcomeCompleted: boolean;
  searchShortcut: string;
  snapAssist: boolean;
  confirmBeforeTrash: boolean;
  /** Default app id per file category, used by "Open with". */
  defaultApps: Record<string, string>;
}

export interface UserProfile {
  /**
   * Local-only profile. There is no account and no server; the shape is
   * deliberately close to what a real auth provider would return so a backend
   * can be introduced later without touching consumers.
   */
  id: string;
  username: string;
  displayName: string;
  /** Emoji, or a `vfs:<id>` reference to an image in the filesystem. */
  avatar: string;
  createdAt: number;
}
