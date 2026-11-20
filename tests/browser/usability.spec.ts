import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
});
test.afterEach(({ page }) => expect(errors.get(page) ?? []).toEqual([]));

async function ready(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.message-card').first()).toBeVisible();
}

function file(data: unknown, name = 'usability.json') {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) };
}

async function importData(page: Page, data: unknown, name = 'usability.json') {
  await page.getByLabel('Import file', { exact: true }).setInputFiles(file(data, name));
  await expect(page.locator('.file-details > strong')).toHaveText(name);
  await ready(page);
}

async function redactionDraft(page: Page, value: string) {
  const field = page.getByRole('textbox', { name: 'Values to hide', exact: true });
  if (!(await field.isVisible())) await page.locator('.custom-rules > summary').click();
  await field.fill(value);
}

async function exportMarkdown(page: Page) {
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export transcript', exact: true }).getByRole('button', { name: /Markdown transcript/ }).click();
  return readFile((await (await downloading).path())!, 'utf8');
}

test('1366×768 workbench keeps controls in its layout without export actions covering them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  expect(await page.locator('.export-bar').evaluate(element => getComputedStyle(element).position)).not.toBe('fixed');
  const controls = await page.locator('.preview-heading button, .preview-toolbar button, .preview-toolbar input, .export-actions button').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    return {
      label: element.getAttribute('aria-label') || element.textContent?.trim(),
      withinViewport: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      reachable: element.contains(document.elementFromPoint(centerX, centerY)),
    };
  }));
  expect(controls.length).toBeGreaterThanOrEqual(9);
  expect(controls.filter(control => !control.withinViewport || !control.reachable)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Export transcript', exact: true })).toBeEnabled();
});

test('mobile cleanup sheet returns directly to the results and restores useful keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importData(page, { messages: [{ role: 'user', content: 'MOBILE_PRIVATE_TARGET: Cedar client group 391.' }] });
  const settings = page.locator('.settings-toggle');
  await settings.click();
  const sheet = page.getByRole('dialog', { name: 'Cleanup recipe', exact: true });
  await expect(sheet).toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await sheet.locator('.custom-rules > summary').click();
  await sheet.getByRole('textbox', { name: 'Values to hide', exact: true }).fill('Cedar client group 391');
  await sheet.getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done, show results', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await ready(page);
  await expect(page.locator('.messages-list')).toContainText('[CUSTOM_1]');
  await expect(page.locator('.preview-panel')).toBeFocused();
  const preview = await page.locator('.preview-panel').boundingBox();
  expect(preview!.y).toBeGreaterThanOrEqual(0);
  expect(preview!.y).toBeLessThan(500);
  await settings.click();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(settings).toBeFocused();
});

test('unapplied custom redactions block export until the visible apply action commits them', async ({ page }) => {
  const privateValue = 'Spruce internal account 584';
  await importData(page, { messages: [{ role: 'user', content: `DRAFT_TARGET: ${privateValue}.` }] });
  await redactionDraft(page, privateValue);
  await expect(page.getByRole('status').filter({ hasText: 'Unapplied redactions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export transcript', exact: true })).toBeDisabled();
  await expect(page.locator('.messages-list')).toContainText(privateValue);
  await page.locator('.export-bar').getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('status').filter({ hasText: 'Unapplied redactions' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Export transcript', exact: true })).toBeEnabled();
  const output = await exportMarkdown(page);
  expect(output).toContain('[CUSTOM_1]');
  expect(output).not.toContain(privateValue);
});

test('invalid custom edits block handoff copy and download until rules are corrected', async ({ page }) => {
  const privateValue = 'Willow private customer 647';
  await importData(page, { messages: [{ role: 'user', content: privateValue }] });
  await redactionDraft(page, privateValue);
  await page.locator('.custom-rules').getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await ready(page);
  await redactionDraft(page, '§');
  await page.locator('.custom-rules').getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await expect(page.locator('.custom-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export transcript', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Handoff builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download handoff', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await redactionDraft(page, privateValue);
  await page.locator('.custom-rules').getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Handoff builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download handoff', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeEnabled();
});

test('clearing handwritten notes requires an explicit discard and can be cancelled', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  const goal = page.getByRole('textbox', { name: 'Goal', exact: true });
  await expect(goal).toBeFocused();
  await goal.fill('HANDWRITTEN_KEEP: test the release migration.');
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Unsaved handoff notes', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(goal).toHaveValue('HANDWRITTEN_KEEP: test the release migration.');
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await confirm.getByRole('button', { name: 'Discard notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  await expect(page.locator('.messages-list')).not.toBeVisible();
});

test('replacement protects notes from another conversation before importing the new file', async ({ page }) => {
  await importData(page, [
    { id: 'alpha', title: 'Alpha', messages: [{ role: 'user', content: 'ARCHIVE_ALPHA' }] },
    { id: 'beta', title: 'Beta', messages: [{ role: 'user', content: 'ARCHIVE_BETA' }] },
  ], 'original-notes.json');
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('CROSS_CONVERSATION_NOTE');
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('beta');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
  const newFile = file({ messages: [{ role: 'user', content: 'REPLACEMENT_ARCHIVE' }] }, 'replacement.json');
  const input = page.getByLabel('Import file', { exact: true });
  await input.setInputFiles(newFile);
  const confirm = page.getByRole('dialog', { name: 'Unsaved handoff notes', exact: true });
  await expect(confirm).toBeVisible();
  await expect(page.locator('.file-details > strong')).toHaveText('original-notes.json');
  await confirm.getByRole('button', { name: 'Keep working', exact: true }).click();
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('alpha');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('CROSS_CONVERSATION_NOTE');
  await input.setInputFiles(newFile);
  await confirm.getByRole('button', { name: 'Discard notes', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('replacement.json');
  await ready(page);
  await expect(page.locator('.messages-list')).toContainText('REPLACEMENT_ARCHIVE');
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
});

test('switching conversations resets old filters and exposes system-message filtering', async ({ page }) => {
  await importData(page, [
    { id: 'alpha', title: 'Alpha', messages: [{ role: 'user', content: 'ALPHA_SEARCH: API_KEY="synthetic_value_123456"' }] },
    { id: 'beta', title: 'Beta', messages: [{ role: 'system', content: 'BETA_SYSTEM_RULE' }, { role: 'user', content: 'BETA_USER_GOAL' }] },
  ]);
  const search = page.getByRole('searchbox', { name: 'Search messages…', exact: true });
  await search.fill('ALPHA_SEARCH');
  await page.locator('.role-filter').getByRole('button', { name: 'User', exact: true }).click();
  await page.getByRole('button', { name: 'Changed only', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('beta');
  await ready(page);
  await expect(search).toHaveValue('');
  await expect(page.locator('.role-filter').getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Changed only', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.message-card')).toHaveCount(2);
  await page.locator('.role-filter').getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(1);
  await expect(page.locator('.message-card')).toContainText('BETA_SYSTEM_RULE');
});

test('view navigation gives keyboard users a useful focus target without tabbing through the hidden file input', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  await expect(page.getByLabel('Import file', { exact: true })).toHaveAttribute('tabindex', '-1');
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await ready(page);
  await expect(page.locator('.preview-panel')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.matches('input[type="file"]'))).toBe(false);
});
