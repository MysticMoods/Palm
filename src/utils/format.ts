/** Formatting helpers shared across apps. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = exponent === 0 ? Math.round(value) : Number(value.toFixed(decimals));
  return `${rounded} ${UNITS[exponent]}`;
}

export function formatDate(timestamp: number, use24Hour = false): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  });
}

export function formatTime(date: Date, options: { seconds?: boolean; hour24?: boolean } = {}): string {
  return date.toLocaleTimeString(undefined, {
    hour: options.hour24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    second: options.seconds ? '2-digit' : undefined,
    hour12: !options.hour24,
  });
}

export function formatDayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' });
}

/** "just now", "4m ago", "Tuesday", … for notification and note lists. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < 45_000) return 'just now';
  if (delta < hour) return `${Math.round(delta / minute)}m ago`;
  if (delta < day) return `${Math.round(delta / hour)}h ago`;
  if (delta < 7 * day) return `${Math.round(delta / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
