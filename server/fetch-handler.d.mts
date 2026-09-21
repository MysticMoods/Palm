import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FetchedResource {
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

export declare const DEFAULTS: {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
};

export declare class FetchFailure extends Error {
  status: number;
}

export declare function fetchResource(
  rawUrl: string,
  options?: Partial<typeof DEFAULTS>,
): Promise<FetchedResource>;

/** Connect-style middleware serving `GET /_palm/fetch?url=…`. */
export declare function fetchMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
): Promise<void>;
