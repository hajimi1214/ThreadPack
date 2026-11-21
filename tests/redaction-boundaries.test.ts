import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanConversation, DEFAULT_OPTIONS, buildTranscript, buildJsonl, buildHandoff } from '../src/core';
import type { Conversation } from '../src/core';

const conversation = (content: string): Conversation => ({
  id: 'conversation-1', title: 'Synthetic fixture', source: 'Test',
  messages: [{ id: 'message-1', role: 'user', content }],
});

test('bare URL user information is fully redacted while protocol, host, port and path remain exact', () => {
  const cases = [
    ['mysql', 'user:password', 'host', '/db'],
    ['postgresql', 'database-user:database-password', 'db.example.test:5432', '/db?sslmode=require'],
    ['redis', ':redis-password', 'cache.example.test:6379', '/0'],
    ['rediss', 'cache-user:cache-password', '[2001:db8::1]:6380', '/1'],
    ['http', 'web-user:web-password', 'localhost:8080', '/path'],
    ['HTTPS', 'deploy-user:deploy-token', 'Example.test:443', '/path?q=1#section'],
    ['mongodb+srv', 'mongo-user:mongo-password', 'cluster.example.test', '/db'],
    ['mysql', 'user:Pr0d_P@ssw0rd_2024', '10.20.30.40', '/db'],
    ['https', 'first@example.test:password@again', '[::1]:443', '/path'],
    ['https', 'user%40example.test:p%40ss%3Aword%2Ftail%3F%23%25', '[2001:db8::2]', '/path'],
    ['mysql', '%75%73%65%72:%70%61%73%73', 'host', '/db'],
    ['https', 'token-only', 'host', '/'],
    ['https', '用户:密码🔒', 'host', '/路径'],
    ['mysql', "user:p'assword", 'host', '/db'],
    ['redis', 'u:p', 'host', '/0'],
  ];
  for (const [scheme, userInfo, host, path] of cases) {
    const source = `${scheme}://${userInfo}@${host}${path}`;
    for (const redactEmails of [false, true]) {
      const input = conversation(source);
      const result = cleanConversation(input, { ...DEFAULT_OPTIONS, redactEmails });
      assert.equal(result.conversation.messages[0]!.content, `${scheme}://[SECRET_1]@${host}${path}`);
      assert.equal(result.stats.secretsRedacted, 1);
      assert.equal(result.stats.emailsRedacted, 0);
      assert.equal(result.stats.redactionReplacements, 1);
      assert.equal(input.messages[0]!.content, source);
    }
  }
});

test('URL credentials in adjacent URLs and serialized text are covered and aliases are idempotent', () => {
  const userInfo = 'same-user:same-password';
  const source = JSON.stringify({ urls: `mysql://${userInfo}@host,redis://${userInfo}@cache/0`,
    other: `https://${userInfo}@example.test/path` });
  const options = { ...DEFAULT_OPTIONS, redactEmails: true };
  const first = cleanConversation(conversation(source), options);
  const output = first.conversation.messages[0]!.content;
  assert.doesNotThrow(() => JSON.parse(output));
  assert.equal(output.match(/\[SECRET_1\]/g)?.length, 3);
  assert.equal(first.stats.secretsRedacted, 3);
  const second = cleanConversation(first.conversation, options);
  assert.equal(second.conversation.messages[0]!.content, output);
  assert.equal(second.stats.redactionReplacements, 0);
});

test('email redaction rejects multi-at and malformed tokens instead of replacing a suffix', () => {
  const tokens = [
    'Pr0d_P@ssw0rd_2024@10.20.30.40',
    'prefix@name@example.test',
    'name@example.test@tail.example',
    '@name@example.test',
    'name@@example.test',
    'name@10.20.30.40',
    'name@example.test_invalid',
    'name@example..test',
    'name..suffix@example.test',
  ];
  const source = tokens.join('\n');
  const result = cleanConversation(conversation(source), { ...DEFAULT_OPTIONS, redactEmails: true });
  assert.equal(result.conversation.messages[0]!.content, source);
  assert.equal(result.stats.emailsRedacted, 0);
  assert.equal(result.stats.redactionReplacements, 0);
});

