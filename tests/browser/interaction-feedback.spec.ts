import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ locale: 'en-US' });

async function upload(page: Page, messages: { role: string; content: string }[]) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'feedback.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages })) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.message-card').first()).toBeVisible();
}

test('copy reports pending, success and failure at the clicked button without duplicate writes', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { copyCalls: number; finishCopy: () => void; rejectCopy: () => void };
    state.copyCalls = 0;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => {
      state.copyCalls++;
      return new Promise<void>((resolve, reject) => { state.finishCopy = resolve; state.rejectCopy = () => reject(new Error('Synthetic clipboard refusal')); });
    } } });
  });
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, [{ role: 'user', content: 'COPY_FEEDBACK_CONTENT' }]);
  const copy = page.getByRole('button', { name: 'Copy full message', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-state', 'pending');
  await expect(copy).toHaveAttribute('aria-busy', 'true');
  await expect(copy).toBeDisabled();
  await expect(copy).toContainText('Copying');
  await expect.poll(() => page.evaluate(() => (window as unknown as { copyCalls: number }).copyCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(copy).toHaveAttribute('data-state', 'success');
  await expect(copy).toContainText('Copied');
  await expect(copy).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copyCalls: number }).copyCalls)).toBe(2);
  await page.evaluate(() => (window as unknown as { rejectCopy: () => void }).rejectCopy());
  await expect(copy).toHaveAttribute('data-state', 'error');
  await expect(page.locator('.toast-error')).toContainText('Clipboard');
});

test('filtered export covers other pages and keeps original-mode matches cleaned', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private requests = new Map<number, string>();
      postMessage(message: { id: number; type: string }, ...rest: unknown[]) {
        this.requests.set(message.id, message.type);
        return super.postMessage(message, ...(rest as []));
      }
      set onmessage(handler: ((this: Worker, ev: MessageEvent) => unknown) | null) {
        super.onmessage = event => {
          if (this.requests.get(event.data.id) === 'export-excerpt') {
            (window as unknown as { finishExport: () => void }).finishExport = () => handler?.call(this, event);
          } else handler?.call(this, event);
        };
      }
    };
  });
  await page.goto('/');
  const privateValue = 'synthetic_filter_secret_943817';
  await upload(page, [
    ...Array.from({ length: 65 }, (_, index) => ({ role: 'user', content: `FILTERED_${index + 1} API_KEY=${privateValue}` })),
    { role: 'assistant', content: 'EXCLUDED_REPLY' },
  ]);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.getByRole('searchbox').fill(privateValue);
  await expect(page.locator('.preview-heading p')).toContainText('65');
  await page.getByRole('button', { name: /Export filtered results/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export filtered results', exact: true });
  const jsonl = dialog.getByRole('button', { name: /Normalized JSONL/ });
  await jsonl.click();
  await expect(jsonl).toHaveAttribute('aria-busy', 'true');
  await expect(jsonl).toBeDisabled();
  await expect(jsonl).toContainText('Exporting');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishExport?: () => void }).finishExport)).toBe('function');
  const downloading = page.waitForEvent('download');
  await page.evaluate(() => (window as unknown as { finishExport: () => void }).finishExport());
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('threadpack-excerpt.jsonl');
  const text = await readFile((await download.path())!, 'utf8');
  const messages = text.trim().split('\n').map(line => JSON.parse(line));
  expect(messages).toHaveLength(65);
  expect(text).toContain('FILTERED_65');
  expect(text).toContain('[SECRET_1]');
  expect(text).not.toContain(privateValue);
  expect(text).not.toContain('EXCLUDED_REPLY');
});

