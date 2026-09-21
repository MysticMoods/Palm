/** POSIX-ish path helpers for the virtual filesystem. */

export const SEP = '/';
export const ROOT = '/';

/** Split a path into its non-empty segments. */
export function segments(path: string): string[] {
  return path.split(SEP).filter((part) => part.length > 0);
}

/** Collapse `.`/`..`, duplicate slashes and trailing slashes. */
export function normalize(path: string): string {
  const absolute = path.startsWith(SEP);
  const out: string[] = [];
  for (const part of segments(path)) {
    if (part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(part);
  }
  const joined = out.join(SEP);
  if (absolute) return SEP + joined;
  return joined.length > 0 ? joined : '.';
}

/** Resolve `path` against `base` (both may be relative). */
export function resolve(base: string, path: string): string {
  if (path.startsWith(SEP)) return normalize(path);
  return normalize(`${base}${base.endsWith(SEP) ? '' : SEP}${path}`);
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join(SEP));
}

export function dirname(path: string): string {
  const norm = normalize(path);
  if (norm === ROOT) return ROOT;
  const index = norm.lastIndexOf(SEP);
  if (index <= 0) return ROOT;
  return norm.slice(0, index);
}

export function basename(path: string): string {
  const norm = normalize(path);
  if (norm === ROOT) return ROOT;
  return norm.slice(norm.lastIndexOf(SEP) + 1);
}

/** File extension without the dot, lowercased. Empty for dotfiles. */
export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  if (index <= 0) return '';
  return name.slice(index + 1).toLowerCase();
}

/** Filename without its extension. */
export function stem(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  if (index <= 0) return name;
  return name.slice(0, index);
}

/** True when `child` is `parent` or lives underneath it. */
export function isWithin(parent: string, child: string): boolean {
  const p = normalize(parent);
  const c = normalize(child);
  if (p === c) return true;
  return c.startsWith(p === ROOT ? ROOT : `${p}${SEP}`);
}

/** Characters that would break path parsing or look like traversal. */
const INVALID_NAME = /[/\\]/;

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (INVALID_NAME.test(trimmed)) return false;
  // Reject control characters, which render as garbage and confuse the shell.
  return ![...trimmed].some((ch) => ch.charCodeAt(0) < 32);
}

/** Replace a display path's home prefix with `~`. */
export function tildify(path: string, home: string): string {
  if (path === home) return '~';
  if (path.startsWith(`${home}${SEP}`)) return `~${path.slice(home.length)}`;
  return path;
}
