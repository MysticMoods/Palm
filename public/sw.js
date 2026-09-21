/**
 * Retirement worker for the Palm OS origin.
 *
 * Palm OS used to serve archived applications from its *own* origin, under
 * `/site/<id>/…`, using a service worker registered here. That is no longer
 * how it works: each application now lives on its own origin with its own
 * worker (`/_papp/sw.js`), because an application sharing the OS's origin
 * could read the OS's storage.
 *
 * A browser that installed the old worker still has it, and it would keep
 * intercepting requests with code that no longer matches anything. So this
 * file exists only to take itself out of the way. It serves nothing.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop anything the previous worker cached.
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.map((name) => caches.delete(name).catch(() => undefined)));

      await self.registration.unregister().catch(() => undefined);

      // Reload open pages so they stop being controlled by a worker that is
      // on its way out; without this they keep talking to it until navigation.
      const clients = await self.clients.matchAll({ type: 'window' }).catch(() => []);
      for (const client of clients) client.navigate(client.url).catch(() => undefined);
    })(),
  );
});

// Deliberately no fetch handler: an unregistering worker must not intercept.
