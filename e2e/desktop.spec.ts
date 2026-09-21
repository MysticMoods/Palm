import { expect, test } from './fixtures';

test.describe('boot', () => {
  test('seeds a filesystem and renders the desktop', async ({ palm, page }) => {
    await expect(page.getByRole('toolbar', { name: 'Taskbar' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Desktop' })).toBeVisible();
    // The seed puts a welcome file on the desktop alongside the shortcuts.
    await expect(page.locator('[data-icon-key]')).toHaveCount(3);
    await expect(page.locator('[aria-label="Welcome.txt"]')).toBeVisible();
    void palm;
  });

  test('reports no console errors while starting', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor();
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
});

test.describe('applications', () => {
  test('every built-in app opens without crashing', async ({ palm, page }) => {
    const apps = [
      'Files', 'Terminal', 'Text Editor', 'Browser', 'Notes', 'Calendar',
      'Calculator', 'Image Viewer', 'Media Player', 'System Monitor', 'Settings', 'App Store',
    ];
    for (const app of apps) await palm.launch(app);

    await expect(palm.windows()).toHaveCount(apps.length);
    await expect(page.getByText('Application stopped responding')).toHaveCount(0);
    // Exactly one window is focused, whatever else is open.
    await expect(palm.focusedWindow()).toHaveCount(1);
  });

  test('the taskbar tracks what is running', async ({ palm, page }) => {
    await palm.launch('Terminal');
    await palm.launch('Calculator');
    const taskbar = page.getByRole('toolbar', { name: 'Taskbar' });
    await expect(taskbar.getByRole('button', { name: /Terminal — 1 window/ })).toBeVisible();
    await expect(taskbar.getByRole('button', { name: /Calculator — 1 window/ })).toBeVisible();
  });

  test('clicking a focused app in the taskbar minimises it', async ({ palm, page }) => {
    await palm.launch('Calculator');
    await expect(palm.window('Calculator')).toBeVisible();

    const button = page.getByRole('toolbar', { name: 'Taskbar' })
      .getByRole('button', { name: /Calculator — 1 window/ });
    await button.click();
    await expect(palm.window('Calculator')).toHaveCount(0);

    await button.click();
    await expect(palm.window('Calculator')).toBeVisible();
  });
});

test.describe('system panels', () => {
  test('search finds files, apps and settings', async ({ palm, page }) => {
    void palm;
    await page.keyboard.press('Control+ ');
    const search = page.getByRole('dialog', { name: 'Search' });
    await expect(search).toBeVisible();

    await page.getByLabel('Search Palm OS').fill('budget');
    await expect(search.getByRole('option', { name: /budget\.csv/ })).toBeVisible();

    await page.getByLabel('Search Palm OS').fill('wallpaper');
    // Anchored: the Settings *app* result also mentions personalisation in
    // its description, so an unanchored match would hit two options.
    await expect(search.getByRole('option', { name: /^Personalisation/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();
  });

  test('quick settings toggles high contrast', async ({ palm, page }) => {
    void palm;
    await page.getByRole('button', { name: /Quick settings/ }).click();
    await page.getByRole('button', { name: /High contrast/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  });

  test('the notification centre and calendar open from the tray', async ({ palm, page }) => {
    void palm;
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notification centre' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Clock and calendar/ }).click();
    await expect(page.getByRole('dialog', { name: 'Calendar' })).toBeVisible();
  });
});
