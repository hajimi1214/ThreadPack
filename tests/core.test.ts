import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHandoff, buildHandoffWithSummary, buildJsonl, buildTranscript, cleanConversation, DEFAULT_OPTIONS, parseInput } from '../src/core/index';
import type { Conversation } from '../src/core/types';

const conversation = (content: string, role: 'user' | 'assistant' | 'tool' = 'user'): Conversation => ({
  id: 'test', title: 'A test conversation', source: 'test', messages: [{ id: 'm1', role, content }],
});
const jsonl = (...records: unknown[]): string => records.map((value) => JSON.stringify(value)).join('\n');

test('Codex JSONL imports response records once, converts images and preserves tool call arguments', () => {
  const result = parseInput(jsonl(
    { type: 'session_meta', payload: { id: 'session-1' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the parser.' }, { type: 'input_image', image_url: 'data:image/png;base64,' + 'QUJD'.repeat(1000) }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the parser.' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'shell-call', name: 'shell', arguments: '{"cmd":"npm test"}' } },
    { type: 'response_item', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'function_call_output', call_id: 'shell-call', output: 'All tests passed.' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } },
  ), 'rollout.jsonl');
  assert.equal(result.format, 'Codex JSONL');
  assert.equal(result.conversations[0]!.messages.length, 4);
  assert.equal(result.conversations[0]!.messages[1]!.kind, 'tool-call');
  assert.equal(result.conversations[0]!.messages[1]!.toolCallId, result.conversations[0]!.messages[2]!.toolCallId);
  assert.equal(result.conversations[0]!.messages[0]!.provenance?.platform, 'codex');
  assert.equal(result.conversations[0]!.messages[2]!.role, 'tool');
  assert.match(result.conversations[0]!.messages[1]!.content, /npm test/);
  const cleaned = cleanConversation(result.conversations[0]!, DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.imagesRemoved, 1);
  assert.doesNotMatch(cleaned.conversation.messages[0]!.content, /QUJD/);
  assert.match(cleaned.conversation.messages[0]!.content, /Fix the parser/);
});

test('Codex reasoning records and non-message events retain distinct timeline meaning', () => {
  const archive = parseInput(jsonl(
    { type: 'session_meta', payload: { id: 'session-fixture' } },
    { type: 'response_item', timestamp: '2026-02-03T04:05:06Z', payload: { id: 'reasoning-1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Compare the two implementations.' }] } },
    { type: 'event_msg', payload: { type: 'turn_started' } },
    { type: 'response_item', payload: { id: 'answer-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The second implementation is correct.' }] } },
  ), 'rollout.jsonl');
  const conversation = archive.conversations[0]!;
  assert.deepEqual(conversation.messages.map(message => message.kind), ['reasoning', 'message']);
  assert.equal(conversation.messages[0]!.timestamp, '2026-02-03T04:05:06.000Z');
  assert.equal(conversation.messages[0]!.provenance?.platformId, 'reasoning-1');
  assert.equal(conversation.events?.length, 2);
  assert.equal(archive.integrity?.timelineEventCount, 2);
});

test('Claude Code tool_result is a tool output even inside a user envelope', () => {
  const result = parseInput(jsonl(
    { type: 'user', uuid: 'user-1', message: { role: 'user', content: 'Run tests.' } },
    { type: 'assistant', uuid: 'assistant-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', uuid: 'tool-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'x'.repeat(15000) + '\nERROR: final failure' }] } },
  ), 'session.jsonl');
  assert.equal(result.format, 'Claude Code JSONL');
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.role), ['user', 'assistant', 'assistant', 'tool']);
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.kind), ['message', 'message', 'tool-call', 'tool-result']);
  assert.equal(result.conversations[0]!.messages[2]!.toolName, 'Bash');
  assert.equal(result.conversations[0]!.messages[2]!.toolCallId, result.conversations[0]!.messages[3]!.toolCallId);
  assert.equal(result.conversations[0]!.messages[0]!.provenance?.platformId, 'user-1');
  const cleaned = cleanConversation(result.conversations[0]!, { ...DEFAULT_OPTIONS, toolLimit: 500 });
  assert.equal(cleaned.stats.outputsTrimmed, 1);
  assert.ok(cleaned.conversation.messages[3]!.content.length <= 500);
  assert.match(cleaned.conversation.messages[3]!.content, /ERROR: final failure/);
  assert.match(cleaned.conversation.messages[3]!.content, /characters omitted/);
});

test('ChatGPT follows only the active branch in parent order', () => {
  const result = parseInput(JSON.stringify([{ id: 'chat', title: 'Branch test', current_node: 'b', mapping: {
    root: { parent: null, message: { id: 'm0', author: { role: 'system' }, content: { parts: ['System prompt'] } } },
    a: { parent: 'root', message: { id: 'm1', author: { role: 'user' }, content: { parts: ['Question'] } } },
    abandoned: { parent: 'a', message: { id: 'wrong', author: { role: 'assistant' }, content: { parts: ['Abandoned branch'] } } },
    middle: { parent: 'a', message: null },
    b: { parent: 'middle', message: { id: 'm2', author: { role: 'assistant' }, content: { parts: ['Active answer'] } } },
  } }]), 'conversations.json');
  assert.equal(result.conversations.length, 1);
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.id), ['message-1', 'message-2', 'message-3']);
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.content), ['System prompt', 'Question', 'Active answer']);
  assert.deepEqual(result.conversations[0]!.history?.messages.map(message => message.content), ['System prompt', 'Question', 'Active answer', 'Abandoned branch']);
  assert.equal(result.conversations[0]!.history?.branches.length, 2);
  assert.equal(result.conversations[0]!.history?.activeBranchId, 'branch-2');
  assert.equal(result.conversations[0]!.history?.branches[0]!.headMessageId, 'message-4');
  assert.equal(result.conversations[0]!.history?.branches[1]!.headMessageId, 'message-3');
  assert.deepEqual(result.conversations[0]!.history?.branches[1]!.sourceNodeIds, ['root', 'a', 'middle', 'b']);
  assert.equal(result.conversations[0]!.history?.messages[3]!.parentId, 'message-2');
  assert.equal(result.conversations[0]!.history?.messages[2]!.parentId, 'message-2');
  assert.equal(result.integrity?.status, 'complete');
  assert.doesNotMatch(buildTranscript(result.conversations[0]!), /Abandoned/);
});

