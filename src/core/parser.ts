import type { Conversation, Message, ParsedArchive, Role } from './types';

type RecordValue = Record<string, unknown>;
const encoder = new TextEncoder();
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

function roleOf(value: unknown): Role | undefined {
  const role = asString(value).toLowerCase();
  if (role === 'human') return 'user';
  if (role === 'function' || role === 'tool_result' || role === 'function_call_output') return 'tool';
  if (role === 'developer') return 'system';
  return ['system', 'user', 'assistant', 'tool'].includes(role) ? role as Role : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

/** Convert multimodal blocks to auditable text; never fetch attachment URLs. */
function blockText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(blockText).filter(Boolean).join('\n');
  if (!record(value)) return stringify(value);
  if (typeof value.text === 'string') return value.text;
  const type = asString(value.type) || asString(value.content_type);
  if (type === 'image' && record(value.source)) {
    const source = value.source;
    if (source.type === 'base64' && typeof source.data === 'string') {
      return `data:${asString(source.media_type) || 'image/unknown'};base64,${source.data.replace(/\s/g, '')}`;
    }
    if (typeof source.url === 'string') return `[Image: ${source.url}]`;
  }
  if (type.includes('image')) {
    const image = value.image_url;
    const url = typeof image === 'string' ? image : record(image) ? asString(image.url) : '';
    if (url) return url.startsWith('data:') ? url : `[Image: ${url}]`;
    if (typeof value.data === 'string') return `data:image/unknown;base64,${value.data.replace(/\s/g, '')}`;
    return `[Image attachment${value.asset_pointer ? `: ${asString(value.asset_pointer)}` : ''}]`;
  }
  if (type === 'tool_use' || type === 'function_call') {
    return `Tool call: ${asString(value.name) || 'unknown'}\n${stringify(value.input ?? value.arguments)}`;
  }
  if (type === 'thinking' && typeof value.thinking === 'string') return `[Reasoning]\n${value.thinking}`;
  if (type === 'redacted_thinking') return '[Provider-redacted reasoning]';
  if (value.parts !== undefined) return blockText(value.parts);
  if (value.content !== undefined) return blockText(value.content);
  if (value.output !== undefined) return blockText(value.output);
  return stringify(value);
}

function makeMessages(value: unknown, fallbackId: string, fallbackRole?: Role, fallbackTime?: unknown): Message[] {
  if (!record(value)) return [];
  const author = record(value.author) ? value.author.role : undefined;
  const role = roleOf(value.role ?? author ?? value.type) ?? fallbackRole;
  if (!role) return [];
  const id = asString(value.id) || asString(value.uuid) || fallbackId;
  const time = timestamp(value.timestamp ?? value.created_at ?? value.create_time ?? fallbackTime);
  const content = value.content ?? value.text ?? value.output;
  const groups: { role: Role; content: string }[] = [];
  const blocks = Array.isArray(content) ? content : [content];
  for (const block of blocks) {
    const blockRole = record(block) && (block.type === 'tool_result' || block.type === 'function_call_output') ? 'tool' : role;
    const text = blockText(block);
    if (!text) continue;
    const last = groups[groups.length - 1];
    if (last && last.role === blockRole) last.content += `\n${text}`;
    else groups.push({ role: blockRole, content: text });
  }
  return groups.map((group, index) => ({
    id: groups.length === 1 ? id : `${id}-${index + 1}`,
    role: group.role,
    content: group.content,
    ...(time ? { timestamp: time } : {}),
  }));
}

function uniqueIds(messages: Message[]): Message[] {
  // Provider identifiers are not needed for a normalized transcript. They can
  // contain arbitrary user-controlled text, including credentials. Sequential
  // identifiers remain stable across imports and keep pins/change references safe.
  return messages.map((message, index) => {
    const { timestamp: providerTime, ...body } = message;
    const normalizedTime = timestamp(providerTime);
    return { ...body, id: `message-${index + 1}`, ...(normalizedTime ? { timestamp: normalizedTime } : {}) };
  });
}

