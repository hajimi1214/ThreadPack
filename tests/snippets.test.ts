import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCodeSnippets, snippetExtension } from '../src/core';
import type { Conversation } from '../src/core';

function conversation(...content: string[]): Conversation {
  return { id: 'test', title: '', source: '', messages: content.map((text, index) => ({ id: `message-${index + 1}`, role: 'assistant', content: text })) };
}

test('closed fenced snippets preserve code, line endings, empty lines, and message references', () => {
  const input = conversation('Intro\r\n   ```TS\r\nconst value = 1;\r\n\r\nconsole.log(value);\r\n   ```\r\n', '~~~python\nprint("done")\n~~~');
  const snippets = extractCodeSnippets(input);
  assert.equal(snippets.length, 2);
  assert.deepEqual(snippets.map(({ id, language, messageIndex, fenceIndex, lines }) => ({ id, language, messageIndex, fenceIndex, lines })), [
    { id: 'message-1-code-1', language: 'typescript', messageIndex: 0, fenceIndex: 0, lines: 3 },
    { id: 'message-2-code-1', language: 'python', messageIndex: 1, fenceIndex: 0, lines: 1 },
  ]);
  assert.equal(input.messages[0]!.content.slice(snippets[0]!.start, snippets[0]!.end), 'const value = 1;\r\n\r\nconsole.log(value);\r\n');
  assert.equal(snippets[0]!.characters, 'const value = 1;\r\n\r\nconsole.log(value);\r\n'.length);
});

test('longer outer fences retain nested shorter or different fences as code', () => {
  const body = '````markdown\n```js\nconst n = 2;\n```\n~~~\n`````\n~~~sql\nselect 1;\n```\n~~~~';
  const input = conversation(body);
  const snippets = extractCodeSnippets(input);
  assert.equal(snippets.length, 2);
  assert.equal(body.slice(snippets[0]!.start, snippets[0]!.end), '```js\nconst n = 2;\n```\n~~~\n');
  assert.equal(body.slice(snippets[1]!.start, snippets[1]!.end), 'select 1;\n```\n');
  assert.equal(snippets[1]!.fenceIndex, 1);
});

test('inline, over-indented, invalid, and unclosed fences do not become snippets', () => {
  assert.equal(extractCodeSnippets(conversation('Inline ```js const x = 1; ``` prose.')).length, 0);
  assert.equal(extractCodeSnippets(conversation('    ```js\nconst x = 1;\n    ```')).length, 0);
  assert.equal(extractCodeSnippets(conversation('```js`invalid\nconst x = 1;\n```')).length, 0);
  assert.equal(extractCodeSnippets(conversation('```js\nconst x = 1;')).length, 0);
  assert.equal(extractCodeSnippets(conversation('~~~js\nconst x = 1;\n```')).length, 0);
});

test('only up to three spaces can close a fence and empty closed blocks are retained', () => {
  const content = '```\n    ```\nbody\n```\n~~~\n~~~';
  const snippets = extractCodeSnippets(conversation(content));
  assert.equal(snippets.length, 2);
  assert.equal(content.slice(snippets[0]!.start, snippets[0]!.end), '    ```\nbody\n');
  assert.equal(snippets[1]!.characters, 0);
  assert.equal(snippets[1]!.lines, 0);
});

test('language metadata and extensions use a fixed allowlist instead of arbitrary info strings', () => {
  const snippets = extractCodeSnippets(conversation('```../../private/path.exe\npayload\n```\n```constructor\nvalue\n```\n```js filename=../../private.sh\nconst n = 1;\n```'));
  assert.deepEqual(snippets.map(snippet => snippet.language), ['text', 'text', 'javascript']);
  assert.equal(snippetExtension('../../private/path.exe'), 'txt');
  assert.equal(snippetExtension('__proto__'), 'txt');
  assert.equal(snippetExtension('constructor'), 'txt');
  assert.equal(snippetExtension('typescript'), 'ts');
  assert.equal(snippetExtension('python'), 'py');
});
