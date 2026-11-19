import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const acceptedText = 'ACCEPTED_ARCHIVE_A: keep this synthetic conversation.';
const candidateText = 'CANCELLED_ARCHIVE_B: this must never replace A.';

async function importSynthetic(page: Page, name: string, content: string) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content }] })),
  });
}

async function expectAcceptedArchive(page: Page) {
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.file-details > strong')).toHaveText('A.json');
  await expect(page.locator('.messages-list')).toContainText(acceptedText);
  await expect(page.locator('.messages-list')).not.toContainText(candidateText);
}

async function expectAcceptedExport(page: Page) {
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export transcript', exact: true });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Markdown transcript/ }).click();
  const location = await (await downloading).path();
  expect(location).toBeTruthy();
  const text = await readFile(location!, 'utf8');
  expect(text).toContain(acceptedText);
  expect(text).not.toContain(candidateText);
}

test('a cancelled parse cannot replace the accepted archive when the next import is rejected', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Delay only delivery of B's successful response. The real worker has
  // already parsed B, reproducing the cancellation window without large files.
  await page.addInitScript(`(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.requests = new Map();
      }
      postMessage(message, ...rest) {
        this.requests.set(message.id, message);
        return super.postMessage(message, ...rest);
      }
      set onmessage(handler) {
        super.onmessage = event => {
          const request = this.requests.get(event.data.id);
          if (request?.type === 'parse' && request.filename === 'B.json' && !event.data.error) {
            window.__threadpackReleaseCandidate = () => handler.call(this, event);
            window.__threadpackCandidateParsed = true;
          } else handler.call(this, event);
        };
      }
    };
  })();`);
  await page.goto('/');
  await importSynthetic(page, 'A.json', acceptedText);
  await expectAcceptedArchive(page);
  await importSynthetic(page, 'B.json', candidateText);
  await page.waitForFunction(() => (window as unknown as { __threadpackCandidateParsed?: boolean }).__threadpackCandidateParsed);

  // A real file-input change exercises the normal size-rejection path. An
  // overridden size avoids allocating an otherwise unnecessary 101 MiB buffer.
  await page.evaluate(() => {
    const file = new File(['synthetic oversized input'], 'C.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 101 * 1024 * 1024 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('alert')).toContainText('100 MiB');
  await page.evaluate(() => (window as unknown as { __threadpackReleaseCandidate: () => void }).__threadpackReleaseCandidate());

  // Reclean after the stale response, then read the actual downloaded output.
  await page.getByRole('switch', { name: 'Redact email addresses', exact: true }).click();
  await expectAcceptedArchive(page);
  await expectAcceptedExport(page);
  expect(errors).toEqual([]);
});

test('a failed replacement import leaves the accepted archive available for cleaning and export', async ({ page }) => {
  await page.goto('/');
  await importSynthetic(page, 'A.json', acceptedText);
  await expectAcceptedArchive(page);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"messages": [invalid}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid JSON');
  await page.getByRole('switch', { name: 'Redact email addresses', exact: true }).click();
  await expectAcceptedArchive(page);
  await expectAcceptedExport(page);
});