function schemaMessages(values: unknown[], conversationId: string, index: number, warnings: string[]): Message[] {
  let unrecognized = 0;
  const messages = values.flatMap((value, n) => {
    const fallbackId = `${conversationId}-message-${n + 1}`;
    const recognized = makeMessages(value, fallbackId);
    if (recognized.length) return recognized;
    // A schema may gain new roles before this importer is updated. Preserve
    // their content as historical system data rather than silently dropping it.
    const content = record(value) ? blockText(value.content ?? value.text ?? value.output) : blockText(value);
    if (!content.trim()) return [];
    unrecognized++;
    return [{ id: fallbackId, role: 'system' as const, content: `[ThreadPack: unrecognized message role; original content preserved as system data]\n${content}` }];
  });
  if (unrecognized) warnings.push(`Conversation ${index + 1}: ${unrecognized} message(s) with unrecognized roles were preserved as system data. Review their meaning before continuing.`);
  if (!messages.length) warnings.push(`Conversation ${index + 1}: no nonempty messages were found in this conversation.`);
  return uniqueIds(messages);
}

function conversationFromJson(value: unknown, index: number, titleFallback: string, warnings: string[]): Conversation | undefined {
  if (!record(value)) return undefined;
  const id = asString(value.id) || asString(value.uuid) || `conversation-${index + 1}`;
  const title = asString(value.title) || asString(value.name) || titleFallback;
  if (record(value.mapping)) {
    const mapping = value.mapping;
    const nodes: unknown[] = [];
    let cursor = asString(value.current_node);
    if (cursor && record(mapping[cursor])) {
      const seen = new Set<string>();
      while (cursor && record(mapping[cursor]) && !seen.has(cursor)) {
        seen.add(cursor);
        const node = mapping[cursor] as RecordValue;
        if (node.message !== undefined) nodes.push(node.message);
        cursor = asString(node.parent);
      }
      if (cursor) warnings.push(`Conversation ${index + 1}: incomplete or cyclic parent chain; only the reachable active branch was imported.`);
      nodes.reverse();
    } else {
      warnings.push(`Conversation ${index + 1}: no valid current_node; all available ChatGPT branches were imported in export order.`);
      for (const node of Object.values(mapping)) if (record(node) && node.message !== undefined) nodes.push(node.message);
    }
    const messages = schemaMessages(nodes, id, index, warnings);
    return { id, title, source: 'ChatGPT', messages };
  }
  if (Array.isArray(value.chat_messages)) {
    const entries = value.chat_messages.map((item) => {
      if (!record(item)) return item;
      const content = Array.isArray(item.content) && item.content.length === 0 ? item.text : item.content ?? item.text;
      return { ...item, role: item.sender, content };
    });
    const messages = schemaMessages(entries, id, index, warnings);
    return { id, title, source: 'Claude', messages };
  }
  if (Array.isArray(value.messages)) {
    const messages = schemaMessages(value.messages, id, index, warnings);
    return { id, title, source: asString(value.source) || 'Messages JSON', messages };
  }
  return undefined;
}

