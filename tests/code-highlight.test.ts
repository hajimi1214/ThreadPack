import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RootContent } from 'hast';
import { highlightCode, MAX_HIGHLIGHT_CHARACTERS } from '../src/code-highlight';
import HighlightedCode from '../src/components/HighlightedCode';

function textOf(nodes: readonly RootContent[]): string {
  return nodes.map(node => node.type === 'text' ? node.value : node.type === 'element' ? textOf(node.children) : '').join('');
}

test('selected grammars highlight tokens while preserving exact code and whitespace', () => {
  const examples = [
    ['typescript', 'export async function retry<T>(value: T): Promise<T> {\r\n\treturn value;\r\n}\r\n\r\n'],
    ['python', 'def greet(name):\n    # Unicode stays intact\n    return "你好, " + name\n'],
    ['sql', 'SELECT name FROM users WHERE active = true;\n'],
    ['html', '<section data-name="demo">Hello & goodbye</section>\n'],
    ['json', '{ "items": [1, true, "text"] }\n'],
  ];
  for (const [language, code] of examples) {
    const result = highlightCode(code!, language!);
    assert.equal(result.data.highlighted, true);
    assert.equal(textOf(result.children), code);
    assert.ok(result.children.some(node => node.type === 'element'));
    const inspect = (nodes: readonly RootContent[]) => {
      for (const node of nodes) {
        if (node.type !== 'element') { assert.equal(node.type, 'text'); continue; }
        assert.equal(node.tagName, 'span');
        assert.deepEqual(Object.keys(node.properties), ['className']);
        inspect(node.children);
      }
    };
    inspect(result.children);
  }
});

test('unsupported, inherited, and oversized language inputs stay complete plain text', () => {
  const source = '<script>not executed</script>\n\n  exact whitespace\t';
  for (const language of ['text', 'unknown-language', '__proto__', 'constructor']) {
    const result = highlightCode(source, language);
    assert.equal(result.data.highlighted, false);
    assert.deepEqual(result.children, [{ type: 'text', value: source }]);
  }
  const longCode = 'const unchanged = 1;\n'.repeat(MAX_HIGHLIGHT_CHARACTERS);
  const result = highlightCode(longCode, 'javascript');
  assert.equal(result.data.highlighted, false);
  assert.equal(textOf(result.children), longCode);
});

test('React renders malicious-looking code as escaped text rather than executable elements', () => {
  const source = '<img src=x onerror="window.injected=true"><script>alert(1)</script>\n';
  const html = renderToStaticMarkup(createElement(HighlightedCode, { code: source, language: 'html', wrap: false }));
  assert.doesNotMatch(html, /<(?:img|script)\b/);
  assert.match(html, /&lt;/);
  assert.equal(textOf(highlightCode(source, 'html').children), source);
  assert.match(html, /class="snippet-code highlighted-code"/);
});

test('wrap mode changes only presentation and preserves empty lines and trailing whitespace', () => {
  const code = 'const value = "long string";\n\n\t  ';
  const plain = renderToStaticMarkup(createElement(HighlightedCode, { code, language: 'javascript', wrap: false }));
  const wrapped = renderToStaticMarkup(createElement(HighlightedCode, { code, language: 'javascript', wrap: true }));
  assert.match(wrapped, /is-wrapped/);
  assert.equal(plain.replace('snippet-code highlighted-code', 'snippet-code highlighted-code is-wrapped'), wrapped);
  assert.equal(textOf(highlightCode(code, 'javascript').children), code);
});
