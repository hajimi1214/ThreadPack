import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS } from '../src/core';
import type { CleanOptions } from '../src/core';
import { MAX_IMPORT_BYTES, MAX_PREVIEW_CHARACTERS, MAX_SNIPPET_PREVIEW_CHARACTERS, WorkerEngine } from '../src/worker/engine';
import type { CleanSummary, ExportExcerptRequest, ImportProgress, ParseInfo, QueryRequest } from '../src/worker/types';

let rpcId = 0;
const next = () => ++rpcId;
const textOf = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

async function load(engine: WorkerEngine, text: string, archiveId = 1, filename = 'messages.json', keepArchiveId: number | null = null): Promise<ParseInfo> {
  return engine.handle({ id: next(), type: 'parse', archiveId, keepArchiveId, text, filename });
}
async function clean(engine: WorkerEngine, archive: ParseInfo, options: CleanOptions = DEFAULT_OPTIONS, conversationIndex = 0): Promise<CleanSummary> {
  return engine.handle({ id: next(), type: 'clean', archiveId: archive.archiveId, conversationId: archive.conversations[conversationIndex]!.id, options });
}
function preview(engine: WorkerEngine, archive: ParseInfo, summary: CleanSummary, overrides: Partial<QueryRequest> = {}) {
  return engine.handle({ id: next(), type: 'query', archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision,
    mode: 'cleaned', query: '', role: 'all', changedOnly: false, pinnedOnly: false, pinnedIds: [], page: 0, pageSize: 30, ...overrides });
}
function exportExcerpt(engine: WorkerEngine, archive: ParseInfo, summary: CleanSummary, overrides: Partial<ExportExcerptRequest> = {}) {
  return engine.handle({ id: next(), type: 'export-excerpt', archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision,
    mode: 'cleaned', query: '', role: 'all', changedOnly: false, pinnedOnly: false, pinnedIds: [], format: 'jsonl', ...overrides });
}
function deferredFile(name = 'stream.txt') {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  return { file: { name, size: 50, stream: () => stream } as File, controller };
}

test('clean RPC sends summaries only; message bodies and full change arrays stay in the worker', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: 'UNIQUE_MESSAGE_BODY_DO_NOT_TRANSFER' }] }));
  const summary = await clean(engine, archive);
  assert.equal(summary.conversation.messageCount, 1);
  assert.ok(summary.revision > 0);
  assert.equal(summary.changedMessageCount, 0);
  assert.ok(!JSON.stringify(summary).includes('UNIQUE_MESSAGE_BODY_DO_NOT_TRANSFER'));
  assert.ok(!('messages' in summary.conversation));
  assert.ok(!('changes' in summary));
  const page = await preview(engine, archive, summary);
  assert.equal(page.items[0]!.message.content, 'UNIQUE_MESSAGE_BODY_DO_NOT_TRANSFER');
});

test('code snippet queries page across the full cleaned corpus and return bounded previews only', async () => {
  const engine = new WorkerEngine();
  const code = 'a'.repeat(MAX_SNIPPET_PREVIEW_CHARACTERS - 1) + '🔎' + 'tail '.repeat(1000);
  const messages = Array.from({ length: 23 }, (_, index) => ({ role: 'assistant', content: `\`\`\`ts\n// block ${index + 1}\n${code}\n\`\`\`` }));
  const archive = await load(engine, JSON.stringify({ messages }));
  const summary = await clean(engine, archive);
  const selection = { archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision };
  const first = await engine.handle({ id: next(), type: 'query-snippets', ...selection, page: 0, pageSize: 20 });
  assert.equal(first.total, 23);
  assert.equal(first.items.length, 20);
  assert.equal(first.pageCount, 2);
  assert.ok(first.items.every(item => item.preview.length <= MAX_SNIPPET_PREVIEW_CHARACTERS && item.shortened && item.language === 'typescript'));
  assert.ok(first.items.every(item => !('text' in item) && !('content' in item) && !('start' in item)));
  const last = await engine.handle({ id: next(), type: 'query-snippets', ...selection, page: 10, pageSize: 20 });
  assert.equal(last.page, 1);
  assert.equal(last.items.length, 3);
  assert.equal(last.items[2]!.id, 'message-23-code-1');
});