test('generic OpenAI tool calls retain arguments and pair with their result', () => {
  const result = parseInput(jsonl(
    { id: 'assistant-turn', role: 'assistant', content: 'Checking the repository.', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/App.tsx"}' } },
    ], timestamp: '2026-01-02T03:04:05+02:00' },
    { id: 'tool-result-1', role: 'tool', tool_call_id: 'call-1', content: 'File content follows.' },
  ), 'openai.jsonl');
  const messages = result.conversations[0]!.messages;
  assert.deepEqual(messages.map(message => message.kind), ['message', 'tool-call', 'tool-result']);
  assert.equal(result.provenance?.platform, 'openai');
  assert.equal(messages[1]!.toolName, 'read_file');
  assert.match(messages[1]!.content, /\{"path":"src\/App.tsx"\}/);
  assert.equal(messages[1]!.toolCallId, messages[2]!.toolCallId);
  assert.equal(messages[0]!.timestamp, '2026-01-02T01:04:05.000Z');
  assert.equal(messages[0]!.provenance?.rawTimestamp, '2026-01-02T03:04:05+02:00');
  assert.equal(result.integrity?.issues.length, 0);
  const openAiJson = parseInput(JSON.stringify({ id: 'openai-session', messages: [
    { id: 'assistant-json', role: 'assistant', content: null, tool_calls: [{ id: 'json-call', function: { name: 'lookup', arguments: '{"query":"x"}' } }] },
    { id: 'tool-json', role: 'tool', tool_call_id: 'json-call', content: 'result' },
  ] }), 'openai.json');
  assert.equal(openAiJson.provenance?.platform, 'openai');
  assert.deepEqual(openAiJson.conversations[0]!.messages.map(message => message.kind), ['tool-call', 'tool-result']);
  assert.equal(openAiJson.conversations[0]!.provenance?.sourceId, 'openai-session');
  const repeatedResults = parseInput(jsonl(
    { role: 'assistant', content: null, tool_calls: [
      { id: 'call-a', function: { name: 'read', arguments: '{}' } },
      { id: 'call-b', function: { name: 'read', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'call-a', content: 'same result' },
    { role: 'tool', tool_call_id: 'call-b', content: 'same result' },
  ), 'tools.jsonl');
  const cleaned = cleanConversation(repeatedResults.conversations[0]!, DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.duplicatesRemoved, 0);
  assert.equal(cleaned.conversation.messages.filter(message => message.kind === 'tool-result').length, 2);
});

test('integrity checks report duplicate IDs, missing parents, cycles, and unmatched tool events', () => {
  const result = parseInput(jsonl(
    { id: 'duplicate-source', role: 'assistant', content: null, tool_calls: [{ id: 'call-known', function: { name: 'run', arguments: '{}' } }] },
    { id: 'duplicate-source', role: 'tool', tool_call_id: 'call-missing', content: 'orphan result' },
    { id: 'child', role: 'user', content: 'missing parent', parent_id: 'missing' },
    { id: 'cycle-a', role: 'assistant', content: 'A', parent_id: 'cycle-b' },
    { id: 'cycle-b', role: 'assistant', content: 'B', parent_id: 'cycle-a' },
  ), 'integrity.jsonl');
  assert.equal(result.integrity?.status, 'partial');
  assert.equal(result.integrity?.sourceRecordCount, 5);
  assert.deepEqual(new Set(result.integrity?.issues.map(issue => issue.code)), new Set([
    'duplicate-source-id', 'missing-parent', 'cyclic-parent', 'orphan-tool-result', 'unmatched-tool-call',
  ]));
  assert.ok(result.integrity!.issueCount >= 5);
});

test('malformed and unknown JSONL records are reported and unknown records remain in the timeline', () => {
  const result = parseInput(jsonl(
    { role: 'user', content: 'Known message.' },
    { type: 'future_provider_event', payload: { state: 'synthetic state' } },
  ) + '\n{broken', 'future.jsonl');
  assert.equal(result.integrity?.status, 'partial');
  assert.deepEqual(result.integrity?.issues.map(issue => issue.code).sort(), ['malformed-record', 'unknown-record']);
  assert.equal(result.conversations[0]!.events?.length, 1);
  assert.equal(result.conversations[0]!.events?.[0]!.type, 'future_provider_event');
  assert.match(result.conversations[0]!.events?.[0]!.content ?? '', /synthetic state/);
});

test('Codex session metadata and unknown records survive cleaned interchange exports', () => {
  const sessionId = ['ghp', 'R'.repeat(36)].join('_');
  const source = jsonl(
    { type: 'session_meta', payload: { id: sessionId } },
    { type: 'response_item', payload: { id: 'provider-message-1', type: 'message', role: 'user', content: 'Preserve this question.' } },
    { type: 'future_provider_event', payload: { status: 'synthetic event data' } },
  );
  const imported = parseInput(source, 'rollout.jsonl');
  assert.equal(imported.provenance?.platform, 'codex');
  assert.equal(imported.integrity?.status, 'partial');
  assert.equal(imported.conversations[0]!.events?.length, 2);
  assert.equal(imported.conversations[0]!.messages[0]!.provenance?.platformId, 'provider-message-1');
  const cleaned = cleanConversation(imported.conversations[0]!, DEFAULT_OPTIONS).conversation;
  const exported = buildJsonl(cleaned);
  assert.ok(!exported.includes(sessionId));
  const roundTrip = parseInput(exported, 'session-v2.jsonl');
  assert.equal(roundTrip.conversations[0]!.events?.length, 2);
  assert.equal(roundTrip.conversations[0]!.events?.[1]!.type, 'future_provider_event');
  assert.equal(roundTrip.conversations[0]!.provenance?.sourceId, '[SECRET_1]');
});

test('cleaned ThreadPack session JSONL round-trips branches and source provenance', () => {
  const providerSecret = ['ghp', 'T'.repeat(36)].join('_');
  const rootNode = providerSecret;
  const source = JSON.stringify({
    id: providerSecret,
    current_node: 'answer',
    mapping: {
      [rootNode]: { parent: null, message: { id: 'root-source', author: { role: 'user' }, content: { parts: ['Question with ' + providerSecret] } } },
      call: { parent: rootNode, message: { id: 'call-source', author: { role: 'assistant' }, content: { parts: [{ type: 'tool_use', id: 'tool-source', name: 'read', input: { file: 'README.md' } }] } } },
      tool: { parent: 'call', message: { id: 'tool-result-source', author: { role: 'tool' }, content: { parts: ['Read complete.'] } } },
      answer: { parent: 'tool', message: { id: 'answer-source', author: { role: 'assistant' }, content: { parts: ['Continue.'] } } },
      alternate: { parent: rootNode, message: { id: 'alternate-source', author: { role: 'assistant' }, content: { parts: ['Alternate branch.'] } } },
    },
  });
  const imported = parseInput(source, 'branches.json');
  const conversation = imported.conversations[0]!;
  const cleaned = cleanConversation(conversation, DEFAULT_OPTIONS).conversation;
  const exported = buildJsonl(cleaned);
  assert.doesNotMatch(exported, new RegExp(providerSecret));
  const roundTrip = parseInput(exported, 'threadpack-session.jsonl').conversations[0]!;
  assert.deepEqual(roundTrip.history?.branches, cleaned.history?.branches);
  assert.deepEqual(roundTrip.history?.messages.map(message => [message.role, message.kind, message.content, message.toolCallId]),
    cleaned.history?.messages.map(message => [message.role, message.kind, message.content, message.toolCallId]));
  assert.equal(roundTrip.provenance?.platform, 'chatgpt');
  assert.equal(roundTrip.provenance?.sourceId, '[SECRET_1]');
  assert.equal(roundTrip.history?.branches[0]?.sourceNodeIds?.[0], '[SECRET_1]');
});

test('malformed ChatGPT mapping entries remain reviewable timeline records', () => {
  const result = parseInput(JSON.stringify({ current_node: 'root', mapping: {
    malformed: null,
    root: { parent: null, message: { author: { role: 'user' }, content: { parts: ['Visible message.'] } } },
  } }), 'malformed-map.json');
  assert.equal(result.conversations[0]!.events?.length, 1);
  assert.equal(result.conversations[0]!.events?.[0]!.type, 'invalid-mapping-node');
  assert.ok(result.integrity?.issues.some(issue => issue.code === 'unknown-record'));
});

test('unrecognized conversation entries in a mixed archive are retained as timeline events', () => {
  const privateText = ['ghp', 'V'.repeat(36)].join('_');
  const result = parseInput(JSON.stringify([
    { id: 'known', messages: [{ role: 'user', content: 'Known conversation.' }] },
    { future_conversation_type: privateText, metadata: { tag: 'synthetic' } },
  ]), 'mixed-archive.json');
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0]!.events?.[0]!.type, 'unrecognized-conversation');
  assert.equal(result.integrity?.sourceRecordCount, 2);
  assert.ok(result.integrity?.issues.some(issue => issue.code === 'unknown-record'));
  const cleaned = cleanConversation(result.conversations[0]!, DEFAULT_OPTIONS).conversation;
  assert.doesNotMatch(buildJsonl(cleaned), new RegExp(privateText));
  assert.match(cleaned.events?.[0]!.content ?? '', /\[SECRET_1\]/);
});

