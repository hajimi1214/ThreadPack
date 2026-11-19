import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
});
test.afterEach(({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

async function idle(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
}

async function importMessages(page: Page, messages: { role: string; content: string }[], name = 'review.json') {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ title: 'Synthetic review fixture', messages })),
  });
  await expect(page.locator('.file-details > strong')).toHaveText(name);
  await idle(page);
  await expect(page.locator('.message-card').first()).toBeVisible();
}

async function customInput(page: Page) {
  const field = page.getByRole('textbox', { name: 'Values to hide', exact: true });
  if (!(await field.isVisible())) await page.locator('summary').filter({ hasText: 'Custom redactions' }).click();
  await expect(field).toBeVisible();
  return field;
}

async function applyCustom(page: Page, value: string) {
  await (await customInput(page)).fill(value);
  await page.getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await idle(page);
}

async function exportText(page: Page, format: string) {
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export transcript', exact: true });
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: new RegExp(format) }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  return readFile(path!, 'utf8');
}

test('custom rules redact transcript and handoff notes with built-in detection off, without leaking through reports', async ({ page }) => {
  const privateValue = 'Atlas private workspace 314';
  const differentlyCased = privateValue.toLowerCase();
  await importMessages(page, [
    { role: 'user', content: `PROJECT_GOAL: work on ${privateValue}. Case control: ${differentlyCased}.` },
    { role: 'assistant', content: 'UNCHANGED_REPLY: keep the public interface stable.' },
    { role: 'tool', content: `PROJECT_AUDIT: checked ${privateValue}.` },
  ]);
  const standard = page.getByRole('switch', { name: 'Redact common secrets', exact: true });
  await standard.click();
  await expect(standard).toHaveAttribute('aria-checked', 'false');
  await idle(page);
  await applyCustom(page, privateValue);
  await expect(page.locator('.messages-list')).toContainText('[CUSTOM_1]');
  await expect(page.locator('.messages-list')).not.toContainText(privateValue);
  await expect(page.locator('.messages-list')).toContainText(differentlyCased);
  const changed = page.locator('.message-card').filter({ hasText: 'PROJECT_GOAL' });
  await expect(changed.locator('.message-change-labels')).toContainText(/custom/i);
  await changed.getByRole('button', { name: 'Pin for handoff', exact: true }).click();

  const markdown = await exportText(page, 'Markdown transcript');
  expect(markdown).toContain('[CUSTOM_1]');
  expect(markdown).not.toContain(privateValue);
  expect(markdown).toContain(differentlyCased);
  const rawReport = await exportText(page, 'Cleanup report');
  const report = JSON.parse(rawReport);
  expect(report.stats.customRedacted).toBe(2);
  expect(report.options.customRuleCount).toBe(1);
  expect(rawReport).not.toContain(privateValue);
  expect(rawReport).not.toContain('customSecrets');
  expect(rawReport).not.toContain(differentlyCased);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(privateValue);

  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill(`Continue work on ${privateValue}.`);
  await expect(page.locator('.handoff-document')).toContainText('[NOTE_CUSTOM_1]');
  await expect(page.locator('.handoff-document')).not.toContainText(privateValue);
  await expect(page.locator('.handoff-document')).toContainText('[CUSTOM_1]');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download handoff', exact: true }).click();
  const handoff = await readFile((await (await download).path())!, 'utf8');
  expect(handoff).toContain('[NOTE_CUSTOM_1]');
  expect(handoff).not.toContain(privateValue);

  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await idle(page);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await idle(page);
  const resetReport = await exportText(page, 'Cleanup report');
  expect(resetReport).not.toContain(privateValue);
  expect(resetReport).not.toContain('customSecrets');
});

