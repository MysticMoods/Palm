/**
 * Everything Palm OS needs from a server, in the order it has to run.
 *
 * Mounted into the Vite dev and preview servers, and by the standalone
 * service, so that the three cannot drift apart.
 */

import { appOriginMiddleware, originInfoMiddleware } from './app-origin.mjs';
import { fetchMiddleware } from './fetch-handler.mjs';
import { framePolicyMiddleware } from './frame-policy.mjs';

/**
 * Host routing comes first: on an application host nothing else should run,
 * and on the OS host it is what attaches the OS's own security headers to
 * every response, including the ones the static handler produces.
 */
const chainFor = (options) => [
  (req, res, next) => appOriginMiddleware(req, res, next, options),
  originInfoMiddleware,
  fetchMiddleware,
  framePolicyMiddleware,
];

/**
 * A single connect-style middleware running the whole chain.
 *
 * @param options.dev  true for the Vite dev server. It changes only the OS
 *   origin's Content-Security-Policy, which cannot be applied in dev because
 *   Fast Refresh injects an inline script.
 */
export function palmService(req, res, next, options = {}) {
  const chain = chainFor(options);
  let index = 0;
  const step = () => {
    const middleware = chain[index++];
    if (!middleware) return next?.();
    return middleware(req, res, step);
  };
  return step();
}

/** Attach the chain to a connect-style app (Vite's `server.middlewares`). */
export function mountPalmService(app, options = {}) {
  app.use((req, res, next) => palmService(req, res, next, options));
}
