import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { createOfflinePlugin, buildOfflineWorker } from '../scripts/pwa-plugin';

const origin = 'https://example.test/ThreadPack/';
const shell = ['', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'third-party-licenses.txt'].map(path => origin + path);

function workerHarness() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const writes: string[] = [];
  const network: string[] = [];
  let offline = false;
  let responseBody = 'original application shell';
  let skipped = 0;
  let claimed = 0;
  const keyOf = (request: string | { url: string }) => typeof request === 'string' ? request : request.url;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        addAll: async (requests: Request[]) => {
          for (const request of requests) {
            writes.push(request.url);
            store.set(request.url, new Response('pre-cached shell', { headers: { 'content-type': 'text/html' } }));
          }
        },
        put: async (request: string | Request, response: Response) => {
          writes.push(keyOf(request)); store.set(keyOf(request), response);
        },
        match: async (request: string | Request) => store.get(keyOf(request))?.clone(),
      };
    },
  };
  const self = {
    registration: { scope: origin },
    clients: { claim: async () => { claimed++; } },
    skipWaiting: async () => { skipped++; },
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
  };
  const fetch = async (request: string | Request) => {
    network.push(keyOf(request));
    if (offline) throw new Error('Synthetic network unavailable');
    return new Response(responseBody, { headers: { 'content-type': 'text/html' } });
  };
  runInNewContext(buildOfflineWorker('test-build'), { self, caches, fetch, URL, Request, Response, Set, Promise, encodeURIComponent });
  return {
    stores, writes, network,
    counts: () => ({ skipped, claimed }),
    setOffline(value: boolean) { offline = value; },
    setBody(value: string) { responseBody = value; },
    async lifecycle(name: string, extra: Record<string, unknown> = {}) {
      const promises: Promise<unknown>[] = [];
      handlers.get(name)!({ ...extra, waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
      await Promise.all(promises);
    },
    async request(url: string, mode = 'navigate', method = 'GET'): Promise<Response | undefined> {
      let response: Promise<Response> | undefined;
      handlers.get('fetch')!({ request: { url, method, mode }, respondWith: (value: Promise<Response>) => { response = value; } });
      return response;
    },
  };
}

test('offline worker precaches only the scoped shell and waits for an explicit update request', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  assert.deepEqual(worker.writes, shell);
  assert.equal(worker.counts().skipped, 0);
  await worker.lifecycle('message', { data: { type: 'UNRELATED' } });
  assert.equal(worker.counts().skipped, 0);
  await worker.lifecycle('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.counts().skipped, 1);
});

test('worker bypasses user files, API routes, query values, blob URLs, foreign origins and non-GET requests', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  const writesBefore = [...worker.writes];
  for (const url of [
    `${origin}session.jsonl`, `${origin}api/conversations`, `${origin}?private=synthetic`,
    `${origin}index.html?private=synthetic`, `${origin}icons/icon-192.png?private=synthetic`,
    'https://foreign.test/ThreadPack/', 'blob:https://example.test/synthetic-file',
    'https://example.test/other-application/',
  ]) assert.equal(await worker.request(url), undefined);
  assert.equal(await worker.request(origin, 'navigate', 'POST'), undefined);
  assert.equal(await worker.request(`${origin}index.html`, 'cors'), undefined);
  assert.deepEqual(worker.network, []);
  assert.deepEqual(worker.writes, writesBefore);
});

test('shell navigation tries network first, then serves its cached copy when offline', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  worker.setBody('updated application shell');
  assert.equal(await (await worker.request(origin))!.text(), 'updated application shell');
  assert.equal(worker.network.length, 1);
  worker.setOffline(true);
  assert.equal(await (await worker.request(`${origin}index.html`))!.text(), 'updated application shell');
  const calls = worker.network.length;
  assert.equal(await (await worker.request(`${origin}icons/icon-192.png`, 'cors'))!.text(), 'pre-cached shell');
  assert.equal(worker.network.length, calls);
  assert.ok(worker.writes.every(path => shell.includes(path)));
});

