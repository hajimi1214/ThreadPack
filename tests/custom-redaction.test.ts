import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanConversation, DEFAULT_OPTIONS, validateCustomSecrets } from '../src/core';
import type { CleanOptions, Conversation } from '../src/core';

const makeConversation = (content: string, overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conversation-1', title: 'Example', source: 'Test', messages: [{ id: 'message-1', role: 'user', content }], ...overrides,
});
const customOnly = (customSecrets: string[]): CleanOptions => ({
  ...DEFAULT_OPTIONS, redact: false, redactEmails: false, customSecrets,
});

test('custom values are literal and still redacted when both standard scanners are disabled', () => {
  const literal = 'literal.*(value)[x]';
  const input = makeConversation(`${literal} remains protected; literalZZvaluex stays unchanged.`);
  const result = cleanConversation(input, customOnly([literal]));
  assert.equal(result.conversation.messages[0]!.content, '[CUSTOM_1] remains protected; literalZZvaluex stays unchanged.');
  assert.equal(result.stats.customRedacted, 1);
  assert.equal(result.stats.secretsRedacted, 0);
  assert.equal(result.stats.emailsRedacted, 0);
  assert.equal(result.changes[0]!.kind, 'custom');
});

test('repeated custom values use stable aliases across messages, title and source without mutation', () => {
  const first = 'internal-project';
  const second = '__proto__';
  const input = makeConversation(`Start ${first} and ${second}`, {
    title: `Title ${first}`,
    source: `Source ${second}`,
    messages: [
      { id: 'message-1', role: 'user', content: `Start ${first} and ${second}` },
      { id: 'message-2', role: 'assistant', content: `Again ${first}; again ${second}.` },
    ],
  });
  const options = customOnly([first, second, first]);
  const originalInput = JSON.stringify(input);
  const originalOptions = JSON.stringify(options);
  const result = cleanConversation(input, options);
  assert.equal(result.conversation.messages[0]!.content, 'Start [CUSTOM_1] and [CUSTOM_2]');
  assert.equal(result.conversation.messages[1]!.content, 'Again [CUSTOM_1]; again [CUSTOM_2].');
  assert.equal(result.conversation.title, 'Title [CUSTOM_1]');
  assert.equal(result.conversation.source, 'Source [CUSTOM_2]');
  assert.equal(result.stats.customRedacted, 6);
  assert.equal(JSON.stringify(input), originalInput);
  assert.equal(JSON.stringify(options), originalOptions);
  assert.deepEqual(cleanConversation(input, options), result);
});

test('Unicode, multiline text and meaningful leading or trailing spaces match exactly', () => {
  const literal = '  私有\n项目🔒  ';
  const input = makeConversation(`A${literal}B | 私有\n项目🔒 | ${literal}C`);
  const result = cleanConversation(input, customOnly([literal]));
  assert.equal(result.conversation.messages[0]!.content, 'A[CUSTOM_1]B | 私有\n项目🔒 | [CUSTOM_1]C');
  assert.equal(result.stats.customRedacted, 2);
});

test('overlapping standard and custom matches choose the longest interval and custom wins exact ties', () => {
  const email = ['person', 'example.test'].join('@');
  const fakeToken = ['ghp', 'U'.repeat(36)].join('_');
  const exact = cleanConversation(makeConversation(`${email} ${fakeToken}`), { ...DEFAULT_OPTIONS, redactEmails: true, customSecrets: [email, fakeToken] });
  assert.equal(exact.conversation.messages[0]!.content, '[CUSTOM_1] [CUSTOM_2]');
  assert.equal(exact.stats.customRedacted, 2);
  assert.equal(exact.stats.secretsRedacted, 0);
  assert.equal(exact.stats.emailsRedacted, 0);

  const containing = cleanConversation(makeConversation(`contact: ${email}`), { ...DEFAULT_OPTIONS, redactEmails: true, customSecrets: [`contact: ${email}`] });
  assert.equal(containing.conversation.messages[0]!.content, '[CUSTOM_1]');
  assert.equal(containing.stats.customRedacted, 1);

  const shorter = cleanConversation(makeConversation(email), { ...DEFAULT_OPTIONS, redactEmails: true, customSecrets: ['person'] });
  assert.equal(shorter.conversation.messages[0]!.content, '[EMAIL_1]');
  assert.equal(shorter.stats.emailsRedacted, 1);
  assert.equal(shorter.stats.customRedacted, 0);
});

test('crossing custom intervals remove their full union rather than leaving a sensitive suffix', () => {
  const input = makeConversation('prefixABCDsuffix adjacentABCABC');
  const result = cleanConversation(input, customOnly(['prefixABCD', 'CDsuffix', 'ABC']));
  assert.equal(result.conversation.messages[0]!.content, '[CUSTOM_1] adjacent[CUSTOM_2][CUSTOM_2]');
  assert.equal(result.stats.customRedacted, 3);
});

