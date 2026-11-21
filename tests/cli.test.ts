import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, link, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

let folder: string;
let cli: string;
const fakeSecret = ['sk-', 'NotARealProviderCredential', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
const transcript = JSON.stringify({ messages: [
  { role: 'user', content: 'Keep the acceptance criteria and the Unicode: 你好.' },
  { role: 'assistant', content: `The test credential is ${fakeSecret}` },
] });

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'threadpack-cli-'));
  cli = join(folder, 'threadpack.mjs');
  await build({
    entryPoints: ['cli/index.ts'], outfile: cli, bundle: true,
    platform: 'node', format: 'esm', target: 'node20',
    define: { __THREADPACK_VERSION__: JSON.stringify('test') },
  });
});
after(async () => { await rm(folder, { recursive: true, force: true }); });
const run = (args: string[], stdin?: string) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input: stdin });

test('CLI exports redacted Markdown while keeping input intact and diagnostics content-free', async () => {
  const input = join(folder, 'conversation.json');
  const output = join(folder, 'clean.md');
  await writeFile(input, transcript);
  const result = run([input, '--out', output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const exported = await readFile(output, 'utf8');
  assert.ok(exported.includes('你好'));
  assert.ok(!exported.includes(fakeSecret));
  assert.ok(!result.stderr.includes(fakeSecret));
  assert.equal(await readFile(input, 'utf8'), transcript);
});

test('CLI refuses overwriting output unless force is explicit', async () => {
  const input = join(folder, 'overwrite-input.json');
  const output = join(folder, 'exists.md');
  await writeFile(input, transcript);
  await writeFile(output, 'preserve existing data');
  assert.equal(run([input, '--out', output]).status, 1);
  assert.equal(await readFile(output, 'utf8'), 'preserve existing data');
  const forced = run([input, '--out', output, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.notEqual(await readFile(output, 'utf8'), 'preserve existing data');
});

test('CLI refuses input=output and hard-linked aliases even with force', async () => {
  const input = join(folder, 'never-overwrite.json');
  const alias = join(folder, 'input-alias.json');
  await writeFile(input, transcript);
  assert.equal(run([input, '--out', input, '--force']).status, 1);
  await link(input, alias);
  assert.equal(run([input, '--out', alias, '--force']).status, 1);
  assert.equal(await readFile(input, 'utf8'), transcript);
});

test('CLI exports parseable canonical JSONL from stdin', async () => {
  const output = join(folder, 'stdin.jsonl');
  const result = run(['-', '--out', output, '--format', 'jsonl'], transcript);
  assert.equal(result.status, 0, result.stderr);
  const messages = (await readFile(output, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(messages.length > 0);
  assert.ok(!JSON.stringify(messages).includes(fakeSecret));
});

test('CLI report contains aggregate statistics and no message content', async () => {
  const output = join(folder, 'report.json');
  const result = run(['-', '--out', output, '--format', 'report'], transcript);
  assert.equal(result.status, 0, result.stderr);
  const raw = await readFile(output, 'utf8');
  const report = JSON.parse(raw);
  assert.equal(report.tool, 'ThreadPack');
  assert.ok(report.stats.beforeBytes > 0);
  assert.ok(!raw.includes(fakeSecret));
  assert.ok(!raw.includes('acceptance criteria'));
});

test('CLI handoff includes redacted notes and selected messages with independent NOTE aliases', async () => {
  const repeatedSecret = ['sk-', 'NotesOnlySecret', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
  const customValue = 'NOTES_PRIVATE_LITERAL_731';
  const notesPath = join(folder, 'handoff-notes.json');
  const rulesPath = join(folder, 'handoff-rules.txt');
  const output = join(folder, 'notes-handoff.md');
  const input = JSON.stringify({ messages: [
    { role: 'user', content: 'first source message' },
    { role: 'assistant', content: 'second source message' },
    { role: 'user', content: 'third source message' },
  ] });
  await writeFile(notesPath, JSON.stringify({
    goal: `Use ${repeatedSecret} and contact owner@example.test.`,
    decisions: `Reuse ${repeatedSecret}; remove ${customValue}.`,
    constraints: 'Keep the private notes local.',
    nextSteps: 'Continue with the selected context.',
  }));
  await writeFile(rulesPath, customValue);
  const result = run(['-', '--out', output, '--format', 'handoff', '--notes-file', notesPath,
    '--redact-file', rulesPath, '--redact-emails', '--recent', '0', '--pin', '2', '--pin', '3'], input);
  assert.equal(result.status, 0, result.stderr);
  const handoff = await readFile(output, 'utf8');
  assert.match(handoff, /Use \[NOTE_SECRET_1\] and contact \[NOTE_EMAIL_1\]/);
  assert.match(handoff, /Reuse \[NOTE_SECRET_1\]; remove \[NOTE_CUSTOM_1\]/);
  assert.ok(handoff.includes('Keep the private notes local.'));
  assert.ok(handoff.includes('Continue with the selected context.'));
  assert.match(handoff, /### ASSISTANT · message-2/);
  assert.match(handoff, /### USER · message-3/);
  assert.ok(!handoff.includes(repeatedSecret));
  assert.ok(!handoff.includes(customValue));
  assert.ok(!handoff.includes('owner@example.test'));
  assert.ok(!result.stderr.includes(repeatedSecret));
  assert.ok(!result.stderr.includes(customValue));
  assert.ok(!result.stderr.includes('owner@example.test'));
});

test('CLI rejects malformed notes without exposing their contents', async () => {
  const privateText = 'PRIVATE_NOTE_CONTENT_NOT_FOR_DIAGNOSTICS';
  const cases: [string, string | Buffer][] = [
    ['invalid-json', `{"goal":"${privateText}"`],
    ['invalid-shape', JSON.stringify({ goal: privateText, decisions: 42 })],
    ['null-field', JSON.stringify({ goal: null, decisions: privateText })],
    ['long-field', JSON.stringify({ goal: 'N'.repeat(12001) })],
    ['unknown-field', JSON.stringify({ goal: privateText, surprise: 'value' })],
    ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xff])],
    ['too-large', Buffer.alloc(256 * 1024 + 1, 'X')],
  ];
  for (const [name, content] of cases) {
    const notes = join(folder, `${name}-notes.json`);
    const output = join(folder, `${name}-notes-rejected.md`);
    await writeFile(notes, content);
    const result = run(['-', '--out', output, '--format', 'handoff', '--notes-file', notes], transcript);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(privateText));
    assert.ok(!result.stderr.includes(notes));
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('CLI validates repeated handoff message numbers against the selected conversation', async () => {
  const output = join(folder, 'invalid-pins.md');
  for (const value of ['0', '4', 'not-a-number', '999999999999999999999999999999']) {
    const result = run(['-', '--out', output, '--format', 'handoff', '--pin', value], JSON.stringify({
      messages: [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }],
    }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--pin/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('CLI keeps a pinned duplicate tool message in the handoff', async () => {
  const output = join(folder, 'pinned-duplicate.md');
  const input = JSON.stringify({ messages: [
    { role: 'tool', content: 'shared tool output' },
    { role: 'tool', content: 'shared tool output' },
  ] });
  const result = run(['-', '--out', output, '--format', 'handoff', '--recent', '0', '--pin', '2'], input);
  assert.equal(result.status, 0, result.stderr);
  const handoff = await readFile(output, 'utf8');
  assert.match(handoff, /### TOOL · message-2/);
  assert.ok(handoff.includes('shared tool output'));
  assert.ok(!handoff.includes('duplicate tool output omitted'));
});

test('CLI reports warning details in JSON and stderr while retaining warningCount', async () => {
  const input = join(folder, 'warning-details.jsonl');
  const output = join(folder, 'warning-details.json');
  const malformedLine = '{"role":"user","content":"valid"}\nnot-json\n';
  await writeFile(input, malformedLine);
  const result = run([input, '--out', output, '--format', 'report']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.warningCount, report.warnings.length);
  assert.ok(report.warningCount > 0);
  assert.ok(report.warnings.some((warning: string) => warning.includes('invalid JSONL line')));
  assert.ok(result.stderr.includes('Warning:'));
  assert.ok(result.stderr.includes('invalid JSONL line'));
});

test('CLI keeps notes, source, redaction, and output files separate across hard-linked aliases', async () => {
  const input = join(folder, 'notes-path-input.json');
  const inputAlias = join(folder, 'notes-path-input-alias.json');
  const notes = join(folder, 'notes-path-notes.json');
  const rules = join(folder, 'notes-path-rules.txt');
  const output = join(folder, 'notes-path-output.md');
  await writeFile(input, transcript);
  await link(input, inputAlias);
  await writeFile(notes, JSON.stringify({ goal: 'A local goal.' }));
  await writeFile(rules, 'PRIVATE_RULE_VALUE');
  for (const source of [input, inputAlias]) {
    const result = run([source, '--out', output, '--format', 'handoff', '--notes-file', input]);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(input));
  }
  const outputAlias = join(folder, 'notes-path-output-alias.md');
  await link(notes, outputAlias);
  const outputCollision = run([input, '--out', outputAlias, '--force', '--format', 'handoff', '--notes-file', notes]);
  assert.equal(outputCollision.status, 1);
  assert.equal(await readFile(notes, 'utf8'), JSON.stringify({ goal: 'A local goal.' }));
  const rulesCollision = run([input, '--out', output, '--redact-file', rules, '--notes-file', rules, '--format', 'handoff']);
  assert.equal(rulesCollision.status, 1);
  assert.equal(await readFile(rules, 'utf8'), 'PRIVATE_RULE_VALUE');
});

test('CLI help documents the recent-message default', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--recent <N>.*default: 8/);
  assert.match(result.stdout, /--notes-file <file>/);
  assert.match(result.stdout, /--pin <N>.*repeatable/);
});

test('CLI report uses a fixed schema format and never echoes a private source label', async () => {
  const sourceToken = ['ghp', 'S'.repeat(36)].join('_');
  const privateSource = `PRIVATE_SOURCE_LABEL:${sourceToken}`;
  const output = join(folder, 'private-source-report.json');
  const input = JSON.stringify({
    source: privateSource,
    messages: [{ role: 'user', content: 'Synthetic report privacy regression.' }],
  });
  const result = run(['-', '--out', output, '--format', 'report'], input);
  assert.equal(result.status, 0, result.stderr);
  const raw = await readFile(output, 'utf8');
  const report = JSON.parse(raw);
  assert.equal(report.format, 'Messages JSON export');
  assert.ok(!raw.includes(sourceToken));
  assert.ok(!raw.includes('PRIVATE_SOURCE_LABEL'));
  assert.ok(!result.stderr.includes(sourceToken));
  assert.ok(!result.stdout.includes(sourceToken));
});

test('CLI rejects invalid numeric arguments and unknown flags without echoing input', async () => {
  for (const args of [['--tool-limit', 'NaN'], ['--recent', '-1'], ['--conversation', '0'], ['--format', 'evil'], ['--unknown']]) {
    const result = run(['-', '--out', join(folder, 'invalid.md'), ...args], transcript);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(fakeSecret));
  }
});

test('CLI rejects empty input and unavailable conversation numbers', async () => {
  assert.equal(run(['-', '--out', join(folder, 'empty.md')], '   ').status, 1);
  const result = run(['-', '--out', join(folder, 'missing.md'), '--conversation', '100'], transcript);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('unavailable'));
});

test('CLI rejects oversized files before reading their content', async () => {
  const input = join(folder, 'oversized.txt');
  const handle = await open(input, 'w');
  try { await handle.truncate(100 * 1024 * 1024 + 1); }
  finally { await handle.close(); }
  const result = run([input, '--out', join(folder, 'oversized.md')]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('100 MiB limit'));
});

test('CLI creates an explicitly labeled deterministic handoff', async () => {
  const output = join(folder, 'handoff.md');
  const result = run(['-', '--out', output, '--format', 'handoff', '--recent', '1'], transcript);
  assert.equal(result.status, 0, result.stderr);
  const handoff = await readFile(output, 'utf8');
  assert.match(handoff, /deterministic|excerpt/i);
  assert.ok(!handoff.includes(fakeSecret));
});

test('CLI redacts bare URL credentials in every cleaned format and exposes overlap counts without values', async () => {
  const userInfo = 'cli-fixture-user:cli-fixture-password%40tail';
  const url = `mysql://${userInfo}@[2001:db8::1]:3306/db`;
  const rules = join(folder, 'url-rules.txt');
  await writeFile(rules, 'cli-fixture-user\ncli-fixture-password');
  const input = JSON.stringify({ messages: [{ role: 'user', content: `${url}\nreader@example.test` }] });
  for (const redactEmails of [false, true]) {
    for (const format of ['markdown', 'jsonl', 'handoff', 'report']) {
      const output = join(folder, `url-${format}-${redactEmails}.txt`);
      const args = ['-', '--out', output, '--format', format, '--redact-file', rules];
      if (redactEmails) args.push('--redact-emails');
      const result = run(args, input);
      assert.equal(result.status, 0, result.stderr);
      const exported = await readFile(output, 'utf8');
      for (const value of ['cli-fixture-user', 'cli-fixture-password', userInfo, rules]) {
        assert.ok(!exported.includes(value));
        assert.ok(!result.stderr.includes(value));
        assert.ok(!result.stdout.includes(value));
      }
      assert.match(result.stderr, /2 custom rule matches/);
      assert.match(result.stderr, /0 custom replacements/);
      if (format === 'report') {
        const report = JSON.parse(exported);
        assert.equal(report.stats.customRuleMatches, 2);
        assert.equal(report.stats.customRedacted, 0);
        assert.equal(report.stats.redactionReplacements, redactEmails ? 2 : 1);
      } else {
        assert.ok(exported.includes('mysql://[SECRET_1]@[2001:db8::1]:3306/db'));
        assert.equal(exported.includes('reader@example.test'), !redactEmails);
      }
    }
  }
  const invalid = run(['-', '--out', join(folder, 'rejected-url.md'), '--tool-limit', userInfo], input);
  assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes(userInfo));
  const invalidInput = join(folder, 'private-url-input.json');
  await writeFile(invalidInput, `{ "messages": [ ${url} }`);
  const malformed = run([invalidInput, '--out', join(folder, 'unused.md')]);
  assert.equal(malformed.status, 1);
  assert.ok(!malformed.stderr.includes(userInfo));
  assert.ok(!malformed.stdout.includes(userInfo));
  assert.ok(!malformed.stderr.includes('private-url-input.json'));
});

test('CLI email mode never partially labels a standalone multi-at credential as an email', async () => {
  const credential = 'Pr0d_P@ssw0rd_2024@10.20.30.40';
  const output = join(folder, 'multi-at.jsonl');
  const input = JSON.stringify({ messages: [{ role: 'user', content: `${credential}\nreal@example.test` }] });
  const result = run(['-', '--out', output, '--format', 'jsonl', '--redact-emails'], input);
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse((await readFile(output, 'utf8')).trim());
  assert.equal(message.content, `${credential}\n[EMAIL_1]`);
  assert.ok(!result.stderr.includes(credential));
});

test('CLI custom literal redaction remains active with --no-redact and preserves significant spaces', async () => {
  const exactValue = ['PRIVATE', 'PROJECT[42].*'].join('_');
  const spacedValue = '  EXPLICIT SPACES  ';
  const rules = join(folder, 'literal-rules.txt');
  await writeFile(rules, `\uFEFF${exactValue}\r\n\r\n   \r\n${spacedValue}\r\n`);
  const input = JSON.stringify({ messages: [{
    role: 'user',
    content: `Exact: ${exactValue}. Again: ${exactValue}. Spaced:${spacedValue}|EXPLICIT SPACES|. Provider: ${fakeSecret}`,
  }] });
  const output = join(folder, 'literal-cleaned.jsonl');
  const result = run(['-', '--out', output, '--format', 'jsonl', '--redact-file', rules, '--no-redact'], input);
  assert.equal(result.status, 0, result.stderr);
  const messages = (await readFile(output, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const content = messages[0].content as string;
  assert.equal((content.match(/\[CUSTOM_1\]/g) ?? []).length, 2);
  assert.ok(content.includes('[CUSTOM_2]|EXPLICIT SPACES|'));
  assert.ok(!content.includes(exactValue));
  assert.ok(!content.includes(spacedValue));
  assert.ok(content.includes(fakeSecret));
  assert.ok(!result.stderr.includes(exactValue));
  assert.ok(!result.stderr.includes(rules));
  assert.equal(result.stdout, '');
});

test('CLI custom redaction report contains only aggregate custom counts', async () => {
  const exactValue = ['SYNTHETIC', 'INTERNAL_ACCOUNT_73'].join('_');
  const rules = join(folder, 'report-custom-rules.txt');
  const output = join(folder, 'custom-report.json');
  await writeFile(rules, exactValue);
  const input = JSON.stringify({
    title: `Private project ${exactValue}`,
    messages: [{ role: 'user', content: `${exactValue} and ${exactValue}` }],
  });
  const result = run(['-', '--out', output, '--format', 'report', '--redact-file', rules], input);
  assert.equal(result.status, 0, result.stderr);
  const raw = await readFile(output, 'utf8');
  const report = JSON.parse(raw);
  assert.equal(report.stats.customRedacted, 3);
  assert.ok(!raw.includes(exactValue));
  assert.ok(!raw.includes('customSecrets'));
  assert.ok(!raw.includes(rules));
  assert.ok(!result.stderr.includes(exactValue));
  assert.ok(!result.stderr.includes(rules));
});

test('CLI protects custom rule files and their hard-linked aliases from both input and output roles', async () => {
  const rules = join(folder, 'protected-rules.txt');
  const alias = join(folder, 'protected-rules-alias.txt');
  const input = join(folder, 'rules-protection-input.json');
  const ruleText = 'SYNTHETIC_PROTECTED_LITERAL';
  await writeFile(rules, ruleText);
  await link(rules, alias);
  await writeFile(input, transcript);
  for (const output of [rules, alias]) {
    const result = run([input, '--out', output, '--redact-file', rules, '--force']);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(ruleText));
    assert.ok(!result.stderr.includes(rules));
  }
  for (const source of [rules, alias]) {
    const result = run([source, '--out', join(folder, 'rules-must-not-be-input.md'), '--redact-file', rules, '--force']);
    assert.equal(result.status, 1);
  }
  assert.equal(await readFile(rules, 'utf8'), ruleText);
  assert.equal(await readFile(alias, 'utf8'), ruleText);
  assert.equal(await readFile(input, 'utf8'), transcript);
});

test('CLI rejects invalid custom rule files without leaking values or file paths', async () => {
  const cases: [string, string | Buffer][] = [
    ['too-short', '汉字'],
    ['too-many', Array.from({ length: 51 }, (_, index) => `SYNTHETIC_RULE_${index}`).join('\n')],
    ['too-long', 'V'.repeat(1001)],
    ['too-large', Buffer.alloc(64 * 1024 + 1, 'X')],
    ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xff])],
  ];
  for (const [name, content] of cases) {
    const rules = join(folder, `${name}-private-rules.txt`);
    const output = join(folder, `${name}-rejected.md`);
    await writeFile(rules, content);
    const result = run(['-', '--out', output, '--redact-file', rules], transcript);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(rules));
    assert.ok(!result.stderr.includes('SYNTHETIC_RULE_'));
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    if (name === 'too-large') assert.ok(result.stderr.includes('64 KiB limit'));
  }
});
