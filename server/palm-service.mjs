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
const CHAIN = [appOriginMiddleware, originInfoMiddleware, fetchMiddleware, framePolicyMiddleware];

/** A single connect-style middleware running the whole chain. */
export function palmService(req, res, next) {
  let index = 0;
  const step = () => {
    const middleware = CHAIN[index++];
    if (!middleware) return next?.();
    return middleware(req, res, step);
  };
  return step();
}

/** Attach the chain to a connect-style app (Vite's `server.middlewares`). */
export function mountPalmService(app) {
  app.use(palmService);
}