test('crossing standard and custom intervals cover both boundaries and prefer the longer owner', () => {
  const fakeToken = ['sk', 'proj', 'L'.repeat(30)].join('-');
  const prefix = 'prefix'.repeat(10) + ' ';
  const custom = prefix + fakeToken.slice(0, 10);
  const result = cleanConversation(makeConversation(`${prefix}${fakeToken}`), { ...DEFAULT_OPTIONS, customSecrets: [custom] });
  assert.equal(result.conversation.messages[0]!.content, '[CUSTOM_1]');
  assert.equal(result.stats.customRedacted, 1);
  assert.equal(result.stats.secretsRedacted, 0);
});

test('custom values are scanned before tool clipping can expose an unrecognizable tail', () => {
  const literal = 'PRIVATE-LITERAL-' + 'SYNTHETIC'.repeat(70);
  const input = makeConversation('', { messages: [{ id: 'message-1', role: 'tool', content: 'padding '.repeat(700) + literal + '\nfinal output' }] });
  const result = cleanConversation(input, { ...customOnly([literal]), toolLimit: 500 });
  assert.equal(result.stats.customRedacted, 1);
  assert.equal(result.stats.outputsTrimmed, 1);
  assert.match(result.conversation.messages[0]!.content, /\[CUSTOM_1\]/);
  assert.doesNotMatch(result.conversation.messages[0]!.content, /SYNTHETIC|PRIVATE-LITERAL/);
  assert.ok(result.conversation.messages[0]!.content.endsWith('\nfinal output'));
  assert.ok(result.conversation.messages[0]!.content.length <= 500);
});

test('deduplication compares raw outputs while custom scanning counts both repeated originals', () => {
  const input = makeConversation('', { messages: [
    { id: 'message-1', role: 'tool', content: 'internal-tenant output' },
    { id: 'message-2', role: 'tool', content: 'internal-tenant output' },
    { id: 'message-3', role: 'tool', content: 'another-tenant output' },
  ] });
  const result = cleanConversation(input, customOnly(['internal-tenant', 'another-tenant']));
  assert.equal(result.stats.customRedacted, 3);
  assert.equal(result.stats.duplicatesRemoved, 1);
  assert.equal(result.conversation.messages[0]!.content, '[CUSTOM_1] output');
  assert.match(result.conversation.messages[1]!.content, /identical to message message-1/);
  assert.equal(result.conversation.messages[2]!.content, '[CUSTOM_2] output');
});

test('custom raw values never appear in changes, warnings or stats', () => {
  const literal = 'private-customer-reference';
  const input = makeConversation(literal, { title: literal, source: literal });
  const result = cleanConversation(input, customOnly([literal]));
  const diagnostics = JSON.stringify({ changes: result.changes, stats: result.stats, warnings: result.warnings });
  assert.ok(!diagnostics.includes(literal));
  assert.equal(result.stats.customRedacted, 3);
});

test('custom validation enforces fixed limits without reflecting submitted input', () => {
  const literal = 'private-reference';
  for (const invalid of [null, literal, [literal, ''], [literal, '  \n'], ['ab'], [1], Array.from({ length: 51 }, () => literal), ['x'.repeat(1001)]]) {
    assert.throws(() => validateCustomSecrets(invalid), (error: unknown) => error instanceof Error && !error.message.includes(literal));
  }
  assert.throws(() => cleanConversation(makeConversation('text'), { ...DEFAULT_OPTIONS, customSecrets: ['ab'] }), /3 to 1,000/);
  assert.deepEqual(validateCustomSecrets(undefined), []);
  assert.deepEqual(validateCustomSecrets([]), []);
  assert.deepEqual(validateCustomSecrets(['  significant  ', '__proto__', '__proto__']), ['  significant  ', '__proto__']);
  assert.deepEqual(validateCustomSecrets(['x'.repeat(1000)]), ['x'.repeat(1000)]);
  assert.equal(validateCustomSecrets(Array.from({ length: 50 }, (_, index) => `rule-${index}`)).length, 50);
});

test('validation counts Unicode characters without trimming literal values', () => {
  assert.throws(() => validateCustomSecrets(['🔒🔑']), /3 to 1,000/);
  assert.deepEqual(validateCustomSecrets(['🔒🔑📦']), ['🔒🔑📦']);
  assert.deepEqual(validateCustomSecrets(['🔒'.repeat(1000)]), ['🔒'.repeat(1000)]);
  assert.throws(() => validateCustomSecrets(['🔒'.repeat(1001)]), /3 to 1,000/);
});

test('no custom rules preserves the existing return shape with explicit zero count', () => {
  const input = makeConversation('Nothing sensitive here.');
  const result = cleanConversation(input, DEFAULT_OPTIONS);
  assert.equal(result.stats.customRedacted, 0);
  assert.equal(result.conversation.messages[0]!.content, input.messages[0]!.content);
});

test('dense overlapping literal matches are merged while adjacent occurrences remain separate', () => {
  const result = cleanConversation(makeConversation('a'.repeat(20000) + ' ' + 'abc'.repeat(100)), customOnly(['aaa', 'abc']));
  assert.equal(result.conversation.messages[0]!.content, '[CUSTOM_1] ' + '[CUSTOM_2]'.repeat(100));
  assert.equal(result.stats.customRedacted, 101);
});