test('ChatGPT image asset pointers are labeled without pretending to contain image bytes', () => {
  const result = parseInput(JSON.stringify({ current_node: 'a', mapping: {
    a: { parent: null, message: { id: 'u', author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
      'Look at this.', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://example-image', size_bytes: 50000 },
    ] } } },
  } }), 'images.json');
  const message = result.conversations[0]!.messages[0]!;
  assert.match(message.content, /Look at this/);
  assert.match(message.content, /Image attachment: file-service:\/\/example-image/);
  const cleaned = cleanConversation(result.conversations[0]!, DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.imagesRemoved, 0);
  assert.equal(cleaned.conversation.messages[0]!.content, message.content);
});

test('Claude exports support multiple conversations and human sender', () => {
  const result = parseInput(JSON.stringify([
    { uuid: 'c1', name: 'One', chat_messages: [{ uuid: 'm1', sender: 'human', text: 'Hello' }, { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: 'Hi' }] }] },
    { uuid: 'c2', name: 'Two', chat_messages: [{ sender: 'human', text: 'Another chat' }] },
  ]), 'claude.json');
  assert.equal(result.format, 'Claude export');
  assert.equal(result.conversations.length, 2);
  assert.equal(result.conversations[0]!.messages[0]!.role, 'user');
  assert.equal(result.conversations[0]!.messages[1]!.content, 'Hi');
});

