import { expect, test } from './fixtures';

/**
 * The Palm OS origin's own Content-Security-Policy.
 *
 * A CSP is only worth having if it is known not to break the thing it
 * protects, and a violation logs to the console rather than failing anything —
 * so without a test like this one, a policy that quietly blocks a stylesheet
 * or a worker looks exactly like a policy that works.
 *
 * `securitypolicyviolation` is collected from the page itself, before any
 * application code runs, and the desktop is then exercised across the features
 * most likely to trip it: lazy chunks, blob URLs, object URLs, inline styles
 * and an embedded frame.
 */
const COLLECT_VIOLATIONS = `
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__cspViolations.push({
      directive: event.violatedDirective,
      blocked: event.blockedURI,
      line: event.lineNumber,
    });
  });
`;

type Violation = { directive: string; blocked: string; line: number };

const violations = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);

test.describe('the Palm OS origin policy', () => {
  test('is sent, and locks down the directive that matters', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'];

    expect(csp).toBeTruthy();
    // Palm OS uses no eval, no inline script and no remote script, so this
    // costs nothing and is what stops an injection bug reaching the origin
    // that holds the user's files.
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // Nothing may frame Palm OS.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');
  });

  test('does not block the desktop doing its job', async ({ page }) => {
    await page.addInitScript(COLLECT_VIOLATIONS);

    const { Palm } = await import('./fixtures');
    const palm = new Palm(page);
    await palm.boot();

    // Each of these exercises something a CSP commonly breaks: lazily loaded
    // chunks, inline style attributes, object URLs for file previews, and a
    // worker-backed view.
    for (const app of ['Files', 'Settings', 'Text Editor', 'Calculator', 'System Monitor']) {
      await palm.launch(app);
    }

    expect(await violations(page)).toEqual([]);
  });

  test('does not block the Browser embedding a site', async ({ page }) => {
    await page.addInitScript(COLLECT_VIOLATIONS);
    await page.route('**/_palm/frame-policy?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://allows.test/', verdict: 'ALLOWED', source: 'none' }),
      }),
    );
    await page.route('https://allows.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Embedded</h1>' }),
    );

    const { Palm } = await import('./fixtures');
    const palm = new Palm(page);
    await palm.boot();
    await palm.launch('Browser');

    await page.getByLabel('search bar').fill('https://allows.test/');
    await page.getByLabel('search bar').press('Enter');
    await expect(palm.window('Browser').locator('iframe')).toHaveCount(1);

    // `frame-src` has to stay open enough for the Browser to do the one thing
    // it exists to do.
    expect(await violations(page)).toEqual([]);
  });
});
