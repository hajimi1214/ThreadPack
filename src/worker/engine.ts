import { buildHandoff, buildJsonl, buildTranscript, cleanConversation, parseInput, validateCustomSecrets } from '../core';
import type { Change, CleanOptions, CleanResult, Conversation, ParsedArchive } from '../core';
import { searchPattern } from '../preview';
import { APP_VERSION } from '../version';
import type { CleanSummary, CompareMessageRequest, CompareMessageResult, ConversationInfo, CopyMessageRequest, ExportResult, HandoffRequest, ImportProgress, ParseInfo, ParseRequest, PreviewMessage, QueryRequest, QueryResult, WorkerRequest, WorkerResult, WorkerResultMap } from './types';

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const MAX_PREVIEW_CHARACTERS = 12000;
const STALE_REVISION = 'This preview is out of date. Refresh the cleanup result and try again.';
const CANCELLED_IMPORT = 'This import was cancelled or replaced by a newer import.';
const IMAGE_DATA = /data:image\/[a-z0-9.+-]+;base64,(?:[a-z0-9+/=_-]|\\[rn])+/gi;
const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).byteLength;

interface CleanCache {
  revision: number;
  optionsKey: string;
  options: CleanOptions;
  result: CleanResult;
  changes: Map<string, Change[]>;
  originalSizes: Map<string, number>;
  cleanedSizes: Map<string, number>;
}
interface ArchiveState { archive: ParsedArchive; cleaned: Map<string, CleanCache> }

const info = (conversation: Conversation): ConversationInfo => ({
  id: conversation.id,
  title: conversation.title.slice(0, 500),
  source: conversation.source.slice(0, 200),
  messageCount: conversation.messages.length,
});

function snapshotOptions(options: CleanOptions): CleanOptions {
  if (!options || ['stripImages', 'trimToolOutputs', 'deduplicate', 'redact', 'redactEmails'].some(key => typeof options[key as keyof CleanOptions] !== 'boolean')) {
    throw new Error('Valid cleanup settings are required.');
  }
  return {
    stripImages: options.stripImages, trimToolOutputs: options.trimToolOutputs, toolLimit: options.toolLimit,
    deduplicate: options.deduplicate, redact: options.redact, redactEmails: options.redactEmails,
    customSecrets: validateCustomSecrets(options.customSecrets),
  };
}

function previewContent(content: string, query: string): { text: string; shortened: boolean } {
  const readable = content.replace(IMAGE_DATA, '[Embedded image payload · hidden in preview]');
  const hiddenImage = readable !== content;
  if (readable.length <= MAX_PREVIEW_CHARACTERS) return { text: readable, shortened: hiddenImage };
  const marker = '\n\n[Preview shortened. Export includes the complete selected output.]\n\n';
  const available = MAX_PREVIEW_CHARACTERS - marker.length;
  const match = searchPattern(query)?.exec(readable);
  if (match) {
    const start = Math.max(0, Math.min(readable.length - available, match.index - Math.floor(available * .35)));
    return { text: marker + readable.slice(start, start + available), shortened: true };
  }
  const head = Math.floor(available * .7);
  return { text: readable.slice(0, head) + marker + readable.slice(-(available - head)), shortened: true };
}

/** Worker-owned archive, cleanup, search and export state. No full conversation crosses the RPC boundary. */
export class WorkerEngine {
  private archives = new Map<number, ArchiveState>();
  private acceptedArchiveId: number | null = null;
  private parseSequence = 0;
  private revisionSequence = 0;

  async handle<T extends WorkerRequest>(request: T, progress?: (value: ImportProgress) => void): Promise<WorkerResultMap[T['type']]> {
    return await this.dispatch(request, progress) as WorkerResultMap[T['type']];
  }

