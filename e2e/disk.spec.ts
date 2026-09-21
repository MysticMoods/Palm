import { expect, test as base } from '@playwright/test';
import { DISK_POLYFILL } from './disk-polyfill';
import { Palm } from './fixtures';

const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    await page.addInitScript(DISK_POLYFILL);
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

/** Open Files and switch to the Palm Disk volume. */
async function openDisk(palm: Palm) {
  await palm.launch('Files');
  await palm.page
    .getByRole('navigation', { name: 'Places' })
    .getByRole('button', { name: /Palm Disk|my-project/ })
    .click();
}

const diskItems = (palm: Palm) =>
  palm.page.getByRole('listbox', { name: 'Palm Disk' }).getByRole('option');

test.describe('palm disk', () => {
  test('mounts a folder without asking for write access', async ({ palm, page }) => {
    await openDisk(palm);
    await expect(page.getByText('Connect a folder')).toBeVisible();

    await page.getByRole('button', { name: 'Choose folder…' }).click();

    await expect(page.getByText('These are your real files')).toBeVisible();
    await expect(diskItems(palm)).toHaveCount(3);
    // Connecting must not have requested permission to modify anything.
    expect(await page.evaluate(() => (window as unknown as { __grants: string[] }).__grants)).toEqual([]);
  });

  test('navigates into folders and keeps the two filesystems distinct', async ({ palm, page }) => {
    await openDisk(palm);
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await diskItems(palm).filter({ hasText: 'src' }).dblclick();

    await expect(diskItems(palm).filter({ hasText: 'main.ts' })).toHaveCount(1);
    // The virtual filesystem is still reachable and separate.
    await palm.goToPlace('Documents');
    await expect(palm.fileItems().filter({ hasText: 'budget.csv' })).toHaveCount(1);
  });

  test('opens a real file read-only until writing is granted', async ({ palm, page }) => {
    await openDisk(palm);
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await diskItems(palm).filter({ hasText: 'notes.txt' }).dblclick();

    const editor = palm.window('Text Editor');
    await expect(editor).toBeVisible();
    await expect(page.getByLabel('Document text')).toHaveValue('original contents');
    await expect(editor).toContainText('Real file on your computer');
  });

  test('confirms before replacing a real file, and only once per file', async ({ palm, page }) => {
    await openDisk(palm);
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await diskItems(palm).filter({ hasText: 'notes.txt' }).dblclick();

    await page.getByLabel('Document text').fill('edited by Palm OS');
    await page.getByRole('button', { name: /^Save to the real file/ }).click();

    // There is no Trash for real files, so the first overwrite is acknowledged.
    await expect(page.getByText(/Overwrite .*notes\.txt.* on your computer\?/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __peek(n: string): string }).__peek('notes.txt')))
      .toBe('original contents');

    await page.getByRole('button', { name: 'Overwrite the real file' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __peek(n: string): string }).__peek('notes.txt')))
      .toBe('edited by Palm OS');
    expect(await page.evaluate(() => (window as unknown as { __grants: string[] }).__grants)).toContain('readwrite');

    // A second save in the same window writes without asking again.
    await page.getByLabel('Document text').fill('second edit');
    await page.getByRole('button', { name: /^Save to the real file/ }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __peek(n: string): string }).__peek('notes.txt')))
      .toBe('second edit');
  });

  test('creates files and folders after one permission grant', async ({ palm, page }) => {
    await openDisk(palm);
    await page.getByRole('button', { name: 'Choose folder…' }).click();

    await page.getByRole('button', { name: 'New folder' }).click();
    await expect(page.getByText(/Let Palm OS write to/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(diskItems(palm).filter({ hasText: 'New Folder' })).toHaveCount(1);

    // Creating is additive, so it does not re-confirm.
    await page.getByRole('button', { name: 'New file' }).click();
    await expect(diskItems(palm).filter({ hasText: 'New File.txt' })).toHaveCount(1);
    await expect(page.getByText(/Let Palm OS write to/)).toHaveCount(0);
  });

  test('notices changes made outside the browser', async ({ palm, page }) => {
    await openDisk(palm);
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await expect(diskItems(palm)).toHaveCount(3);

    await page.evaluate(() => (window as unknown as { __add(n: string, c: string): void }).__add('outside.txt', 'hi'));
    // There is no file-watching API on the web, so it appears on refresh.
    await expect(diskItems(palm).filter({ hasText: 'outside.txt' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Re-read this folder from disk' }).click();
    await expect(diskItems(palm).filter({ hasText: 'outside.txt' })).toHaveCount(1);
  });
});

test.describe('without the File System Access API', () => {
  // Firefox and Safari never shipped the picker; this is the majority case.
  base('explains itself instead of failing', async ({ page }) => {
    const palm = new Palm(page);
    await palm.boot();
    await openDisk(palm);

    await expect(page.getByText('This browser cannot connect to a folder')).toBeVisible();
    await expect(page.getByRole('button', { name: /Import files into Palm OS/ })).toBeVisible();
  });
});
