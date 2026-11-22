import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

async function ready(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.message-card').first()).toBeVisible();
}

async function upload(page: Page, name: string, data: unknown) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  });
  await ready(page);
}

function changes(page: Page, label: string) {
  return page.locator('.changes-list > span').filter({ hasText: label }).locator('strong');
}

test('imports a supported conversation directly from a ZIP export', async ({ page }) => {
  const zip = zipSync({ 'conversations.json': Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'DIRECT_ZIP_IMPORT' }] })) });
  const originalZip = Buffer.from(zip);
  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'chatgpt-export.zip', mimeType: 'application/zip', buffer: originalZip });
  await ready(page);
  await expect(page.locator('.file-details > strong')).toHaveText('chatgpt-export.zip');
  await expect(page.locator('.message-content').first()).toContainText('DIRECT_ZIP_IMPORT');
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original file', exact: true }).click();
  expect(await readFile((await (await originalDownload).path())!)).toEqual(originalZip);
});

test('browser downloads the original imported bytes separately from the cleaned export', async ({ page }) => {
  const source = Buffer.from('\uFEFF{\r\n  "messages": [{"role":"user","content":"ORIGINAL_SOURCE_PAYLOAD"}]\r\n}\r\n', 'utf8');
  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'preserve-source.json', mimeType: 'application/json', buffer: source,
  });
  await ready(page);

  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original file', exact: true }).click();
  const original = await originalDownload;
  expect(original.suggestedFilename()).toBe('preserve-source.json');
  expect(await readFile((await original.path())!)).toEqual(source);

  const cleanedText = await exported(page, 'Markdown transcript');
  expect(cleanedText).toContain('ORIGINAL_SOURCE_PAYLOAD');
  expect(cleanedText).toContain('Normalized transcript');
  expect(Buffer.from(cleanedText)).not.toEqual(source);

  const replacement = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'REPLACEMENT_SOURCE' }] }), 'utf8');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'replacement-source.json', mimeType: 'application/json', buffer: replacement,
  });
  await ready(page);
  const replacementDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original file', exact: true }).click();
  expect(await readFile((await (await replacementDownload).path())!)).toEqual(replacement);

  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download original file', exact: true })).not.toBeVisible();
});

test('mobile handoff shows its preview and actions without opening the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await upload(page, 'handoff.json', { messages: [{ role: 'user', content: 'Mobile handoff context.' }] });
  await page.getByRole('button', { name: 'Handoff builder', exact: true }).click();
  await expect(page.locator('.handoff-document')).toContainText('Mobile handoff context.');
  await expect(page.getByRole('button', { name: 'Download handoff', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const preview = page.locator('.handoff-document');
  const previousPreview = await preview.textContent();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Keep the current preview visible.');
  expect(await preview.textContent()).toBe(previousPreview);
  await expect(preview).toContainText('Keep the current preview visible.');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.locator('.handoff-markdown h1')).toContainText('Handoff: handoff.json');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.locator('.handoff-document')).toContainText('Keep the current preview visible.');
});

test('Markdown reading mode renders GFM while text mode and copy retain source text', async ({ page, context }) => {
  await page.goto('/');
  const source = [
    '# Retry plan', '',
    '| Attempt | Result |', '| --- | --- |', '| 1 | **safe** |', '',
    '- [x] Preserve the public API', '',
    '```typescript', 'return createCharge(request);', '```',
    '', '<img src=x onerror="window.injected = true">',
  ].join('\n');
  await upload(page, 'markdown.json', { messages: [{ role: 'assistant', content: source }] });
  const message = page.locator('.message-card');
  await expect(message.locator('.message-content')).toContainText('| Attempt | Result |');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const rendered = message.locator('.markdown-message');
  await expect(rendered.locator('h1')).toHaveText('Retry plan');
  await expect(rendered.locator('table')).toBeVisible();
  await expect(rendered.locator('strong')).toHaveText('safe');
  await expect(rendered.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(rendered.locator('img, script')).toHaveCount(0);
  await expect(rendered).toContainText('img src=x onerror=');

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(message.locator('.message-content')).toContainText('| Attempt | Result |');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = message.getByRole('button', { name: 'Copy full message', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-state', 'success');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('| Attempt | Result |');
});

async function switchRecipe(page: Page, title: string, checked: boolean) {
  const control = page.getByRole('switch', { name: title, exact: true });
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(checked));
  await ready(page);
}

async function exported(page: Page, label: string): Promise<string> {
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export transcript', exact: true });
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: new RegExp(label) }).click();
  const download = await downloadPromise;
  const location = await download.path();
  expect(location).toBeTruthy();
  const text = await readFile(location!, 'utf8');
  await expect(dialog).not.toBeVisible();
  return text;
}

