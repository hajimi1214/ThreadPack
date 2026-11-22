import type { Conversation, ConversationBranch, ConversationProvenance, IntegrityIssue, IntegrityReport, Message, MessageKind, MessageProvenance, ParsedArchive, Role, SessionEvent, SourcePlatform } from './types';

type RecordValue = Record<string, unknown>;
const sourcePlatforms: SourcePlatform[] = ['chatgpt', 'codex', 'claude', 'claude-code', 'openai', 'generic', 'text', 'threadpack', 'unknown'];
const encoder = new TextEncoder();
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonnegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

function messageProvenance(value: unknown): MessageProvenance | undefined {
  if (!record(value) || !sourcePlatforms.includes(value.platform as SourcePlatform)) return undefined;
  const result: MessageProvenance = { platform: value.platform as SourcePlatform };
  for (const key of ['platformId', 'recordType', 'sourceNodeId', 'parentSourceId', 'toolCallSourceId', 'conversationSourceId', 'conversationTitle', 'conversationSource'] as const) {
    const field = value[key];
    if (typeof field === 'string' && field.length <= 2000) result[key] = field;
  }
  if (Number.isSafeInteger(value.recordIndex) && (value.recordIndex as number) >= 0) result.recordIndex = value.recordIndex as number;
  if (Number.isSafeInteger(value.conversationSourceRecordCount) && (value.conversationSourceRecordCount as number) >= 0) {
    result.conversationSourceRecordCount = value.conversationSourceRecordCount as number;
  }
  if ((typeof value.rawTimestamp === 'string' && value.rawTimestamp.length <= 1000) || (typeof value.rawTimestamp === 'number' && Number.isFinite(value.rawTimestamp))) {
    result.rawTimestamp = value.rawTimestamp as string | number;
  }
  return result;
}

function validMessageProvenance(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || !sourcePlatforms.includes(value.platform as SourcePlatform)) return false;
  for (const key of ['platformId', 'recordType', 'sourceNodeId', 'parentSourceId', 'toolCallSourceId', 'conversationSourceId', 'conversationTitle', 'conversationSource'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || (value[key] as string).length > 2000)) return false;
  }
  if (value.recordIndex !== undefined && (!Number.isSafeInteger(value.recordIndex) || (value.recordIndex as number) < 0)) return false;
  if (value.conversationSourceRecordCount !== undefined && (!Number.isSafeInteger(value.conversationSourceRecordCount) || (value.conversationSourceRecordCount as number) < 0)) return false;
  if (value.rawTimestamp !== undefined && !((typeof value.rawTimestamp === 'string' && value.rawTimestamp.length <= 1000) || (typeof value.rawTimestamp === 'number' && Number.isFinite(value.rawTimestamp)))) return false;
  return true;
}

function conversationProvenance(value: unknown): ConversationProvenance | undefined {
  if (!record(value) || !sourcePlatforms.includes(value.platform as SourcePlatform)) return undefined;
  return {
    platform: value.platform as SourcePlatform,
    ...(typeof value.sourceId === 'string' && value.sourceId.length <= 2000 ? { sourceId: value.sourceId } : {}),
    ...(Number.isSafeInteger(value.sourceRecordCount) && (value.sourceRecordCount as number) >= 0 ? { sourceRecordCount: value.sourceRecordCount as number } : {}),
  };
}

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
  if (type === 'reasoning') return asString(value.text) || asString(value.summary) || stringify(value.content ?? value.summary ?? value);
  if (type === 'thinking' && typeof value.thinking === 'string') return `[Reasoning]\n${value.thinking}`;
  if (type === 'redacted_thinking') return '[Provider-redacted reasoning]';
  if (value.parts !== undefined) return blockText(value.parts);
  if (value.content !== undefined) return blockText(value.content);
  if (value.output !== undefined) return blockText(value.output);
  return stringify(value);
}

interface MessageSourceContext {
  platform: SourcePlatform;
  recordIndex: number;
  recordType?: string;
  sourceNodeId?: string;
  parentSourceId?: string;
}

function makeMessages(value: unknown, fallbackId: string, fallbackRole?: Role, fallbackTime?: unknown, context?: MessageSourceContext): Message[] {
  if (!record(value)) return [];
  const author = record(value.author) ? value.author.role : undefined;
  const role = roleOf(value.role ?? author ?? value.type) ?? fallbackRole;
  if (!role) return [];
  const id = asString(value.id) || asString(value.uuid) || fallbackId;
  const rawTime = value.timestamp ?? value.created_at ?? value.create_time ?? fallbackTime;
  const time = timestamp(rawTime);
  const content = value.content ?? value.text ?? value.output;
  const groups: { role: Role; content: string; kind?: MessageKind; toolCallId?: string; toolName?: string }[] = [];
  const blocks = Array.isArray(content) ? content : [content];
  for (const block of blocks) {
    const blockType = record(block) ? asString(block.type) : '';
    const blockRole = blockType === 'tool_result' || blockType === 'function_call_output' ? 'tool' : role;
    const text = blockText(block);
    if (!text) continue;
    const last = groups[groups.length - 1];
    const suppliedKind = ['message', 'tool-call', 'tool-result', 'reasoning', 'summary', 'compaction', 'metadata'].includes(asString(value.kind))
      ? asString(value.kind) as MessageKind : undefined;
    const kind: MessageKind | undefined = blockType === 'tool_use' || blockType === 'function_call'
      ? 'tool-call' : blockType === 'tool_result' || blockType === 'function_call_output'
        ? 'tool-result' : blockType === 'thinking' || blockType === 'reasoning' ? 'reasoning' : blockRole === 'tool' && (value.tool_call_id || value.toolCallId) ? 'tool-result' : suppliedKind;
    const toolCallId = (record(block) ? asString(block.id) || asString(block.tool_use_id) || asString(block.call_id) : '')
      || asString(value.tool_call_id) || asString(value.function_call_id) || asString(value.toolCallId) || undefined;
    const toolName = (record(block) ? asString(block.name) : '') || asString(value.toolName) || asString(value.name) || undefined;
    if (last && last.role === blockRole && last.kind === kind && !kind) last.content += `\n${text}`;
    else groups.push({ role: blockRole, content: text, ...(kind ? { kind } : {}), ...(toolCallId ? { toolCallId } : {}), ...(toolName ? { toolName } : {}) });
  }
  const toolCalls = Array.isArray(value.tool_calls) ? value.tool_calls : value.function_call ? [value.function_call] : [];
  for (const callValue of toolCalls) {
    if (!record(callValue)) continue;
    const fn = record(callValue.function) ? callValue.function : callValue;
    const name = asString(fn.name) || 'unknown';
    const argumentsText = stringify(fn.arguments ?? fn.input);
    groups.push({
      role: 'assistant', content: `Tool call: ${name}\n${argumentsText}`, kind: 'tool-call',
      ...(asString(callValue.id) ? { toolCallId: asString(callValue.id) } : {}), toolName: name,
    });
  }
  const sourceId = asString(value.id) || asString(value.uuid) || undefined;
  const existingProvenance = messageProvenance(value.provenance);
  const parentSourceId = context?.parentSourceId || asString(value.parent_id) || asString(value.parentId)
    || asString(value.parentUuid) || asString(value.parent_message_uuid) || asString(value.parentMessageUuid)
    || asString(value.parent_message_id) || undefined;
  const suppliedParentId = asString(value.parentId) || undefined;
  return groups.map((group, index) => ({
    id: groups.length === 1 ? id : `${id}-${index + 1}`,
    role: group.role,
    content: group.content,
    ...(time ? { timestamp: time } : {}),
    ...(group.kind ? { kind: group.kind } : {}),
    ...(group.toolCallId ? { toolCallId: group.toolCallId } : {}),
    ...(group.toolName ? { toolName: group.toolName } : {}),
    ...(suppliedParentId ? { parentId: suppliedParentId } : {}),
    ...(existingProvenance ? { provenance: existingProvenance } : context ? { provenance: {
      platform: context.platform,
      ...(sourceId ? { platformId: sourceId } : {}),
      recordIndex: context.recordIndex,
      ...(context.recordType ? { recordType: context.recordType } : {}),
      ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
      ...(parentSourceId ? { parentSourceId } : {}),
      ...(group.toolCallId ? { toolCallSourceId: group.toolCallId } : {}),
      ...(typeof rawTime === 'string' || typeof rawTime === 'number' ? { rawTimestamp: rawTime } : {}),
    } } : {}),
  }));
}

