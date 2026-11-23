import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { test, before, after } from 'node:test';

let folder: string;
let cli: string;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'threadpack-mcp-'));
  cli = join(folder, 'threadpack.mjs');
  await build({ entryPoints: ['cli/index.ts'], outfile: cli, bundle: true, platform: 'node', format: 'esm', target: 'node20', define: { __THREADPACK_VERSION__: JSON.stringify('test') } });
});

after(async () => { await rm(folder, { recursive: true, force: true }); });

test('MCP bridge serves the latest authorized backup with a trust boundary', async () => {
  const memory = {
    id: 'fact-1', category: 'constraint', topic: 'Runtime', statement: 'The runtime must stay local.', origin: 'user', status: 'confirmed',
    evidence: [{ id: 'evidence-1', kind: 'conversation', reference: 'Local project evidence', quote: 'The runtime must stay local.', sessionId: 'session-1', version: 1, messageId: 'message-1', messageFingerprint: 'a'.repeat(64), recordedAt: 1, verification: 'source-matched' }],
    conflictsWith: [], createdAt: 1, updatedAt: 1,
  };
  const content = JSON.stringify({ id: 'message-1', role: 'user', content: 'The runtime must stay local.' }) + '\n';
  const backup = [
    { type: 'threadpack_project', version: 2, createdAt: 1, project: { name: 'ThreadPack', summary: 'A local context project.', importantNotes: '' }, sessionCount: 1, revisionCount: 1, factCount: 1 },
    { type: 'session', data: { id: 'session-1', sessionKey: 'source:generic:session', title: 'Local project evidence', sourceName: 'session.json', platform: 'generic', format: 'Messages JSON export', messageCount: 1, fingerprint: createHash('sha256').update(content).digest('hex'), currentVersion: 1, createdAt: 1, updatedAt: 1 } },
    { type: 'revision', data: { sessionId: 'session-1', version: 1, fingerprint: createHash('sha256').update(content).digest('hex'), content, title: 'Local project evidence', platform: 'generic', format: 'Messages JSON export', messageCount: 1, sourceName: 'session.json', createdAt: 1 } },
    { type: 'memory', fingerprint: createHash('sha256').update(JSON.stringify(memory)).digest('hex'), data: memory },
  ].map(record => JSON.stringify(record)).join('\n') + '\n';
  const backupPath = join(folder, 'project-backup.jsonl');
  await writeFile(backupPath, backup, 'utf8');
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'threadpack_project_context', arguments: { query: 'runtime', budget: 4000 } } }),
  ].join('\n') + '\n';
  const result = spawnSync(process.execPath, [cli, 'mcp', '--backup', backupPath], { encoding: 'utf8', input });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line) as { id: number; result?: { content?: { text: string }[]; tools?: { name: string }[] } });
  assert.equal(responses.length, 3);
  assert.equal(responses[1]!.result?.tools?.[0]?.name, 'threadpack_project_context');
  const context = responses[2]!.result?.content?.[0]?.text ?? '';
  assert.match(context, /TRUST BOUNDARY/);
  assert.match(context, /The runtime must stay local\./);
});

test('MCP bridge fails closed for a tampered memory record', async () => {
  const backupPath = join(folder, 'tampered-backup.jsonl');
  const data = { id: 'fact', category: 'constraint', topic: 'Runtime', statement: 'Tampered', origin: 'user', status: 'confirmed', evidence: [], conflictsWith: [], createdAt: 1, updatedAt: 1 };
  const backup = [
    { type: 'threadpack_project', version: 2, createdAt: 1, project: { name: 'P', summary: '', importantNotes: '' }, sessionCount: 0, revisionCount: 0, factCount: 1 },
    { type: 'memory', fingerprint: '0'.repeat(64), data },
  ].map(record => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(backupPath, backup, 'utf8');
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'threadpack_project_context', arguments: {} } }) + '\n';
  const result = spawnSync(process.execPath, [cli, 'mcp', '--backup', backupPath], { encoding: 'utf8', input });
  assert.equal(result.status, 0);
  const response = JSON.parse(result.stdout.trim()) as { error?: { code: number; message: string } };
  assert.equal(response.error?.code, -32000);
  assert.equal(response.error?.message, 'ThreadPack could not read the authorized project context.');
});
