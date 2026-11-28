import { test, expect } from '@playwright/test';
import { open, stat } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

async function readRendererHeap(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: {
      usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number;
    } }).memory;
    return memory ? {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    } : null;
  });
}

test('large saved snapshots above the external import limit survive reload and search', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const measurements: Record<string, unknown> = { browser: testInfo.project.name, sampleCount: 1 };
  const sourcePath = testInfo.outputPath('large-project-source.json');
  const sourceGenerationStarted = performance.now();
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
  measurements.sourceBytes = (await stat(sourcePath)).size;
  measurements.sourceGenerationMs = performance.now() - sourceGenerationStarted;

  const coldStartStarted = performance.now();
  await page.goto('/');
  measurements.coldStartMs = performance.now() - coldStartStarted;
  measurements.coldNavigationMs = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.duration ?? null);
  const importStarted = performance.now();
  await page.getByLabel('Import file', { exact: true }).setInputFiles(sourcePath);
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
  measurements.importAndParseMs = performance.now() - importStarted;
  measurements.heapAfterImport = await readRendererHeap(page);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Large durable project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  const persistStarted = performance.now();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Large durable session', { timeout: 120_000 });
  measurements.persistProjectMs = performance.now() - persistStarted;

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
  measurements.storedRevisionBytes = revisionBytes;

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const hotStartStarted = performance.now();
  await page.reload();
  measurements.hotStartMs = performance.now() - hotStartStarted;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const restoredDialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(restoredDialog.locator('.project-session-item')).toContainText('Large durable session', { timeout: 30_000 });
  await restoredDialog.locator('.project-session-item').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('threadpack-session.jsonl', { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Download original file', exact: true })).toBeDisabled();
  const searchStarted = performance.now();
  await page.getByLabel('Search messages…', { exact: true }).fill(marker);
  await expect(page.locator('.message-content')).toContainText(marker, { timeout: 120_000 });
  measurements.searchToVisibleResultMs = performance.now() - searchStarted;
  measurements.heapAfterSearch = await readRendererHeap(page);
  const report = JSON.stringify(measurements, null, 2);
  console.log(`THREADPACK_LARGE_PROJECT_METRICS ${JSON.stringify(measurements)}`);
  await testInfo.attach('large-project-performance.json', { body: report, contentType: 'application/json' });
});