  private async dispatch(request: WorkerRequest, progress?: (value: ImportProgress) => void): Promise<WorkerResult> {
    if (!request || !Number.isSafeInteger(request.id) || request.id < 1) throw new Error('A valid request reference is required.');
    if (request.type === 'clear') {
      ++this.parseSequence;
      this.archives.clear();
      this.acceptedArchiveId = null;
      return null;
    }
    if (!Number.isSafeInteger(request.archiveId) || request.archiveId < 1) throw new Error('A valid archive reference is required. Import the conversation again.');
    if (request.type === 'parse') return this.parse(request, progress);
    const state = this.archives.get(request.archiveId);
    const original = state?.archive.conversations.find(conversation => conversation.id === request.conversationId);
    if (!state || !original) throw new Error('This conversation is unavailable. Import the conversation again.');
    if (request.type === 'clean') {
      const options = snapshotOptions(request.options);
      const optionsKey = JSON.stringify(options);
      let cache = state.cleaned.get(original.id);
      if (!cache || cache.optionsKey !== optionsKey) {
        const result = cleanConversation(original, options);
        const changes = new Map<string, Change[]>();
        for (const change of result.changes) {
          const group = changes.get(change.messageId);
          if (group) group.push(change); else changes.set(change.messageId, [change]);
        }
        cache = {
          revision: ++this.revisionSequence, optionsKey, options, result, changes,
          originalSizes: cache?.originalSizes ?? new Map(original.messages.map(message => [message.id, byteLength(message.content)])),
          cleanedSizes: new Map(result.conversation.messages.map(message => [message.id, byteLength(message.content)])),
        };
        state.cleaned.set(original.id, cache);
      }
      this.acceptedArchiveId = request.archiveId;
      const summary: CleanSummary = {
        conversation: info(cache.result.conversation), revision: cache.revision,
        stats: { ...cache.result.stats }, warnings: [...cache.result.warnings], changedMessageCount: cache.changes.size,
      };
      return summary;
    }
    const cache = state.cleaned.get(original.id);
    if (!cache || cache.revision !== request.revision) throw new Error(STALE_REVISION);
    if (request.type === 'query') return this.query(original, cache, request);
    if (request.type === 'copy-message') return this.copyMessage(original, cache, request);
    if (request.type === 'compare-message') return this.compareMessage(original, cache, request);
    if (request.type === 'export') return this.export(state.archive, cache, request.format);
    if (request.type === 'handoff') return this.handoff(cache, request);
    throw new Error('This operation is not supported.');
  }

