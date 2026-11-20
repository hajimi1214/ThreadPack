import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const site = 'https://hajimi1214.github.io/ThreadPack/';
const root = new URL('../', import.meta.url);

function elements(html: string, tag: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map(match => Object.fromEntries(
    [...match[0].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(attribute => [attribute[1]!.toLowerCase(), attribute[2]!]),
  ));
}

test('link previews use one canonical project URL and an actual large preview image', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const links = elements(html, 'link');
  const metadata = elements(html, 'meta');
  const byName = (name: string) => metadata.find(meta => meta.name === name || meta.property === name)?.content;
  assert.equal(links.find(link => link.rel === 'canonical')?.href, site);
  assert.equal(byName('og:url'), site);
  assert.equal(byName('og:image'), byName('twitter:image'));
  assert.equal(byName('twitter:card'), 'summary_large_image');
  assert.ok(byName('description')?.includes('Codex'));
  assert.ok(byName('description')?.includes('ChatGPT'));
  assert.ok(byName('og:image:alt'));

  const image = new URL(byName('og:image')!);
  assert.equal(image.origin, new URL(site).origin);
  assert.ok(image.pathname.startsWith(new URL(site).pathname));
  const png = await readFile(new URL(`public/${image.pathname.slice(new URL(site).pathname.length)}`, root));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(Number(byName('og:image:width')), png.readUInt32BE(16));
  assert.equal(Number(byName('og:image:height')), png.readUInt32BE(20));
});

test('structured application data and the JavaScript-free fallback describe the real app', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const source = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  assert.ok(source);
  const schema = JSON.parse(source);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema['@type'], 'SoftwareApplication');
  assert.equal(schema.name, 'ThreadPack');
  assert.equal(schema.url, site);
  assert.equal(schema.isAccessibleForFree, true);
  assert.deepEqual(schema.inLanguage, ['en', 'zh-CN', 'ja', 'fr', 'es']);
  assert.equal(schema.aggregateRating, undefined);
  assert.equal(schema.review, undefined);
  assert.equal(schema.interactionStatistic, undefined);

  const fallback = /<noscript>([\s\S]*?)<\/noscript>/i.exec(html)?.[1] ?? '';
  assert.match(fallback, /requires JavaScript/i);
  assert.match(fallback, /processed locally/i);
  assert.match(fallback, /https:\/\/github\.com\/hajimi1214\/ThreadPack\/releases\/latest/);
  assert.ok(!elements(html, 'script').some(script => script.src?.startsWith('https:')));
  assert.ok(!elements(html, 'img').some(image => image.src?.startsWith('https:')));
});

test('crawler assets retain the GitHub Pages project prefix', async () => {
  const robots = await readFile(new URL('public/robots.txt', root), 'utf8');
  const sitemap = await readFile(new URL('public/sitemap.xml', root), 'utf8');
  assert.match(robots, /User-agent: \*/);
  assert.ok(robots.includes(`Sitemap: ${site}sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:\s*\/(?:\s|$)/);
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, [site, `${site}import-guide.html`]);
  const guide = await readFile(new URL('public/import-guide.html', root), 'utf8');
  assert.match(guide, /conversations\.json/);
  assert.match(guide, /chat_messages/);
  assert.match(guide, /lang="zh-CN"/);
  assert.ok(!elements(guide, 'script').length);
});
