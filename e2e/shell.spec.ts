import { expect, test } from './fixtures';

test.describe('terminal', () => {
  test.beforeEach(async ({ palm }) => {
    await palm.launch('Terminal');
  });

  test('runs sequences, redirection and pipelines', async ({ palm }) => {
    /*
     * Regression: `&&`, `;` and `||` were parsed as ordinary arguments, so
     * `mkdir a && ls` tried to create directories called "&&" and "ls".
     */
    let out = await palm.runCommand('mkdir -p /Documents/e2e && echo hi > /Documents/e2e/a.txt');
    out = await palm.runCommand('cat /Documents/e2e/a.txt');
    expect(out).toContain('hi');

    out = await palm.runCommand('cat /Desktop/Welcome.txt | grep -i palm | wc');
    expect(out).toMatch(/\d+\s+\d+\s+\d+/);

    out = await palm.runCommand('nosuchcmd || echo fallback-ran');
    expect(out).toContain('command not found');
    expect(out).toContain('fallback-ran');
  });

  test('tracks the working directory in the prompt', async ({ palm }) => {
    // Regression: tildify built its prefix by appending a separator to the
    // home path — but home *is* the root, so it always compared against "//".
    const out = await palm.runCommand('cd /Documents ; pwd');
    expect(out).toContain('/Documents');
    expect(out).toContain('palm@palm:~/Documents$');
  });

  test('keeps a single & as part of an argument', async ({ palm }) => {
    const out = await palm.runCommand('echo a&b');
    expect(out).toContain('a&b');
  });

  test('completes commands with Tab and recalls history with the arrow keys', async ({ palm, page }) => {
    const input = page.getByLabel('Terminal input');
    await input.fill('neo');
    await input.press('Tab');
    await expect(input).toHaveValue('neofetch ');

    await input.press('Enter');
    await expect(page.getByRole('log', { name: 'Terminal output' })).toContainText('Palm OS 1.0.0');

    await input.press('ArrowUp');
    await expect(input).toHaveValue('neofetch');
    void palm;
  });

  test('reports system facts without inventing the ones it cannot have', async ({ palm }) => {
    const out = await palm.runCommand('systeminfo');
    expect(out).toContain('Palm OS');
    expect(out).toContain('Virtual filesystem');
    // Firefox does not expose performance.memory; that must be said, not faked.
    const neofetch = await palm.runCommand('neofetch');
    expect(neofetch).toMatch(/Memory\s+(not exposed|[\d.]+)/);
  });

  test('explains that there is no superuser rather than pretending', async ({ palm }) => {
    const out = await palm.runCommand('sudo rm -rf /');
    expect(out).toContain('There is no superuser here');
  });
});

test.describe('keyboard shortcuts', () => {
  test('Ctrl+Space opens search and Escape closes it', async ({ palm, page }) => {
    void palm;
    await page.keyboard.press('Control+ ');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
  });

  test('Alt+F4 closes the focused window', async ({ palm, page }) => {
    await palm.launch('Calculator');
    await expect(palm.windows()).toHaveCount(1);
    await page.keyboard.press('Alt+F4');
    await expect(palm.windows()).toHaveCount(0);
  });

  test('Super snaps the focused window, but not while you are typing', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const win = palm.window('Terminal');
    const viewport = page.viewportSize()!;
    const before = await win.boundingBox();

    // The terminal input has focus on launch. Window shortcuts deliberately
    // yield to text fields, so this must do nothing.
    await expect(page.getByLabel('Terminal input')).toBeFocused();
    await page.keyboard.press('Meta+ArrowRight');
    await page.waitForTimeout(300);
    expect(Math.round((await win.boundingBox())!.x)).toBe(Math.round(before!.x));

    // With focus out of the field, it snaps.
    await win.getByText('Terminal').first().click();
    await page.keyboard.press('Meta+ArrowRight');
    await expect
      .poll(async () => Math.round((await win.boundingBox())!.x))
      .toBe(Math.round(viewport.width / 2));
  });
});
