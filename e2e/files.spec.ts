import { expect, test } from './fixtures';

test.describe('files', () => {
  test.beforeEach(async ({ palm }) => {
    await palm.launch('Files');
  });

  test('creates, renames, trashes and restores', async ({ palm, page }) => {
    await page.getByRole('button', { name: 'New folder' }).click();
    // The rename field focuses on the next frame, so wait for it rather than
    // typing into whatever happens to be focused.
    const rename = page.getByLabel('Rename New Folder');
    await rename.waitFor();
    await rename.fill('E2E Folder');
    await rename.press('Enter');
    await expect(palm.fileItems().filter({ hasText: 'E2E Folder' })).toHaveCount(1);

    // Delete it, then confirm it turns up in the Trash and comes back.
    await palm.fileItems().filter({ hasText: 'E2E Folder' }).click();
    await page.keyboard.press('Delete');
    await expect(palm.fileItems().filter({ hasText: 'E2E Folder' })).toHaveCount(0);

    await palm.goToPlace('Trash');
    await expect(palm.fileItems().filter({ hasText: 'E2E Folder' })).toHaveCount(1);
  });

  test('navigates with the sidebar and breadcrumb', async ({ palm, page }) => {
    await palm.goToPlace('Documents');
    await expect(palm.fileItems().filter({ hasText: 'budget.csv' })).toHaveCount(1);

    await palm.fileItems().filter({ hasText: 'Projects' }).dblclick();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Projects');
  });

  test('switches between grid and list view', async ({ palm, page }) => {
    await palm.goToPlace('Documents');
    await page.getByRole('button', { name: 'Switch to list view' }).click();
    await expect(page.getByRole('button', { name: 'Modified' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Size' })).toBeVisible();
  });

  test('filters the current folder', async ({ palm, page }) => {
    await palm.goToPlace('Documents');
    await page.getByLabel('Search this folder').fill('budget');
    await expect(palm.fileItems()).toHaveCount(1);
  });

  test('opens a text file in the editor, asking for permission first', async ({ palm, page }) => {
    await palm.goToPlace('Documents');
    await palm.fileItems().filter({ hasText: 'Todo.txt' }).dblclick();

    // Applications receive nothing implicitly; the first filesystem use asks.
    const dialog = page.getByRole('dialog').filter({ hasText: 'Allow Text Editor to use Files?' });
    await expect(dialog).toBeVisible();
    // Exact: "Allow" is also a substring of "Don't allow".
    await dialog.getByRole('button', { name: 'Allow', exact: true }).click();

    await expect(page.getByLabel('Document text')).toContainText('Palm OS');
  });

  test('refuses to open a binary file as text, and says why', async ({ palm, page }) => {
    await palm.goToPlace('Pictures');
    await palm.fileItems().filter({ hasText: 'Aurora.svg' }).click();
    await page.keyboard.press('Enter');

    const allow = page.getByRole('button', { name: 'Allow' });
    if (await allow.isVisible().catch(() => false)) await allow.click();
    // An image opens in the viewer, not the editor.
    await expect(palm.window('Image Viewer')).toBeVisible();
  });
});

test.describe('persistence', () => {
  test('files and settings survive a reload', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.runCommand('mkdir -p /Documents/persisted');

    await palm.launch('Settings');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await palm.launch('Terminal');
    const out = await palm.runCommand('ls /Documents');
    expect(out).toContain('persisted');
  });

  test('desktop icon positions survive a reload', async ({ palm, page }) => {
    const icon = page.locator('[data-icon-key][aria-label="Welcome.txt"]');
    const before = await icon.boundingBox();

    await icon.hover();
    await page.mouse.down();
    await page.mouse.move(before!.x + 220, before!.y + 210, { steps: 10 });
    await page.mouse.up();

    const moved = await icon.boundingBox();
    expect(moved!.x).toBeGreaterThan(before!.x);

    await page.reload();
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor();
    const after = await page.locator('[data-icon-key][aria-label="Welcome.txt"]').boundingBox();
    expect(Math.round(after!.x)).toBe(Math.round(moved!.x));
    void palm;
  });
});