  private async parse(request: ParseRequest, progress?: (value: ImportProgress) => void): Promise<ParseInfo> {
    const sequence = ++this.parseSequence;
    if (this.archives.has(request.archiveId)) throw new Error('This archive reference is already in use. Start a new import.');
    const checkActive = (): void => { if (sequence !== this.parseSequence) throw new Error(CANCELLED_IMPORT); };
    let text: string;
    let sourceBytes: number;
    if (request.file) {
      const file = request.file;
      if (typeof file.stream !== 'function' || !Number.isFinite(file.size) || file.size < 0 || file.size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit or cannot be read.');
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try { reader = file.stream().getReader(); }
      catch { throw new Error('This file could not be read. Choose it again or paste its text.'); }
      const decoder = new TextDecoder('utf-8');
      const chunks: string[] = [];
      sourceBytes = 0;
      let lastProgressBytes = 0;
      let lastProgressTime = 0;
      progress?.({ loaded: 0, total: file.size });
      try {
        for (;;) {
          checkActive();
          const chunk = await reader.read();
          checkActive();
          if (chunk.done) break;
          sourceBytes += chunk.value.byteLength;
          if (sourceBytes > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.');
          chunks.push(decoder.decode(chunk.value, { stream: true }));
          const now = Date.now();
          if (sourceBytes - lastProgressBytes >= 1024 * 1024 || now - lastProgressTime >= 80) {
            progress?.({ loaded: sourceBytes, total: file.size });
            lastProgressBytes = sourceBytes; lastProgressTime = now;
          }
        }
        chunks.push(decoder.decode());
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof Error && (error.message === CANCELLED_IMPORT || error.message.startsWith('This file exceeds'))) throw error;
        throw new Error('This file could not be read. Choose it again or paste its text.');
      } finally { reader.releaseLock(); }
      text = chunks.join('');
      progress?.({ loaded: sourceBytes, total: file.size });
    } else {
      text = request.text ?? '';
      sourceBytes = byteLength(text);
      if (sourceBytes > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.');
    }
    checkActive();
    const archive = parseInput(text, request.filename ?? request.file?.name ?? 'pasted.txt');
    checkActive();
    archive.sourceBytes = sourceBytes;
    // The importing interface owns acceptance. An older queued clean may run
    // after a newer selection, so the explicit keep reference takes precedence.
    const keep = request.keepArchiveId !== null && this.archives.has(request.keepArchiveId)
      ? request.keepArchiveId : this.acceptedArchiveId;
    for (const archiveId of this.archives.keys()) if (archiveId !== keep) this.archives.delete(archiveId);
    this.archives.set(request.archiveId, { archive, cleaned: new Map() });
    return {
      archiveId: request.archiveId, format: archive.format, warnings: [...archive.warnings], sourceBytes,
      conversations: archive.conversations.map(info),
    };
  }

  private query(original: Conversation, cache: CleanCache, request: QueryRequest): QueryResult {
    if (!['cleaned', 'original'].includes(request.mode) || !['all', 'user', 'assistant', 'tool', 'system'].includes(request.role) || typeof request.query !== 'string' || request.query.length > 1000 || typeof request.changedOnly !== 'boolean' || typeof request.pinnedOnly !== 'boolean' || !Array.isArray(request.pinnedIds) || request.pinnedIds.some(id => typeof id !== 'string' || id.length > 500) || request.pinnedIds.length > original.messages.length || request.pageSize !== 30 || !Number.isSafeInteger(request.page) || request.page < 0) {
      throw new Error('Valid preview filters and a page number are required.');
    }
    const conversation = request.mode === 'original' ? original : cache.result.conversation;
    const pattern = searchPattern(request.query);
    const pinned = new Set(request.pinnedIds);
    const matches: number[] = [];
    for (let index = 0; index < conversation.messages.length; index++) {
      const message = conversation.messages[index]!;
      if (request.role !== 'all' && message.role !== request.role) continue;
      if (request.changedOnly && !cache.changes.has(message.id)) continue;
      if (request.pinnedOnly && !pinned.has(message.id)) continue;
      // Match the complete worker-owned content before image removal or clipping.
      if (pattern && !pattern.test(message.content)) continue;
      matches.push(index);
    }
    const pageCount = Math.max(1, Math.ceil(matches.length / 30));
    const page = Math.min(request.page, pageCount - 1);
    const sizes = request.mode === 'original' ? cache.originalSizes : cache.cleanedSizes;
    const items: PreviewMessage[] = matches.slice(page * 30, (page + 1) * 30).map(index => {
      const message = conversation.messages[index]!;
      const preview = previewContent(message.content, request.query);
      return { message: { ...message, content: preview.text }, index, bytes: sizes.get(message.id) ?? 0,
        changes: (cache.changes.get(message.id) ?? []).map(change => ({ ...change })), shortened: preview.shortened };
    });
    return { items, total: matches.length, page, pageCount };
  }

  private copyMessage(original: Conversation, cache: CleanCache, request: CopyMessageRequest): { text: string } {
    if (!['cleaned', 'original'].includes(request.mode) || typeof request.messageId !== 'string' || request.messageId.length < 1 || request.messageId.length > 500) {
      throw new Error('A valid message reference is required.');
    }
    const conversation = request.mode === 'original' ? original : cache.result.conversation;
    const message = conversation.messages.find(candidate => candidate.id === request.messageId);
    if (!message) throw new Error('This message is unavailable in the selected view.');
    return { text: message.content };
  }

  private compareMessage(original: Conversation, cache: CleanCache, request: CompareMessageRequest): CompareMessageResult {
    if (typeof request.messageId !== 'string' || request.messageId.length < 1 || request.messageId.length > 500) {
      throw new Error('A valid message reference is required.');
    }
    const source = original.messages.find(message => message.id === request.messageId);
    const cleaned = cache.result.conversation.messages.find(message => message.id === request.messageId);
    if (!source || !cleaned) throw new Error('This message is unavailable in the selected view.');
    const excerpt = (content: string): CompareMessageResult['original'] => {
      const readable = content.replace(IMAGE_DATA, '[Embedded image payload · hidden in preview]');
      const imageHidden = readable !== content;
      if (readable.length <= MAX_PREVIEW_CHARACTERS) return { text: readable, shortened: false, imageHidden };
      const marker = '\n\n[Review excerpt shortened · beginning and end shown.]\n\n';
      const available = MAX_PREVIEW_CHARACTERS - marker.length;
      const head = Math.ceil(available / 2);
      const tail = available - head;
      return { text: readable.slice(0, head) + marker + readable.slice(-tail), shortened: true, imageHidden };
    };
    return {
      original: excerpt(source.content), cleaned: excerpt(cleaned.content),
      changes: (cache.changes.get(request.messageId) ?? []).map(change => ({ ...change })),
    };
  }

  private export(archive: ParsedArchive, cache: CleanCache, format: 'markdown' | 'jsonl' | 'report'): ExportResult {
    const conversation = cache.result.conversation;
    const conversationIndex = archive.conversations.findIndex(item => item.id === conversation.id);
    const suffix = archive.conversations.length > 1 ? `-${Math.max(0, conversationIndex) + 1}` : '';
    const options = cache.options;
    let text: string;
    let filename: string;
    let mimeType: string;
    if (format === 'markdown') { text = buildTranscript(conversation); filename = `threadpack-transcript${suffix}.md`; mimeType = 'text/markdown;charset=utf-8'; }
    else if (format === 'jsonl') { text = buildJsonl(conversation); filename = `threadpack-transcript${suffix}.jsonl`; mimeType = 'application/x-ndjson;charset=utf-8'; }
    else if (format === 'report') {
      text = JSON.stringify({ tool: 'ThreadPack', version: APP_VERSION, format: archive.format, messageCount: conversation.messages.length, stats: cache.result.stats,
        options: { stripImages: options.stripImages, trimToolOutputs: options.trimToolOutputs, toolLimit: options.toolLimit, deduplicate: options.deduplicate,
          redact: options.redact, redactEmails: options.redactEmails, customRuleCount: options.customSecrets?.length ?? 0 },
        scope: 'UTF-8 normalized message text; excludes source metadata. No message text, file paths, or custom redaction values are included in this report.',
      }, null, 2);
      filename = `threadpack-report${suffix}.json`; mimeType = 'application/json;charset=utf-8';
    } else throw new Error('Choose a supported export format.');
    return { buffer: encoder.encode(text).buffer as ArrayBuffer, filename, mimeType };
  }

  private handoff(cache: CleanCache, request: HandoffRequest): { text: string } {
    const keys = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
    if (!request.notes || keys.some(key => typeof request.notes[key] !== 'string' || request.notes[key].length > 12000) || !Array.isArray(request.pinnedIds) || request.pinnedIds.some(id => typeof id !== 'string')) {
      throw new Error('Valid handoff notes and pinned messages are required.');
    }
    const cleanedNotes = cleanConversation({ id: 'notes', title: '', source: 'notes', messages: keys.map(key => ({ id: key, role: 'user' as const, content: request.notes[key] })) }, { ...cache.options, trimToolOutputs: false, deduplicate: false });
    const notes = Object.fromEntries(cleanedNotes.conversation.messages.map(message => [message.id, message.content.replace(/\[(SECRET|EMAIL|CUSTOM)_(\d+)\]/g, '[NOTE_$1_$2]')])) as unknown as HandoffRequest['notes'];
    return { text: buildHandoff(cache.result.conversation, { ...notes, pinnedIds: request.pinnedIds, recentCount: request.recentCount, maxCharacters: request.maxCharacters }) };
  }
}
