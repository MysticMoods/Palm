import { expect, test as base } from '@playwright/test';
import { Palm } from './fixtures';

/** This suite opts back in to the first-run tour the other specs skip. */
const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    const palm = new Palm(page);
    await palm.boot({ welcome: true });
    await use(palm);
  },
});

test.describe('first run', () => {
  test('walks through setup and applies the choices live', async ({ palm, page }) => {
    const card = page.getByRole('dialog', { name: /Welcome|Your profile|Appearance|Ready/ });
    await expect(card).toBeVisible();
    await expect(page.getByText('Welcome to Palm OS')).toBeVisible();

    await page.getByRole('button', { name: 'Get started' }).click();

    // The name drives the greeting and the terminal prompt.
    await page.getByLabel('Your name').fill('Ada Lovelace');
    await expect(page.getByText('@adalovelace')).toBeVisible();
    await page.getByRole('button', { name: 'Use 🦜 as your avatar' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Appearance applies immediately — the backdrop is the real wallpaper.
    const before = await page.locator('html').evaluate((el) => el.style.getPropertyValue('--os-accent'));
    await page.getByRole('button', { name: 'Teal' }).click();
    await expect
      .poll(() => page.locator('html').evaluate((el) => el.style.getPropertyValue('--os-accent')))
      .not.toBe(before);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText("You're all set, Ada")).toBeVisible();

    await page.getByRole('button', { name: 'Enter Palm OS' }).click();
    await expect(card).toBeHidden();
    await expect(page.getByRole('toolbar', { name: 'Taskbar' })).toBeVisible();

    // The profile reaches the shell.
    await palm.launch('Terminal');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText('adalovelace@palm');
  });

  test('does not appear on the second boot', async ({ palm, page }) => {
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page.getByLabel('Setup progress')).toBeHidden();

    await page.reload();
    await page.getByRole('toolbar', { name: 'Taskbar' }).waitFor();
    await expect(page.getByLabel('Setup progress')).toHaveCount(0);
    void palm;
  });

  test('suspends global shortcuts while it is open', async ({ palm, page }) => {
    // The desktop is mounted behind the overlay; Super or Ctrl+Space reaching
    // it through a modal would be baffling.
    await expect(page.getByLabel('Setup progress')).toBeVisible();
    await page.keyboard.press('Control+ ');
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0);

    // Escape rather than the Skip button: the Space in Ctrl+Space is also a
    // native button activation, which would have advanced the focused step.
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Setup progress')).toBeHidden();

    await page.keyboard.press('Control+ ');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    void palm;
  });

  test('is keyboard navigable and Escape skips it', async ({ palm, page }) => {
    await page.keyboard.press('Enter');
    await expect(page.getByText("Who's using this computer?")).toBeVisible();

    // Tab must stay inside the dialog.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Setup progress')).toBeHidden();
    await expect(page.getByRole('toolbar', { name: 'Taskbar' })).toBeVisible();
    void palm;
  });
});
