import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Fault injection delays one local File read. Inputs and actions still use the real UI.
test('clearing during a file read cancels it, and the last selected file wins', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    const state = window as unknown as { threadpackReadCompleted: number };
    state.threadpackReadCompleted = 0;
    File.prototype.text = async function () {
      if (this.name.startsWith('slow-')) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const result = await read.call(this);
        state.threadpackReadCompleted++;
        return result;
      }
      return read.call(this);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  const input = page.getByLabel('Import file', { exact: true });
  await input.setInputFiles({ name: 'slow-private.txt', mimeType: 'text/plain', buffer: Buffer.from('PRIVATE_TEXT_MUST_STAY_CLEARED') });
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { threadpackReadCompleted: number }).threadpackReadCompleted === 1);
  await expect(page.locator('.metrics')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();

  await input.setInputFiles({ name: 'slow-first.txt', mimeType: 'text/plain', buffer: Buffer.from('FIRST_SLOW_CONVERSATION') });
  await input.setInputFiles({ name: 'last-selected.txt', mimeType: 'text/plain', buffer: Buffer.from('LAST_SELECTED_CONVERSATION') });
  await expect(page.locator('.messages-list')).toContainText('LAST_SELECTED_CONVERSATION');
  await page.waitForFunction(() => (window as unknown as { threadpackReadCompleted: number }).threadpackReadCompleted === 2);
  await expect(page.locator('.messages-list')).toContainText('LAST_SELECTED_CONVERSATION');
  await expect(page.locator('.messages-list')).not.toContainText('FIRST_SLOW_CONVERSATION');
});

test('a report cannot leak a secret from custom source metadata', async ({ page }) => {
  const synthetic = ['ghp', 'S'.repeat(36)].join('_');
  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      source: synthetic, title: 'Synthetic report', messages: [{ role: 'user', content: 'Report regression.' }],
    })),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Cleanup report/ }).click();
  const file = await (await downloading).path();
  const report = await readFile(file!, 'utf8');
  expect(report).not.toContain(synthetic);
  expect(JSON.parse(report).format).toBe('Messages JSON export');
});
