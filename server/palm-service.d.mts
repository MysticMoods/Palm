import type { IncomingMessage, ServerResponse } from 'node:http';

export interface PalmServiceOptions {
  /** True for the Vite dev server; relaxes the OS origin's CSP. */
  dev?: boolean;
}

export declare function palmService(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
  options?: PalmServiceOptions,
): void | Promise<void>;

export declare function mountPalmService(
  app: {
    use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
  },
  options?: PalmServiceOptions,
): void;
