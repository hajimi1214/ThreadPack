import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownDocument from '../src/components/MarkdownDocument';

test('Markdown preview renders GFM tables, task lists, and fenced code', () => {
  const source = [
    '# Checkout review',
    '',
    '| Check | Result |',
    '| --- | --- |',
    '| Retry | **safe** |',
    '',
    '- [x] Keep the API stable',
    '- [ ] Verify the race case',
    '',
    '```typescript',
    'return createCharge(request);',
    '```',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(MarkdownDocument, { source, imageLabel: 'Image omitted' }));
  assert.match(html, /<h1>Checkout review<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /<strong>safe<\/strong>/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /class="snippet-code highlighted-code"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /<span class="hljs-keyword">return<\/span>/);
  assert.match(html, /<span class="hljs-title function_">createCharge<\/span>/);
});

test('Markdown preview skips raw HTML, replaces remote images, and rejects unsafe link schemes', () => {
  const source = [
    '<script>window.injected = true</script>',
    '<img src=x onerror="window.injected = true">',
    '',
    '![Issue screenshot](https://images.example.test/private.png)',
    '',
    '[unsafe](javascript:alert(1))',
    '[docs](https://docs.example.test/guide)',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(MarkdownDocument, { source, imageLabel: 'Embedded images are hidden' }));
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.match(html, /&lt;script&gt;window\.injected/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.doesNotMatch(html, /private\.png|href="javascript:/i);
  assert.match(html, /Issue screenshot/);
  assert.match(html, /href="https:\/\/docs\.example\.test\/guide"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