function uniqueIds(messages: Message[], warnings: string[] = [], issues: IntegrityIssue[] = []): Message[] {
  const sourceIds = new Map<string, string>();
  const sourceRecordIndexes = new Map<string, number | undefined>();
  const duplicateSources = new Set<string>();
  const originalIds = new Map<string, string>();
  const toolCallIds = new Map<string, string>();
  const normalized = messages.map((message, index) => {
    const id = `message-${index + 1}`;
    if (!originalIds.has(message.id)) originalIds.set(message.id, id);
    const provenance = message.provenance;
    if (provenance) {
      const sourceReferences = new Set([provenance.sourceNodeId, provenance.platformId].filter((sourceId): sourceId is string => Boolean(sourceId)));
      for (const sourceId of sourceReferences) {
        const key = `${provenance.platform}\0${sourceId}`;
        if (sourceIds.has(key)) {
          if (sourceRecordIndexes.get(key) !== provenance.recordIndex) duplicateSources.add(key);
        } else {
          sourceIds.set(key, id);
          sourceRecordIndexes.set(key, provenance.recordIndex);
        }
      }
    }
    const { timestamp: originalTimestamp, ...body } = message;
    const normalizedTime = timestamp(originalTimestamp);
    return { ...body, id, kind: message.kind ?? 'message', ...(normalizedTime ? { timestamp: normalizedTime } : {}) };
  });
  if (duplicateSources.size) {
    issues.push({ code: 'duplicate-source-id', severity: 'warning', count: duplicateSources.size });
    warnings.push(`${duplicateSources.size} duplicate provider message identifier(s) were encountered; normalized references remain unique.`);
  }
  const normalizedBySource = new Map<string, string>();
  for (const message of normalized) {
    const provenance = message.provenance;
    if (provenance) {
      for (const sourceId of new Set([provenance.sourceNodeId, provenance.platformId].filter((value): value is string => Boolean(value)))) {
        const key = `${provenance.platform}\0${sourceId}`;
        normalizedBySource.set(key, normalizedBySource.get(key) ?? message.id);
      }
    }
  }
  const result = normalized.map(message => {
    const provenance = message.provenance;
    const parentSourceId = provenance?.parentSourceId;
    const parentId = parentSourceId && provenance
      ? normalizedBySource.get(`${provenance.platform}\0${parentSourceId}`)
      : message.parentId ? originalIds.get(message.parentId) : undefined;
    const callSourceId = provenance?.toolCallSourceId;
    let toolCallId = message.toolCallId;
    if (callSourceId) {
      const key = `${provenance!.platform}\0${callSourceId}`;
      if (!toolCallIds.has(key)) toolCallIds.set(key, `tool-call-${toolCallIds.size + 1}`);
      toolCallId = toolCallIds.get(key);
    }
    return { ...message, ...(parentId ? { parentId } : {}), ...(toolCallId ? { toolCallId } : {}) };
  });
  let missingParents = 0;
  for (const message of result) if (message.provenance?.parentSourceId && !message.parentId) missingParents++;
  if (missingParents) {
    issues.push({ code: 'missing-parent', severity: 'warning', count: missingParents });
    warnings.push(`${missingParents} message parent reference(s) were not found. The available messages were preserved.`);
  }
  const byId = new Map(result.map(message => [message.id, message]));
  const visitState = new Map<string, 0 | 1 | 2>();
  let cycles = 0;
  for (const message of result) {
    if (visitState.get(message.id) === 2) continue;
    const path: Message[] = [];
    const pathIndex = new Map<string, number>();
    let current: Message | undefined = message;
    while (current && visitState.get(current.id) !== 2) {
      const previousIndex = pathIndex.get(current.id);
      if (previousIndex !== undefined) { cycles++; break; }
      pathIndex.set(current.id, path.length);
      path.push(current);
      visitState.set(current.id, 1);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const item of path) visitState.set(item.id, 2);
  }
  if (cycles) {
    issues.push({ code: 'cyclic-parent', severity: 'warning', count: cycles });
    warnings.push(`${cycles} cyclic message parent reference(s) were detected. The source order was preserved.`);
  }
  const calls = new Set(result.filter(message => message.kind === 'tool-call' && message.toolCallId).map(message => message.toolCallId!));
  const results = new Set(result.filter(message => message.kind === 'tool-result' && message.toolCallId).map(message => message.toolCallId!));
  const orphanResults = result.filter(message => message.kind === 'tool-result' && message.toolCallId && !calls.has(message.toolCallId)).length;
  const unmatchedCalls = [...calls].filter(callId => !results.has(callId)).length;
  if (orphanResults) issues.push({ code: 'orphan-tool-result', severity: 'warning', count: orphanResults });
  if (unmatchedCalls) issues.push({ code: 'unmatched-tool-call', severity: 'warning', count: unmatchedCalls });
  if (orphanResults || unmatchedCalls) warnings.push('Some tool calls and tool results could not be paired by their source identifiers. Their content was retained.');
  return result;
}

