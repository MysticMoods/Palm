/** Join class names, dropping falsy values. Small enough not to need clsx. */
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  let out = '';
  for (const part of parts) {
    if (!part || typeof part !== 'string') continue;
    out = out.length > 0 ? `${out} ${part}` : part;
  }
  return out;
}