test('quick actions support keyboard search and execute with focus and scroll restored', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const menu = page.getByRole('dialog', { name: 'Quick actions', exact: true });
  const search = menu.getByRole('combobox', { name: 'Search actions…', exact: true });
  await expect(search).toBeFocused();
  await search.fill('demo');
  await page.keyboard.press('Enter');
  await expect(menu).not.toBeVisible();
  await expect(page.locator('.message-card')).toHaveCount(10);
  await page.keyboard.press('Control+k');
  await search.fill('Search conversation');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('no_matching_message_881');
  await expect(page.locator('.no-results')).toBeVisible();
  await page.locator('.no-results').getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.message-card')).toHaveCount(10);
  await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
  await search.fill('no_matching_action');
  await expect(menu).toContainText('No matching actions');
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('a replacement archive remains usable after an older export response arrives', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private requests = new Map<number, string>();
      postMessage(message: { id: number; type: string }, ...rest: unknown[]) {
        this.requests.set(message.id, message.type);
        return super.postMessage(message, ...(rest as []));
      }
      set onmessage(handler: ((this: Worker, ev: MessageEvent) => unknown) | null) {
        super.onmessage = event => {
          if (this.requests.get(event.data.id) === 'export-excerpt') {
            (window as unknown as { finishOldExport: () => void }).finishOldExport = () => handler?.call(this, event);
          } else handler?.call(this, event);
        };
      }
    };
  });
  await page.goto('/');
  await upload(page, [{ role: 'user', content: 'OLD_ARCHIVE_ONLY' }]);
  await page.getByRole('button', { name: /Export filtered results/ }).click();
  await page.getByRole('dialog', { name: 'Export filtered results', exact: true }).getByRole('button', { name: /Normalized JSONL/ }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishOldExport?: () => void }).finishOldExport)).toBe('function');
  await upload(page, [{ role: 'user', content: 'REPLACEMENT_ARCHIVE_ONLY' }]);
  await page.evaluate(() => (window as unknown as { finishOldExport: () => void }).finishOldExport());
  await expect(page.locator('.messages-list')).toContainText('REPLACEMENT_ARCHIVE_ONLY');
  const exportButton = page.getByRole('button', { name: 'Export transcript', exact: true });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export transcript', exact: true }).getByRole('button', { name: /Markdown transcript/ }).click();
  const text = await readFile((await (await downloading).path())!, 'utf8');
  expect(text).toContain('REPLACEMENT_ARCHIVE_ONLY');
  expect(text).not.toContain('OLD_ARCHIVE_ONLY');
});

test('a small mobile screen keeps a readable transcript and reachable export controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await upload(page, [{ role: 'user', content: 'SMALL_SCREEN_MESSAGE' }]);
  const list = page.locator('.messages-list');
  expect((await list.boundingBox())!.height).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const exportButton = page.getByRole('button', { name: 'Export transcript', exact: true });
  await exportButton.scrollIntoViewIfNeeded();
  await expect(exportButton).toBeInViewport();
  await exportButton.click();
  await expect(page.getByRole('dialog', { name: 'Export transcript', exact: true })).toBeVisible();
});

test('handoff copy feedback stays with the conversation that was copied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (text: string) => new Promise<void>(resolve => {
      const state = window as unknown as { finishHandoffCopy: () => void; copiedHandoff: string };
      state.copiedHandoff = text; state.finishHandoffCopy = resolve;
    }) } });
  });
  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'two-conversations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([
    { id: 'alpha', title: 'Alpha', messages: [{ role: 'user', content: 'ALPHA_HANDOFF' }] },
    { id: 'beta', title: 'Beta', messages: [{ role: 'user', content: 'BETA_HANDOFF' }] },
  ])) });
  await expect(page.getByRole('button', { name: 'Build a handoff', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(page.locator('.handoff-document')).toContainText('ALPHA_HANDOFF');
  const copy = page.getByRole('button', { name: 'Copy text', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('data-state', 'pending');
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption({ label: '2. Beta' });
  await expect(page.locator('.handoff-document')).toContainText('BETA_HANDOFF');
  await expect(copy).toHaveAttribute('data-state', 'idle');
  await expect(copy).toBeEnabled();
  await page.evaluate(() => (window as unknown as { finishHandoffCopy: () => void }).finishHandoffCopy());
  await expect(copy).toHaveAttribute('data-state', 'idle');
  await copy.click();
  await expect(copy).toHaveAttribute('data-state', 'pending');
  expect(await page.evaluate(() => (window as unknown as { copiedHandoff: string }).copiedHandoff)).toContain('BETA_HANDOFF');
  await page.evaluate(() => (window as unknown as { finishHandoffCopy: () => void }).finishHandoffCopy());
  await expect(copy).toHaveAttribute('data-state', 'success');
});