function parseRecords(values: Iterable<unknown>, filename: string, warnings: string[]): { conversations: Conversation[]; format: string } {
  const messages: Message[] = [];
  let format = 'Messages JSONL';
  let title = filename;
  let id = 'conversation-1';
  let skipped = 0;
  let codex = false;
  let claudeCode = false;
  let n = 0;
  for (const value of values) {
    n++;
    if (!record(value)) { skipped++; continue; }
    const fallbackId = `message-${n}`;
    if (value.type === 'session_meta') {
      codex = true;
      if (record(value.payload)) id = asString(value.payload.id) || id;
      continue;
    }
    if (value.type === 'response_item' && record(value.payload)) {
      codex = true;
      const payload = value.payload;
      if (payload.type === 'message') messages.push(...makeMessages(payload, fallbackId, undefined, value.timestamp));
      else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        messages.push(...makeMessages({ ...payload, role: 'tool', content: payload.output }, fallbackId, 'tool', value.timestamp));
      } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        messages.push(...makeMessages({ role: 'assistant', content: `Tool call: ${asString(payload.name) || 'unknown'}\n${stringify(payload.arguments ?? payload.input)}` }, fallbackId, 'assistant', value.timestamp));
      } else skipped++;
      continue;
    }
    if (value.type === 'event_msg' || value.type === 'turn_context' || value.type === 'compacted') {
      // Codex event messages mirror response_item records. Do not duplicate them.
      if (value.type === 'compacted' && record(value.payload) && typeof value.payload.message === 'string') {
        messages.push({ id: fallbackId, role: 'system', content: `[Provider compaction]\n${value.payload.message}` });
      }
      continue;
    }
    if ((value.type === 'user' || value.type === 'assistant') && record(value.message)) {
      claudeCode = true;
      messages.push(...makeMessages({ ...value.message, id: value.uuid ?? value.message.id }, fallbackId, roleOf(value.type), value.timestamp));
      continue;
    }
    if (value.type === 'summary' && typeof value.summary === 'string') {
      claudeCode = true;
      messages.push({ id: fallbackId, role: 'system', content: `[Provider summary]\n${value.summary}` });
      continue;
    }
    const generic = makeMessages(value, fallbackId);
    if (generic.length) messages.push(...generic);
    else skipped++;
  }
  if (codex) format = 'Codex JSONL';
  else if (claudeCode) format = 'Claude Code JSONL';
  if (skipped) warnings.push(`${skipped} metadata or unsupported record(s) contained no recognized conversation message and were not included.`);
  // Keep the file name as the title. A truncated first user prompt could expose
  // a partial credential that no longer matches the full redaction pattern.
  return { format, conversations: messages.length ? [{ id, title, source: codex ? 'Codex' : claudeCode ? 'Claude Code' : 'JSONL', messages }] : [] };
}

interface JsonlParseStats { validRecords: number; malformedLines: number }

function* jsonlValues(text: string, stats: JsonlParseStats): Generator<unknown> {
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, '');
    if (line.trim()) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        stats.malformedLines++;
        if (newline < 0) break;
        start = newline + 1;
        continue;
      }
      stats.validRecords++;
      yield value;
    }
    if (newline < 0) break;
    start = newline + 1;
  }
}

function parseJson(value: unknown, text: string, filename: string, warnings: string[]): { conversations: Conversation[]; format: string } {
  const entries = Array.isArray(value) ? value : record(value) && Array.isArray(value.conversations) ? value.conversations : [value];
  const conversations: Conversation[] = [];
  const schemaFormats = new Set<string>();
  let unknownEntries = 0;
  for (let n = 0; n < entries.length; n++) {
    const conversation = conversationFromJson(entries[n], n, filename, warnings);
    if (conversation) {
      conversations.push(conversation);
      const entry = entries[n] as RecordValue;
      // Format is public diagnostic metadata, so derive it only from known
      // structural schemas, never an arbitrary source label from the export.
      schemaFormats.add(record(entry.mapping) ? 'ChatGPT export' : Array.isArray(entry.chat_messages) ? 'Claude export' : 'Messages JSON export');
    }
    else unknownEntries++;
  }
  if (conversations.length) {
    if (unknownEntries) warnings.push(`${unknownEntries} unrecognized conversation record(s) were not imported.`);
    return { conversations, format: schemaFormats.size === 1 ? schemaFormats.values().next().value! : 'Conversation archive' };
  }
  const records = parseRecords(entries, filename, warnings);
  if (records.conversations.length) return { ...records, format: records.format.replace('JSONL', 'JSON') };
  warnings.push('Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.');
  return { format: 'Unrecognized JSON', conversations: [{ id: 'conversation-1', title: filename, source: 'JSON text', messages: [{ id: 'message-1', role: 'user', content: text }] }] };
}

