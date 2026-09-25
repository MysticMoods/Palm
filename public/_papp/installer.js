/**
 * Runs inside an application origin, in a hidden frame owned by Palm OS.
 *
 * Its whole job is to receive an archive from the OS and commit it to *this*
 * origin's storage, then start the service worker that will serve it. Palm OS
 * cannot do either of those things itself: that is the isolation working, not
 * an inconvenience to route around.
 *
 * Every message is checked both ways. Palm OS verifies this frame's origin
 * before trusting a reply; this frame verifies the OS origin before acting on
 * anything, because a page that wrote whatever any opener told it to would
 * hand an attacker a way to plant code under an installed application's name.
 */

import { appIdFromHost, baseHostFrom } from './origins.mjs';

const APP_ID = appIdFromHost(location.host);

/**
 * The only origin allowed to drive this installer.
 *
 * Derived from where we are, never taken from the message: an attacker can
 * choose what they send, but not which host the browser loaded this from.
 */
const OS_ORIGIN = (() => {
  const base = baseHostFrom(location.host);
  return base ? `${location.protocol}//${base}` : null;
})();

const post = (payload) => {
  if (!OS_ORIGIN) return;
  parent.postMessage(payload, OS_ORIGIN);
};

if (!APP_ID || !OS_ORIGIN) {
  post({ type: 'palm.installer.error', error: 'This origin is not a valid application host.' });
} else {
  window.addEventListener('message', onMessage);
  post({ type: 'palm.installer.ready', appId: APP_ID, origin: location.origin });
}

async function onMessage(event) {
  // Origin check first: nothing below this line runs for an unknown sender.
  if (event.origin !== OS_ORIGIN) return;
  if (event.source !== parent) return;

  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  // The OS states which application it thinks it is talking to; if that does
  // not match this origin, something is routed wrong and nothing should run.
  if (data.appId !== APP_ID) {
    post({ type: 'palm.installer.error', error: 'Application id does not match this origin.' });
    return;
  }

  try {
    switch (data.type) {
      case 'palm.install':
        post({ type: 'palm.installer.result', requestId: data.requestId, result: await install(data) });
        break;
      case 'palm.permissions':
        post({
          type: 'palm.installer.result',
          requestId: data.requestId,
          result: await command({
            type: 'palm.sw.permissions',
            permissions: data.permissions,
            security: data.security,
          }),
        });
        break;
      case 'palm.status':
        post({
          type: 'palm.installer.result',
          requestId: data.requestId,
          result: await command({ type: 'palm.sw.ping' }),
        });
        break;
      case 'palm.report':
        post({
          type: 'palm.installer.result',
          requestId: data.requestId,
          result: await command({ type: 'palm.sw.report', reset: data.reset }),
        });
        break;
      case 'palm.uninstall':
        post({ type: 'palm.installer.result', requestId: data.requestId, result: await uninstall() });
        break;
      default:
        post({
          type: 'palm.installer.result',
          requestId: data.requestId,
          result: { ok: false, error: `Unknown command ${data.type}` },
        });
    }
  } catch (error) {
    post({
      type: 'palm.installer.result',
      requestId: data.requestId,
      result: { ok: false, error: error && error.message ? error.message : String(error) },
    });
  }
}

/** Register the worker and wait until it is actually in charge. */
async function worker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are unavailable here, so this application cannot be installed offline.');
  }
  const registration = await navigator.serviceWorker.register('/_papp/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration.active ?? navigator.serviceWorker.controller ?? registration.waiting ?? registration.installing;
}

/** Send one command to the worker and wait for its reply. */
async function command(message) {
  const target = await worker();
  if (!target) throw new Error('The application service worker did not start.');

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('The application service worker did not respond.')), 30_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    target.postMessage(message, [channel.port2]);
  });
}

async function install(data) {
  return command({ type: 'palm.sw.install', manifest: data.manifest, files: data.files });
}

async function uninstall() {
  const result = await command({ type: 'palm.sw.clear' });
  // Drop the worker too, so nothing of this application is left running.
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  try {
    indexedDB.deleteDatabase('palm-app');
  } catch {
    /* the stores were already cleared above; this is belt and braces */
  }
  return result;
}