test('invalid custom drafts preserve applied rules, while explicit clearing and new imports discard them', async ({ page }) => {
  const privateValue = 'Orchard confidential case 872';
  const messages = [{ role: 'user', content: `CASE_TO_REVIEW: ${privateValue}.` }];
  await importMessages(page, messages);
  await applyCustom(page, privateValue);
  await expect(page.locator('.messages-list')).not.toContainText(privateValue);

  await (await customInput(page)).fill('§');
  await page.getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('§');
  await expect(page.locator('.messages-list')).toContainText('[CUSTOM_1]');
  await expect(page.locator('.messages-list')).not.toContainText(privateValue);
  const stillProtected = await exportText(page, 'Markdown transcript');
  expect(stillProtected).not.toContain(privateValue);

  await page.getByRole('button', { name: 'Clear custom rules', exact: true }).click();
  await idle(page);
  await expect(await customInput(page)).toHaveValue('');
  await expect(page.locator('.messages-list')).toContainText(privateValue);
  await applyCustom(page, privateValue);
  await expect(page.locator('.messages-list')).not.toContainText(privateValue);

  await importMessages(page, messages, 'fresh-archive.json');
  await expect(page.locator('.messages-list')).toContainText(privateValue);
  await expect(await customInput(page)).toHaveValue('');
  expect(JSON.parse(await exportText(page, 'Cleanup report')).options.customRuleCount).toBe(0);
  await applyCustom(page, privateValue);
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.locator('.messages-list')).not.toBeVisible();
  await importMessages(page, messages, 'after-clear.json');
  await expect(page.locator('.messages-list')).toContainText(privateValue);
  await expect(await customInput(page)).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(privateValue);
});

test('changed-only review combines with role and search filters and uses the same message references in original mode', async ({ page }) => {
  const privateValue = 'Juniper private ticket 926';
  await importMessages(page, [
    { role: 'user', content: 'UNCHANGED_GOAL: preserve backward compatibility.' },
    { role: 'assistant', content: `CHANGED_ASSISTANT: reviewing ${privateValue}.` },
    { role: 'tool', content: `CHANGED_TOOL: ${'Synthetic log entry. '.repeat(500)}END_OF_TOOL` },
    { role: 'user', content: `CHANGED_USER: do not share ${privateValue}.` },
  ]);
  await applyCustom(page, privateValue);
  const onlyChanged = page.getByRole('button', { name: 'Changed only', exact: true });
  await expect(onlyChanged).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.message-card')).toHaveCount(4);
  await onlyChanged.click();
  await expect(onlyChanged).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.message-card')).toHaveCount(3);
  await expect(page.locator('.messages-list')).not.toContainText('UNCHANGED_GOAL');
  await expect(page.locator('.message-card').filter({ hasText: 'CHANGED_TOOL' }).locator('.message-change-labels')).toContainText(/clip|trim|output/i);
  await expect(page.locator('.message-card').filter({ hasText: 'CHANGED_ASSISTANT' }).locator('.message-change-labels')).toContainText(/custom/i);

  await page.locator('.role-filter').getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Search messages…' });
  await search.fill('CHANGED_USER');
  await expect(page.locator('.message-card')).toHaveCount(0);
  await expect(page.locator('.no-results')).toBeVisible();
  await search.fill('changed_assistant');
  await expect(page.locator('.message-card')).toHaveCount(1);
  await page.locator('.role-filter').getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(1);
  await search.clear();
  await expect(page.locator('.message-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(3);
  await expect(page.locator('.messages-list')).toContainText(privateValue);
  await expect(page.locator('.messages-list')).not.toContainText('UNCHANGED_GOAL');
  await onlyChanged.click();
  await expect(onlyChanged).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.message-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Packed', exact: true }).click();
  await expect(page.locator('.messages-list')).not.toContainText(privateValue);
});

test('search reveals a match beyond the normal expansion limit and clearing it restores the initial preview', async ({ page }) => {
  const needle = 'DEEP_NEEDLE_09';
  const longMessage = `LONG_HEAD: ${'ordinary filler '.repeat(1100)}${needle} context near the match. ${'tail '.repeat(200)}`;
  expect(longMessage.indexOf(needle)).toBeGreaterThan(15000);
  await importMessages(page, [{ role: 'assistant', content: longMessage }]);
  const body = page.locator('.message-content');
  await expect(body).toContainText('LONG_HEAD');
  await expect(body).not.toContainText(needle);
  const search = page.getByRole('searchbox', { name: 'Search messages…' });
  await search.fill(needle.toLowerCase());
  await expect(page.locator('.message-card')).toHaveCount(1);
  await expect(body).toContainText(needle);
  await expect(body).not.toContainText('LONG_HEAD');
  await expect(page.getByText('Search match', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(body).toContainText(needle);
  await search.clear();
  await expect(body).toContainText('LONG_HEAD');
  await expect(body).not.toContainText(needle);
  await expect(page.getByText('Search match', { exact: true })).not.toBeVisible();
});