test('snippet copy and downloads retain complete cleaned code with safe filenames', async () => {
  const engine = new WorkerEngine();
  const secret = 'private-snippet-project-628';
  const code = `const project = "${secret}";\n` + '// complete retained source\n'.repeat(400);
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'assistant', content: `\`\`\`ts filename=../../private.exe\n${code}\`\`\`` }] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, customSecrets: [secret] });
  const selection = { archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision };
  const copied = await engine.handle({ id: next(), type: 'copy-snippet', ...selection, snippetId: 'message-1-code-1' });
  assert.equal(copied.text, code.replace(secret, '[CUSTOM_1]'));
  assert.ok(copied.text.length > MAX_SNIPPET_PREVIEW_CHARACTERS);
  const exported = await engine.handle({ id: next(), type: 'export-snippet', ...selection, snippetId: 'message-1-code-1' });
  assert.equal(textOf(exported.buffer), copied.text);
  assert.equal(exported.filename, 'threadpack-code-1-1.ts');
  assert.equal(exported.mimeType, 'text/plain;charset=utf-8');
  assert.doesNotMatch(exported.filename, /private|exe|\.\./);
});

test('snippet previews do not split a Unicode surrogate pair at their length boundary', async () => {
  const engine = new WorkerEngine();
  const code = 'x'.repeat(MAX_SNIPPET_PREVIEW_CHARACTERS - 1) + '🔎tail\n';
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'assistant', content: `\`\`\`text\n${code}\`\`\`` }] }));
  const summary = await clean(engine, archive);
  const result = await engine.handle({ id: next(), type: 'query-snippets', archiveId: archive.archiveId,
    conversationId: summary.conversation.id, revision: summary.revision, page: 0, pageSize: 20 });
  assert.equal(result.items[0]!.preview, 'x'.repeat(MAX_SNIPPET_PREVIEW_CHARACTERS - 1));
  assert.equal(result.items[0]!.shortened, true);
  assert.equal(result.items[0]!.characters, code.length);
});

test('snippet references reject stale revisions and missing or invalid IDs without reflecting input', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'assistant', content: '```python\nprint("ok")\n```' }] }));
  const summary = await clean(engine, archive);
  const selection = { archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision };
  await assert.rejects(engine.handle({ id: next(), type: 'query-snippets', ...selection, page: -1, pageSize: 20 }), /page number/);
  await assert.rejects(engine.handle({ id: next(), type: 'copy-snippet', ...selection, snippetId: 'message-1-code-10' }), /unavailable/);
  await assert.rejects(engine.handle({ id: next(), type: 'export-snippet', ...selection, snippetId: '../../private-entry' }), error => error instanceof Error && !error.message.includes('private-entry'));
  await clean(engine, archive, { ...DEFAULT_OPTIONS, redactEmails: true });
  await assert.rejects(engine.handle({ id: next(), type: 'query-snippets', ...selection, page: 0, pageSize: 20 }), /out of date/);
  await assert.rejects(engine.handle({ id: next(), type: 'copy-snippet', ...selection, snippetId: 'message-1-code-1' }), /out of date/);
  await assert.rejects(engine.handle({ id: next(), type: 'export-snippet', ...selection, snippetId: 'message-1-code-1' }), /out of date/);
});

test('original searches the complete body and sends a bounded excerpt around a deep match', async () => {
  const engine = new WorkerEngine();
  const needle = 'DEEP_MATCH_中部_🔎';
  const body = 'front '.repeat(6000) + needle + ' tail'.repeat(6000);
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: body }] }));
  const summary = await clean(engine, archive);
  const page = await preview(engine, archive, summary, { mode: 'original', query: needle });
  assert.equal(page.total, 1);
  assert.ok(page.items[0]!.message.content.includes(needle));
  assert.ok(page.items[0]!.message.content.length <= MAX_PREVIEW_CHARACTERS);
  assert.equal(page.items[0]!.bytes, new TextEncoder().encode(body).byteLength);
  assert.equal(page.items[0]!.shortened, true);
  const emptyQuery = await preview(engine, archive, summary, { mode: 'original' });
  assert.ok(emptyQuery.items[0]!.message.content.startsWith('front'));
  assert.ok(emptyQuery.items[0]!.message.content.endsWith(' tail'));
  assert.match(emptyQuery.items[0]!.message.content, /Preview shortened/);
});

