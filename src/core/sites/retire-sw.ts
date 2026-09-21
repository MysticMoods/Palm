/**
 * Removing the service worker Palm OS used to register on its own origin.
 *
 * Under the previous design an archived application was served from
 * `/site/<id>/…` on the Palm OS origin by a worker registered here. Each
 * application now runs on its own origin with its own worker, so nothing on
 * the OS origin should be controlled any more.
 *
 * Only the OS origin is touched: `getRegistrations()` is scoped to the origin
 * it is called on, so an application's own worker is unaffected by this.
 */

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export async function retireOsWorker(): Promise<number> {
  if (!serviceWorkerSupported()) return 0;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) return 0;

    let removed = 0;
    for (const registration of registrations) {
      if (await registration.unregister().catch(() => false)) removed += 1;
    }
    return removed;
  } catch {
    // Service workers are unavailable in some contexts; nothing to retire.
    return 0;
  }
}
