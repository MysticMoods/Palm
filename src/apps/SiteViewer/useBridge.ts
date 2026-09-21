/**
 * Wiring the application bridge to the running OS.
 *
 * `bridge-host.ts` decides whether a message may act; this decides what acting
 * means. Keeping them apart means the security rules can be tested without a
 * DOM, and the effects can change without touching the rules.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { clipboard } from '../../core/clipboard/store';
import { validate } from '../../core/sites/bridge-host';
import type { BridgeRequestType } from '../../core/sites/bridge-host';
import { appOrigin } from '../../core/sites/origin';
import { siteAppId } from '../../core/sites/store';
import type { AppManifest } from '../../core/sites/types';
import { notifications } from '../../core/notifications/store';
import { vfs } from '../../core/filesystem/vfs';
import type { AppAPI } from '../../core/os';

export interface BridgeOptions {
  manifest: AppManifest | null;
  frame: RefObject<HTMLIFrameElement | null>;
  os: AppAPI;
  /** Called when a request is refused, so the UI can surface it. */
  onRefusal?: (message: string) => void;
}

/**
 * Listen for bridge requests from this application's frame.
 *
 * Bound to the window because that is where a cross-origin `postMessage`
 * arrives; every listener re-checks the origin, so several open applications
 * cannot answer for one another.
 */
export function useBridge({ manifest, frame, os, onRefusal }: BridgeOptions): void {
  useEffect(() => {
    if (!manifest) return;
    const origin = appOrigin(manifest.id);
    if (!origin) return;

    const listener = async (event: MessageEvent) => {
      const outcome = validate(
        { origin: event.origin, source: event.source, data: event.data },
        {
          appId: manifest.id,
          appOrigin: origin,
          frame: frame.current?.contentWindow ?? null,
          granted: manifest.permissions,
        },
      );

      if (!outcome.ok) {
        if (outcome.kind === 'ignore') return;
        onRefusal?.(outcome.error);
        respond(frame.current, origin, outcome.requestId, { ok: false, error: outcome.error });
        return;
      }

      try {
        const result = await perform(outcome.request, outcome.payload, os, manifest);
        respond(frame.current, origin, outcome.requestId, { ok: true, result });
      } catch (error) {
        respond(frame.current, origin, outcome.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [manifest, frame, os, onRefusal]);
}

function respond(
  frame: HTMLIFrameElement | null,
  origin: string,
  requestId: string | null,
  payload: { ok: boolean; result?: unknown; error?: string },
): void {
  if (!frame?.contentWindow || !requestId) return;
  // Addressed to the exact application origin, never "*".
  frame.contentWindow.postMessage(
    { type: 'palm.bridge.response', requestId, ...payload },
    origin,
  );
}

/**
 * Carry out a request that has already been validated and permitted.
 *
 * The effects go to the underlying stores rather than through the
 * permission-scoped `AppAPI`, and that is deliberate. An installed application
 * is governed by its own permission model — the one in the details panel,
 * which the user set for *this* application on *this* origin. Routing through
 * the OS's built-in-application permissions as well would ask the same
 * question twice, in two different vocabularies, for one decision the user has
 * already made. `bridge-host.validate` is the gate; this is the effect.
 */
async function perform(
  request: BridgeRequestType,
  payload: Record<string, unknown>,
  os: AppAPI,
  manifest: AppManifest,
): Promise<unknown> {
  switch (request) {
    case 'notification': {
      // Attributed to the application, so the notification centre never shows
      // third-party text as though Palm OS said it.
      notifications.push(siteAppId(manifest.id), {
        title: `${manifest.name}: ${payload.title as string}`,
        body: typeof payload.body === 'string' ? payload.body : undefined,
      });
      return { delivered: true };
    }

    case 'window-control': {
      if (payload.action === 'close') {
        os.window.close();
        return { closed: true };
      }
      os.window.setTitle(`${payload.title as string} — ${manifest.name}`);
      return { title: payload.title };
    }

    case 'clipboard-write': {
      await clipboard.writeText(payload.text as string);
      return { written: true };
    }

    case 'save-file': {
      /*
       * Saved into a folder named after the application, never anywhere the
       * application chooses. `uniqueName` means a save cannot overwrite
       * something that is already there.
       */
      const folder =
        vfs.nodeAt(`/Documents/${manifest.name}`) ?? (await vfs.mkdirp(`/Documents/${manifest.name}`));
      const name = vfs.uniqueName(folder.id, payload.name as string);
      const blob =
        payload.data instanceof Blob
          ? payload.data
          : new Blob([payload.data as BlobPart], { type: 'application/octet-stream' });
      const created = await vfs.createFile(folder.id, name, blob, blob.type || undefined);
      return { path: vfs.pathOf(created.id), name };
    }

    case 'open-file': {
      // Palm OS shows the picker; the application never sees the filesystem,
      // only the one file the user chose.
      const chosen = await pickFile(payload.accept as string[] | undefined);
      if (!chosen) return null;
      return chosen;
    }

    case 'system-info': {
      return {
        platform: 'Palm OS',
        theme: document.documentElement.dataset.theme ?? 'dark',
        language: navigator.language,
        online: navigator.onLine,
      };
    }

    default:
      throw new Error('Unsupported request.');
  }
}

/**
 * A one-file picker, using the browser's own dialog.
 *
 * The real browser picker rather than a Palm OS one on purpose: it is the
 * user's own trusted UI, an application cannot dismiss or fake it, and it
 * gives the application exactly one file and nothing else.
 */
function pickFile(accept?: string[]): Promise<{ name: string; mime: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept?.length) input.accept = accept.join(',');
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, mime: file.type, text: await file.text() });
    });
    // A cancelled picker fires no `change`; `cancel` is what settles the
    // promise so the application is not left waiting.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();
  });
}