test('pagination and role/changed filters query the whole corpus, including system messages', async () => {
  const engine = new WorkerEngine();
  const messages = Array.from({ length: 5003 }, (_, index) => ({ role: index % 5 === 0 ? 'system' : index % 2 ? 'user' : 'assistant', content: `Message ${index} search.literal[${index}]` }));
  messages[123] = { role: 'user', content: 'password=synthetic-placeholder-value' };
  const archive = await load(engine, JSON.stringify({ messages }));
  const summary = await clean(engine, archive);
  const first = await preview(engine, archive, summary);
  assert.equal(first.total, 5003);
  assert.equal(first.items.length, 30);
  assert.equal(first.pageCount, 167);
  const last = await preview(engine, archive, summary, { page: 1000 });
  assert.equal(last.page, 166);
  assert.equal(last.items.length, 23);
  assert.equal(last.items.at(-1)!.index, 5002);
  const systems = await preview(engine, archive, summary, { role: 'system' });
  assert.equal(systems.total, 1001);
  assert.ok(systems.items.every(item => item.message.role === 'system'));
  const changes = await preview(engine, archive, summary, { changedOnly: true });
  assert.equal(changes.total, 1);
  assert.equal(changes.items[0]!.index, 123);
  assert.equal(changes.items[0]!.changes[0]!.kind, 'secret');
  const literal = await preview(engine, archive, summary, { query: 'search.literal[5002]' });
  assert.equal(literal.total, 1);
  assert.equal(literal.items[0]!.index, 5002);
});

test('pinned-only filtering combines with existing filters and validates supplied pin IDs', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [
    { role: 'user', content: 'first pinned' }, { role: 'assistant', content: 'second pinned' }, { role: 'user', content: 'not pinned' },
  ] }));
  const summary = await clean(engine, archive);
  const pinned = ['message-1', 'message-2'];
  const filtered = await preview(engine, archive, summary, { pinnedOnly: true, pinnedIds: pinned });
  assert.equal(filtered.total, 2);
  assert.deepEqual(filtered.items.map(item => item.index), [0, 1]);
  const role = await preview(engine, archive, summary, { pinnedOnly: true, pinnedIds: pinned, role: 'assistant' });
  assert.equal(role.total, 1);
  assert.equal(role.items[0]!.index, 1);
  const none = await preview(engine, archive, summary, { pinnedOnly: true, pinnedIds: ['missing-id'] });
  assert.equal(none.total, 0);
  await assert.rejects(preview(engine, archive, summary, { pinnedOnly: true, pinnedIds: [42 as unknown as string] }), /filters/);
  await assert.rejects(preview(engine, archive, summary, { pinnedOnly: true, pinnedIds: ['one', 'two', 'three', 'four'] }), /filters/);
});

test('filtered excerpt export includes every match across pages and preserves complete cleaned bodies', async () => {
  const engine = new WorkerEngine();
  const longBody = 'Selected result 0: ' + 'complete content '.repeat(2000);
  const messages = Array.from({ length: 95 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: index ? `Selected result ${index}` : longBody }));
  const archive = await load(engine, JSON.stringify({ messages }));
  const summary = await clean(engine, archive);
  const filters = { role: 'user' as const, query: 'selected result' };
  const firstPage = await preview(engine, archive, summary, filters);
  assert.equal(firstPage.items.length, 30);
  assert.equal(firstPage.total, 48);
  const exported = await exportExcerpt(engine, archive, summary, filters);
  const lines = textOf(exported.buffer).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(exported.messageCount, 48);
  assert.equal(lines.length, 48);
  assert.equal(lines[0].content, longBody);
  assert.equal(lines.at(-1).content, 'Selected result 94');
  assert.equal(exported.filename, 'threadpack-excerpt.jsonl');
  const markdown = await exportExcerpt(engine, archive, summary, { ...filters, format: 'markdown' });
  assert.equal(markdown.filename, 'threadpack-excerpt.md');
  assert.ok(textOf(markdown.buffer).startsWith('# Filtered excerpt\n'));
  assert.match(textOf(markdown.buffer), /48 matching messages/);
  assert.match(textOf(markdown.buffer), /Selected result 94/);
  assert.doesNotMatch(textOf(markdown.buffer), /Selected result 93/);
});