function cardWith(page: Page, content: string): Locator {
  return page.locator('.message-card').filter({ hasText: content });
}

test('demo cleanup controls update real results, reset defaults, and compare the original', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  await expect(page.locator('.demo-badge')).toHaveText('SAMPLE DATA');
  await expect(page.getByRole('switch', { name: 'Redact email addresses' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.message-card')).toHaveCount(10);
  await expect(changes(page, 'images removed')).toHaveText('1');
  await expect(changes(page, 'outputs clipped')).toHaveText('1');
  await expect(changes(page, 'repeats collapsed')).toHaveText('1');
  await expect(changes(page, 'secrets redacted')).toHaveText('1');
  expect(Number.parseFloat(await page.locator('.metric-saved strong').innerText())).toBeGreaterThan(90);
  await expect(page.locator('.messages-list')).toContainText('[SECRET_1]');
  await expect(page.locator('.messages-list')).toContainText('[EMAIL_1]');
  await expect(page.locator('.messages-list')).toContainText('Inline image removed');

  await switchRecipe(page, 'Remove embedded images', false);
  await expect(changes(page, 'images removed')).toHaveText('0');
  await switchRecipe(page, 'Remove embedded images', true);
  await expect(changes(page, 'images removed')).toHaveText('1');

  await switchRecipe(page, 'Clip long tool outputs', false);
  await expect(changes(page, 'outputs clipped')).toHaveText('0');
  await expect(page.getByRole('slider', { name: 'Characters per tool output' })).not.toBeVisible();
  await switchRecipe(page, 'Clip long tool outputs', true);
  const limit = page.getByRole('slider', { name: 'Characters per tool output' });
  await limit.focus();
  await limit.press('Home');
  await expect(limit).toHaveValue('500');
  await ready(page);
  await limit.press('ArrowRight');
  await expect(limit).toHaveValue('1000');
  await ready(page);
  await expect(changes(page, 'outputs clipped')).toHaveText('1');

  await switchRecipe(page, 'Collapse repeat outputs', false);
  await expect(changes(page, 'repeats collapsed')).toHaveText('0');
  await expect(changes(page, 'outputs clipped')).toHaveText('2');
  await switchRecipe(page, 'Collapse repeat outputs', true);
  await expect(changes(page, 'repeats collapsed')).toHaveText('1');

  await switchRecipe(page, 'Redact common secrets', false);
  await expect(changes(page, 'secrets redacted')).toHaveText('0');
  await expect(page.locator('.messages-list')).toContainText('demo_value_for_documentation_only');
  await switchRecipe(page, 'Redact common secrets', true);
  await expect(page.locator('.messages-list')).not.toContainText('demo_value_for_documentation_only');
  await switchRecipe(page, 'Redact email addresses', false);
  await expect(page.locator('.messages-list')).toContainText('developer@example.test');
  await switchRecipe(page, 'Redact email addresses', true);
  await expect(changes(page, 'emails redacted')).toHaveText('1');
  await expect(page.locator('.messages-list')).toContainText('[EMAIL_1]');

  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.original-warning')).toBeVisible();
  await expect(page.locator('.messages-list')).toContainText('demo_value_for_documentation_only');
  await expect(page.locator('.messages-list')).toContainText('hidden in preview');
  await page.getByRole('button', { name: 'Packed', exact: true }).click();
  await expect(page.locator('.original-warning')).not.toBeVisible();
  await expect(page.locator('.messages-list')).not.toContainText('demo_value_for_documentation_only');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await ready(page);
  await expect(limit).toHaveValue('4000');
  await expect(page.getByRole('switch', { name: 'Redact email addresses' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.messages-list')).toContainText('[EMAIL_1]');
  await expect(changes(page, 'outputs clipped')).toHaveText('1');
});

test('ChatGPT archive switches conversations, filters, pins, and downloads actual portable exports', async ({ page }) => {
  await page.goto('/');
  const node = (id: string, parent: string | null, role: string, content: string) => ({
    id, parent, message: { id, author: { role }, content: { content_type: 'text', parts: [content] } },
  });
  await upload(page, 'conversations.json', [
    { id: 'alpha', title: 'Alpha release', current_node: 'a3', mapping: {
      a1: node('a1', null, 'user', 'ALPHA_GOAL: preserve the public contract.'),
      a2: node('a2', 'a1', 'assistant', 'ALPHA_DECISION: add a regression test.'),
      a3: node('a3', 'a2', 'tool', 'ALPHA_TOOL: test suite passed.'),
      abandoned: node('abandoned', 'a1', 'assistant', 'ABANDONED_BRANCH_MUST_NOT_EXPORT'),
    } },
    { id: 'beta', title: 'Beta migration', current_node: 'b2', mapping: {
      b1: node('b1', null, 'user', 'BETA_GOAL: migrate the database.'),
      b2: node('b2', 'b1', 'assistant', 'BETA_DECISION: create a reversible migration.'),
    } },
  ]);
  const conversations = page.getByRole('combobox', { name: 'Conversation', exact: true });
  await expect(conversations).toBeVisible();
  await expect(page.locator('.message-card')).toHaveCount(3);
  await expect(page.locator('.messages-list')).not.toContainText('ABANDONED_BRANCH');

  const search = page.getByRole('searchbox', { name: 'Search messages…' });
  await search.fill('alpha_decision');
  await expect(page.locator('.message-card')).toHaveCount(1);
  await expect(page.locator('.message-card')).toContainText('ALPHA_DECISION');
  await search.fill('does-not-exist');
  await expect(page.locator('.no-results')).toBeVisible();
  await search.clear();
  await page.locator('.role-filter').getByRole('button', { name: 'User', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(1);
  await expect(page.locator('.message-card')).toContainText('ALPHA_GOAL');
  await page.locator('.role-filter').getByRole('button', { name: 'All', exact: true }).click();

  const important = cardWith(page, 'ALPHA_DECISION');
  await important.getByRole('button', { name: 'Pin for handoff' }).click();
  await expect(important.getByRole('button', { name: 'Unpin message' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.metrics')).toContainText('1 pinned');
  await important.getByRole('button', { name: 'Unpin message' }).click();
  await expect(page.locator('.metrics')).toContainText('0 pinned');

  await conversations.selectOption({ label: '2. Beta migration' });
  await ready(page);
  await expect(page.locator('.message-card')).toHaveCount(2);
  await expect(page.locator('.messages-list')).toContainText('BETA_GOAL');
  await expect(page.locator('.messages-list')).not.toContainText('ALPHA_GOAL');
  const markdown = await exported(page, 'Markdown transcript');
  expect(markdown).toContain('BETA_GOAL');
  expect(markdown).not.toContain('ALPHA_GOAL');
  expect(markdown).toContain('not a resumable provider session');
  const jsonl = await exported(page, 'Normalized JSONL');
  const messages = jsonl.trim().split('\n').map(line => JSON.parse(line));
  expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
  expect(messages[1].content).toContain('BETA_DECISION');
  const report = JSON.parse(await exported(page, 'Cleanup report'));
  expect(report.tool).toBe('ThreadPack');
  expect(report.messageCount).toBe(2);
  expect(report.stats.beforeBytes).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain('BETA_GOAL');
});

test('handoff notes are redacted, pinning is preserved, and the text budget explains overflow', async ({ page }) => {
  await page.goto('/');
  const noteSecret = ['note_', 'synthetic_credential_1234567890'].join('');
  await upload(page, 'messages.json', { title: 'Handoff rehearsal', messages: [
    { id: 'pin', role: 'user', content: 'PINNED_KEEP\n' + 'Pinned requirements. '.repeat(400) },
    { id: 'work', role: 'assistant', content: 'Completed the reversible migration.' },
    { id: 'last', role: 'user', content: 'RECENT_FINAL: run the concurrency test.' },
  ] });
  await cardWith(page, 'PINNED_KEEP').getByRole('button', { name: 'Pin for handoff' }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill(`Continue the migration. API_KEY="${noteSecret}"`);
  await page.getByRole('textbox', { name: 'Decisions & completed work', exact: true }).fill('DECISION_NOTE: keep the public API stable.');
  await page.getByRole('textbox', { name: 'Constraints', exact: true }).fill('CONSTRAINT_NOTE: do not deploy.');
  await page.getByRole('textbox', { name: 'Next steps', exact: true }).fill('NEXT_NOTE: test parallel retries.');
  const document = page.locator('.handoff-document');
  await expect(document).toContainText('[NOTE_SECRET_1]');
  await expect(document).not.toContainText(noteSecret);
  await expect(document).toContainText('DECISION_NOTE');
  await expect(document).toContainText('CONSTRAINT_NOTE');
  await expect(document).toContainText('NEXT_NOTE');
  await expect(document).toContainText('PINNED_KEEP');
  await expect(document).toContainText('RECENT_FINAL');
  await page.getByRole('combobox', { name: 'Recent messages', exact: true }).selectOption('0');
  await expect(document).not.toContainText('RECENT_FINAL');
  await expect(document).toContainText('PINNED_KEEP');
  await page.getByRole('combobox', { name: 'Handoff text budget', exact: true }).selectOption('6000');
  await expect(document).toContainText('Budget exceeded');
  await expect(document).toContainText('Pinned requirements. Pinned requirements.');
  await page.getByRole('combobox', { name: 'Handoff text budget', exact: true }).selectOption('12000');
  await expect(document).not.toContainText('Budget exceeded');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download handoff', exact: true }).click();
  const location = await (await downloadPromise).path();
  const handoff = await readFile(location!, 'utf8');
  expect(handoff).toContain('[NOTE_SECRET_1]');
  expect(handoff).not.toContain(noteSecret);
  expect(handoff).toContain('PINNED_KEEP');
  expect(handoff).not.toContain('RECENT_FINAL');
  expect(handoff).toContain('deterministic excerpts, not an AI summary');
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await ready(page);
  await cardWith(page, 'PINNED_KEEP').getByRole('button', { name: 'Unpin message' }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(document).not.toContainText('PINNED_KEEP');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['threadpack-language']);
});

test('handoff timestamp mode reports its range and keeps selected messages in source order', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'timestamp-order.json', { messages: [
    { role: 'user', content: 'LATEST_TIMESTAMP', timestamp: '2026-01-05T00:00:00Z' },
    { role: 'assistant', content: 'VERY_OLD_TIMESTAMP', timestamp: '2026-01-01T00:00:00Z' },
    { role: 'user', content: 'SECOND_NEWEST_TIMESTAMP', timestamp: '2026-01-04T00:00:00Z' },
    { role: 'assistant', content: 'MIDDLE_TIMESTAMP', timestamp: '2026-01-03T00:00:00Z' },
    { role: 'user', content: 'NEXT_OLDEST_TIMESTAMP', timestamp: '2026-01-02T00:00:00Z' },
    { role: 'assistant', content: 'NO_TIMESTAMP_MESSAGE' },
  ] });
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('combobox', { name: 'Recent messages', exact: true }).selectOption('4');
  const document = page.locator('.handoff-document');
  await expect(document).toContainText('SECOND_NEWEST_TIMESTAMP');
  await expect(document).toContainText('NEXT_OLDEST_TIMESTAMP');
  await expect(document).not.toContainText('VERY_OLD_TIMESTAMP');
  await expect(document).toContainText('NO_TIMESTAMP_MESSAGE');
  await expect(document).not.toContainText('LATEST_TIMESTAMP');

  await page.getByRole('button', { name: 'Latest timestamps', exact: true }).click();
  await expect(document).toContainText('LATEST_TIMESTAMP');
  await expect(document).toContainText('SECOND_NEWEST_TIMESTAMP');
  await expect(document).not.toContainText('VERY_OLD_TIMESTAMP');
  await expect(document).not.toContainText('NO_TIMESTAMP_MESSAGE');
  await expect(document).toContainText('LATEST_TIMESTAMP');
  await expect(page.locator('.handoff-summary')).toContainText('Latest timestamps');
  await expect(page.locator('.handoff-summary')).toContainText('Recent context time range');
  await expect(page.locator('.handoff-summary')).toContainText('Complete messages');
  await expect(page.locator('.handoff-summary')).toContainText('Within limit');
  await expect(page.locator('.handoff-summary')).toContainText('Without valid timestamps');
  expect(await document.evaluate((element) => element.textContent!.indexOf('LATEST_TIMESTAMP') < element.textContent!.indexOf('SECOND_NEWEST_TIMESTAMP'))).toBeTruthy();
});

test('paste, malformed JSON, clearing, language, and help keyboard focus all work', async ({ page }) => {
  await page.goto('/');
  const help = page.getByRole('button', { name: 'How it works', exact: true });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'How it works', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(help).toBeFocused();
  await page.getByRole('combobox', { name: 'Language / 语言', exact: true }).selectOption('zh');
  await expect(page.getByRole('button', { name: '试用演示', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: '使用说明', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '使用说明', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '使用说明', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Language / 语言', exact: true }).selectOption('en');

  await page.getByRole('button', { name: 'Paste text', exact: true }).click();
  const paste = page.getByRole('dialog', { name: 'Paste text', exact: true });
  await expect(paste.getByRole('button', { name: 'Open text' })).toBeDisabled();
  const pastedSource = 'User: PASTE_GOAL: keep Unicode 你好.\nAssistant: PASTE_REPLY: ready.';
  await paste.getByRole('textbox', { name: 'Paste text', exact: true }).fill(pastedSource);
  await paste.getByRole('button', { name: 'Open text', exact: true }).click();
  await ready(page);
  await expect(page.locator('.message-card')).toHaveCount(2);
  await expect(page.locator('.messages-list')).toContainText('你好');
  const pastedOriginalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original file', exact: true }).click();
  expect(await readFile((await (await pastedOriginalDownload).path())!)).toEqual(Buffer.from(pastedSource, 'utf8'));
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"messages": [this is not JSON}') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.metrics')).not.toBeVisible();
  await page.getByRole('alert').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.locator('.messages-list')).not.toBeVisible();
});

test('390px viewport keeps the workbench and handoff controls within the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  if (!(await page.getByRole('switch', { name: 'Remove embedded images' }).isVisible())) await page.locator('.settings-toggle').click();
  await expect(page.getByRole('switch', { name: 'Remove embedded images' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('dialog', { name: 'Cleanup recipe', exact: true }).getByRole('button', { name: 'Done, show results', exact: true }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Mobile handoff goal.');
  await expect(page.locator('.handoff-document')).toContainText('Mobile handoff goal.');
  await expect(page.getByRole('button', { name: 'Download handoff', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('self-contained HTML runs offline from file:// and exports without network requests or page errors', async ({ browser }) => {
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(resolve('dist/index.html')).href);
    await expect(page.locator('#app-boot')).not.toBeAttached();
    const brandIcon = page.locator('.brand-icon img');
    await expect(brandIcon).toHaveJSProperty('naturalWidth', 192);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('type', 'image/png');
    expect(await page.locator('link[rel="icon"]').getAttribute('href')).toMatch(/^data:image\/png;base64,/);
    await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
    await ready(page);
    await expect(changes(page, 'images removed')).toHaveText('1');
    const transcript = await exported(page, 'Markdown transcript');
    expect(transcript).toContain('[Inline image removed by ThreadPack]');
    expect(transcript).toContain('[SECRET_1]');
    expect(transcript).not.toContain('data:image/png;base64,');
    expect(remoteRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
