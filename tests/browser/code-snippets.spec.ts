import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ locale: 'en-US' });

test('snippet copy and download contain full cleaned code beyond the displayed preview', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const secret = 'synthetic_snippet_credential_583192';
  const code = `const API_KEY="${secret}";\n${'// synthetic code context\n'.repeat(180)}export const complete = 'FULL_CODE_TAIL';\n`;
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'code.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages: [{ role: 'assistant', content: `Explanation.\n\n\`\`\`typescript\n${code}\`\`\`\nEnd.` }] })) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code snippets', exact: true });
  await expect(dialog.locator('.snippet-card')).toHaveCount(1);
  await expect(dialog.locator('.snippet-code')).toContainText('[SECRET_1]');
  await expect(dialog.locator('.snippet-code')).not.toContainText(secret);
  await expect(dialog.locator('.snippet-code')).not.toContainText('FULL_CODE_TAIL');
  await expect(dialog.locator('.snippet-shortened')).toBeVisible();
  const copy = dialog.getByRole('button', { name: 'Copy code', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-state', 'success');
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(copied).toContain('FULL_CODE_TAIL');
  expect(copied).not.toContain(secret);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download code', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('threadpack-code-1-1.ts');
  expect(await readFile((await download.path())!, 'utf8')).toBe(copied);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('snippet pages cover the conversation and imported markup stays text', async ({ page }) => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ role: 'assistant', content: `~~~html\n<div data-index="${index}">SNIPPET_${index + 1}</div>\n~~~` }));
  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'many.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages })) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code snippets', exact: true });
  await expect(dialog.locator('.snippet-card')).toHaveCount(20);
  await expect(dialog.locator('.snippet-total')).toContainText('25');
  await expect(dialog.locator('.snippet-code').first()).toContainText('<div');
  await expect(dialog.locator('.snippet-code div')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('.snippet-card')).toHaveCount(5);
  await expect(dialog.getByRole('heading', { name: 'Code snippets', exact: true })).toBeFocused();
  await expect(dialog).toContainText('SNIPPET_25');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Code snippets', exact: true })).toBeFocused();
});

test('the bundled demo includes code and plain conversations explain the empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code snippets', exact: true });
  await expect(dialog.locator('.snippet-code')).toContainText('findByIdempotencyKey');
  await page.keyboard.press('Escape');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from('A plain conversation without fenced code.') });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  await expect(dialog.locator('.snippet-empty')).toContainText('No fenced code blocks found.');
});

test('sharing copies only the project link and the import guide works without JavaScript', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { sharedLink: string }).sharedLink = text; } } }));
  await page.goto('/?private_query=synthetic_private_query#synthetic_private_fragment');
  await page.getByRole('button', { name: 'Share ThreadPack', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Project link copied');
  expect(await page.evaluate(() => (window as unknown as { sharedLink: string }).sharedLink)).toBe('https://hajimi1214.github.io/ThreadPack/');
  const guide = page.getByRole('link', { name: 'Import guide', exact: true });
  await expect(guide).toHaveAttribute('href', 'https://hajimi1214.github.io/ThreadPack/import-guide.html');
  const base = new URL(page.url()).origin;
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  try {
    const guidePage = await noJs.newPage();
    await guidePage.goto(`${base}/import-guide.html`);
    await expect(guidePage.getByRole('heading', { name: 'Open your conversation export.', exact: true })).toBeVisible();
    await expect(guidePage.locator('#zh')).toContainText('导入指南');
  } finally { await noJs.close(); }
});