test('filtered excerpts share role, pin, search, and changed-only matching with preview', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [
    { role: 'user', content: 'MATCH_PRIVATE password=synthetic-sensitive-fixture-001' },
    { role: 'assistant', content: 'MATCH_PRIVATE password=synthetic-sensitive-fixture-002' },
    { role: 'user', content: 'OTHER password=synthetic-sensitive-fixture-003' },
    { role: 'user', content: 'MATCH_PRIVATE unchanged public content' },
    { role: 'user', content: 'MATCH_PRIVATE password=synthetic-sensitive-fixture-005' },
  ] }));
  const summary = await clean(engine, archive);
  const filters = { mode: 'original' as const, role: 'user' as const, query: 'match_private', changedOnly: true, pinnedOnly: true, pinnedIds: ['message-1', 'message-2', 'message-3', 'message-4'] };
  const page = await preview(engine, archive, summary, filters);
  const exported = await exportExcerpt(engine, archive, summary, filters);
  const lines = textOf(exported.buffer).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(page.total, 1);
  assert.equal(exported.messageCount, page.total);
  assert.deepEqual(lines.map(message => message.id), page.items.map(item => item.message.id));
  assert.match(lines[0].content, /\[SECRET_1\]/);
  assert.doesNotMatch(textOf(exported.buffer), /synthetic-sensitive-fixture/);
});

test('original-view excerpt searches may match removed text but always export cleaned bodies and metadata', async () => {
  const engine = new WorkerEngine();
  const privateValue = 'private-original-search-value-839';
  const archive = await load(engine, JSON.stringify({ title: privateValue, source: privateValue, messages: [
    { role: 'user', content: `Keep this context but hide ${privateValue}.` },
    { role: 'assistant', content: 'Other public context.' },
  ] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, customSecrets: [privateValue] });
  const exported = await exportExcerpt(engine, archive, summary, { mode: 'original', query: privateValue, format: 'markdown' });
  const text = textOf(exported.buffer);
  assert.equal(exported.messageCount, 1);
  assert.match(text, /Keep this context but hide \[CUSTOM_1\]/);
  assert.doesNotMatch(text, new RegExp(privateValue));
  assert.doesNotMatch(text, /Other public context/);
  await assert.rejects(exportExcerpt(engine, archive, summary, { mode: 'cleaned', query: privateValue }), error => error instanceof Error && /No messages match/.test(error.message) && !error.message.includes(privateValue));
});

test('filtered excerpt exports reject stale, empty, or invalid requests without echoing filter text', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: 'Keep this result.' }] }));
  const summary = await clean(engine, archive);
  const sensitiveQuery = 'absent-private-search-string';
  await assert.rejects(exportExcerpt(engine, archive, summary, { query: sensitiveQuery }), error => error instanceof Error && /No messages match/.test(error.message) && !error.message.includes(sensitiveQuery));
  await assert.rejects(exportExcerpt(engine, archive, summary, { pinnedIds: [42 as unknown as string] }), /filters/);
  await assert.rejects(exportExcerpt(engine, archive, summary, { query: 'x'.repeat(1001) }), /filters/);
  await assert.rejects(exportExcerpt(engine, archive, summary, { format: 'report' as ExportExcerptRequest['format'] }), /supported excerpt format/);
  await clean(engine, archive, { ...DEFAULT_OPTIONS, redactEmails: true });
  await assert.rejects(exportExcerpt(engine, archive, summary), /out of date/);
});

test('filtered excerpt filenames distinguish archive conversations without exposing titles', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify([
    { title: 'private-first-title', messages: [{ role: 'user', content: 'First result' }] },
    { title: 'private-second-title', messages: [{ role: 'user', content: 'Second result' }] },
  ]));
  const first = await clean(engine, archive, DEFAULT_OPTIONS, 0);
  const second = await clean(engine, archive, DEFAULT_OPTIONS, 1);
  assert.equal((await exportExcerpt(engine, archive, first, { format: 'markdown' })).filename, 'threadpack-excerpt-1.md');
  assert.equal((await exportExcerpt(engine, archive, second)).filename, 'threadpack-excerpt-2.jsonl');
});

