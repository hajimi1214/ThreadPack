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
const run = (args: string[], stdin?: string | Buffer) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input: stdin });

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

test('CLI saves a byte-for-byte original copy beside the cleaned export without changing input', async () => {
  const input = join(folder, 'original-preservation.json');
  const cleaned = join(folder, 'original-preservation-cleaned.md');
  const originalCopy = join(folder, 'original-preservation-source.bin');
  const originalBytes = Buffer.from('\uFEFF{\r\n  "messages": [\r\n    {"role":"user","content":"Keep this source byte-for-byte."}\r\n  ]\r\n}\r\n', 'utf8');
  await writeFile(input, originalBytes);
  const result = run([input, '--out', cleaned, '--original-out', originalCopy]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(originalCopy), originalBytes);
  assert.deepEqual(await readFile(input), originalBytes);
  const exportText = await readFile(cleaned, 'utf8');
  assert.ok(exportText.includes('Normalized transcript'));
  assert.ok(exportText.includes('Keep this source byte-for-byte.'));
});

test('CLI preserves stdin bytes and keeps JSONL machine fields unchanged with Chinese diagnostics', async () => {
  const cleaned = join(folder, 'stdin-chinese.jsonl');
  const originalCopy = join(folder, 'stdin-original.bin');
  const sourceBytes = Buffer.from(`\uFEFF${JSON.stringify({ messages: [{ role: 'user', content: fakeSecret }] })}\r\n`, 'utf8');
  const result = run(['-', '--out', cleaned, '--original-out', originalCopy, '--format', 'jsonl', '--language', 'zh'], sourceBytes);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(originalCopy), sourceBytes);
  assert.match(result.stderr, /已导出/);
  const [line] = (await readFile(cleaned, 'utf8')).trim().split('\n');
  const message = JSON.parse(line!);
  assert.equal(message.role, 'user');
  assert.equal(message.content, '[SECRET_1]');
});