test('Claude message UUIDs, parent links, and original timestamps remain traceable', () => {
  const imported = parseInput(JSON.stringify({ uuid: 'claude-chat', chat_messages: [
    { uuid: 'human-turn', sender: 'human', text: 'Question.', created_at: '2026-03-01T09:30:00-05:00' },
    { uuid: 'assistant-turn', parent_message_uuid: 'human-turn', sender: 'assistant', content: [{ type: 'text', text: 'Answer.' }] },
  ] }), 'claude.json');
  const [user, assistant] = imported.conversations[0]!.messages;
  assert.equal(imported.provenance?.platform, 'claude');
  assert.equal(user!.provenance?.platformId, 'human-turn');
  assert.equal(user!.timestamp, '2026-03-01T14:30:00.000Z');
  assert.equal(user!.provenance?.rawTimestamp, '2026-03-01T09:30:00-05:00');
  assert.equal(assistant!.parentId, user!.id);
});

test('canonical JSONL round-trips without losing content or Unicode', () => {
  const initial = conversation('用户代码\n```js\nconsole.log("你好 🌍")\n```');
  const exported = buildJsonl(initial);
  const imported = parseInput(exported, 'threadpack.jsonl');
  assert.equal(imported.conversations[0]!.messages[0]!.content, initial.messages[0]!.content);
  assert.equal(imported.sourceBytes, new TextEncoder().encode(exported).byteLength);
});

test('JSONL parsing accepts a known source byte length without re-encoding the text', () => {
  const text = JSON.stringify({ role: 'user', content: '你好' });
  const imported = parseInput(text, 'session.jsonl', 42);
  assert.equal(imported.sourceBytes, 42);
  assert.equal(imported.conversations[0]!.messages[0]!.content, '你好');
});

test('stdin text automatically recognizes JSONL and generic messages JSON', () => {
  const result = parseInput(jsonl({ role: 'user', content: 'One' }, { role: 'assistant', content: 'Two' }), 'stdin.txt');
  assert.equal(result.conversations[0]!.messages.length, 2);
  const duplicateIds = parseInput(jsonl(
    { id: 'provider-id', role: 'user', content: 'First record' },
    { id: 'provider-id', role: 'assistant', content: 'Second record' },
  ), 'stdin.txt');
  assert.deepEqual(duplicateIds.conversations[0]!.messages.map(message => message.id), ['message-1', 'message-2']);
  const json = parseInput(JSON.stringify({ messages: [{ role: 'developer', content: 'A constraint' }, { role: 'user', content: 'Go' }] }), 'stdin.txt');
  assert.equal(json.conversations[0]!.messages[0]!.role, 'system');
});

test('invalid JSON errors; partial JSONL explicitly reports dropped lines', () => {
  assert.throws(() => parseInput('{broken', 'export.json'), /Invalid JSON/);
  assert.throws(() => parseInput('not json', 'export.jsonl'), /No valid JSONL/);
  assert.throws(() => parseInput('  ', 'empty.txt'), /empty/);
  const result = parseInput('\r\n{broken\r\n' + JSON.stringify({ role: 'user', content: 'Recover me' }) + '\r\n\r\n' + JSON.stringify({ role: 'assistant', content: 'Keep order.' }), 'partial.jsonl');
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.content), ['Recover me', 'Keep order.']);
  assert.ok(result.warnings.some((warning) => warning.includes('1 invalid JSONL')));
});

test('unknown JSON schema is retained verbatim and reported', () => {
  const text = '{"unknown":{"nested":[1,2,3]}}';
  const result = parseInput(text, 'unknown.json');
  assert.equal(result.conversations[0]!.messages[0]!.content, text);
  assert.ok(result.warnings.some((warning) => warning.includes('Unknown JSON schema')));
});

test('known JSON schemas preserve unknown role content with content-free warnings', () => {
  const important = 'UNSUPPORTED_BUT_IMPORTANT';
  const variants = [
    { messages: [{ role: 'user', content: 'Keep me' }, { role: 'bot', content: important }] },
    { chat_messages: [{ sender: 'human', text: 'Keep me' }, { sender: 'bot', text: important }] },
    { current_node: 'b', mapping: {
      a: { parent: null, message: { author: { role: 'user' }, content: { parts: ['Keep me'] } } },
      b: { parent: 'a', message: { author: { role: 'bot' }, content: { parts: [important] } } },
    } },
  ];
  for (const value of variants) {
    const archive = parseInput(JSON.stringify(value), 'known.json');
    const messages = archive.conversations[0]!.messages;
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.content, 'Keep me');
    assert.equal(messages[1]!.role, 'system');
    assert.ok(messages[1]!.content.includes(important));
    assert.match(messages[1]!.content, /unrecognized message role/);
    assert.ok(archive.warnings.some((warning) => warning.includes('1 message(s) with unrecognized roles')));
    assert.ok(archive.warnings.every((warning) => !warning.includes(important)));
  }
});

test('normalized JSONL preserves partial-import integrity for a forward-compatible role', () => {
  const imported = parseInput(JSON.stringify({ messages: [
    { role: 'user', content: 'Known historical text.' },
    { role: 'future_assistant', content: 'Preserved future-role text.' },
  ] }), 'future-role.json');
  assert.equal(imported.integrity?.status, 'partial');
  const cleaned = cleanConversation(imported.conversations[0]!, DEFAULT_OPTIONS).conversation;
  const roundTrip = parseInput(buildJsonl(cleaned), 'forward-compatible.jsonl');
  assert.equal(roundTrip.integrity?.status, 'partial');
  assert.ok(roundTrip.integrity?.issues.some(issue => issue.code === 'unknown-record'));
  assert.match(roundTrip.conversations[0]!.messages[1]!.content, /Preserved future-role text/);
});

