import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface WorkerEvidence {
  querySizes: number[];
  cleanContainedMessages: boolean[];
  fileImports: number;
  textImports: number;
  progress: number;
  mainFileTextCalls: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(`(() => {
    const NativeWorker = window.Worker;
    const evidence = window.__threadpackWorkerEvidence = {
      querySizes: [], cleanContainedMessages: [], fileImports: 0,
      textImports: 0, progress: 0, mainFileTextCalls: 0
    };
    File.prototype.text = function() {
      evidence.mainFileTextCalls++;
      throw new Error('Main-thread File.text is forbidden by this streaming regression test.');
    };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.requests = new Map(); this.stopped = false; }
      postMessage(message, ...rest) {
        this.requests.set(message.id, message);
        if (message.type === 'parse') {
          if (message.file instanceof File) evidence.fileImports++;
          if (typeof message.text === 'string') evidence.textImports++;
        }
        return super.postMessage(message, ...rest);
      }
      set onmessage(handler) {
        super.onmessage = event => {
          const request = this.requests.get(event.data.id);
          const data = event.data.data;
          if (request?.type === 'query' && data?.items) evidence.querySizes.push(data.items.length);
          if (request?.type === 'clean' && data) {
            evidence.cleanContainedMessages.push(!!(data.conversation?.messages || data.original?.messages || data.result?.conversation?.messages));
          }
          if (request?.type === 'handoff' && window.__threadpackFailHandoff === true) {
            handler.call(this, new MessageEvent('message', { data: { id: event.data.id, error: 'Synthetic handoff failure.' } }));
            return;
          }
          if (event.data.progress) evidence.progress++;
          if (request?.type === 'parse' && request.file?.name.startsWith('cancel-')) {
            const delay = event.data.progress ? 100 : 900;
            setTimeout(() => { if (!this.stopped) handler.call(this, event); }, delay);
          } else handler.call(this, event);
        };
      }
      terminate() { this.stopped = true; super.terminate(); }
    };
  })();`);
  await page.goto('/');
});

async function evidence(page: Page) {
  return page.evaluate(() => (window as unknown as { __threadpackWorkerEvidence: WorkerEvidence }).__threadpackWorkerEvidence);
}

async function ready(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.message-card').first()).toBeVisible();
}

async function upload(page: Page, messages: { role: string; content: string }[], name = 'modern.json') {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ messages })),
  });
  await expect(page.locator('.file-details > strong')).toHaveText(name);
  await ready(page);
}

test('desktop opens directly onto useful message content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  const first = await page.locator('.message-card').first().boundingBox();
  expect(first).toBeTruthy();
  expect(first!.y).toBeLessThan(700);
  await expect(page.getByRole('switch', { name: 'Remove embedded images', exact: true })).toBeVisible();
});

test('mobile keeps settings collapsed until requested and shows the first message promptly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  const settings = page.locator('.settings-toggle');
  await expect(settings).toHaveAttribute('aria-label', 'Cleanup recipe');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  const imageSwitch = page.getByRole('switch', { name: 'Remove embedded images', exact: true });
  await expect(imageSwitch).not.toBeVisible();
  const first = await page.locator('.message-card').first().boundingBox();
  expect(first).toBeTruthy();
  expect(first!.y).toBeLessThan(780);
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(imageSwitch).toBeVisible();
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(imageSwitch).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pagination resets the transcript scroll and sends at most thirty preview items', async ({ page }) => {
  await upload(page, Array.from({ length: 61 }, (_, index) => ({ role: 'user', content: `PAGE_MESSAGE_${index + 1}: synthetic requirements.\nKeep this message separate.` })));
  await expect(page.locator('.message-card')).toHaveCount(30);
  const list = page.locator('.messages-list');
  await list.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await ready(page);
  await expect(page.locator('.message-index').first()).toHaveText('31');
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(2);
  await expect(page.locator('.message-card')).toHaveCount(30);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await ready(page);
  await expect(page.locator('.message-index').first()).toHaveText('61');
  await expect(page.locator('.message-card')).toHaveCount(1);
  const captured = await evidence(page);
  expect(captured.querySizes.length).toBeGreaterThanOrEqual(3);
  expect(captured.querySizes.every(size => size <= 30)).toBe(true);
  expect(captured.cleanContainedMessages.length).toBeGreaterThan(0);
  expect(captured.cleanContainedMessages.every(value => !value)).toBe(true);
});

test('original-mode search finds text forty thousand characters into worker-owned content', async ({ page }) => {
  const needle = 'ORIGINAL_FULLTEXT_NEEDLE_47';
  await upload(page, [{ role: 'tool', content: `HEAD\n${'x'.repeat(40000)}\n${needle}\n${'z'.repeat(12000)}\nTAIL` }]);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await ready(page);
  await expect(page.locator('.message-content')).not.toContainText(needle);
  await page.getByRole('searchbox', { name: 'Search messages…', exact: true }).fill(needle.toLowerCase());
  await expect(page.locator('.message-card')).toHaveCount(1);
  await expect(page.locator('.message-content')).toContainText(needle);
  await expect(page.getByText('Search match', { exact: true })).toBeVisible();
  expect((await evidence(page)).querySizes.every(size => size <= 30)).toBe(true);
});