test('email scanning skips URL authorities even when secret scanning is switched off', () => {
  const url = 'https://first@example.test:secret@host.example/path';
  const plainUrl = 'https://host.example/path?x=1#part';
  const result = cleanConversation(conversation(`${url}\n${plainUrl}\nreal@example.test`), {
    ...DEFAULT_OPTIONS, redact: false, redactEmails: true,
  });
  assert.equal(result.conversation.messages[0]!.content, `${url}\n${plainUrl}\n[EMAIL_1]`);
  assert.equal(result.stats.emailsRedacted, 1);
  assert.equal(result.stats.secretsRedacted, 0);
});

test('normal emails including plus tags, subdomains and punctuation retain stable aliases', () => {
  const source = "Contact: <alice+alerts@sub.example.test>, bob@example.test. Again alice+alerts@sub.example.test! 'o'connor@example.test'. mailto:alice+alerts@sub.example.test";
  const result = cleanConversation(conversation(source), { ...DEFAULT_OPTIONS, redactEmails: true });
  assert.equal(result.conversation.messages[0]!.content, "Contact: <[EMAIL_1]>, [EMAIL_2]. Again [EMAIL_1]! '[EMAIL_3]'. mailto:[EMAIL_1]");
  assert.equal(result.stats.emailsRedacted, 5);
  assert.equal(result.stats.redactionReplacements, 5);
  assert.equal(cleanConversation(conversation(source), DEFAULT_OPTIONS).conversation.messages[0]!.content, source);
});

test('custom rule matches remain visible when a larger credential interval owns the replacement', () => {
  const userInfo = 'fixture-user:fixture-password';
  const url = `mysql://${userInfo}@host/db`;
  const input = { ...conversation(url), title: url, source: url };
  const result = cleanConversation(input, { ...DEFAULT_OPTIONS, redactEmails: true,
    customSecrets: ['fixture-user', 'fixture-password', 'fixture-user'] });
  assert.equal(result.stats.customRuleMatches, 6);
  assert.equal(result.stats.customRedacted, 0);
  assert.equal(result.stats.secretsRedacted, 3);
  assert.equal(result.stats.redactionReplacements, 3);
  const diagnostics = JSON.stringify({ stats: result.stats, changes: result.changes, warnings: result.warnings });
  for (const value of [userInfo, 'fixture-user', 'fixture-password']) assert.ok(!diagnostics.includes(value));
  for (const output of [buildTranscript(result.conversation), buildJsonl(result.conversation), buildHandoff(result.conversation, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: ['message-1'], recentCount: 1,
  })]) {
    assert.ok(!output.includes(userInfo));
    assert.ok(output.includes('[SECRET_1]'));
  }
});

test('custom occurrences and final replacement spans distinguish containment, ties and crossing matches', () => {
  const shorter = cleanConversation(conversation('password=synthetic-long-secret'), {
    ...DEFAULT_OPTIONS, customSecrets: ['synthetic', 'long-secret'],
  });
  assert.equal(shorter.stats.customRuleMatches, 2);
  assert.equal(shorter.stats.customRedacted, 0);
  assert.equal(shorter.stats.redactionReplacements, 1);

  const tie = cleanConversation(conversation('redis://user:password@host'), {
    ...DEFAULT_OPTIONS, customSecrets: ['user:password'],
  });
  assert.equal(tie.stats.customRuleMatches, 1);
  assert.equal(tie.stats.customRedacted, 1);
  assert.equal(tie.stats.redactionReplacements, 1);
  assert.equal(tie.conversation.messages[0]!.content, 'redis://[CUSTOM_1]@host');

  const dense = cleanConversation(conversation('aaaaa'), { ...DEFAULT_OPTIONS, customSecrets: ['aaa', 'aaaa', 'aaa'] });
  assert.equal(dense.stats.customRuleMatches, 5);
  assert.equal(dense.stats.customRedacted, 1);
  assert.equal(dense.stats.redactionReplacements, 1);
});

test('URL credentials are scanned in full before tool trimming and duplicate removal', () => {
  const content = 'padding '.repeat(300) + 'redis://user:private-test-value@cache/0\n' + 'tail '.repeat(300);
  const input = conversation('');
  input.messages = [
    { id: 'message-1', role: 'tool', content },
    { id: 'message-2', role: 'tool', content },
  ];
  const result = cleanConversation(input, { ...DEFAULT_OPTIONS, toolLimit: 500, customSecrets: ['private-test-value'] });
  assert.equal(result.stats.customRuleMatches, 2);
  assert.equal(result.stats.redactionReplacements, 2);
  assert.equal(result.stats.duplicatesRemoved, 1);
  assert.ok(!JSON.stringify(result).includes('private-test-value'));
});