test('empty known conversations warn, while empty ChatGPT root nodes do not become fake messages', () => {
  for (const value of [{ messages: [] }, { chat_messages: [] }, { current_node: 'root', mapping: { root: { parent: null, message: null } } }]) {
    const archive = parseInput(JSON.stringify(value), 'empty-conversation.json');
    assert.equal(archive.conversations[0]!.messages.length, 0);
    assert.ok(archive.warnings.some((warning) => warning.includes('no nonempty messages')));
  }
  const archive = parseInput(JSON.stringify({ current_node: 'user', mapping: {
    root: { parent: null, message: null },
    user: { parent: 'root', message: { author: { role: 'user' }, content: { parts: ['Actual user content'] } } },
  } }), 'root.json');
  assert.equal(archive.conversations[0]!.messages.length, 1);
  assert.equal(archive.warnings.length, 0);
});

test('plain text role headings split messages while source code is preserved', () => {
  const input = '## User\nFix this.\n\n## Assistant\n```js\nconst value = 1;\n```';
  const result = parseInput(input, 'conversation.md');
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.role), ['user', 'assistant']);
  assert.match(result.conversations[0]!.messages[1]!.content, /const value = 1/);
});

test('transcript-like lines inside fenced code never split messages', () => {
  const input = '## User\nRead this fixture.\n\n```yaml\nuser: admin\nassistant: helper\n```\n\n## Assistant\nThe fixture is valid.';
  const result = parseInput(input, 'conversation.md');
  assert.equal(result.conversations[0]!.messages.length, 2);
  assert.match(result.conversations[0]!.messages[0]!.content, /user: admin\nassistant: helper/);
});

test('cleanup does not mutate source or shorten user/assistant code', () => {
  const original = conversation('```js\n' + 'important();\n'.repeat(3000) + '```', 'assistant');
  const serialized = JSON.stringify(original);
  const cleaned = cleanConversation(original, { ...DEFAULT_OPTIONS, toolLimit: 500 });
  assert.equal(JSON.stringify(original), serialized);
  assert.equal(cleaned.conversation.messages[0]!.content, original.messages[0]!.content);
  assert.equal(cleaned.stats.outputsTrimmed, 0);
});

test('only exact tool duplicates are omitted; differing middles remain distinct', () => {
  const first = 'head '.repeat(200) + 'first middle' + ' tail'.repeat(200);
  const second = 'head '.repeat(200) + 'second middle' + ' tail'.repeat(200);
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'one', role: 'tool', content: first },
    { id: 'two', role: 'tool', content: second },
    { id: 'three', role: 'tool', content: first },
    { id: 'four', role: 'assistant', content: first },
  ] };
  const cleaned = cleanConversation(input, { ...DEFAULT_OPTIONS, toolLimit: 400 });
  assert.equal(cleaned.stats.duplicatesRemoved, 1);
  assert.equal(cleaned.stats.outputsTrimmed, 2);
  assert.match(cleaned.conversation.messages[2]!.content, /identical to message one/);
  assert.equal(cleaned.conversation.messages[3]!.content, first);
});

test('provider credentials, contextual secrets, bearer and emails get stable aliases', () => {
  const fakeKey = ['sk', 'proj', 'X'.repeat(35)].join('-');
  const fakeGithub = ['ghp', 'Z'.repeat(36)].join('_');
  const fakeAws = ['AK', 'IA', 'X'.repeat(16)].join('');
  const fakeBearer = ['not', 'a', 'real', 'bearer', 'token'].join('-');
  const email = ['person', 'example.test'].join('@');
  const secret = ['sample', 'password', 'value'].join('-');
  const text = `First ${fakeKey}\nRepeat ${fakeKey}\n${fakeGithub}\n${fakeAws}\nAuthorization: Bearer ${fakeBearer}\npassword="${secret}"\n${email} twice ${email}`;
  const cleaned = cleanConversation(conversation(text), DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.secretsRedacted, 6);
  assert.equal(cleaned.stats.emailsRedacted, 2);
  const output = cleaned.conversation.messages[0]!.content;
  for (const value of [fakeKey, fakeGithub, fakeAws, fakeBearer, secret, email]) assert.ok(!output.includes(value));
  assert.equal(output.match(/\[SECRET_1\]/g)?.length, 2);
  assert.equal(output.match(/\[EMAIL_1\]/g)?.length, 2);
  const again = cleanConversation(cleaned.conversation, DEFAULT_OPTIONS);
  assert.equal(again.stats.secretsRedacted, 0);
  assert.equal(again.conversation.messages[0]!.content, output);
});

test('PEM keys and JSON embedded base64 images are removed without invalidating JSON text', () => {
  const pem = ['-----BEGIN PRIVATE KEY-----', 'QUJD'.repeat(50), '-----END PRIVATE KEY-----'].join('\n');
  const keyResult = cleanConversation(conversation(pem), DEFAULT_OPTIONS);
  assert.equal(keyResult.stats.secretsRedacted, 1);
  assert.equal(keyResult.conversation.messages[0]!.content, '[SECRET_1]');
  const image = JSON.stringify({ image: 'data:image/png;base64,' + 'QUJD'.repeat(500) });
  const cleaned = cleanConversation(conversation(image), DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.imagesRemoved, 1);
  assert.doesNotThrow(() => JSON.parse(cleaned.conversation.messages[0]!.content));
});

test('redaction scans the entire tool output before trimming can remove credential boundaries', () => {
  const material = ['SYNTHETIC', 'PRIVATE', 'MATERIAL', ''].join('_');
  const input = 'x'.repeat(4500) + '\n-----BEGIN PRIVATE KEY-----\n' + material.repeat(100) + '\n-----END PRIVATE KEY-----\nend';
  const cleaned = cleanConversation(conversation(input, 'tool'), { ...DEFAULT_OPTIONS, toolLimit: 500 });
  assert.equal(cleaned.stats.secretsRedacted, 1);
  assert.equal(cleaned.stats.outputsTrimmed, 1);
  const output = cleaned.conversation.messages[0]!.content;
  assert.ok(output.length <= 500);
  assert.ok(!output.includes(material));
  assert.doesNotMatch(output, /PRIVATE KEY/);
  assert.match(output, /\[SECRET_1\]/);
  assert.ok(output.endsWith('\nend'));
});

