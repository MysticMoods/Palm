/** Join class names, dropping falsy values. Small enough not to need clsx. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    out = out.length > 0 ? `${out} ${part}` : part;
  }
  return out;
}
