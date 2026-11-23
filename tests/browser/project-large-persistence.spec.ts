import { test, expect } from '@playwright/test';
import { open } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

test('large saved snapshots above the external import limit survive reload and search', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const sourcePath = testInfo.outputPath('large-project-source.json');
  const handle = await open(sourcePath, 'w');
  const body = 'L'.repeat(1_048_400);
  const marker = 'LARGE_PROJECT_RELOAD_MARKER';
  try {
    await handle.write('{"id":"large-project-session","title":"Large durable session","messages":[');
    for (let index = 0; index < 100; index++) {
      if (index) await handle.write(',');
      const content = index === 99 ? `${body}${marker}` : body;
      await handle.write(JSON.stringify({ id: `large-message-${index}`, role: 'user', content }));
    }
    await handle.write(']}');
  } finally { await handle.close(); }

  await page.goto('/');
  await page.getByLabel('Import file', { exact: true }).setInputFiles(sourcePath);
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Large durable project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Large durable session', { timeout: 120_000 });

  const revisionBytes = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('threadpack-project-library');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('revisions', 'readonly').objectStore('revisions').getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const record = (read.result as { content?: string }[])[0];
        resolve(record?.content ? new TextEncoder().encode(record.content).byteLength : 0);
        database.close();
      };
    };
  }));
  expect(revisionBytes).toBeGreaterThan(100 * 1024 * 1024);

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const restoredDialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(restoredDialog.locator('.project-session-item')).toContainText('Large durable session', { timeout: 30_000 });
  await restoredDialog.locator('.project-session-item').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('threadpack-session.jsonl', { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Download original file', exact: true })).toBeDisabled();
  await page.getByLabel('Search messages…', { exact: true }).fill(marker);
  await expect(page.locator('.message-content')).toContainText(marker, { timeout: 120_000 });
});
