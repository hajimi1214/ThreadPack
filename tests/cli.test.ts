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
