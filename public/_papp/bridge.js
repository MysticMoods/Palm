/**
 * The `PalmOS` object an archived application sees.
 *
 * An installed application runs on its own origin and can reach nothing of
 * Palm OS's by itself. This is the only route across, and it is a narrow one:
 * a request is a message to the OS, which decides on it — checking the sending
 * origin, the shape of the payload and the permission behind it — and may
 * simply refuse. Nothing here exposes OS storage, the filesystem, or any way
 * to run code on the OS origin.
 *
 *   await PalmOS.request('notification', { title: 'Saved' });
 *   const file = await PalmOS.request('open-file');
 *
 * Deliberately a classic script, injected as the first thing in <head>: a
 * module script is deferred, and `PalmOS` has to exist before the archived
 * application's own code runs.
 */
(function () {
  'use strict';

  /**
   * The Palm OS origin: this origin with the application label removed.
   *
   * Derived from where the browser loaded this page, not from anything in the
   * page, so archived code cannot redirect requests somewhere else.
   */
  var OS_ORIGIN = (function () {
    var host = location.host;
    var match = /^app-[0-9a-f]{8,32}\.(.+)$/.exec(host);
    return match ? location.protocol + '//' + match[1] : null;
  })();

  var pending = Object.create(null);
  var counter = 0;

  window.addEventListener('message', function (event) {
    if (!OS_ORIGIN || event.origin !== OS_ORIGIN) return;
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.type !== 'palm.bridge.response') return;

    var entry = pending[data.requestId];
    if (!entry) return;
    delete pending[data.requestId];
    clearTimeout(entry.timer);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error || 'Palm OS refused this request.'));
  });

  /** How long the OS has to answer; a permission prompt can take a while. */
  var TIMEOUT_MS = 180000;

  function request(type, payload) {
    if (!OS_ORIGIN) {
      return Promise.reject(new Error('This page is not running as an installed Palm OS application.'));
    }
    if (typeof type !== 'string') {
      return Promise.reject(new TypeError('PalmOS.request(type, payload): type must be a string.'));
    }

    var requestId = 'b' + ++counter + '-' + Date.now().toString(36);
    return new Promise(function (resolve, reject) {
      pending[requestId] = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          delete pending[requestId];
          reject(new Error('Palm OS did not answer this request.'));
        }, TIMEOUT_MS),
      };
      parent.postMessage(
        { type: 'palm.bridge.request', requestId: requestId, request: type, payload: payload || {} },
        OS_ORIGIN,
      );
    });
  }

  Object.defineProperty(window, 'PalmOS', {
    value: Object.freeze({
      version: 1,
      request: request,
      /** What this build knows how to ask for. */
      capabilities: Object.freeze([
        'notification',
        'window-control',
        'open-file',
        'save-file',
        'clipboard-write',
        'system-info',
      ]),
    }),
    writable: false,
    configurable: false,
  });

  /*
   * The application's own service worker.
   *
   * Palm OS's worker owns the root scope on this origin: it is what serves the
   * archive, so letting a second worker replace it would stop the application
   * loading at all. Registration is therefore refused, with a reason — rather
   * than silently resolving with a registration that does nothing, which would
   * leave an application waiting forever for an `activated` event.
   *
   * The offline behaviour the application wanted is already provided; what it
   * loses is control over the caching strategy.
   */
  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    var realRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (script, options) {
      var scope = (options && options.scope) || '/';
      if (scope === '/' || scope === location.origin + '/') {
        return Promise.reject(
          new Error(
            'Palm OS serves this application offline from the root scope, so a second service ' +
              'worker cannot be registered there.',
          ),
        );
      }
      return realRegister(script, options);
    };
  }
})();