function parseText(text: string, filename: string): { conversations: Conversation[]; format: string } {
  const messages: Message[] = [];
  // Only explicit line-start role headings split transcripts, leaving ordinary prose/code intact.
  const heading = /^(?:#{1,6}\s+)?(?:\*\*)?(system|developer|user|human|assistant|tool)(?:\*\*)?\s*(?::\s*|\r?$)/gim;
  const codeRanges: { start: number; end: number }[] = [];
  let fenceStart = -1;
  let fenceCharacter = '';
  let fenceLength = 0;
  let offset = 0;
  for (const sourceLine of text.split(/(?<=\n)/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(sourceLine);
    if (fence) {
      if (fenceStart < 0) {
        fenceStart = offset;
        fenceCharacter = fence[1]![0]!;
        fenceLength = fence[1]!.length;
      } else if (fence[1]![0] === fenceCharacter && fence[1]!.length >= fenceLength) {
        codeRanges.push({ start: fenceStart, end: offset + sourceLine.length });
        fenceStart = -1;
      }
    }
    offset += sourceLine.length;
  }
  if (fenceStart >= 0) codeRanges.push({ start: fenceStart, end: text.length });
  const matches = Array.from(text.matchAll(heading)).filter((match) => !codeRanges.some((range) => match.index >= range.start && match.index < range.end));
  if (matches.length > 1) {
    const prefix = text.slice(0, matches[0]!.index).trim();
    if (prefix) messages.push({ id: 'message-preface', role: 'system', content: prefix });
    for (let n = 0; n < matches.length; n++) {
      const match = matches[n]!;
      const start = match.index + match[0].length;
      const end = matches[n + 1]?.index ?? text.length;
      const content = text.slice(start, end).trim();
      if (content) messages.push({ id: `message-${n + 1}`, role: roleOf(match[1]) ?? 'user', content });
    }
  } else messages.push({ id: 'message-1', role: 'user', content: text });
  return { format: /\.md$/i.test(filename) ? 'Markdown' : 'Plain text', conversations: [{ id: 'conversation-1', title: filename, source: 'Text', messages }] };
}

export function parseInput(text: string, filename: string, inputByteLength?: number): ParsedArchive {
  if (typeof text !== 'string') throw new Error('Input must be a text string.');
  const sourceBytes = inputByteLength ?? encoder.encode(text).byteLength;
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 0) throw new Error('Input byte length must be a nonnegative safe integer.');
  if (!text.trim()) throw new Error('This file is empty. Choose a conversation export or paste a transcript.');
  const warnings: string[] = [];
  const normalized = text.replace(/^\uFEFF/, '');
  const trimmed = normalized.trim();
  const jsonl = /\.(jsonl|ndjson)$/i.test(filename);
  const json = /\.json$/i.test(filename);
  let parsed: { conversations: Conversation[]; format: string };
  if (jsonl) {
    const stats: JsonlParseStats = { validRecords: 0, malformedLines: 0 };
    parsed = parseRecords(jsonlValues(normalized, stats), filename, warnings);
    if (stats.malformedLines) warnings.unshift(`${stats.malformedLines} invalid JSONL line(s) were skipped. Keep the original file to recover them.`);
    if (!stats.validRecords) throw new Error('No valid JSONL records were found. Check the export format or use a .txt file for plain text.');
    if (!parsed.conversations.length) throw new Error('The JSONL contains no recognized conversation messages. Supported formats: Codex, Claude Code, or records with role and content.');
  } else if (json || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value: unknown;
    try { value = JSON.parse(normalized); }
    catch {
      if (json) throw new Error('Invalid JSON. Repair the export before importing; it was not treated as a complete transcript.');
      // A pasted JSONL transcript has no filename. Detect it without silently accepting broken JSON.
      const lines = normalized.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > 1 && lines.every((line) => { try { JSON.parse(line); return true; } catch { return false; } })) {
        parsed = parseRecords(lines.map((line) => JSON.parse(line)), filename, warnings);
        if (!parsed.conversations.length) throw new Error('No recognized messages were found in the pasted JSONL.');
        return { ...parsed, conversations: parsed.conversations.map(conversation => ({ ...conversation, messages: uniqueIds(conversation.messages) })), warnings, sourceBytes };
      }
      warnings.push('Input starts like JSON but is not valid JSON. It was preserved as plain text.');
      parsed = parseText(normalized, filename);
      return { ...parsed, warnings, sourceBytes };
    }
    parsed = parseJson(value, normalized, filename, warnings);
  } else parsed = parseText(normalized, filename);
  const used = new Set<string>();
  parsed.conversations = parsed.conversations.map((conversation) => {
    let id = conversation.id;
    let suffix = 2;
    while (used.has(id)) id = `${conversation.id}-${suffix++}`;
    used.add(id);
    return { ...conversation, id, messages: uniqueIds(conversation.messages) };
  });
  return { ...parsed, warnings, sourceBytes };
}