test('exports include all one hundred and one messages rather than the thirty-message preview', async ({ page }) => {
  await upload(page, Array.from({ length: 101 }, (_, index) => ({ role: 'user', content: `FULL_EXPORT_MESSAGE_${index + 1}` })));
  await expect(page.locator('.message-card')).toHaveCount(30);
  await expect(page.locator('.messages-list')).not.toContainText('FULL_EXPORT_MESSAGE_101');
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export transcript', exact: true }).getByRole('button', { name: /Normalized JSONL/ }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  const messages = text.trim().split('\n').map(line => JSON.parse(line));
  expect(messages).toHaveLength(101);
  expect(messages[100].content).toBe('FULL_EXPORT_MESSAGE_101');
  const captured = await evidence(page);
  expect(captured.fileImports).toBe(1);
  expect(captured.mainFileTextCalls).toBe(0);
  expect(captured.querySizes.every(size => size <= 30)).toBe(true);
  expect(captured.cleanContainedMessages.every(value => !value)).toBe(true);
});

test('large File streaming reports progress and can be cancelled without retaining the archive', async ({ page }) => {
  const content = JSON.stringify({ messages: [{ role: 'user', content: `CANCELLED_PRIVATE_TEXT_${'Synthetic stream line. '.repeat(110000)}` }] });
  expect(Buffer.byteLength(content)).toBeGreaterThan(2 * 1024 * 1024);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'cancel-stream.json', mimeType: 'application/json', buffer: Buffer.from(content),
  });
  await expect(page.locator('progress')).toBeVisible();
  await expect.poll(async () => (await evidence(page)).progress).toBeGreaterThan(0);
  const cancel = page.getByRole('button', { name: 'Cancel and clear', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  await expect(page.locator('.metrics')).not.toBeVisible();
  await expect(page.locator('.messages-list')).not.toBeVisible();
  await expect(page.locator('progress')).not.toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
  const captured = await evidence(page);
  expect(captured.fileImports).toBe(1);
  expect(captured.textImports).toBe(0);
  expect(captured.mainFileTextCalls).toBe(0);
  expect(captured.progress).toBeGreaterThan(0);
  await upload(page, [{ role: 'user', content: 'AFTER_CANCEL: new conversation is usable.' }], 'after-cancel.json');
  await expect(page.locator('.messages-list')).toContainText('AFTER_CANCEL');
  await expect(page.locator('.messages-list')).not.toContainText('CANCELLED_PRIVATE_TEXT');
});

test('failed handoff regeneration disables stale output and recovers after a successful edit', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  const goal = page.getByRole('textbox', { name: 'Goal', exact: true });
  const document = page.locator('.handoff-document');
  const downloadButton = page.getByRole('button', { name: 'Download handoff', exact: true });
  const copyButton = page.getByRole('button', { name: 'Copy text', exact: true });
  await goal.fill('OLD_HANDOFF_GOAL: review the synthetic checkout change.');
  await expect(document).toContainText('OLD_HANDOFF_GOAL');
  await expect(downloadButton).toBeEnabled();

  // Inject a worker RPC rejection while retaining normal textarea and download actions.
  await page.evaluate(() => { (window as unknown as { __threadpackFailHandoff: boolean }).__threadpackFailHandoff = true; });
  await goal.fill('NEW_HANDOFF_GOAL: run the synthetic concurrency test.');
  await expect(page.getByRole('alert')).toContainText('Synthetic handoff failure.');
  await expect(document).not.toContainText('OLD_HANDOFF_GOAL');
  await expect(document).not.toContainText('NEW_HANDOFF_GOAL');
  await expect(document).toHaveText('');
  await expect(downloadButton).toBeDisabled();
  await expect(copyButton).toBeDisabled();

  await page.evaluate(() => { (window as unknown as { __threadpackFailHandoff: boolean }).__threadpackFailHandoff = false; });
  await goal.fill('NEW_HANDOFF_GOAL: run the synthetic concurrency test and verify retries.');
  await expect(document).toContainText('NEW_HANDOFF_GOAL');
  await expect(document).not.toContainText('OLD_HANDOFF_GOAL');
  await expect(downloadButton).toBeEnabled();
  await expect(copyButton).toBeEnabled();
  const download = page.waitForEvent('download');
  await downloadButton.click();
  const content = await readFile((await (await download).path())!, 'utf8');
  expect(content).toContain('NEW_HANDOFF_GOAL');
  expect(content).not.toContain('OLD_HANDOFF_GOAL');
});
