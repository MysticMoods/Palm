import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build, not the dev server: the
 * bugs worth catching here — stacking contexts, animation fill modes, lazy
 * chunk loading — are ones that only appear in a real bundle.
 *
 * Firefox is the default because it is the strictest of the three about the
 * platform features Palm OS leans on, and because the capability fallbacks
 * (no File System Access API) only exercise there.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    video: 'off',
  },

  /*
   * Firefox is the suite of record: it is the stricter of the two about the
   * platform features Palm OS leans on, and the capability fallbacks — no File
   * System Access API — only exercise there.
   *
   * Chromium is here because it is what most people actually use, and it is
   * the only engine with a real File System Access API. Both engines are
   * required to pass in CI. Note that Chromium cannot be run in every
   * development environment — a sandbox without access to Playwright's browser
   * CDN can only run Firefox locally, and relies on CI for the rest.
   */
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