test('copy-message returns the complete body in the requested mode and rejects stale or unknown references', async () => {
  const engine = new WorkerEngine();
  const originalBody = 'password=synthetic-placeholder-value ' + 'complete '.repeat(3000);
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: originalBody }] }));
  const summary = await clean(engine, archive);
  const request = { archiveId: archive.archiveId, conversationId: summary.conversation.id, revision: summary.revision, messageId: 'message-1' };
  const original = await engine.handle({ id: next(), type: 'copy-message', ...request, mode: 'original' });
  assert.equal(original.text, originalBody);
  assert.ok(original.text.length > MAX_PREVIEW_CHARACTERS);
  const cleaned = await engine.handle({ id: next(), type: 'copy-message', ...request, mode: 'cleaned' });
  assert.ok(cleaned.text.length > MAX_PREVIEW_CHARACTERS);
  assert.doesNotMatch(cleaned.text, /synthetic-placeholder-value/);
  assert.match(cleaned.text, /complete /);
  await assert.rejects(engine.handle({ id: next(), type: 'copy-message', ...request, revision: summary.revision + 1, mode: 'original' }), /out of date/);
  await assert.rejects(engine.handle({ id: next(), type: 'copy-message', ...request, messageId: 'unknown', mode: 'cleaned' }), /unavailable/);
});

test('compare-message returns bounded excerpts and cleanup change metadata', async () => {
  const engine = new WorkerEngine();
  const privateValue = 'synthetic-compare-secret-581';
  const body = `password=${privateValue}\n${'TRACE_LINE '.repeat(8000)}`;
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'tool', content: body }] }));
  const summary = await clean(engine, archive);
  const request = { id: next(), type: 'compare-message' as const, archiveId: archive.archiveId,
    conversationId: summary.conversation.id, revision: summary.revision, messageId: 'message-1' };
  const result = await engine.handle(request);
  assert.equal(result.original.shortened, true);
  assert.ok(result.original.text.length <= MAX_PREVIEW_CHARACTERS);
  assert.ok(result.cleaned.text.length <= MAX_PREVIEW_CHARACTERS);
  assert.ok(result.original.text.startsWith(`password=${privateValue}`));
  assert.ok(result.cleaned.text.startsWith('password=[SECRET_1]'));
  assert.equal(result.cleaned.shortened, false);
  assert.deepEqual(result.changes.map(change => change.kind), ['secret', 'tool']);
  assert.ok(!JSON.stringify(result.changes).includes(privateValue));
});

test('compare-message hides embedded image payloads and preserves nearby text in both excerpts', async () => {
  const engine = new WorkerEngine();
  const payload = 'QUJD'.repeat(20000);
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: `before\ndata:image/png;base64,${payload}\nafter` }] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, stripImages: false });
  const result = await engine.handle({ id: next(), type: 'compare-message', archiveId: archive.archiveId,
    conversationId: summary.conversation.id, revision: summary.revision, messageId: 'message-1' });
  for (const side of [result.original, result.cleaned]) {
    assert.equal(side.imageHidden, true);
    assert.doesNotMatch(side.text, /QUJD/);
    assert.match(side.text, /Embedded image payload · hidden in preview/);
    assert.match(side.text, /before/);
    assert.match(side.text, /after/);
  }
});

test('compare-message rejects stale revisions and unknown messages', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: 'Before and after.' }] }));
  const first = await clean(engine, archive);
  const request = { id: next(), type: 'compare-message' as const, archiveId: archive.archiveId,
    conversationId: first.conversation.id, revision: first.revision, messageId: 'message-1' };
  await clean(engine, archive, { ...DEFAULT_OPTIONS, redactEmails: true });
  await assert.rejects(engine.handle({ ...request, id: next() }), /out of date/);
  await assert.rejects(engine.handle({ ...request, id: next(), revision: (await clean(engine, archive, { ...DEFAULT_OPTIONS, redactEmails: true })).revision, messageId: 'unknown' }), /unavailable/);
});

test('inline image data stays hidden in either preview mode without swallowing following text', async () => {
  const engine = new WorkerEngine();
  const image = 'data:image/png;base64,' + 'QUJD'.repeat(10000);
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: image + '\nFollowing text survives.' }] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, stripImages: false });
  for (const mode of ['original', 'cleaned'] as const) {
    const page = await preview(engine, archive, summary, { mode });
    assert.doesNotMatch(page.items[0]!.message.content, /QUJD/);
    assert.match(page.items[0]!.message.content, /hidden in preview/);
    assert.match(page.items[0]!.message.content, /Following text survives/);
    assert.equal(page.items[0]!.shortened, true);
  }
});