function schemaMessages(values: unknown[], conversationId: string, index: number, warnings: string[], platform: SourcePlatform, contexts?: MessageSourceContext[], issues: IntegrityIssue[] = []): Message[] {
  let unrecognized = 0;
  const messages = values.flatMap((value, n) => {
    const fallbackId = `${conversationId}-message-${n + 1}`;
    const context: MessageSourceContext = contexts?.[n] ?? { platform, recordIndex: n + 1, ...(record(value) && asString(value.type) ? { recordType: asString(value.type) } : {}) };
    const recognized = makeMessages(value, fallbackId, undefined, undefined, context);
    if (recognized.length) return recognized;
    // A schema may gain new roles before this importer is updated. Preserve
    // their content as historical system data rather than silently dropping it.
    const content = record(value) ? blockText(value.content ?? value.text ?? value.output) : blockText(value);
    if (!content.trim()) return [];
    unrecognized++;
    return [{ id: fallbackId, role: 'system' as const, kind: 'metadata' as const, content: `[ThreadPack: unrecognized message role; original content preserved as system data]\n${content}`,
      provenance: { ...context, ...(record(value) && asString(value.id) ? { platformId: asString(value.id) } : {}) } }];
  });
  if (unrecognized) {
    issues.push({ code: 'unknown-record', severity: 'warning', count: unrecognized });
    warnings.push(`Conversation ${index + 1}: ${unrecognized} message(s) with unrecognized roles were preserved as system data. Review their meaning before continuing.`);
  }
  if (!messages.length) {
    issues.push({ code: 'empty-conversation', severity: 'warning', count: 1 });
    warnings.push(`Conversation ${index + 1}: no nonempty messages were found in this conversation.`);
  }
  return messages;
}

function conversationFromJson(value: unknown, index: number, titleFallback: string, warnings: string[], issues: IntegrityIssue[]): Conversation | undefined {
  if (!record(value)) return undefined;
  const id = asString(value.id) || asString(value.uuid) || `conversation-${index + 1}`;
  const title = asString(value.title) || asString(value.name) || titleFallback;
  if (record(value.mapping)) {
    const mapping = value.mapping;
    const rawEntries = Object.entries(mapping);
    const entries = rawEntries.filter((entry): entry is [string, RecordValue] => record(entry[1]));
    const mappingEvents: SessionEvent[] = rawEntries.flatMap(([nodeId, node], recordIndex) => record(node) ? [] : [{
      id: `mapping-event-${recordIndex + 1}`, type: 'invalid-mapping-node', recordIndex: recordIndex + 1, platform: 'chatgpt', sourceId: nodeId,
      content: stringify(node),
    }]);
    if (mappingEvents.length) {
      issues.push({ code: 'unknown-record', severity: 'warning', count: mappingEvents.length });
      warnings.push(`Conversation ${index + 1}: ${mappingEvents.length} malformed ChatGPT mapping node(s) were retained as timeline events.`);
    }
    const children = new Map<string, string[]>();
    const leaves: string[] = [];
    let missingParentCount = 0;
    for (const [nodeId, node] of entries) {
      const parent = asString(node.parent);
      if (parent && record(mapping[parent])) {
        const siblings = children.get(parent) ?? [];
        siblings.push(nodeId);
        children.set(parent, siblings);
      }
      else if (parent) missingParentCount++;
    }
    if (missingParentCount) {
      issues.push({ code: 'missing-parent', severity: 'warning', count: missingParentCount });
      warnings.push(`Conversation ${index + 1}: ${missingParentCount} ChatGPT node(s) reference a missing parent; available branches were preserved.`);
    }
    for (const [nodeId] of entries) if (!(children.get(nodeId)?.length)) leaves.push(nodeId);
    let currentNode = asString(value.current_node);
    if (!currentNode || !record(mapping[currentNode])) {
      currentNode = leaves[0] ?? entries[0]?.[0] ?? '';
      if (entries.length) {
        issues.push({ code: 'invalid-branch-reference', severity: 'warning', count: 1 });
        warnings.push(`Conversation ${index + 1}: no valid current_node; the first available branch is shown and all branches were retained.`);
      }
    }
    const pathNodes = (head: string): string[] => {
      const path: string[] = [];
      const seen = new Set<string>();
      let cursor = head;
      while (cursor && record(mapping[cursor]) && !seen.has(cursor)) {
        seen.add(cursor);
        path.unshift(cursor);
        cursor = asString((mapping[cursor] as RecordValue).parent);
      }
      return path;
    };
    const sourceMessageEntries = entries.map(([nodeId, node], recordIndex) => ({ nodeId, node, recordIndex }))
      .filter(entry => entry.node.message !== undefined && entry.node.message !== null);
    const sourceMessageNodes = new Set(sourceMessageEntries.map(entry => entry.nodeId));
    const activePathNodes = pathNodes(currentNode);
    const activeNodeSet = new Set(activePathNodes);
    const sourceMessageByNode = new Map(sourceMessageEntries.map(entry => [entry.nodeId, entry]));
    const messageEntries = [...activePathNodes.flatMap(nodeId => sourceMessageByNode.has(nodeId) ? [sourceMessageByNode.get(nodeId)!] : []),
      ...sourceMessageEntries.filter(entry => !activeNodeSet.has(entry.nodeId))];
    const messageParentSourceId = (nodeId: string, node: RecordValue): string | undefined => {
      const sourceParent = asString(node.parent);
      if (!sourceParent) return undefined;
      if (!record(mapping[sourceParent]) || sourceMessageNodes.has(sourceParent)) return sourceParent;
      const seen = new Set([nodeId]);
      let ancestor = sourceParent;
      while (ancestor && record(mapping[ancestor]) && !sourceMessageNodes.has(ancestor) && !seen.has(ancestor)) {
        seen.add(ancestor);
        ancestor = asString((mapping[ancestor] as RecordValue).parent);
      }
      return ancestor && sourceMessageNodes.has(ancestor) ? ancestor : undefined;
    };
    const contexts = messageEntries.map(({ nodeId, node, recordIndex }): MessageSourceContext => {
      const parentSourceId = messageParentSourceId(nodeId, node);
      return { platform: 'chatgpt', recordIndex: recordIndex + 1, recordType: 'mapping-node', sourceNodeId: nodeId,
        ...(parentSourceId ? { parentSourceId } : {}) };
    });
    const normalizedNodes = uniqueIds(schemaMessages(messageEntries.map(entry => entry.node.message), id, index, warnings, 'chatgpt', contexts, issues), warnings, issues);
    const nodeMessages = new Map<string, string[]>();
    for (const message of normalizedNodes) {
      const nodeId = message.provenance?.sourceNodeId;
      if (nodeId) nodeMessages.set(nodeId, [...(nodeMessages.get(nodeId) ?? []), message.id]);
    }
    const pathFor = (head: string): string[] => {
      const nodes: string[] = [];
      const seen = new Set<string>();
      let cursor = head;
      while (cursor && record(mapping[cursor]) && !seen.has(cursor)) {
        seen.add(cursor);
        nodes.push(cursor);
        cursor = asString((mapping[cursor] as RecordValue).parent);
      }
      nodes.reverse();
      const path: string[] = [];
      for (const nodeId of nodes) for (const messageId of nodeMessages.get(nodeId) ?? []) path.push(messageId);
      return path;
    };
    const branchHeads = [...new Set([...leaves, ...(asString(value.current_node) && record(mapping[asString(value.current_node)]) ? [asString(value.current_node)] : [])])];
    const branchPaths = branchHeads.map(head => ({ head, sourceNodeIds: pathNodes(head), messageIds: pathFor(head) })).filter(branch => branch.messageIds.length > 0);
    const branches: ConversationBranch[] = branchPaths.map((branch, branchIndex) => ({
      id: `branch-${branchIndex + 1}`, headMessageId: branch.messageIds.at(-1)!, messageIds: branch.messageIds, sourceNodeIds: branch.sourceNodeIds,
    }));
    const activeBranchIndex = Math.max(0, branchPaths.findIndex(branch => branch.head === currentNode));
    const activeBranchId = branches[activeBranchIndex]?.id ?? branches[0]?.id ?? 'branch-1';
    const activeBranch = branches.find(branch => branch.id === activeBranchId);
    const activeIds = new Set(activeBranch?.messageIds ?? []);
    if (!normalizedNodes.length) warnings.push(`Conversation ${index + 1}: no nonempty messages were found in this conversation.`);
    return {
      id, title, source: 'ChatGPT', provenance: { platform: 'chatgpt', sourceId: id, sourceRecordCount: rawEntries.length },
      messages: normalizedNodes.filter(message => activeIds.has(message.id)),
      ...(branches.length ? { history: { messages: normalizedNodes, branches, activeBranchId } } : {}),
      ...(mappingEvents.length ? { events: mappingEvents } : {}),
    };
  }
  if (Array.isArray(value.chat_messages)) {
    const entries = value.chat_messages.map((item) => {
      if (!record(item)) return item;
      const content = Array.isArray(item.content) && item.content.length === 0 ? item.text : item.content ?? item.text;
      return { ...item, role: item.sender, content };
    });
    const messages = schemaMessages(entries, id, index, warnings, 'claude', undefined, issues);
    return { id, title, source: 'Claude', provenance: { platform: 'claude', sourceId: id, sourceRecordCount: entries.length }, messages };
  }
  if (Array.isArray(value.messages)) {
    const platform: SourcePlatform = value.messages.some(item => record(item) && (Array.isArray(item.tool_calls) || typeof item.tool_call_id === 'string')) ? 'openai' : 'generic';
    const messages = schemaMessages(value.messages, id, index, warnings, platform, undefined, issues);
    return { id, title, source: asString(value.source) || (platform === 'openai' ? 'OpenAI-compatible JSON' : 'Messages JSON'), provenance: { platform, sourceId: id, sourceRecordCount: value.messages.length }, messages };
  }
  return undefined;
}

