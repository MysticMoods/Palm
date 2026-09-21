/** Small general-purpose helpers. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function uid(prefix = ''): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}

/** Trailing-edge debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/** Leading-edge throttle using rAF, for pointer-driven updates. */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let frame: number | null = null;
  let latest: A;
  const wrapped = (...args: A) => {
    latest = args;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      fn(...latest);
    });
  };
  wrapped.cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  return wrapped;
}

/** Deterministic non-cryptographic hash, used for stable colour picking. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Case-insensitive substring match used by every search field in the OS. */
export function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}