test('revisions prevent a stale preview, export or handoff from using newer cleanup settings', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: 'password=synthetic-placeholder-value' }] }));
  const first = await clean(engine, archive);
  const cached = await clean(engine, archive, { ...DEFAULT_OPTIONS });
  assert.equal(first.revision, cached.revision);
  const changed = await clean(engine, archive, { ...DEFAULT_OPTIONS, redact: false });
  assert.notEqual(changed.revision, first.revision);
  await assert.rejects(preview(engine, archive, first), /out of date/);
  await assert.rejects(engine.handle({ id: next(), type: 'export', archiveId: 1, conversationId: first.conversation.id, revision: first.revision, format: 'markdown' }), /out of date/);
  await assert.rejects(engine.handle({ id: next(), type: 'handoff', archiveId: 1, conversationId: first.conversation.id, revision: first.revision,
    notes: { goal: '', decisions: '', constraints: '', nextSteps: '' }, pinnedIds: [], recentCount: 1, maxCharacters: 6000 }), /out of date/);
  const latest = await preview(engine, archive, changed);
  assert.match(latest.items[0]!.message.content, /synthetic-placeholder-value/);
});

test('exports transfer complete cleaned UTF-8 data and reports contain only allowlisted metadata', async () => {
  const engine = new WorkerEngine();
  const custom = 'internal-customer-record';
  const fakeToken = ['ghp', 'Z'.repeat(36)].join('_');
  const body = '完整文本🌍 '.repeat(4000) + `${custom} ${fakeToken}`;
  const archive = await load(engine, JSON.stringify({ title: custom, source: fakeToken, messages: [{ role: 'user', content: body }] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, customSecrets: [custom] });
  const request = { archiveId: 1, conversationId: summary.conversation.id, revision: summary.revision };
  const jsonl = await engine.handle({ id: next(), type: 'export', ...request, format: 'jsonl' });
  const decoded = JSON.parse(textOf(jsonl.buffer).trim()) as { content: string };
  assert.ok(decoded.content.startsWith('完整文本🌍 '.repeat(4000)));
  assert.ok(!decoded.content.includes(custom));
  assert.ok(!decoded.content.includes(fakeToken));
  assert.match(decoded.content, /CUSTOM_1/);
  const transferred = structuredClone(jsonl, { transfer: [jsonl.buffer] });
  assert.equal(jsonl.buffer.byteLength, 0);
  assert.ok(transferred.buffer.byteLength > MAX_PREVIEW_CHARACTERS);
  const report = await engine.handle({ id: next(), type: 'export', ...request, format: 'report' });
  const reportText = textOf(report.buffer);
  assert.ok(!reportText.includes(custom));
  assert.ok(!reportText.includes(fakeToken));
  assert.ok(!reportText.includes('完整文本'));
  assert.ok(!reportText.includes('customSecrets'));
  const parsed = JSON.parse(reportText) as { options: Record<string, unknown>; format: string };
  assert.equal(parsed.options.customRuleCount, 1);
  assert.equal(parsed.format, 'Messages JSON export');
  const markdown = await engine.handle({ id: next(), type: 'export', ...request, format: 'markdown' });
  assert.equal(markdown.filename, 'threadpack-transcript.md');
  assert.ok(!textOf(markdown.buffer).includes(fakeToken));
});

test('exports distinguish conversations by ordinal without including source titles in filenames', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify([
    { id: 'one', title: 'sensitive/source/path', messages: [{ role: 'user', content: 'First' }] },
    { id: 'two', title: 'private conversation name', messages: [{ role: 'user', content: 'Second' }] },
  ]));
  const first = await clean(engine, archive, DEFAULT_OPTIONS, 0);
  const second = await clean(engine, archive, DEFAULT_OPTIONS, 1);
  const firstExport = await engine.handle({ id: next(), type: 'export', archiveId: 1, conversationId: first.conversation.id, revision: first.revision, format: 'markdown' });
  const secondExport = await engine.handle({ id: next(), type: 'export', archiveId: 1, conversationId: second.conversation.id, revision: second.revision, format: 'markdown' });
  assert.equal(firstExport.filename, 'threadpack-transcript-1.md');
  assert.equal(secondExport.filename, 'threadpack-transcript-2.md');
  assert.doesNotMatch(secondExport.filename, /private|conversation|two|source|path/i);
  const jsonl = await engine.handle({ id: next(), type: 'export', archiveId: 1, conversationId: second.conversation.id, revision: second.revision, format: 'jsonl' });
  const report = await engine.handle({ id: next(), type: 'export', archiveId: 1, conversationId: second.conversation.id, revision: second.revision, format: 'report' });
  assert.equal(jsonl.filename, 'threadpack-transcript-2.jsonl');
  assert.equal(report.filename, 'threadpack-report-2.json');
});