interface RecordParseResult {
  conversations: Conversation[];
  format: string;
  platform: SourcePlatform;
  sourceRecordCount: number;
  issues: IntegrityIssue[];
}

function parseRecords(values: Iterable<unknown>, filename: string, warnings: string[]): RecordParseResult {
  const messages: Message[] = [];
  const events: SessionEvent[] = [];
  const issues: IntegrityIssue[] = [];
  let inheritedIntegrity: IntegrityReport | undefined;
  let format = 'Messages JSONL';
  let title = filename;
  let id = 'conversation-1';
  let sourceId: string | undefined;
  let sourceRecordCount = 0;
  let unknownRecords = 0;
  let codex = false;
  let claudeCode = false;
  let claude = false;
  let generic = false;
  let openai = false;
  let threadpack = false;
  let threadpackSession: RecordValue | undefined;
  let n = 0;
  const addEvent = (value: unknown, type: string, platform: SourcePlatform, recordIndex: number): void => {
    const valueRecord = record(value) ? value : {};
    const rawTimestamp = valueRecord.timestamp ?? valueRecord.created_at;
    events.push({
      id: `event-${events.length + 1}`, type, recordIndex, platform,
      ...(asString(valueRecord.id) || asString(valueRecord.uuid) ? { sourceId: asString(valueRecord.id) || asString(valueRecord.uuid) } : {}),
      ...(typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number' ? { rawTimestamp } : {}),
      ...(timestamp(rawTimestamp) ? { timestamp: timestamp(rawTimestamp) } : {}),
      content: stringify(value),
    });
  };
  for (const value of values) {
    n++;
    sourceRecordCount++;
    if (!record(value)) {
      unknownRecords++;
      addEvent(value, 'unrecognized-record', 'unknown', n);
      continue;
    }
    if (value.type === 'threadpack_session' && value.version === 2) {
      threadpack = true;
      threadpackSession = value;
      if (record(value.integrity) && Array.isArray(value.integrity.issues)
        && (value.integrity.status === 'complete' || value.integrity.status === 'partial')
        && isNonnegativeSafeInteger(value.integrity.sourceRecordCount)
        && isNonnegativeSafeInteger(value.integrity.importedMessageCount)
        && isNonnegativeSafeInteger(value.integrity.branchCount)
        && isNonnegativeSafeInteger(value.integrity.timelineEventCount)
        && isNonnegativeSafeInteger(value.integrity.toolCallCount)
        && isNonnegativeSafeInteger(value.integrity.issueCount)) {
        const inherited = value.integrity as unknown as IntegrityReport;
        const validIssueCodes = ['malformed-record', 'unknown-record', 'empty-conversation', 'missing-parent', 'cyclic-parent', 'duplicate-source-id', 'orphan-tool-result', 'unmatched-tool-call', 'invalid-branch-reference', 'invalid-provenance'];
        const preservedIssues: IntegrityIssue[] = [];
        for (const issue of value.integrity.issues as unknown[]) {
          if (!record(issue) || !validIssueCodes.includes(asString(issue.code))
            || issue.severity !== 'warning' && issue.severity !== 'error' || !isNonnegativeSafeInteger(issue.count)) continue;
          preservedIssues.push({ code: asString(issue.code) as IntegrityIssue['code'], severity: issue.severity, count: issue.count });
        }
        const validIssueCount = preservedIssues.reduce((total, issue) => total + issue.count, 0);
        if (validIssueCount === inherited.issueCount) {
          inheritedIntegrity = {
            status: inherited.status,
            sourceRecordCount: inherited.sourceRecordCount,
            importedMessageCount: inherited.importedMessageCount,
            branchCount: inherited.branchCount,
            timelineEventCount: inherited.timelineEventCount,
            toolCallCount: inherited.toolCallCount,
            issueCount: validIssueCount,
            issues: preservedIssues,
          };
        } else {
          unknownRecords++;
          addEvent(value, 'invalid-threadpack-integrity', 'threadpack', n);
        }
      } else if (value.integrity !== undefined) {
        unknownRecords++;
        addEvent(value, 'invalid-threadpack-integrity', 'threadpack', n);
      }
      const savedProvenance = conversationProvenance(value.provenance);
      if (value.provenance !== undefined && !savedProvenance) {
        issues.push({ code: 'invalid-provenance', severity: 'warning', count: 1 });
        addEvent(value, 'invalid-threadpack-provenance', 'threadpack', n);
      } else if (savedProvenance?.sourceRecordCount !== undefined) sourceRecordCount = Math.max(sourceRecordCount, savedProvenance.sourceRecordCount);
      continue;
    }
    if (value.type === 'threadpack_message' && record(value.message)) {
      threadpack = true;
      const message = value.message;
      if (typeof message.id === 'string' && message.id.length <= 500 && typeof message.content === 'string' && roleOf(message.role)
        && validMessageProvenance(message.provenance)) {
        const kinds: MessageKind[] = ['message', 'tool-call', 'tool-result', 'reasoning', 'summary', 'compaction', 'metadata'];
        const provenance = messageProvenance(message.provenance);
        if ((message.provenance !== undefined && !provenance)
          || (message.kind !== undefined && !kinds.includes(message.kind as MessageKind))
          || (message.parentId !== undefined && (typeof message.parentId !== 'string' || message.parentId.length > 500))
          || (message.toolCallId !== undefined && (typeof message.toolCallId !== 'string' || message.toolCallId.length > 500))
          || (message.toolName !== undefined && (typeof message.toolName !== 'string' || message.toolName.length > 1000))
          || (message.timestamp !== undefined && typeof message.timestamp !== 'string')) {
          unknownRecords++;
          addEvent(value, 'invalid-threadpack-message', 'threadpack', n);
        } else {
          messages.push({
            id: message.id, role: roleOf(message.role)!, content: message.content,
            ...(typeof message.timestamp === 'string' ? { timestamp: message.timestamp } : {}),
            ...(typeof message.kind === 'string' ? { kind: message.kind as MessageKind } : {}),
            ...(typeof message.parentId === 'string' ? { parentId: message.parentId } : {}),
            ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}),
            ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}),
            ...(provenance ? { provenance } : {}),
          });
        }
      } else {
        unknownRecords++;
        addEvent(value, 'invalid-threadpack-message', 'threadpack', n);
      }
      continue;
    }
    if (value.type === 'threadpack_event' && record(value.event)) {
      threadpack = true;
      const event = value.event;
      const eventPlatform = sourcePlatforms.includes(event.platform as SourcePlatform) ? event.platform as SourcePlatform : 'threadpack';
      if (typeof event.id === 'string' && event.id.length <= 500 && typeof event.type === 'string' && event.type.length <= 500
        && typeof event.content === 'string' && Number.isSafeInteger(event.recordIndex) && (event.recordIndex as number) >= 0
        && (event.sourceId === undefined || typeof event.sourceId === 'string' && event.sourceId.length <= 2000)
        && (event.timestamp === undefined || typeof event.timestamp === 'string')
        && (event.rawTimestamp === undefined || ((typeof event.rawTimestamp === 'string' && event.rawTimestamp.length <= 1000) || (typeof event.rawTimestamp === 'number' && Number.isFinite(event.rawTimestamp))))) {
        events.push({
          id: event.id, type: event.type, content: event.content, recordIndex: event.recordIndex as number, platform: eventPlatform,
          ...(typeof event.sourceId === 'string' ? { sourceId: event.sourceId } : {}),
          ...(typeof event.timestamp === 'string' ? { timestamp: event.timestamp } : {}),
          ...(typeof event.rawTimestamp === 'string' || typeof event.rawTimestamp === 'number' ? { rawTimestamp: event.rawTimestamp } : {}),
        });
      } else {
        unknownRecords++;
        addEvent(value, 'invalid-threadpack-event', 'threadpack', n);
      }
      continue;
    }
    const recordType = asString(value.type);
    const fallbackId = `message-${n}`;
    if (value.type === 'session_meta') {
      codex = true;
      if (record(value.payload)) { sourceId = asString(value.payload.id) || sourceId; id = sourceId || id; }
      addEvent(value, recordType, 'codex', n);
      continue;
    }
    if (value.type === 'response_item' && record(value.payload)) {
      codex = true;
      const payload = value.payload;
      const context: MessageSourceContext = { platform: 'codex', recordIndex: n, recordType,
        ...(asString(payload.id) ? { sourceNodeId: asString(payload.id) } : {}),
        ...(asString(payload.parent_id ?? value.parent_id) ? { parentSourceId: asString(payload.parent_id ?? value.parent_id) } : {}) };
      if (payload.type === 'message') messages.push(...makeMessages(payload, fallbackId, undefined, value.timestamp, context));
      else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        messages.push(...makeMessages({ ...payload, id: payload.id ?? fallbackId, role: 'tool', tool_call_id: payload.call_id, content: [{ type: 'function_call_output', call_id: payload.call_id, output: payload.output }] }, fallbackId, 'tool', value.timestamp, context));
      } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        messages.push(...makeMessages({ role: 'assistant', id: payload.id ?? fallbackId, tool_calls: [{ id: payload.call_id, function: { name: payload.name, arguments: payload.arguments ?? payload.input } }] }, fallbackId, 'assistant', value.timestamp, context));
      } else if (payload.type === 'reasoning') {
        const content = payload.summary ?? payload.content ?? payload.text;
        messages.push(...makeMessages({ role: 'assistant', id: payload.id ?? fallbackId, content: [{ type: 'reasoning', content }] }, fallbackId, 'assistant', value.timestamp,
          { ...context, recordType: 'reasoning' }));
      } else {
        unknownRecords++;
        addEvent(value, recordType, 'codex', n);
      }
      continue;
    }
    if (value.type === 'function_call' || value.type === 'custom_tool_call') {
      codex = true;
      messages.push(...makeMessages({ role: 'assistant', id: value.id ?? fallbackId,
        tool_calls: [{ id: value.call_id ?? value.id, function: { name: value.name, arguments: value.arguments ?? value.input } }] }, fallbackId, 'assistant', value.timestamp,
      { platform: 'codex', recordIndex: n, recordType }));
      continue;
    }
    if (value.type === 'function_call_output' || value.type === 'custom_tool_call_output') {
      codex = true;
      messages.push(...makeMessages({ role: 'tool', id: value.id ?? fallbackId, tool_call_id: value.call_id,
        content: [{ type: 'function_call_output', call_id: value.call_id, output: value.output }] }, fallbackId, 'tool', value.timestamp,
      { platform: 'codex', recordIndex: n, recordType }));
      continue;
    }
    if (value.type === 'event_msg' || value.type === 'turn_context' || value.type === 'compacted') {
      // Codex event messages mirror response_item records. Do not duplicate them.
      if (value.type === 'compacted' && record(value.payload) && typeof value.payload.message === 'string') {
        messages.push({ id: fallbackId, role: 'system', kind: 'compaction', content: `[Provider compaction]\n${value.payload.message}`,
          timestamp: timestamp(value.timestamp), provenance: { platform: 'codex', recordIndex: n, recordType, ...(asString(value.id) ? { platformId: asString(value.id) } : {}), ...(typeof value.timestamp === 'string' || typeof value.timestamp === 'number' ? { rawTimestamp: value.timestamp } : {}) } });
      }
      addEvent(value, recordType, 'codex', n);
      continue;
    }
    if ((value.type === 'user' || value.type === 'assistant') && record(value.message)) {
      claudeCode = true;
      const nodeId = asString(value.uuid) || asString(value.message.id) || undefined;
      messages.push(...makeMessages({ ...value.message, id: nodeId }, fallbackId, roleOf(value.type), value.timestamp, {
        platform: 'claude-code', recordIndex: n, recordType, ...(nodeId ? { sourceNodeId: nodeId } : {}),
        ...(asString(value.parentUuid) ? { parentSourceId: asString(value.parentUuid) } : {}),
      }));
      continue;
    }
    if (value.type === 'summary' && typeof value.summary === 'string') {
      claudeCode = true;
      messages.push({ id: fallbackId, role: 'system', kind: 'summary', content: `[Provider summary]\n${value.summary}`,
        provenance: { platform: 'claude-code', recordIndex: n, recordType, ...(asString(value.uuid) ? { platformId: asString(value.uuid) } : {}) } });
      continue;
    }
    if (value.type === 'tool_result') {
      claudeCode = true;
      messages.push(...makeMessages({ role: 'tool', content: [{ type: 'tool_result', tool_use_id: value.tool_use_id, content: value.content ?? value.output }] }, fallbackId, 'tool', value.timestamp, { platform: 'claude-code', recordIndex: n, recordType }));
      continue;
    }
    const sourcePlatform: SourcePlatform = Array.isArray(value.chat_messages) ? 'claude' : Array.isArray(value.tool_calls) || value.tool_call_id ? 'openai' : 'generic';
    claude ||= sourcePlatform === 'claude';
    openai ||= sourcePlatform === 'openai';
    generic ||= sourcePlatform === 'generic';
    const parsed = makeMessages(value, fallbackId, undefined, undefined, { platform: sourcePlatform, recordIndex: n, recordType });
    if (parsed.length) messages.push(...parsed);
    else {
      unknownRecords++;
      addEvent(value, recordType || 'unrecognized-record', sourcePlatform, n);
    }
  }
  const embeddedProvenance = messages.find(message => message.provenance?.conversationTitle || message.provenance?.conversationSourceId)?.provenance;
  const platform: SourcePlatform = threadpack ? 'threadpack' : codex ? 'codex' : claudeCode ? 'claude-code' : claude ? 'claude' : embeddedProvenance?.platform ?? (openai ? 'openai' : generic ? 'generic' : 'unknown');
  if (threadpack) format = 'ThreadPack session JSONL';
  else if (embeddedProvenance) format = 'ThreadPack normalized JSONL';
  else if (codex) format = 'Codex JSONL';
  else if (claudeCode) format = 'Claude Code JSONL';
  else if (claude) format = 'Claude JSONL';
  if (unknownRecords) {
    issues.push({ code: 'unknown-record', severity: 'warning', count: unknownRecords });
    warnings.push(`${unknownRecords} unrecognized or metadata record(s) were retained in the session timeline for review.`);
  }
  if (threadpack && threadpackSession) {
    const normalized = uniqueIds(messages, warnings, issues);
    const rawBranches = Array.isArray(threadpackSession.branches) ? threadpackSession.branches : [];
    let invalidBranchCount = Array.isArray(threadpackSession.branches) ? 0 : threadpackSession.branches === undefined ? 0 : 1;
    const branches = rawBranches.flatMap((branch): ConversationBranch[] => {
      if (!record(branch) || typeof branch.id !== 'string' || branch.id.length > 500 || typeof branch.headMessageId !== 'string'
        || branch.headMessageId.length > 500 || !Array.isArray(branch.messageIds)) { invalidBranchCount++; return []; }
      const messageIds = branch.messageIds.filter((item): item is string => typeof item === 'string' && item.length <= 500);
      if (messageIds.length !== branch.messageIds.length) invalidBranchCount++;
      const sourceNodeIds = Array.isArray(branch.sourceNodeIds)
        ? branch.sourceNodeIds.filter((item): item is string => typeof item === 'string' && item.length <= 2000) : undefined;
      if (Array.isArray(branch.sourceNodeIds) && sourceNodeIds!.length !== branch.sourceNodeIds.length) invalidBranchCount++;
      return [{ id: branch.id, headMessageId: branch.headMessageId, messageIds, ...(sourceNodeIds ? { sourceNodeIds } : {}) }];
    });
    if (invalidBranchCount) {
      issues.push({ code: 'invalid-branch-reference', severity: 'warning', count: invalidBranchCount });
      warnings.push(`${invalidBranchCount} invalid branch record(s) in a normalized session were skipped or repaired.`);
    }
    let activeBranchId = asString(threadpackSession.activeBranchId) || branches[0]?.id || 'branch-1';
    let active = branches.find(branch => branch.id === activeBranchId);
    if (asString(threadpackSession.activeBranchId) && !active) {
      issues.push({ code: 'invalid-branch-reference', severity: 'warning', count: 1 });
      warnings.push('The session envelope references an unknown active branch; the first available branch was selected.');
      active = branches[0];
      activeBranchId = active?.id ?? '';
    }
    const normalizedById = new Map(normalized.map(message => [message.id, message]));
    const conversation: Conversation = {
      id: asString(threadpackSession.id) || 'conversation-1', title: asString(threadpackSession.title) || filename,
      source: asString(threadpackSession.source) || 'ThreadPack',
      provenance: conversationProvenance(threadpackSession.provenance) ?? { platform: 'threadpack' },
      messages: active?.messageIds.map(messageId => normalizedById.get(messageId)).filter((message): message is Message => Boolean(message)) ?? normalized,
      history: branches.length ? { messages: normalized, branches, activeBranchId } : undefined,
      events,
      ...(inheritedIntegrity ? { integrity: inheritedIntegrity } : {}),
    };
    if (inheritedIntegrity) {
      if (inheritedIntegrity.issueCount) warnings.push(`This normalized session preserves ${inheritedIntegrity.issues.length} content-free integrity issue category(ies) from its source import.`);
    }
    return { conversations: [conversation], format, platform, sourceRecordCount, issues };
  }
  // Keep the file name as the title. A truncated first user prompt could expose
  // a partial credential that no longer matches the full redaction pattern.
  const conversation: Conversation = {
    id, title: threadpackSession ? asString(threadpackSession.title) || filename : embeddedProvenance?.conversationTitle ?? title,
    source: threadpackSession ? asString(threadpackSession.source) || 'ThreadPack'
      : embeddedProvenance?.conversationSource ?? (codex ? 'Codex' : claudeCode ? 'Claude Code' : claude ? 'Claude' : generic ? 'JSONL' : 'Unknown session'),
    provenance: threadpackSession && record(threadpackSession.provenance)
      ? threadpackSession.provenance as unknown as Conversation['provenance']
      : { platform: embeddedProvenance?.platform ?? platform,
        ...((embeddedProvenance?.conversationSourceId ?? sourceId) ? { sourceId: embeddedProvenance?.conversationSourceId ?? sourceId } : {}),
        ...(embeddedProvenance?.conversationSourceRecordCount !== undefined ? { sourceRecordCount: embeddedProvenance.conversationSourceRecordCount } : { sourceRecordCount }) },
    messages: uniqueIds(messages, warnings, issues), events,
  };
  return { format, conversations: conversation.messages.length || events.length ? [conversation] : [], platform, sourceRecordCount, issues };
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

