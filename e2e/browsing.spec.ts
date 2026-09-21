import { expect, test } from './fixtures';

/**
 * Normal mode versus embedded mode.
 *
 * The rule being tested is that Palm OS decides by reading the site's own
 * framing headers, and offers the thing that works when the answer is no —
 * rather than rendering a frame that will be refused and leaving a blank
 * rectangle, and rather than stripping the header to force it.
 */
async function routeFramePolicy(
  page: import('@playwright/test').Page,
  verdicts: Record<string, { verdict: string; source?: string }>,
) {
  await page.route('**/_palm/frame-policy?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url') ?? '';
    const host = (() => {
      try {
        return new URL(target).hostname;
      } catch {
        return '';
      }
    })();
    const answer = verdicts[host] ?? { verdict: 'ALLOWED', source: 'none' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: target, ...answer }),
    });
  });
}

test.describe('browsing modes', () => {
  test('a site that refuses framing is offered normally, not shown blank', async ({ palm, page }) => {
    await routeFramePolicy(page, {
      'refuses.test': { verdict: 'DENIED', source: 'x-frame-options' },
    });

    await palm.launch('Browser');
    await page.getByLabel('search bar').fill('https://refuses.test/');
    await page.getByLabel('search bar').press('Enter');

    const win = palm.window('Browser');
    await expect(win.getByText('refuses.test opens in your browser')).toBeVisible();
    // It names the header, so the explanation is checkable rather than vague.
    await expect(win).toContainText('X-Frame-Options: DENY');
    await expect(win.getByRole('button', { name: 'Open normally' })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Try embedded mode' })).toBeVisible();

    // And no frame was rendered for it.
    expect(await win.locator('iframe').count()).toBe(0);
  });

  test('says plainly that it does not strip the protection', async ({ palm, page }) => {
    await routeFramePolicy(page, {
      'refuses.test': { verdict: 'DENIED', source: 'frame-ancestors' },
    });

    await palm.launch('Browser');
    await page.getByLabel('search bar').fill('https://refuses.test/');
    await page.getByLabel('search bar').press('Enter');

    const win = palm.window('Browser');
    await expect(win).toContainText('content security policy');
    await expect(win).toContainText('Palm OS does not remove these protections');
  });

  test('embedded mode can still be tried on request', async ({ palm, page }) => {
    await routeFramePolicy(page, {
      'refuses.test': { verdict: 'DENIED', source: 'x-frame-options' },
    });

    await palm.launch('Browser');
    await page.getByLabel('search bar').fill('https://refuses.test/');
    await page.getByLabel('search bar').press('Enter');

    const win = palm.window('Browser');
    await win.getByRole('button', { name: 'Try embedded mode' }).click();
    // The user's choice wins: Palm OS states the risk and then does as asked.
    await expect(win.locator('iframe')).toHaveCount(1);
  });

  test('a site that permits framing is embedded without asking', async ({ palm, page }) => {
    await routeFramePolicy(page, { 'allows.test': { verdict: 'ALLOWED', source: 'none' } });
    // The frame must not actually reach the network in a test.
    await page.route('https://allows.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Embedded fine</h1>' }),
    );

    await palm.launch('Browser');
    await page.getByLabel('search bar').fill('https://allows.test/');
    await page.getByLabel('search bar').press('Enter');

    const win = palm.window('Browser');
    await expect(win.locator('iframe')).toHaveCount(1);
    await expect(win).not.toContainText('opens in your browser');
  });

  test('a sign-in flow is sent to the real browser whatever the headers say', async ({
    palm,
    page,
  }) => {
    // Even a site that would allow framing cannot complete OAuth in one: the
    // redirect URI is registered against its real origin.
    await routeFramePolicy(page, { 'accounts.google.com': { verdict: 'ALLOWED', source: 'none' } });

    await palm.launch('Browser');
    await page.getByLabel('search bar').fill('https://accounts.google.com/o/oauth2/v2/auth');
    await page.getByLabel('search bar').press('Enter');

    const win = palm.window('Browser');
    await expect(win).toContainText('sign-in flow');
    expect(await win.locator('iframe').count()).toBe(0);
  });
});
