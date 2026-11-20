import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test.use({ locale: 'en-US' });

test('snippet copy and download contain full cleaned code beyond the displayed preview', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const secret = 'synthetic_snippet_credential_583192';
  const code = 'const API_KEY="' + secret + '";\n' + '// synthetic code context\n'.repeat(180) + "export const complete = 'FULL_CODE_TAIL';\n";
  const body = 'Explanation.\n\n' + '```' + 'typescript\n' + code + '```' + '\nEnd.';
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'code.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages: [{ role: 'assistant', content: body }] })) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code snippets', exact: true });
  await expect(dialog.locator('.snippet-card')).toHaveCount(1);
  await expect(dialog.locator('.snippet-code')).toContainText('[SECRET_1]');
  await expect(dialog.locator('.snippet-code')).not.toContainText(secret);
  await expect(dialog.locator('.snippet-code')).not.toContainText('FULL_CODE_TAIL');
  await expect(dialog.locator('.snippet-shortened')).toBeVisible();
  expect(await dialog.locator('.snippet-code .hljs-keyword').count()).toBeGreaterThan(0);
  const wrap = dialog.getByRole('button', { name: 'Wrap code lines', exact: true });
  await wrap.click(); await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await wrap.click();
  const copy = dialog.getByRole('button', { name: 'Copy code', exact: true });
  await copy.click(); await expect(copy).toHaveAttribute('data-state', 'success');
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(copied).toContain('FULL_CODE_TAIL'); expect(copied).not.toContain(secret);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download code', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('threadpack-code-1-1.ts');
  expect(await readFile((await download.path())!, 'utf8')).toBe(copied);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('code search, language filter, and ZIP export include all matching cleaned blocks', async ({ page }) => {
  await page.goto('/');
  const privateValue = 'zip_export_private_fixture_4827';
  const tick = String.fromCharCode(96);
  const body = (index: number) => 'Context ' + (index + 1) + '\n\n' + tick.repeat(3) + 'typescript\nexport const item_' + (index + 1) + ' = API_KEY="' + privateValue + '";\n' + tick.repeat(3);
  const messages = [...Array.from({ length: 22 }, (_, index) => ({ role: 'assistant', content: body(index) })), { role: 'user', content: '~~~python\ndef support(): return True\n~~~' }];
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'zip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages })) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Code snippets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code snippets', exact: true });
  await expect(dialog.locator('.snippet-total')).toContainText('23');
  await dialog.getByRole('searchbox', { name: 'Search code…', exact: true }).fill('item_');
  await expect(dialog.locator('.snippet-total')).toContainText('22 / 23');
  await expect(dialog.locator('.snippet-card')).toHaveCount(20);
  await dialog.getByLabel('Code language', { exact: true }).selectOption('typescript');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const archive = await downloading;
  expect(archive.suggestedFilename()).toBe('threadpack-code.zip');
  const zipped = unzipSync(await readFile((await archive.path())!));
  const names = Object.keys(zipped);
  expect(names).toHaveLength(22);
  expect(names.every(name => /^threadpack-code-\d+-1\.ts$/.test(name))).toBe(true);
  const bodies = names.map(name => new TextDecoder().decode(zipped[name]));
  expect(bodies.some(value => value.includes('item_22'))).toBe(true);
  expect(bodies.every(value => value.includes('[SECRET_1]'))).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain(privateValue);
  await dialog.getByRole('searchbox', { name: 'Search code…', exact: true }).fill('no_code_match_8271');
  await expect(dialog.locator('.snippet-empty')).toContainText('No code matches these filters.');
  await dialog.locator('.snippet-empty').getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(dialog.locator('.snippet-card')).toHaveCount(20);
});

test('snippet pages cover the conversation and imported markup stays text', async ({ page }) => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ role: 'assistant', content: '~~~html\n<div data-index="' + index + '">SNIPPET_' + (index + 1) + '</div>\n~~~' }));
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

test('bundled license notices are available offline in the application help', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'How it works', exact: true });
  const notices = help.getByText('Open-source licenses', { exact: true });
  await expect(notices).toBeVisible();
  await help.locator('.third-party-notices > summary').click();
  await expect(help.locator('.third-party-notices pre')).toContainText('BSD 3-Clause License');
  await expect(help.locator('.third-party-notices pre')).toContainText('0.8.3');
  expect(await page.evaluate(() => document.querySelector<HTMLAnchorElement>('.site-footer a[href$="third-party-licenses.txt"]')?.getAttribute('href'))).toBe('./third-party-licenses.txt');
});