function parseJson(value: unknown, text: string, filename: string, warnings: string[], issues: IntegrityIssue[]): { conversations: Conversation[]; format: string; platform: SourcePlatform; sourceRecordCount: number } {
  const entries = Array.isArray(value) ? value : record(value) && Array.isArray(value.conversations) ? value.conversations : [value];
  const conversations: Conversation[] = [];
  const schemaFormats = new Set<string>();
  let unknownEntries = 0;
  const unknownEvents: SessionEvent[] = [];
  for (let n = 0; n < entries.length; n++) {
    const conversation = conversationFromJson(entries[n], n, filename, warnings, issues);
    if (conversation) {
      conversations.push(conversation);
      const entry = entries[n] as RecordValue;
      // Format is public diagnostic metadata, so derive it only from known
      // structural schemas, never an arbitrary source label from the export.
      schemaFormats.add(record(entry.mapping) ? 'ChatGPT export' : Array.isArray(entry.chat_messages) ? 'Claude export' : 'Messages JSON export');
    } else {
      unknownEntries++;
      unknownEvents.push({ id: `conversation-event-${n + 1}`, type: 'unrecognized-conversation', recordIndex: n + 1, platform: 'unknown', content: stringify(entries[n]) });
    }
  }
  if (conversations.length) {
    if (unknownEntries) {
      issues.push({ code: 'unknown-record', severity: 'warning', count: unknownEntries });
      warnings.push(`${unknownEntries} unrecognized conversation record(s) were retained as timeline events.`);
      conversations[0] = { ...conversations[0]!, events: [...(conversations[0]!.events ?? []), ...unknownEvents] };
    }
    const platform: SourcePlatform = conversations.every(conversation => conversation.provenance?.platform === 'chatgpt') ? 'chatgpt'
      : conversations.every(conversation => conversation.provenance?.platform === 'claude') ? 'claude'
        : conversations.every(conversation => conversation.provenance?.platform === 'openai') ? 'openai' : 'generic';
    const sourceRecordCount = conversations.reduce((count, conversation) => count + (conversation.provenance?.sourceRecordCount ?? conversation.messages.length), 0) + unknownEntries;
    return { conversations, format: schemaFormats.size === 1 ? schemaFormats.values().next().value! : 'Conversation archive', platform, sourceRecordCount };
  }
  const records = parseRecords(entries, filename, warnings);
  if (records.conversations.some(conversation => conversation.messages.length) || records.conversations.length && records.platform !== 'unknown' && records.platform !== 'generic') {
    return { ...records, format: records.format.replace('JSONL', 'JSON') };
  }
  warnings.push('Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.');
  issues.push({ code: 'unknown-record', severity: 'warning', count: 1 });
  return { format: 'Unrecognized JSON', platform: 'unknown', sourceRecordCount: 1, conversations: [{ id: 'conversation-1', title: filename, source: 'JSON text', provenance: { platform: 'unknown', sourceRecordCount: 1 }, messages: [{ id: 'message-1', role: 'user', content: text }] }] };
}

