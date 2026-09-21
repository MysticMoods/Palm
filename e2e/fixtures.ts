import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Shared helpers for driving the desktop.
 *
 * Every test starts from a clean browser profile, so Palm OS seeds its
 * filesystem and shows the first-run tour. The tour is skipped by default —
 * `welcome.spec.ts` opts back in.
 */
export const test = base.extend<{ palm: Palm }>({
  palm: async ({ page }, use) => {
    const palm = new Palm(page);
    await palm.boot();
    await use(palm);
  },
});

export { expect };

export class Palm {
  constructor(readonly page: Page) {}

  /** Load the OS and wait for the desktop. */
  async boot(options: { welcome?: boolean } = {}): Promise<void> {
    await this.page.goto('/');
    await this.page.getByRole('toolbar', { name: 'Taskbar' }).waitFor();
    if (!options.welcome) await this.skipWelcome();
  }

  async skipWelcome(): Promise<void> {
    const skip = this.page.getByRole('button', { name: 'Skip setup' });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await this.page.getByRole('dialog', { name: 'Start menu' }).waitFor({ state: 'hidden' }).catch(() => {});
      await expect(skip).toBeHidden();
    }
  }

  /**
   * Launch an app from the start menu.
   *
   * Scoped to the menu deliberately: a bare name also matches the taskbar
   * button, and clicking that for an already-focused app correctly *minimises*
   * it rather than opening a window.
   *
   * Matched by text rather than role, because pinned apps render as tiles
   * (`button`) while the category and recent lists render as `option` rows.
   */
  async launch(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Open the start menu' }).click();
    const menu = this.page.getByRole('dialog', { name: 'Start menu' });
    await menu.waitFor();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await menu.locator('button').filter({ hasText: new RegExp(`^${escaped}`) }).first().click();

    const win = this.window(name);
    await win.waitFor();
    // The window frame appears before its lazily-loaded chunk does; waiting
    // for the Suspense fallback to clear stops tests racing the first render.
    await expect(win.getByText('Loading…')).toHaveCount(0);
  }

  /** A window, matched on the app name appearing in its accessible name. */
  window(name: string) {
    return this.page.locator(`[data-window-id][aria-label*="${name}"]`);
  }

  windows() {
    return this.page.locator('[data-window-id]');
  }

  focusedWindow() {
    return this.page.locator('[data-window-id][data-focused]');
  }

  /** Run a command in an already-open Terminal and return the scrollback. */
  async runCommand(command: string): Promise<string> {
    const input = this.page.getByLabel('Terminal input');
    await input.fill(command);
    await input.press('Enter');
    // The shell is async; wait for the prompt to come back.
    await expect(this.page.getByRole('log', { name: 'Terminal output' })).toContainText(command);
    await this.page.waitForTimeout(400);
    return (await this.page.getByRole('log', { name: 'Terminal output' }).innerText()) ?? '';
  }

  /** Navigate the Files sidebar. */
  async goToPlace(name: string): Promise<void> {
    await this.page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name }).first().click();
  }

  fileItems() {
    return this.page.getByRole('listbox', { name: 'Files' }).getByRole('option');
  }
}
