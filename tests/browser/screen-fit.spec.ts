import { test, expect } from '@playwright/test';

const screens = [
  { name: 'small phone', width: 320, height: 568 },
  { name: 'compact tablet', width: 600, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'short laptop', width: 1024, height: 600 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'ultrawide', width: 2560, height: 1440 },
];

for (const screen of screens) {
  test(`${screen.name}: transcript stays readable and export controls remain reachable`, async ({ page }) => {
    await page.setViewportSize(screen);
    await page.goto('/');
    await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
    await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.message-card')).toHaveCount(10);
    expect((await page.locator('.messages-list').boundingBox())!.height).toBeGreaterThan(130);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const headerFits = await page.locator('.site-header').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
    expect(headerFits).toBe(true);
    expect(await page.locator('.site-header').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    if (screen.width > 800) expect((await page.locator('.recipe-controls .toggle-row').first().boundingBox())!.width).toBeGreaterThan(150);
    await page.locator('.message-card').first().scrollIntoViewIfNeeded();
    await expect(page.locator('.message-card').first()).toBeInViewport();
    const exportButton = page.getByRole('button', { name: 'Export transcript', exact: true });
    await exportButton.scrollIntoViewIfNeeded();
    await expect(exportButton).toBeInViewport();
    await exportButton.click();
    const dialog = page.getByRole('dialog', { name: 'Export transcript', exact: true });
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(screen.width);
  });
}

test('orientation changes preserve the selected filters and pinned messages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Pin for handoff', exact: true }).first().click();
  await page.getByRole('searchbox').fill('public API');
  await expect(page.locator('.message-card')).toHaveCount(1);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('searchbox')).toHaveValue('public API');
  await expect(page.getByRole('button', { name: 'Unpin message', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await page.locator('.messages-list').boundingBox())!.height).toBeGreaterThan(130);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('searchbox')).toHaveValue('public API');
  await expect(page.getByRole('button', { name: 'Unpin message', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
