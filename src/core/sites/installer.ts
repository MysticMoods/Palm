/**
 * The channel Palm OS uses to write into an application's own origin.
 *
 * Palm OS cannot touch an application's storage directly — that is the whole
 * point of the separation — so installing means loading a small page *on* the
 * application origin and handing the archive across with `postMessage`.
 *
 * Both ends check the other. Palm OS verifies that a reply came from the exact
 * origin it addressed and from the frame it created; the installer verifies
 * that a command came from the Palm OS origin. Neither side trusts
 * `event.data` before those checks pass, because a page that acted on whatever
 * arrived would let any opener plant code under an installed application's name.
 */

import { appOrigin, installerUrl } from './origin';
import { ArchiveError } from './types';

/** How long to wait for the application origin to answer at all. */
const READY_TIMEOUT_MS = 15_000;
/** How long a single command may take; installs move a lot of bytes. */
const COMMAND_TIMEOUT_MS = 120_000;

export interface IncomingMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface ChannelExpectation {
  appId: string;
  appOrigin: string;
  frame: unknown;
}

/**
 * Is this message genuinely from the application frame we opened?
 *
 * Extracted so the rule can be tested directly: an origin check that is subtly
 * wrong is invisible until it matters, and "starts with" is the classic way to
 * get it wrong — `https://app-abc.palm.example.evil.test` starts with the
 * origin we expected.
 */
export function isFromAppFrame(
  message: IncomingMessage,
  expected: ChannelExpectation,
): boolean {
  if (message.origin !== expected.appOrigin) return false;
  if (message.source !== expected.frame) return false;
  const data = message.data;
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  if (typeof record.type !== 'string' || !record.type.startsWith('palm.installer.')) return false;
  // The frame states which application it is; a mismatch means something is
  // routed wrong and nothing should be acted on.
  if ('appId' in record && record.appId !== expected.appId) return false;
  return true;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * A live connection to one application origin.
 *
 * Short-lived by design: it is opened to install, to change permissions or to
 * collect a validation report, and closed straight after. Leaving a frame on
 * an application origin attached to the desktop would be an odd thing to do
 * for no benefit.
 */
export class AppOriginChannel {
  private readonly pending = new Map<string, PendingRequest>();
  private counter = 0;
  private closed = false;

  readonly appId: string;
  readonly origin: string;
  private readonly frame: HTMLIFrameElement;
  private readonly onMessage: (event: MessageEvent) => void;

  private constructor(
    appId: string,
    origin: string,
    frame: HTMLIFrameElement,
    onMessage: (event: MessageEvent) => void,
  ) {
    this.appId = appId;
    this.origin = origin;
    this.frame = frame;
    this.onMessage = onMessage;
  }

  /** Load the installer on the application origin and wait for its hello. */
  static open(appId: string): Promise<AppOriginChannel> {
    const origin = appOrigin(appId);
    const url = installerUrl(appId);
    if (!origin || !url) {
      throw new ArchiveError(
        'This deployment cannot give applications their own origin, so nothing can be installed.',
      );
    }

    return new Promise<AppOriginChannel>((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', `Installer for ${appId}`);
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';

      let channel: AppOriginChannel | null = null;
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new ArchiveError(
            `The application origin (${origin}) did not respond. Offline installation could not be completed.`,
          ),
        );
      }, READY_TIMEOUT_MS);

      const listener = (event: MessageEvent) => {
        if (!isFromAppFrame(event, { appId, appOrigin: origin, frame: frame.contentWindow })) return;
        const data = event.data as { type: string; error?: string; requestId?: string; result?: CommandResult };

        if (data.type === 'palm.installer.ready' && !channel) {
          clearTimeout(timer);
          channel = new AppOriginChannel(appId, origin, frame, listener);
          resolve(channel);
          return;
        }
        if (data.type === 'palm.installer.error' && !channel) {
          clearTimeout(timer);
          cleanup();
          reject(new ArchiveError(data.error ?? 'The application origin refused to install.'));
          return;
        }
        if (data.type === 'palm.installer.result' && channel) {
          channel.settle(data.requestId, data.result);
        }
      };

      const cleanup = () => {
        window.removeEventListener('message', listener);
        frame.remove();
      };

      window.addEventListener('message', listener);
      frame.src = url;
      document.body.appendChild(frame);
    });
  }

  /** Send one command and wait for its reply. */
  send(type: string, payload: Record<string, unknown> = {}): Promise<CommandResult> {
    if (this.closed) return Promise.reject(new ArchiveError('The installer channel is closed.'));
    const target = this.frame.contentWindow;
    if (!target) return Promise.reject(new ArchiveError('The installer frame went away.'));

    const requestId = `r${(this.counter += 1)}`;
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ArchiveError(`The application origin did not finish "${type}" in time.`));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      // Always addressed to the exact origin: a wildcard target would post the
      // archive to whatever happened to be loaded there.
      target.postMessage({ type, appId: this.appId, requestId, ...payload }, this.origin);
    });
  }

  /** Send a command and fail loudly if the far end reported a problem. */
  async require(type: string, payload: Record<string, unknown> = {}): Promise<CommandResult> {
    const result = await this.send(type, payload);
    if (!result || result.ok !== true) {
      throw new ArchiveError(result?.error ?? `The application origin rejected "${type}".`);
    }
    return result;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new ArchiveError('The installer channel closed before this finished.'));
    }
    this.pending.clear();
    window.removeEventListener('message', this.onMessage);
    this.frame.remove();
  }

  private settle(requestId: string | undefined, result: CommandResult | undefined): void {
    if (!requestId) return;
    const request = this.pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.resolve(result ?? { ok: false, error: 'The application origin sent no result.' });
  }
}

/** Run a body with a channel open, closing it whatever happens. */
export async function withAppOrigin<T>(
  appId: string,
  body: (channel: AppOriginChannel) => Promise<T>,
): Promise<T> {
  const channel = await AppOriginChannel.open(appId);
  try {
    return await body(channel);
  } finally {
    channel.close();
  }
}
