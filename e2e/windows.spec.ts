import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

/** Geometry as the browser actually laid it out, not as the store recorded it. */
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
  };
}

test.describe('window geometry', () => {
  test('windows cascade instead of stacking at the origin', async ({ palm }) => {
    /*
     * Regression: the entrance animation used `fill: both` with a keyframe
     * ending at `transform: none`, which permanently overrode each frame's
     * inline transform and pinned every window to the top-left corner.
     */
    await palm.launch('Files');
    await palm.launch('Terminal');
    await palm.launch('Calculator');

    const boxes = await palm.windows().evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    expect(boxes.length).toBe(3);
    expect(new Set(boxes.map((b) => `${b.x},${b.y}`)).size).toBe(3);
    expect(boxes.every((b) => b.x > 0 && b.y > 0)).toBe(true);
  });

  test('dragging to an edge previews and applies a snap', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const win = palm.window('Terminal');
    const start = await win.boundingBox();
    expect(start).not.toBeNull();

    const viewport = page.viewportSize()!;
    await page.mouse.move(start!.x + 150, start!.y + 14);
    await page.mouse.down();
    await page.mouse.move(viewport.width / 2, 400, { steps: 8 });
    await page.mouse.move(3, 400, { steps: 8 });
    await expect(page.getByText('Left half')).toBeVisible();
    await page.mouse.up();

    const snapped = await box(win);
    expect(snapped!.x).toBe(0);
    expect(snapped!.y).toBe(0);
    expect(snapped!.w).toBe(Math.round(viewport.width / 2));
  });

  test('resize handles straddle the border and are grabbable', async ({ palm, page }) => {
    /*
     * Regression: the handles sit a few pixels outside the frame, and used to
     * be clipped away by the frame's own `overflow: hidden`.
     */
    await palm.launch('Terminal');
    const win = palm.window('Terminal');
    const before = await box(win);

    await page.mouse.move(before!.x + before!.w, before!.y + before!.h / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.w + 140, before!.y + before!.h / 2, { steps: 10 });
    await page.mouse.up();

    const after = await box(win);
    expect(after!.w).toBeGreaterThan(before!.w + 100);
    expect(after!.h).toBe(before!.h);
  });

  test('a window cannot be resized below its minimum', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const win = palm.window('Terminal');
    const before = await box(win);

    await page.mouse.move(before!.x + before!.w, before!.y + before!.h / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + 20, before!.y + before!.h / 2, { steps: 12 });
    await page.mouse.up();

    const after = await box(win);
    expect(after!.w).toBeGreaterThanOrEqual(320);
  });

  test('maximise fills the work area and restore brings the size back', async ({ palm, page }) => {
    await palm.launch('Terminal');
    const win = palm.window('Terminal');
    const before = await box(win);

    await page.getByRole('button', { name: /^Maximise/ }).click();
    const maximised = await box(win);
    expect(maximised!.w).toBe(page.viewportSize()!.width);

    await page.getByRole('button', { name: /^Restore/ }).click();
    expect(await box(win)).toEqual(before);
  });
});

test.describe('window switcher', () => {
  /*
   * Regression: the old implementation sorted by z-index and focused the next
   * window, but focusing raises z-index — so each press destroyed the ordering
   * it had just derived and it oscillated between the two most recent.
   */
  test('Alt+Tab reaches every window, not just the last two', async ({ palm, page }) => {
    for (const app of ['Files', 'Terminal', 'Calculator', 'Notes']) await palm.launch(app);

    const switcher = page.getByRole('listbox', { name: 'Switch window' });
    await page.keyboard.down('Alt');
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      await expect(switcher).toBeVisible();
      seen.push(await switcher.getByRole('option', { selected: true }).innerText());
    }
    await page.keyboard.up('Alt');

    expect(new Set(seen.map((s) => s.split('\n')[0])).size).toBe(4);
    await expect(switcher).toBeHidden();
  });

  test('Escape cancels without changing focus', async ({ palm, page }) => {
    await palm.launch('Files');
    await palm.launch('Terminal');
    const before = await palm.focusedWindow().getAttribute('aria-label');

    await page.keyboard.down('Alt');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('listbox', { name: 'Switch window' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.up('Alt');

    await expect(page.getByRole('listbox', { name: 'Switch window' })).toBeHidden();
    expect(await palm.focusedWindow().getAttribute('aria-label')).toBe(before);
  });

  test('the sticky switcher survives the modifiers being released', async ({ palm, page }) => {
    // The fallback for desktops whose window manager swallows Alt+Tab.
    await palm.launch('Files');
    await palm.launch('Terminal');
    await palm.launch('Calculator');

    await page.keyboard.press('Control+Alt+w');
    const switcher = page.getByRole('listbox', { name: 'Switch window' });
    await expect(switcher).toBeVisible();

    await page.keyboard.press('ArrowRight');
    const chosen = (await switcher.getByRole('option', { selected: true }).innerText()).split('\n')[0];
    await page.keyboard.press('Enter');

    await expect(switcher).toBeHidden();
    expect(await palm.focusedWindow().getAttribute('aria-label')).toContain(chosen);
  });
});
