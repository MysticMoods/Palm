/**
 * The Palm OS side of the application bridge.
 *
 * An installed application can ask the OS for a few things — post a
 * notification, open a file, set its window title. Every one of those requests
 * arrives as a `postMessage` from another origin, which means it is untrusted
 * input in the strictest sense: the sender chose every byte of it.
 *
 * So validation is separated from execution and tested on its own. `validate`
 * answers one question — may this message, from this origin, cause this
 * action? — and it answers it before anything else looks at the payload.
 */

import { APP_PERMISSION_INFO } from './types';
import type { AppPermission } from './types';

/** The requests an application may make. */
export const BRIDGE_REQUESTS = [
  'notification',
  'window-control',
  'open-file',
  'save-file',
  'clipboard-write',
  'system-info',
] as const;

export type BridgeRequestType = (typeof BRIDGE_REQUESTS)[number];

/** Which permission each request needs. Nothing is free. */
export const BRIDGE_PERMISSIONS: Record<BridgeRequestType, AppPermission> = {
  notification: 'NOTIFICATIONS',
  'window-control': 'WINDOW_CONTROL',
  'open-file': 'FILES',
  'save-file': 'FILES',
  'clipboard-write': 'CLIPBOARD',
  'system-info': 'SYSTEM_API',
};

/** Caps, so a request cannot be used to exhaust memory or spam the UI. */
export const BRIDGE_LIMITS = {
  title: 200,
  body: 1000,
  clipboard: 100_000,
  fileName: 255,
  fileBytes: 32 * 1024 * 1024,
};

export interface BridgeEnvelope {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface BridgeExpectation {
  appId: string;
  appOrigin: string;
  frame: unknown;
  /** Permissions the user has actually granted this application. */
  granted: readonly AppPermission[];
}

export type ValidationFailure =
  /** Not for us: wrong origin, wrong frame, or not a bridge message at all. */
  | { ok: false; kind: 'ignore' }
  /** For us, but malformed or refused. The application is told why. */
  | { ok: false; kind: 'reject'; requestId: string | null; error: string };

export type ValidationSuccess = {
  ok: true;
  requestId: string;
  request: BridgeRequestType;
  permission: AppPermission;
  payload: Record<string, unknown>;
};

export type ValidationResult = ValidationSuccess | ValidationFailure;

const ignore: ValidationFailure = { ok: false, kind: 'ignore' };

const reject = (requestId: string | null, error: string): ValidationFailure => ({
  ok: false,
  kind: 'reject',
  requestId,
  error,
});

/**
 * Decide whether a message may act on Palm OS.
 *
 * The order matters. Origin and frame identity are settled before the payload
 * is read at all, so a malformed message from the wrong place is ignored
 * rather than answered — answering would confirm to an unknown sender that
 * something is listening.
 */
export function validate(envelope: BridgeEnvelope, expected: BridgeExpectation): ValidationResult {
  // Exact match, never a prefix: `https://app-x.palm.example.evil.test` shares
  // a prefix with the origin we expect.
  if (envelope.origin !== expected.appOrigin) return ignore;
  if (envelope.source !== expected.frame) return ignore;

  const data = envelope.data;
  if (!data || typeof data !== 'object') return ignore;
  const record = data as Record<string, unknown>;
  if (record.type !== 'palm.bridge.request') return ignore;

  const requestId = typeof record.requestId === 'string' ? record.requestId : null;
  if (!requestId) return ignore;

  const request = record.request;
  if (typeof request !== 'string' || !(BRIDGE_REQUESTS as readonly string[]).includes(request)) {
    return reject(requestId, `Palm OS does not support the request "${String(request)}".`);
  }
  const type = request as BridgeRequestType;

  const payload =
    record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : {};

  const permission = BRIDGE_PERMISSIONS[type];
  if (!expected.granted.includes(permission)) {
    return reject(
      requestId,
      `"${APP_PERMISSION_INFO[permission].label}" is not enabled for this application.`,
    );
  }

  const problem = checkPayload(type, payload);
  if (problem) return reject(requestId, problem);

  return { ok: true, requestId, request: type, permission, payload };
}

/** Per-request payload rules. Returns a message when the payload is wrong. */
function checkPayload(type: BridgeRequestType, payload: Record<string, unknown>): string | null {
  switch (type) {
    case 'notification': {
      const title = payload.title;
      if (typeof title !== 'string' || title.trim() === '') {
        return 'A notification needs a title.';
      }
      if (title.length > BRIDGE_LIMITS.title) {
        return `A notification title may be at most ${BRIDGE_LIMITS.title} characters.`;
      }
      if (payload.body !== undefined && typeof payload.body !== 'string') {
        return 'A notification body must be text.';
      }
      if (typeof payload.body === 'string' && payload.body.length > BRIDGE_LIMITS.body) {
        return `A notification body may be at most ${BRIDGE_LIMITS.body} characters.`;
      }
      return null;
    }

    case 'window-control': {
      const action = payload.action;
      if (action !== 'set-title' && action !== 'close') {
        return 'Window control supports "set-title" and "close".';
      }
      if (action === 'set-title') {
        if (typeof payload.title !== 'string') return 'Setting a title needs a title.';
        if (payload.title.length > BRIDGE_LIMITS.title) {
          return `A window title may be at most ${BRIDGE_LIMITS.title} characters.`;
        }
      }
      return null;
    }

    case 'save-file': {
      const name = payload.name;
      if (typeof name !== 'string' || name.trim() === '') return 'Saving a file needs a name.';
      if (name.length > BRIDGE_LIMITS.fileName) return 'That file name is too long.';
      // The name is used to create a file in the Palm OS filesystem, so it may
      // not carry a path — an application does not get to choose where it goes.
      if (/[\\/]/.test(name) || name === '.' || name === '..') {
        return 'A file name may not contain a path.';
      }
      if (!isSaveableBody(payload.data)) {
        return 'Saving a file needs text or binary data.';
      }
      if (sizeOf(payload.data) > BRIDGE_LIMITS.fileBytes) {
        return `A saved file may be at most ${Math.round(BRIDGE_LIMITS.fileBytes / 1024 / 1024)}MB.`;
      }
      return null;
    }

    case 'clipboard-write': {
      if (typeof payload.text !== 'string') return 'Writing to the clipboard needs text.';
      if (payload.text.length > BRIDGE_LIMITS.clipboard) {
        return 'That is too much text for the clipboard.';
      }
      return null;
    }

    case 'open-file': {
      if (payload.accept !== undefined && !Array.isArray(payload.accept)) {
        return '"accept" must be a list of file extensions.';
      }
      return null;
    }

    case 'system-info':
      return null;

    default:
      return 'Unsupported request.';
  }
}

function isSaveableBody(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function sizeOf(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  return 0;
}