test('CLI protects both output destinations and all source aliases for original copies', async () => {
  const input = join(folder, 'original-alias-input.json');
  const alias = join(folder, 'original-alias-input-hardlink.json');
  const cleaned = join(folder, 'original-alias-cleaned.md');
  const originalCopy = join(folder, 'original-alias-copy.json');
  const notes = join(folder, 'original-alias-notes.json');
  const rules = join(folder, 'original-alias-rules.txt');
  await writeFile(input, transcript);
  await link(input, alias);
  await writeFile(notes, JSON.stringify({ goal: 'Private handoff goal.' }));
  await writeFile(rules, 'PRIVATE_REDACTION_RULE');
  for (const source of [input, alias]) {
    const result = run([source, '--out', cleaned, '--original-out', input]);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(input));
  }
  const sameDestination = run([input, '--out', originalCopy, '--original-out', originalCopy]);
  assert.equal(sameDestination.status, 1);
  const notesCollision = run([input, '--out', cleaned, '--format', 'handoff', '--notes-file', notes, '--original-out', notes]);
  assert.equal(notesCollision.status, 1);
  const rulesCollision = run([input, '--out', cleaned, '--redact-file', rules, '--original-out', rules]);
  assert.equal(rulesCollision.status, 1);
  assert.equal(await readFile(notes, 'utf8'), JSON.stringify({ goal: 'Private handoff goal.' }));
  assert.equal(await readFile(rules, 'utf8'), 'PRIVATE_REDACTION_RULE');
  await writeFile(originalCopy, 'preserve this existing copy');
  const blocked = run([input, '--out', cleaned, '--original-out', originalCopy]);
  assert.equal(blocked.status, 1);
  await assert.rejects(readFile(cleaned), { code: 'ENOENT' });
  assert.equal(await readFile(originalCopy, 'utf8'), 'preserve this existing copy');
  const forced = run([input, '--out', cleaned, '--original-out', originalCopy, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(await readFile(originalCopy, 'utf8'), transcript);
  assert.equal(await readFile(input, 'utf8'), transcript);
});

test('CLI translates Markdown headings, warnings, reports, and errors without translating JSON schema keys', async () => {
  const input = join(folder, 'localized-warning.jsonl');
  const output = join(folder, 'localized-report.json');
  await writeFile(input, '{"role":"user","content":"Retained source text."}\n{"type":"unsupported"}\nmalformed-line\n');
  const result = run([input, '--out', output, '--format', 'report', '--language', 'zh']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /已导出/);
  assert.match(result.stderr, /警告：/);
  assert.match(result.stderr, /无效 JSONL/);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(report.warnings.some((warning: string) => warning.includes('无效 JSONL')));
  assert.ok(report.warnings.some((warning: string) => warning.includes('脱敏使用本地模式')));
  assert.ok(Object.hasOwn(report, 'warningCount'));
  assert.ok(Object.hasOwn(report, 'stats'));
  assert.equal(report.note, '统计描述标准化后的消息文本。不包含对话正文或检测到的秘密值。');
  assert.ok(!JSON.stringify(report).includes('Retained source text.'));

  const markdownPath = join(folder, 'localized-transcript.md');
  const markdown = run(['-', '--out', markdownPath, '--format', 'markdown', '--language', 'zh'], transcript);
  assert.equal(markdown.status, 0, markdown.stderr);
  const markdownText = await readFile(markdownPath, 'utf8');
  assert.ok(markdownText.includes('标准化对话'));
  assert.ok(markdownText.includes('由 ThreadPack 在本地创建'));

  const error = run(['-', '--out', join(folder, 'localized-invalid-pin.md'), '--format', 'handoff', '--pin', '0', '--language', 'zh'], transcript);
  assert.equal(error.status, 1);
  assert.match(error.stderr, /消息序号必须在 1 到/);

  const handoffPath = join(folder, 'localized-handoff.md');
  const handoffResult = run(['-', '--out', handoffPath, '--format', 'handoff', '--recent', '1', '--language', 'zh'], transcript);
  assert.equal(handoffResult.status, 0, handoffResult.stderr);
  const handoff = await readFile(handoffPath, 'utf8');
  assert.match(handoff, /^# 交接包:/);
  assert.ok(handoff.includes('## 目标'));
  assert.ok(handoff.includes('[SECRET_1]'));
  assert.ok(!handoff.includes(fakeSecret));
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

test('CLI timestamp mode selects valid recent messages and reports the handoff range and budget counts', async () => {
  const input = join(folder, 'timestamped-conversation.json');
  const reportPath = join(folder, 'timestamped-report.json');
  const handoffPath = join(folder, 'timestamped-handoff.md');
  await writeFile(input, JSON.stringify({ messages: [
    { role: 'user', content: 'LATEST_SOURCE_MESSAGE', timestamp: '2026-01-04T00:00:00Z' },
    { role: 'assistant', content: 'OLDEST_SOURCE_MESSAGE', timestamp: '2026-01-01T00:00:00Z' },
    { role: 'user', content: 'SECOND_LATEST_MESSAGE', timestamp: '2026-01-03T00:00:00Z' },
    { role: 'assistant', content: 'NO_TIMESTAMP_MESSAGE' },
  ] }));
  const reportResult = run([input, '--out', reportPath, '--format', 'report', '--recent', '2', '--recent-mode', 'timestamp']);
  assert.equal(reportResult.status, 0, reportResult.stderr);
  const rawReport = await readFile(reportPath, 'utf8');
  const report = JSON.parse(rawReport);
  assert.equal(report.handoff.selectionMode, 'timestamp');
  assert.equal(report.handoff.completeMessageCount, 2);
  assert.equal(report.handoff.omittedMessageCount, 0);
  assert.equal(report.handoff.truncatedMessageCount, 0);
  assert.equal(report.handoff.notSelectedMessageCount, 1);
  assert.equal(report.handoff.missingTimestampCount, 1);
  assert.deepEqual(report.handoff.timeRange, { start: '2026-01-03T00:00:00.000Z', end: '2026-01-04T00:00:00.000Z' });
  for (const content of ['LATEST_SOURCE_MESSAGE', 'SECOND_LATEST_MESSAGE', 'NO_TIMESTAMP_MESSAGE']) assert.ok(!rawReport.includes(content));

  const handoffResult = run([input, '--out', handoffPath, '--format', 'handoff', '--recent', '2', '--recent-mode', 'timestamp']);
  assert.equal(handoffResult.status, 0, handoffResult.stderr);
  const handoff = await readFile(handoffPath, 'utf8');
  assert.ok(handoff.includes('LATEST_SOURCE_MESSAGE'));
  assert.ok(handoff.includes('SECOND_LATEST_MESSAGE'));
  assert.ok(!handoff.includes('OLDEST_SOURCE_MESSAGE'));
  assert.ok(!handoff.includes('NO_TIMESTAMP_MESSAGE'));
  assert.ok(handoff.indexOf('LATEST_SOURCE_MESSAGE') < handoff.indexOf('SECOND_LATEST_MESSAGE'));
});

test('CLI report names messages omitted or shortened by the handoff budget', async () => {
  const output = join(folder, 'budget-report.json');
  const messages = Array.from({ length: 4 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `BUDGET_MESSAGE_${index + 1} ${'x'.repeat(20000)}`,
  }));
  const result = run(['-', '--out', output, '--format', 'report', '--recent', '4'], JSON.stringify({ messages }));
  assert.equal(result.status, 0, result.stderr);
  const raw = await readFile(output, 'utf8');
  const report = JSON.parse(raw);
  assert.deepEqual(report.handoff.truncatedMessageIds, ['message-4']);
  assert.deepEqual(report.handoff.omittedMessageIds, ['message-1', 'message-2', 'message-3']);
  assert.equal(report.handoff.omittedMessageCount, 3);
  assert.equal(report.handoff.truncatedMessageCount, 1);
  assert.equal(report.handoff.completeMessageCount, 0);
  assert.equal(report.handoff.budgetExceeded, false);
  assert.ok(!raw.includes('BUDGET_MESSAGE_'));

  const pinnedOutput = join(folder, 'pinned-over-budget-report.json');
  const pinnedResult = run(['-', '--out', pinnedOutput, '--format', 'report', '--recent', '4', '--pin', '4'], JSON.stringify({ messages }));
  assert.equal(pinnedResult.status, 0, pinnedResult.stderr);
  assert.equal(JSON.parse(await readFile(pinnedOutput, 'utf8')).handoff.budgetExceeded, true);
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
  assert.match(result.stdout, /--recent-mode <source\|timestamp>/);
  assert.match(result.stdout, /--notes-file <file>/);
  assert.match(result.stdout, /--pin <N>.*repeatable/);
  assert.match(result.stdout, /--original-out <file>/);
  assert.match(result.stdout, /--language <en\|zh>/);
  assert.match(result.stdout, /--no-redact-emails/);
  const chinese = run(['--help', '--language', 'zh']);
  assert.equal(chinese.status, 0);
  assert.match(chinese.stdout, /保存未经修改的原始输入副本/);
  const invalidChinese = run(['-', '--out', join(folder, 'invalid-chinese.md'), '--language', 'zh', '--unknown'], transcript);
  assert.equal(invalidChinese.status, 1);
  assert.match(invalidChinese.stderr, /命令行选项无效/);
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
  for (const redactEmails of [true, false]) {
    for (const format of ['markdown', 'jsonl', 'handoff', 'report']) {
      const output = join(folder, `url-${format}-${redactEmails}.txt`);
      const args = ['-', '--out', output, '--format', format, '--redact-file', rules];
      if (!redactEmails) args.push('--no-redact-emails');
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
  const result = run(['-', '--out', output, '--format', 'jsonl'], input);
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse((await readFile(output, 'utf8')).trim());
  assert.equal(message.content, `${credential}\n[EMAIL_1]`);
  assert.ok(!result.stderr.includes(credential));
});

test('CLI can explicitly retain emails and rejects contradictory email flags', async () => {
  const output = join(folder, 'keep-emails.jsonl');
  const input = JSON.stringify({ messages: [{ role: 'user', content: 'real@example.test' }] });
  const result = run(['-', '--out', output, '--format', 'jsonl', '--no-redact-emails'], input);
  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse((await readFile(output, 'utf8')).trim());
  assert.equal(message.content, 'real@example.test');
  const contradictory = run(['-', '--out', join(folder, 'contradictory-emails.jsonl'), '--redact-emails', '--no-redact-emails'], input);
  assert.equal(contradictory.status, 1);
  assert.match(contradictory.stderr, /Choose either/);
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