test('a trim boundary cannot hide a provider prefix and expose its credential suffix', () => {
  const fakeToken = ['sk', 'proj', 'SYNTHETIC'.repeat(40)].join('-');
  const input = 'padding '.repeat(600) + fakeToken + '\nfinal tail';
  const cleaned = cleanConversation(conversation(input, 'tool'), { ...DEFAULT_OPTIONS, toolLimit: 500 });
  assert.equal(cleaned.stats.secretsRedacted, 1);
  assert.doesNotMatch(cleaned.conversation.messages[0]!.content, /SYNTHETIC/);
  assert.match(cleaned.conversation.messages[0]!.content, /\[SECRET_1\]/);
});

test('archive format and report metadata never inherit arbitrary source credentials', () => {
  const fakeToken = ['ghp', 'F'.repeat(36)].join('_');
  const archive = parseInput(JSON.stringify({ title: 'Safe title', source: fakeToken, messages: [{ role: 'user', content: 'Safe body' }] }), 'source.json');
  assert.equal(archive.format, 'Messages JSON export');
  const cleaned = cleanConversation(archive.conversations[0]!, DEFAULT_OPTIONS);
  assert.equal(cleaned.conversation.source, '[SECRET_1]');
  const reportMetadata = JSON.stringify({ format: archive.format, sourceBytes: archive.sourceBytes, conversations: archive.conversations.length, stats: cleaned.stats, warnings: [...archive.warnings, ...cleaned.warnings] });
  assert.ok(!reportMetadata.includes(fakeToken));
  assert.equal(cleaned.stats.secretsRedacted, 1);
});

test('image removal preserves prose on the next line', () => {
  const cleaned = cleanConversation(conversation('data:image/png;base64,' + 'QUJD'.repeat(100) + '\nNow please continue the work.'), DEFAULT_OPTIONS);
  assert.match(cleaned.conversation.messages[0]!.content, /\nNow please continue the work\./);
});

test('multimodal base64 line wrapping is normalized before cleanup', () => {
  const source = jsonl({ type: 'user', message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD\nQUJD\nQUJD' } },
    { type: 'text', text: 'After image text remains.' },
  ] } });
  const imported = parseInput(source, 'claude.jsonl');
  const cleaned = cleanConversation(imported.conversations[0]!, DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.imagesRemoved, 1);
  assert.doesNotMatch(cleaned.conversation.messages[0]!.content, /QUJD/);
  assert.match(cleaned.conversation.messages[0]!.content, /After image text remains/);
});

test('redaction covers exported title and source with aliases stable across metadata and messages', () => {
  const fakeToken = ['ghp', 'K'.repeat(36)].join('_');
  const fakeEmail = ['title-person', 'example.test'].join('@');
  const input: Conversation = { ...conversation(`Token: ${fakeToken}`), title: `Investigation ${fakeToken}`, source: fakeEmail };
  const cleaned = cleanConversation(input, { ...DEFAULT_OPTIONS, redactEmails: true });
  assert.equal(cleaned.stats.secretsRedacted, 2);
  assert.equal(cleaned.stats.emailsRedacted, 1);
  assert.equal(cleaned.conversation.title, 'Investigation [SECRET_1]');
  assert.equal(cleaned.conversation.source, '[EMAIL_1]');
  const output = buildTranscript(cleaned.conversation);
  assert.ok(!output.includes(fakeToken));
  assert.ok(!output.includes(fakeEmail));
  assert.ok(cleaned.warnings.some((warning) => warning.includes('title or source')));
});

test('a provider token overlapping an assignment is replaced only once per occurrence', () => {
  const fakeToken = ['sk', 'proj', 'Q'.repeat(35)].join('-');
  const result = cleanConversation(conversation(`API_KEY=${fakeToken}\nAuthorization: Bearer ${fakeToken}\n${fakeToken}`), DEFAULT_OPTIONS);
  const content = result.conversation.messages[0]!.content;
  assert.equal(result.stats.secretsRedacted, 3);
  assert.equal(content.match(/\[SECRET_1\]/g)?.length, 3);
  assert.doesNotMatch(content, /SECRET_2/);
});

test('minimum tool budget retains both ends and reports the exact omitted count', () => {
  const input = 'HEAD-START ' + '0123456789'.repeat(500) + ' END-FINAL';
  const cleaned = cleanConversation(conversation(input, 'tool'), { ...DEFAULT_OPTIONS, toolLimit: 200 });
  const output = cleaned.conversation.messages[0]!.content;
  assert.equal(output.length, 200);
  assert.ok(output.startsWith('HEAD-START '));
  assert.ok(output.endsWith(' END-FINAL'));
  const match = output.match(/\n\n\[ThreadPack: ([\d,]+) characters omitted from tool output; head and tail retained\]\n\n/)!;
  const omitted = Number(match[1]!.replace(/,/g, ''));
  assert.equal(omitted, input.length - (output.length - match[0].length));
});

