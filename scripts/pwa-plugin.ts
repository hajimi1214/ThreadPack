import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

/** Build the worker after the single-file plugin has finalized index.html. */
export function createOfflinePlugin(): Plugin {
  return {
    name: 'threadpack-offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html'];
        if (!html || html.type !== 'asset') this.error('The offline worker requires a built index.html asset.');
        const digest = createHash('sha256').update(html.source).digest('hex').slice(0, 20);
        this.emitFile({
          type: 'asset', fileName: 'sw.js',
          source: buildOfflineWorker(`${version}-${digest}`),
        });
      },
    },
  };
}

export function buildOfflineWorker(buildId: string): string {
  return `/* ThreadPack application shell only. Conversation data is never cached. */
const BUILD_ID = ${JSON.stringify(buildId)};
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'threadpack-shell-' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './third-party-licenses.txt'].map(path => new URL(path, SCOPE).href);
const NAVIGATION_URLS = new Set(SHELL_URLS.slice(0, 2));
const STATIC_URLS = new Set(SHELL_URLS.slice(2));

function cacheable(response) {
  return response.ok && response.type !== 'opaque' && !response.redirected;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload', credentials: 'same-origin', redirect: 'error' })));
  })());
  // A waiting update is activated only by an explicit SKIP_WAITING message.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function navigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (cacheable(response) && (response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      await Promise.all(SHELL_URLS.slice(0, 2).map(url => cache.put(url, response.clone())));
    }
    return response;
  } catch {
    return await cache.match(request.url) || await cache.match(SHELL_URLS[1]) || Response.error();
  }
}

async function staticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request.url, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never handle blob URLs, user files, API routes, cross-origin data, or query strings.
  if (url.protocol !== SCOPE.protocol || url.origin !== SCOPE.origin || url.search) return;
  if (request.mode === 'navigate' && NAVIGATION_URLS.has(url.href)) {
    event.respondWith(navigation(request));
  } else if (STATIC_URLS.has(url.href)) {
    event.respondWith(staticAsset(request));
  }
});
`;
}
