/**
 * Join class names, dropping anything falsy.
 *
 * Accepts the union that `condition && 'class'` produces for any condition
 * type, so callers never have to coerce to boolean first.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined;

export function cn(...parts: ClassValue[]): string {
  let out = '';
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) continue;
    out = out.length > 0 ? `${out} ${part}` : part;
  }
  return out;
}
