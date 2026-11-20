import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('HTTP app installs only its shell cache and reloads offline without storing an imported conversation', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', './manifest.webmanifest');
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe('ThreadPack');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512']);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const origin = new URL(page.url()).origin;

  const privateMarker = 'SYNTHETIC_PWA_SESSION_MUST_NOT_BE_CACHED_812';
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'private-conversation.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: privateMarker }] })),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.messages-list')).toContainText(privateMarker);
  await page.getByRole('button', { name: 'Export transcript', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export transcript', exact: true }).getByRole('button', { name: /Markdown transcript/ }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toContain(privateMarker);

  const cached = await page.evaluate(async () => {
    const result: { name: string; urls: string[]; containsPrivate: boolean }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      let containsPrivate = false;
      for (const request of requests) {
        const response = await cache.match(request);
        if (response && (await response.text()).includes('SYNTHETIC_PWA_SESSION_MUST_NOT_BE_CACHED_812')) containsPrivate = true;
      }
      result.push({ name, urls: requests.map(request => request.url), containsPrivate });
    }
    return result;
  });
  expect(cached.length).toBeGreaterThan(0);
  const expectedPaths = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/third-party-licenses.txt'];
  for (const cache of cached) {
    expect(cache.name).toMatch(/^threadpack-shell-/);
    expect(cache.containsPrivate).toBe(false);
    expect(cache.urls.map(url => new URL(url).pathname).sort()).toEqual([...expectedPaths].sort());
    expect(cache.urls.every(url => new URL(url).origin === origin)).toBe(true);
    expect(cache.urls.every(url => !new URL(url).search)).toBe(true);
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Try the demo', exact: true })).toBeVisible();
  await expect(page.locator('.message-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.message-card')).toHaveCount(10);
  await expect(page.locator('.messages-list')).toContainText('[SECRET_1]');
  await expect(page.locator('.messages-list')).not.toContainText(privateMarker);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['threadpack-language']);
  expect(errors).toEqual([]);
});