test('activation deletes stale caches only for this application scope', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  const prefix = `threadpack-shell-${encodeURIComponent(origin)}:`;
  worker.stores.set(prefix + 'older-build', new Map());
  worker.stores.set('unrelated-cache', new Map());
  worker.stores.set(`threadpack-shell-${encodeURIComponent('https://example.test/Other/')}old-build`, new Map());
  await worker.lifecycle('activate');
  assert.equal(worker.stores.has(prefix + 'older-build'), false);
  assert.equal(worker.stores.has(prefix + 'test-build'), true);
  assert.equal(worker.stores.has('unrelated-cache'), true);
  assert.equal(worker.stores.size, 3);
  assert.equal(worker.counts().claimed, 1);
});

test('Vite plugin uses the final HTML hash and package version, with deployable manifest and PNG icons', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'threadpack-pwa-'));
  try {
    const out = join(fixture, 'out');
    const metadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    const build = async (body: string) => {
      await writeFile(join(fixture, 'index.html'), `<!doctype html><title>PWA fixture</title><p>${body}</p>`);
      await viteBuild({
        configFile: false, root: fixture, publicDir: resolve('public'),
        logLevel: 'silent', build: { outDir: out, emptyOutDir: true }, plugins: [createOfflinePlugin()],
      });
      const html = await readFile(join(out, 'index.html'));
      const sw = await readFile(join(out, 'sw.js'), 'utf8');
      assert.ok(sw.includes(`${metadata.version}-${createHash('sha256').update(html).digest('hex').slice(0, 20)}`));
      return sw;
    };
    const first = await build('first shell');
    const second = await build('changed shell');
    assert.notEqual(first, second);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, 'ThreadPack');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.deepEqual(manifest.display_override, ['window-controls-overlay', 'standalone', 'browser']);
    assert.deepEqual(manifest.categories, ['developer', 'productivity', 'utilities']);
    assert.deepEqual(manifest.shortcuts.map((shortcut: { short_name: string }) => shortcut.short_name), ['Demo', 'Guide']);
    assert.equal(manifest.theme_color, '#2563eb');
    for (const size of [192, 512]) {
      const png = await readFile(join(out, 'icons', `icon-${size}.png`));
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      assert.ok(manifest.icons.some((icon: { sizes: string; purpose: string }) => icon.sizes === `${size}x${size}` && icon.purpose.includes('maskable')));
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('PWA helper skips file URLs and development, and only explicit acceptance reloads its requesting tab', async () => {
  const compiled = async (prod: boolean) => (await esbuild({
    entryPoints: ['src/pwa.ts'], bundle: true, write: false, format: 'iife', globalName: 'pwa',
    define: { 'import.meta.env.PROD': String(prod) },
  })).outputFiles[0].text;
  let calls = 0;
  let updates = 0;
  let reloads = 0;
  const messages: unknown[] = [];
  const handlers = new Map<string, () => void>();
  const workerRegistration = {
    waiting: { postMessage: (message: unknown) => messages.push(message) }, installing: null,
    addEventListener() {}, removeEventListener() {},
  };
  const context: Record<string, unknown> = {
    window: { location: { protocol: 'https:', href: origin, reload: () => { reloads++; } }, isSecureContext: true },
    navigator: { serviceWorker: {
      controller: {},
      register: async () => { calls++; return workerRegistration; },
      addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
      removeEventListener: (name: string) => handlers.delete(name),
    } }, URL,
  };
  const start = (code: string) => {
    runInNewContext(code, context);
    return context.pwa as { startPwa: (callback: () => void) => () => void; applyUpdate: () => void };
  };
  start(await compiled(false)).startPwa(() => { updates++; });
  assert.equal(calls, 0);
  (context.window as { location: { protocol: string } }).location.protocol = 'file:';
  start(await compiled(true)).startPwa(() => { updates++; });
  assert.equal(calls, 0);
  (context.window as { location: { protocol: string } }).location.protocol = 'https:';
  const api = start(await compiled(true));
  const dispose = api.startPwa(() => { updates++; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(updates, 1);
  handlers.get('controllerchange')!();
  assert.equal(reloads, 0);
  api.applyUpdate();
  assert.equal((messages[0] as { type: string }).type, 'SKIP_WAITING');
  handlers.get('controllerchange')!();
  assert.equal(reloads, 1);
  dispose();
  assert.equal(handlers.has('controllerchange'), false);
});
