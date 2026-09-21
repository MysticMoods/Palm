import type { IncomingMessage, ServerResponse } from 'node:http';

export declare function palmService(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
): void | Promise<void>;

export declare function mountPalmService(app: {
  use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}): void;