test('prefixed environment variables and connection strings are redacted', () => {
  const text = 'CUSTOM_API_KEY="placeholder-credential-value"\nAWS_SECRET_ACCESS_KEY=sample-signing-value\nDATABASE_URL="postgres://user:pass@localhost/db"';
  const cleaned = cleanConversation(conversation(text), DEFAULT_OPTIONS);
  assert.equal(cleaned.stats.secretsRedacted, 3);
  assert.doesNotMatch(cleaned.conversation.messages[0]!.content, /placeholder-credential-value|sample-signing-value|postgres:\/\//);
  const again = cleanConversation(cleaned.conversation, DEFAULT_OPTIONS);
  assert.equal(again.stats.secretsRedacted, 0);
  assert.equal(again.conversation.messages[0]!.content, cleaned.conversation.messages[0]!.content);
});

test('disabling every transform preserves content, including credentials and emails', () => {
  const input = conversation('password=examplevalue data:image/png;base64,QUJD person@example.test');
  const output = cleanConversation(input, { stripImages: false, trimToolOutputs: false, toolLimit: 4000, deduplicate: false, redact: false, redactEmails: false });
  assert.equal(output.conversation.messages[0]!.content, input.messages[0]!.content);
  assert.equal(output.changes.length, 0);
  assert.equal(output.stats.beforeBytes, output.stats.afterBytes);
});

test('handoff includes explicit notes, pinned clean content and recent context', () => {
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'pinned', role: 'user', content: 'Preserve this decision.' },
    { id: 'old', role: 'tool', content: 'Old unrelated output' },
    { id: 'recent', role: 'assistant', content: 'Latest progress' },
  ] };
  const result = buildHandoff(input, { goal: 'Ship it', decisions: 'Use local processing', constraints: 'No API key', nextSteps: 'Review', pinnedIds: ['pinned'], recentCount: 1 });
  for (const value of ['Ship it', 'Use local processing', 'No API key', 'Preserve this decision.', 'Latest progress', 'not an AI summary']) assert.ok(result.includes(value));
  assert.doesNotMatch(result, /Old unrelated output/);
  assert.equal(result.match(/Preserve this decision/g)?.length, 1);
});

test('source-order mode keeps the existing recent window when messages are pinned', () => {
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'old', role: 'user', content: 'outside the source window' },
    { id: 'pinned', role: 'assistant', content: 'pinned inside the source window' },
    { id: 'recent', role: 'user', content: 'recent source message' },
  ] };
  const result = buildHandoffWithSummary(input, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: ['pinned'], recentCount: 2,
  });
  assert.ok(result.text.includes('pinned inside the source window'));
  assert.ok(result.text.includes('recent source message'));
  assert.ok(!result.text.includes('outside the source window'));
  assert.equal(result.summary.selectedRecentMessageCount, 1);
  assert.equal(result.summary.notSelectedMessageCount, 1);
});

test('timestamp mode selects by valid timestamps and restores source order for display', () => {
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'm1', role: 'user', content: 'latest timestamp', timestamp: '2026-01-04T00:00:00Z' },
    { id: 'm2', role: 'assistant', content: 'oldest timestamp', timestamp: '2026-01-01T00:00:00Z' },
    { id: 'm3', role: 'user', content: 'second latest timestamp', timestamp: '2026-01-03T00:00:00Z' },
    { id: 'm4', role: 'assistant', content: 'middle timestamp', timestamp: '2026-01-02T00:00:00Z' },
  ] };
  const result = buildHandoffWithSummary(input, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 2, recentMode: 'timestamp',
  });
  assert.ok(result.text.includes('latest timestamp'));
  assert.ok(result.text.includes('second latest timestamp'));
  assert.ok(!result.text.includes('oldest timestamp'));
  assert.ok(result.text.indexOf('latest timestamp') < result.text.indexOf('second latest timestamp'));
  assert.equal(result.summary.selectionMode, 'timestamp');
  assert.equal(result.summary.completeMessageCount, 2);
  assert.equal(result.summary.notSelectedMessageCount, 2);
  assert.deepEqual(result.summary.timeRange, { start: '2026-01-03T00:00:00.000Z', end: '2026-01-04T00:00:00.000Z' });
});

test('timestamp ties use later source position and missing or invalid timestamps are excluded', () => {
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'first-tie', role: 'user', content: 'first equal timestamp', timestamp: '2026-02-02T10:00:00Z' },
    { id: 'missing-time', role: 'assistant', content: 'missing timestamp' },
    { id: 'second-tie', role: 'user', content: 'second equal timestamp', timestamp: '2026-02-02T10:00:00Z' },
    { id: 'invalid-time', role: 'assistant', content: 'invalid timestamp', timestamp: 'not a timestamp' },
    { id: 'older', role: 'assistant', content: 'older timestamp', timestamp: '2026-02-01T10:00:00Z' },
  ] };
  const result = buildHandoffWithSummary(input, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 1, recentMode: 'timestamp',
  });
  assert.ok(result.text.includes('second equal timestamp'));
  assert.ok(!result.text.includes('first equal timestamp'));
  assert.ok(!result.text.includes('missing timestamp'));
  assert.ok(!result.text.includes('invalid timestamp'));
  assert.equal(result.summary.missingTimestampCount, 2);
  assert.equal(result.summary.eligibleMessageCount, 3);
  assert.deepEqual(result.summary.timeRange, { start: '2026-02-02T10:00:00.000Z', end: '2026-02-02T10:00:00.000Z' });
});

test('handoff honors budget for recent content and explicitly preserves oversized pins', () => {
  const input = conversation('x'.repeat(20_000), 'assistant');
  const options = { goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 1, maxCharacters: 2500 };
  const result = buildHandoff(input, options);
  assert.ok(result.length <= 2500, `Expected budget <=2500, got ${result.length}`);
  assert.match(result, /excerpt shortened/);
  const reported = buildHandoffWithSummary(input, options);
  assert.equal(reported.summary.completeMessageCount, 0);
  assert.equal(reported.summary.truncatedMessageCount, 1);
  assert.deepEqual(reported.summary.truncatedMessageIds, ['m1']);
  assert.match(reported.text, /excerpt shortened/);
  const pinned = buildHandoff(input, { ...options, pinnedIds: ['m1'] });
  assert.ok(pinned.includes(input.messages[0]!.content));
  assert.match(pinned, /Budget exceeded/);
  assert.equal(buildHandoffWithSummary(input, { ...options, pinnedIds: ['m1'] }).summary.budgetExceeded, true);
});