test('handoff cleans notes with separate aliases and retains pinned full text from the worker', async () => {
  const engine = new WorkerEngine();
  const custom = 'internal-project-label';
  const fakeToken = ['sk', 'proj', 'J'.repeat(35)].join('-');
  const email = ['private-note', 'example.test'].join('@');
  const archive = await load(engine, JSON.stringify({ messages: [{ role: 'user', content: 'Pinned context ' + 'important '.repeat(1800) }, { role: 'assistant', content: 'Newest progress' }] }));
  const summary = await clean(engine, archive, { ...DEFAULT_OPTIONS, redactEmails: true, customSecrets: [custom] });
  const handoff = await engine.handle({ id: next(), type: 'handoff', archiveId: 1, conversationId: summary.conversation.id, revision: summary.revision,
    notes: { goal: `${custom} ${fakeToken}`, decisions: 'Already decided', constraints: email, nextSteps: 'Continue' }, pinnedIds: ['message-1'], recentCount: 1, maxCharacters: 24000 });
  assert.ok(handoff.text.includes('important '.repeat(1800)));
  assert.match(handoff.text, /Newest progress/);
  assert.ok(!handoff.text.includes(custom));
  assert.ok(!handoff.text.includes(fakeToken));
  assert.ok(!handoff.text.includes(email));
  for (const marker of ['[NOTE_CUSTOM_1]', '[NOTE_SECRET_1]', '[NOTE_EMAIL_1]']) assert.ok(handoff.text.includes(marker));
});

test('File Web Streams preserve split UTF-8 characters and report original byte progress', async () => {
  const engine = new WorkerEngine();
  const text = '\uFEFF用户🔒\nこんにちは';
  const bytes = new TextEncoder().encode(text);
  const file = { name: 'unicode.txt', size: bytes.byteLength, stream: () => new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }) } as File;
  const progress: ImportProgress[] = [];
  const archive = await engine.handle({ id: next(), type: 'parse', archiveId: 1, keepArchiveId: null, file }, value => progress.push(value));
  assert.equal(archive.sourceBytes, bytes.byteLength);
  assert.equal(progress[0]!.loaded, 0);
  assert.equal(progress.at(-1)!.loaded, bytes.byteLength);
  assert.equal(progress.at(-1)!.total, bytes.byteLength);
  assert.ok(progress.every((value, index) => index === 0 || value.loaded >= progress[index - 1]!.loaded));
  const summary = await clean(engine, archive);
  const page = await preview(engine, archive, summary);
  assert.equal(page.items[0]!.message.content, text.replace(/^\uFEFF/, ''));
  assert.ok(!page.items[0]!.message.content.includes('\uFFFD'));
});

test('newer streaming imports cannot be overwritten by late old imports', async () => {
  const engine = new WorkerEngine();
  const accepted = await load(engine, 'Accepted original', 1, 'accepted.txt');
  const oldSummary = await clean(engine, accepted);
  const slow = deferredFile();
  const pending = engine.handle({ id: next(), type: 'parse', archiveId: 2, keepArchiveId: 1, file: slow.file });
  const rejected = assert.rejects(pending, /cancelled or replaced/);
  const newest = await load(engine, 'Latest candidate', 3, 'latest.txt', 1);
  slow.controller.enqueue(new TextEncoder().encode('Late old import'));
  slow.controller.close();
  await rejected;
  assert.equal((await preview(engine, accepted, oldSummary)).items[0]!.message.content, 'Accepted original');
  const newestSummary = await clean(engine, newest);
  assert.equal((await preview(engine, newest, newestSummary)).items[0]!.message.content, 'Latest candidate');
  await assert.rejects(engine.handle({ id: next(), type: 'clean', archiveId: 2, conversationId: 'conversation-1', options: DEFAULT_OPTIONS }), /unavailable/);
});