function parseText(text: string, filename: string): { conversations: Conversation[]; format: string; platform: SourcePlatform; sourceRecordCount: number } {
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
  return { format: /\.md$/i.test(filename) ? 'Markdown' : 'Plain text', platform: 'text', sourceRecordCount: 1,
    conversations: [{ id: 'conversation-1', title: filename, source: 'Text', provenance: { platform: 'text' }, messages }] };
}

function finalizeArchive(parsed: { conversations: Conversation[]; format: string; platform?: SourcePlatform; sourceRecordCount?: number; issues?: IntegrityIssue[] }, warnings: string[], issues: IntegrityIssue[], sourceBytes: number): ParsedArchive {
  if (parsed.issues) issues.push(...parsed.issues);
  const platform = parsed.platform ?? 'unknown';
  let importedMessageCount = 0;
  let branchCount = 0;
  let timelineEventCount = 0;
  let toolCallCount = 0;
  const conversations = parsed.conversations.map((conversation, index) => {
    const sourceId = conversation.provenance?.sourceId;
    const id = `conversation-${index + 1}`;
    const annotate = (message: Message, messageIndex: number): Message => ({
      ...message,
      provenance: message.provenance ?? {
        platform: conversation.provenance?.platform ?? platform,
        recordIndex: messageIndex + 1,
        ...(message.timestamp !== undefined ? { rawTimestamp: message.timestamp } : {}),
      },
    });
    let messages: Message[];
    let history = conversation.history;
    if (history) {
      const sourceHistory = history;
      const sourceActiveBranchId = sourceHistory.activeBranchId;
      const historyMessages = sourceHistory.messages.map(annotate);
      const byId = new Map(historyMessages.map(message => [message.id, message]));
      messages = conversation.messages.map(message => byId.get(message.id) ?? annotate(message, 0));
      const validIds = new Set(historyMessages.map(message => message.id));
      let invalidBranches = 0;
      const branchIdMap = new Map<string, string>();
      const seenBranchIds = new Set<string>();
      const branches = sourceHistory.branches.map((branch, branchIndex) => {
        const messageIds = branch.messageIds.filter(messageId => validIds.has(messageId));
        const headMessageId = validIds.has(branch.headMessageId) ? branch.headMessageId : messageIds.at(-1) ?? '';
        if (messageIds.length !== branch.messageIds.length || !validIds.has(branch.headMessageId) || !branch.id || seenBranchIds.has(branch.id)) invalidBranches++;
        const normalizedBranchId = `branch-${branchIndex + 1}`;
        if (branch.id && !branchIdMap.has(branch.id)) branchIdMap.set(branch.id, normalizedBranchId);
        if (branch.id) seenBranchIds.add(branch.id);
        const sourceNodeIds = branch.sourceNodeIds?.filter(nodeId => typeof nodeId === 'string' && nodeId.length <= 2000);
        if (branch.sourceNodeIds && sourceNodeIds?.length !== branch.sourceNodeIds.length) invalidBranches++;
        return { id: normalizedBranchId, messageIds, headMessageId, ...(sourceNodeIds ? { sourceNodeIds } : {}) };
      }).filter(branch => branch.id && branch.headMessageId);
      const activeBranchId = branchIdMap.get(sourceActiveBranchId) && branches.some(branch => branch.id === branchIdMap.get(sourceActiveBranchId))
        ? branchIdMap.get(sourceActiveBranchId)! : branches[0]?.id ?? '';
      if (invalidBranches || activeBranchId !== sourceActiveBranchId) {
        const count = Math.max(1, invalidBranches);
        issues.push({ code: 'invalid-branch-reference', severity: 'warning', count });
        warnings.push(`${count} branch reference(s) did not match an imported message and were repaired where possible.`);
      }
      history = { messages: historyMessages, branches, activeBranchId };
      importedMessageCount += historyMessages.length;
      branchCount += branches.length;
      toolCallCount += historyMessages.filter(message => message.kind === 'tool-call').length;
    } else {
      const sourceMessages = conversation.messages.map(annotate);
      messages = uniqueIds(sourceMessages, warnings, issues);
      importedMessageCount += messages.length;
      toolCallCount += messages.filter(message => message.kind === 'tool-call').length;
    }
    timelineEventCount += conversation.events?.length ?? 0;
    return {
      ...conversation, id, messages, ...(history ? { history } : {}),
      provenance: { platform: conversation.provenance?.platform ?? platform, ...(sourceId ? { sourceId } : {}),
        ...(conversation.provenance?.sourceRecordCount !== undefined ? { sourceRecordCount: conversation.provenance.sourceRecordCount } : {}) },
      ...(conversation.events ? { events: conversation.events.map((event, eventIndex) => ({ ...event, id: `event-${eventIndex + 1}` })) } : {}),
    };
  });
  const integrityIssues = [...issues];
  const mergedIssueIndexes = new Map(integrityIssues.map((issue, index) => [`${issue.code}\0${issue.severity}`, index]));
  for (const conversation of parsed.conversations) {
    for (const issue of conversation.integrity?.issues ?? []) {
      const key = `${issue.code}\0${issue.severity}`;
      const existingIndex = mergedIssueIndexes.get(key);
      if (existingIndex === undefined) {
        mergedIssueIndexes.set(key, integrityIssues.length);
        integrityIssues.push(issue);
      } else {
        integrityIssues[existingIndex] = { ...issue, count: Math.max(issue.count, integrityIssues[existingIndex]!.count) };
      }
    }
  }
  const issueCount = integrityIssues.reduce((total, issue) => total + issue.count, 0);
  const integrity: IntegrityReport = {
    status: warnings.length || issueCount || parsed.conversations.some(conversation => conversation.integrity?.status === 'partial') ? 'partial' : 'complete',
    sourceRecordCount: parsed.sourceRecordCount ?? parsed.conversations.reduce((count, conversation) => count + (conversation.integrity?.sourceRecordCount
      ?? conversation.provenance?.sourceRecordCount ?? conversation.messages.length), 0),
    importedMessageCount,
    branchCount,
    timelineEventCount,
    toolCallCount,
    issueCount,
    issues: integrityIssues,
  };
  const completeConversations = conversations.map(conversation => ({ ...conversation, integrity }));
  return { format: parsed.format, conversations: completeConversations, warnings, sourceBytes,
    provenance: { platform, format: parsed.format, byteLength: sourceBytes }, integrity };
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
  const issues: IntegrityIssue[] = [];
  let parsed: { conversations: Conversation[]; format: string; platform?: SourcePlatform; sourceRecordCount?: number; issues?: IntegrityIssue[] };
  if (jsonl) {
    const stats: JsonlParseStats = { validRecords: 0, malformedLines: 0 };
    parsed = parseRecords(jsonlValues(normalized, stats), filename, warnings);
    if (stats.malformedLines) {
      issues.push({ code: 'malformed-record', severity: 'warning', count: stats.malformedLines });
      warnings.unshift(`${stats.malformedLines} invalid JSONL line(s) were skipped. Keep the original file to recover them.`);
    }
    parsed.sourceRecordCount = (parsed.sourceRecordCount ?? stats.validRecords) + stats.malformedLines;
    if (!stats.validRecords) throw new Error('No valid JSONL records were found. Check the export format or use a .txt file for plain text.');
    if (!parsed.conversations.length) throw new Error('The JSONL contains no recognized conversation messages or timeline events. Supported formats: Codex, Claude Code, or records with role and content.');
  } else if (json || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value: unknown;
    try { value = JSON.parse(normalized); }
    catch {
      if (json) throw new Error('Invalid JSON. Repair the export before importing; it was not treated as a complete transcript.');
      // A pasted JSONL transcript has no filename. Detect it without silently accepting broken JSON.
      const lines = normalized.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > 1 && lines.every((line) => { try { JSON.parse(line); return true; } catch { return false; } })) {
        parsed = parseRecords(lines.map((line) => JSON.parse(line)), filename, warnings);
        if (!parsed.conversations.length) throw new Error('No recognized messages or timeline events were found in the pasted JSONL.');
        return finalizeArchive(parsed, warnings, issues, sourceBytes);
      }
      warnings.push('Input starts like JSON but is not valid JSON. It was preserved as plain text.');
      parsed = parseText(normalized, filename);
      return finalizeArchive(parsed, warnings, issues, sourceBytes);
    }
    parsed = parseJson(value, normalized, filename, warnings, issues);
  } else parsed = parseText(normalized, filename);
  return finalizeArchive(parsed, warnings, issues, sourceBytes);
}