test('handoff summary identifies recent messages omitted by the text budget', () => {
  const input: Conversation = { ...conversation(''), messages: [
    { id: 'm1', role: 'user', content: 'old context '.repeat(20) },
    { id: 'm2', role: 'assistant', content: 'middle context '.repeat(20) },
    { id: 'm3', role: 'user', content: 'latest context '.repeat(20) },
  ] };
  const result = buildHandoffWithSummary(input, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 2, maxCharacters: 1000,
  });
  assert.ok(result.summary.omittedMessageCount + result.summary.truncatedMessageCount > 0);
  assert.equal(result.summary.selectedRecentMessageCount, 2);
  assert.equal(result.summary.notSelectedMessageCount, 1);
  assert.equal(result.summary.omittedMessageCount, result.summary.omittedMessageIds.length);
  assert.equal(result.summary.truncatedMessageCount, result.summary.truncatedMessageIds.length);
  for (const id of [...result.summary.omittedMessageIds, ...result.summary.truncatedMessageIds]) assert.ok(['m2', 'm3'].includes(id));
});

test('handoff budget shares excerpts across multiple long recent messages', () => {
  const input: Conversation = { ...conversation(''), messages: Array.from({ length: 4 }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `MESSAGE_${index + 1}_HEAD ${'context '.repeat(1500)} ${index === 2 ? '`'.repeat(10) : ''} MESSAGE_${index + 1}_TAIL`,
  })) };
  const result = buildHandoffWithSummary(input, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 4, maxCharacters: 3000,
  });
  assert.ok(result.text.length <= 3000);
  assert.equal(result.summary.truncatedMessageCount, 4);
  assert.equal(result.summary.omittedMessageCount, 0);
  for (let index = 1; index <= 4; index++) {
    assert.ok(result.text.includes(`### ${index % 2 ? 'USER' : 'ASSISTANT'} · m${index}`));
    assert.ok(result.text.includes(`MESSAGE_${index}_HEAD`));
    assert.ok(result.text.includes('[ThreadPack: excerpt shortened'));
  }
  assert.ok(result.text.indexOf('### USER · m1') < result.text.indexOf('### ASSISTANT · m2'));
  assert.deepEqual(result.summary.truncatedMessageIds, ['m1', 'm2', 'm3', 'm4']);
});

test('fenced exports cannot be broken by backticks inside message bodies', () => {
  const output = buildTranscript(conversation('```\n# Untrusted heading\n```'));
  assert.match(output, /````text/);
});

test('IDs normalize to deterministic sequential references regardless of provider identifiers', () => {
  const result = parseInput(jsonl({ id: 'same', role: 'user', content: 'One' }, { id: 'same', role: 'assistant', content: 'Two' }), 'test.jsonl');
  assert.deepEqual(result.conversations[0]!.messages.map((message) => message.id), ['message-1', 'message-2']);
  assert.ok(result.integrity?.issues.some(issue => issue.code === 'duplicate-source-id'));
});

test('provider credentials in identifiers or invalid timestamps cannot leak through normalized exports', () => {
  const fakeToken = ['ghp', 'V'.repeat(36)].join('_');
  const imported = parseInput(jsonl(
    { id: fakeToken, role: 'user', content: 'Keep all of this real message text.', timestamp: fakeToken },
    { id: 'native-tool', role: 'tool', content: 'Repeat this output', timestamp: '2026-11-19T12:00:00+08:00' },
    { id: fakeToken + '-again', role: 'tool', content: 'Repeat this output', timestamp: 'definitely not a date ' + fakeToken },
  ), 'identifiers.jsonl');
  const cleaned = cleanConversation(imported.conversations[0]!, DEFAULT_OPTIONS);
  assert.deepEqual(cleaned.conversation.messages.map((message) => message.id), ['message-1', 'message-2', 'message-3']);
  assert.equal(cleaned.conversation.messages[0]!.timestamp, undefined);
  assert.equal(cleaned.conversation.messages[1]!.timestamp, '2026-11-19T04:00:00.000Z');
  assert.equal(cleaned.conversation.messages[2]!.timestamp, undefined);
  assert.equal(cleaned.conversation.messages[0]!.content, 'Keep all of this real message text.');
  assert.match(cleaned.conversation.messages[2]!.content, /identical to message message-2/);
  assert.equal(cleaned.changes[0]!.messageId, 'message-3');
  const handoff = buildHandoff(cleaned.conversation, { goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: ['message-1'], recentCount: 1 });
  for (const output of [buildTranscript(cleaned.conversation), buildJsonl(cleaned.conversation), handoff]) assert.ok(!output.includes(fakeToken));
  assert.match(handoff, /Keep all of this real message text/);
});

test('ChatGPT parent cycles terminate and report incomplete import', () => {
  const result = parseInput(JSON.stringify({ current_node: 'a', mapping: { a: { parent: 'a', message: { role: 'user', content: { parts: ['Cycle safe'] } } } } }), 'cycle.json');
  assert.equal(result.conversations[0]!.messages.length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('cyclic')));
});

test('invalid numeric limits fail rather than silently producing broken exports', () => {
  assert.throws(() => cleanConversation(conversation(''), { ...DEFAULT_OPTIONS, toolLimit: Number.NaN }), /limit/);
  assert.throws(() => buildHandoff(conversation(''), { goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: 1, maxCharacters: 3 }), /budget/);
});