test('unaccepted candidates and invalid imports cannot replace the active conversation', async () => {
  const engine = new WorkerEngine();
  const accepted = await load(engine, 'Original accepted', 1, 'a.txt');
  const summary = await clean(engine, accepted);
  await load(engine, 'Unaccepted candidate', 2, 'b.txt', 1);
  await assert.rejects(load(engine, '{broken', 3, 'invalid.json', 1), /Invalid JSON/);
  assert.equal((await preview(engine, accepted, summary)).items[0]!.message.content, 'Original accepted');
  await load(engine, 'Replacement candidate', 4, 'c.txt', 1);
  await assert.rejects(engine.handle({ id: next(), type: 'clean', archiveId: 2, conversationId: 'conversation-1', options: DEFAULT_OPTIONS }), /unavailable/);
  assert.equal((await preview(engine, accepted, summary)).items[0]!.message.content, 'Original accepted');
});

test('an explicit accepted archive survives replacement even if an older queued clean runs last', async () => {
  const engine = new WorkerEngine();
  const first = await load(engine, 'Earlier archive', 1, 'first.txt');
  const firstSummary = await clean(engine, first);
  const second = await load(engine, 'Currently accepted archive', 2, 'second.txt', 1);
  const secondSummary = await clean(engine, second);
  await clean(engine, first);
  await load(engine, 'New candidate', 3, 'third.txt', 2);
  assert.equal((await preview(engine, second, secondSummary)).items[0]!.message.content, 'Currently accepted archive');
  await assert.rejects(preview(engine, first, firstSummary), /unavailable/);
});

test('clear invalidates cached data and pending streams, even when archive IDs are reused later', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, 'Old data', 1, 'old.txt');
  const summary = await clean(engine, archive);
  const slow = deferredFile();
  const pending = engine.handle({ id: next(), type: 'parse', archiveId: 2, keepArchiveId: 1, file: slow.file });
  const rejected = assert.rejects(pending, /cancelled or replaced/);
  await engine.handle({ id: next(), type: 'clear' });
  slow.controller.enqueue(new TextEncoder().encode('Cancelled stream'));
  slow.controller.close();
  await rejected;
  await assert.rejects(preview(engine, archive, summary), /unavailable/);
  const replacement = await load(engine, 'New data', 1, 'new.txt');
  const latest = await clean(engine, replacement);
  assert.notEqual(latest.revision, summary.revision);
  await assert.rejects(preview(engine, replacement, summary), /out of date/);
});

test('conversation caches isolate revisions and immutable option snapshots', async () => {
  const engine = new WorkerEngine();
  const archive = await load(engine, JSON.stringify([{ id: 'a', messages: [{ role: 'user', content: 'tenant-private' }] }, { id: 'b', messages: [{ role: 'user', content: 'Other conversation' }] }]));
  const options = { ...DEFAULT_OPTIONS, redact: false, customSecrets: ['tenant-private'] };
  const first = await clean(engine, archive, options, 0);
  options.customSecrets[0] = 'different-value';
  const second = await clean(engine, archive, DEFAULT_OPTIONS, 1);
  assert.notEqual(first.revision, second.revision);
  assert.equal((await preview(engine, archive, first)).items[0]!.message.content, '[CUSTOM_1]');
  assert.equal((await preview(engine, archive, second)).items[0]!.message.content, 'Other conversation');
  await assert.rejects(preview(engine, archive, second, { revision: first.revision }), /out of date/);
});

test('oversized files are rejected before streaming and unreadable files return content-free errors', async () => {
  const engine = new WorkerEngine();
  let opened = false;
  const oversized = { name: 'private-path', size: MAX_IMPORT_BYTES + 1, stream: () => { opened = true; throw new Error('must not read'); } } as unknown as File;
  await assert.rejects(engine.handle({ id: next(), type: 'parse', archiveId: 1, keepArchiveId: null, file: oversized }), /100 MiB/);
  assert.equal(opened, false);
  const secret = 'sensitive-error-detail';
  const unreadable = { name: 'private-file', size: 1, stream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(secret)); } }) } as File;
  await assert.rejects(engine.handle({ id: next(), type: 'parse', archiveId: 2, keepArchiveId: null, file: unreadable }), (error: unknown) => error instanceof Error && error.message.includes('could not be read') && !error.message.includes(secret));
  const unavailableStream = { name: 'private-file', size: 1, stream: () => { throw new Error(secret); } } as unknown as File;
  await assert.rejects(engine.handle({ id: next(), type: 'parse', archiveId: 3, keepArchiveId: null, file: unavailableStream }), (error: unknown) => error instanceof Error && error.message.includes('could not be read') && !error.message.includes(secret));
});
