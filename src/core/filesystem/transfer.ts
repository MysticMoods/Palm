/**
 * Moving files between the browser and the user's computer, the plain way.
 *
 * These are the universal fallbacks — a download and a file picker — that work
 * in every browser. Palm Disk (`disk.ts`) is the richer path, but it exists
 * only in Chromium, so these remain the floor rather than a legacy shim.
 */

/** Hand the browser a file to save, via a download. */
export function downloadBlob(
  data: Blob | string,
  filename: string,
  mime = 'application/octet-stream',
): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the navigation a tick before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prompt for real files to copy into the virtual filesystem. */
export function pickFiles(accept?: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish(input.files ? [...input.files] : []));
    // `cancel` is not universally supported; a cancelled picker simply never
    // resolves with files, which every caller already treats as "nothing to do".
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}
