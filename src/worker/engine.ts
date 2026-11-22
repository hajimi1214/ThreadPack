import { buildContextBundleReadme, buildFilteredTranscript, buildHandoffWithSummary, buildJsonl, buildTranscript, cleanConversation, outputLabels, parseInput, validateCustomSecrets } from '../core';
import type { Change, CleanOptions, CleanResult, Conversation, ParsedArchive } from '../core';
import type { OutputLanguage } from '../core';
import { extractCodeSnippets } from '../core/snippets';
import type { CodeSnippet } from '../core/snippets';
import { searchPattern } from '../preview';
import { APP_VERSION } from '../version';
import { buildCodeArchive, codeSnippetFilename, normalizedSnippetLanguage } from './code-archive';
import { buildContextBundle } from './context-bundle';
import { extractZipText } from './zip-import';
import { sha256Fingerprint } from '../handoff-draft';
import { localizeWarning } from '../../cli/i18n';
import type { CleanSummary, CompareMessageRequest, CompareMessageResult, ContextBundleResult, ConversationInfo, CopyMessageRequest, ExcerptExportResult, ExportBundleRequest, ExportExcerptRequest, ExportResult, ExportSnippetsRequest, ExportSourceSessionResult, HandoffRequest, ImportProgress, ParseInfo, ParseRequest, PreviewFilters, PreviewMessage, QueryRequest, QueryResult, QuerySnippetsRequest, SnippetArchiveResult, SnippetFilters, SnippetQueryResult, WorkerRequest, WorkerResult, WorkerResultMap } from './types';

export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const MAX_PREVIEW_CHARACTERS = 12000;
export const MAX_SNIPPET_PREVIEW_CHARACTERS = 2000;
const STALE_REVISION = 'This preview is out of date. Refresh the cleanup result and try again.';
const CANCELLED_IMPORT = 'This import was cancelled or replaced by a newer import.';
const IMAGE_DATA = /data:image\/[a-z0-9.+-]+;base64,(?:[a-z0-9+/=_-]|\\[rn])+/gi;
const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).byteLength;

async function messageFingerprint(message: Conversation['messages'][number]): Promise<string> {
  return sha256Fingerprint(`${message.role}\0${message.timestamp ?? ''}\0${message.content}`);
}

interface CleanCache {
  revision: number;
  optionsKey: string;
  options: CleanOptions;
  result: CleanResult;
  changes: Map<string, Change[]>;
  originalSizes: Map<string, number>;
  cleanedSizes: Map<string, number>;
  snippets?: CodeSnippet[];
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
    if (request.type === 'export-source-session') return this.exportSourceSession(state.archive.format, original);
    if (request.type === 'pin-numbers') {
      if (!Array.isArray(request.pinnedIds) || request.pinnedIds.length > original.messages.length
        || request.pinnedIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 500)) {
        throw new Error('Valid pinned message references are required.');
      }
      const messageIndexes = new Map<string, number>();
      original.messages.forEach((message, index) => {
        if (messageIndexes.has(message.id)) messageIndexes.set(message.id, -1);
        else messageIndexes.set(message.id, index);
      });
      const indexes = request.pinnedIds.map(id => messageIndexes.get(id) ?? -1);
      if (indexes.some(index => index < 0) || new Set(indexes).size !== indexes.length) {
        throw new Error('Pinned messages could not be matched to this conversation.');
      }
      const pinnedMessages = await Promise.all(indexes.map(async index => ({
        number: index + 1,
        fingerprint: await messageFingerprint(original.messages[index]!),
      })));
      return { pinnedMessages };
    }
    if (request.type === 'pin-ids') {
      if (!Array.isArray(request.pinnedMessages) || request.pinnedMessages.length > original.messages.length
        || request.pinnedMessages.some(pin => !pin || !Number.isSafeInteger(pin.number) || pin.number < 1 || pin.number > original.messages.length
          || typeof pin.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pin.fingerprint))
        || new Set(request.pinnedMessages.map(pin => pin.number)).size !== request.pinnedMessages.length) {
        throw new Error('Valid pinned message numbers are required.');
      }
      const pinnedIds = await Promise.all(request.pinnedMessages.map(async pin => {
        const message = original.messages[pin.number - 1]!;
        return await messageFingerprint(message) === pin.fingerprint ? message.id : '';
      }));
      if (new Set(pinnedIds).size !== pinnedIds.length) throw new Error('Pinned messages could not be matched to this conversation.');
      if (pinnedIds.some(id => !id)) throw new Error('Pinned messages could not be matched to this conversation.');
      return { pinnedIds };
    }
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
    if (request.type === 'export') return this.export(state.archive, cache, request.format, request.language ?? 'en');
    if (request.type === 'export-excerpt') return this.exportExcerpt(state.archive, original, cache, request);
    if (request.type === 'query-snippets') return this.querySnippets(cache, request);
    if (request.type === 'export-snippets') return this.exportSnippets(state.archive, cache, request);
    if (request.type === 'copy-snippet') return { text: this.snippet(cache, request.snippetId).text };
    if (request.type === 'export-snippet') {
      const { snippet, text } = this.snippet(cache, request.snippetId);
      return { buffer: encoder.encode(text).buffer as ArrayBuffer,
        filename: codeSnippetFilename(snippet),
        mimeType: 'text/plain;charset=utf-8' };
    }
    if (request.type === 'handoff') return this.handoff(cache, request);
    if (request.type === 'export-bundle') return this.exportBundle(state.archive, cache, request);
    throw new Error('This operation is not supported.');
  }

  private async parse(request: ParseRequest, progress?: (value: ImportProgress) => void): Promise<ParseInfo> {
    const sequence = ++this.parseSequence;
    if (this.archives.has(request.archiveId)) throw new Error('This archive reference is already in use. Start a new import.');
    const checkActive = (): void => { if (sequence !== this.parseSequence) throw new Error(CANCELLED_IMPORT); };
    let text = '';
    let parsedFilename = request.filename ?? request.file?.name ?? 'pasted.txt';
    let importWarning: string | undefined;
    let sourceBytes = 0;
    if (request.file) {
      const file = request.file;
      if ((!file.stream && !file.arrayBuffer && typeof FileReader === 'undefined') || !Number.isFinite(file.size) || file.size < 0 || file.size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit or cannot be read.');
      if (/\.zip$/i.test(file.name)) {
        let bytes: Uint8Array;
        try {
          if (typeof file.arrayBuffer === 'function') {
            bytes = new Uint8Array(await file.arrayBuffer());
            checkActive();
            if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.');
            progress?.({ loaded: bytes.byteLength, total: file.size });
          }
          else if (typeof file.stream === 'function') {
            const reader = file.stream().getReader(); const chunks: Uint8Array[] = []; let size = 0;
            for (;;) { checkActive(); const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.'); chunks.push(chunk.value); }
            bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          } else bytes = await new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file); });
          const extracted = extractZipText(bytes); text = extracted.text; parsedFilename = extracted.filename; sourceBytes = bytes.byteLength; importWarning = extracted.warning;
        } catch (error) {
          if (error instanceof Error && (error.message.includes('ZIP') || error.message.includes('100 MiB') || error.message.includes('supported text'))) throw error;
          throw new Error('This ZIP could not be read. Choose a valid conversation export.');
        }
      } else {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      if (typeof file.stream === 'function') {
        try { reader = file.stream().getReader(); }
        catch { throw new Error('This file could not be read. Choose it again or paste its text.'); }
      } else {
        try {
          const bytes = typeof file.arrayBuffer === 'function' ? new Uint8Array(await file.arrayBuffer()) : await new Promise<Uint8Array>((resolve, reject) => { const fallback = new FileReader(); fallback.onload = () => resolve(new Uint8Array(fallback.result as ArrayBuffer)); fallback.onerror = () => reject(fallback.error); fallback.readAsArrayBuffer(file); });
          checkActive();
          if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.');
          text = new TextDecoder('utf-8').decode(bytes); sourceBytes = bytes.byteLength; progress?.({ loaded: sourceBytes, total: file.size });
          reader = null as unknown as ReadableStreamDefaultReader<Uint8Array>;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('This file exceeds')) throw error;
          throw new Error('This file could not be read. Choose it again or paste its text.');
        }
      }
      if (reader) {
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
      chunks.length = 0;
      progress?.({ loaded: sourceBytes, total: file.size });
      }
      }
    } else {
      text = request.text ?? '';
      sourceBytes = byteLength(text);
      if (sourceBytes > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 100 MiB limit. Split it into smaller exports first.');
    }
    checkActive();
    const archive = parseInput(text, parsedFilename, sourceBytes);
    if (importWarning) archive.warnings.push(importWarning);
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
      integrity: archive.integrity!,
      conversations: archive.conversations.map(info),
    };
  }

  private exportSourceSession(format: string, conversation: Conversation): ExportSourceSessionResult {
    const content = buildJsonl(conversation);
    return {
      buffer: encoder.encode(content).buffer as ArrayBuffer,
      filename: 'threadpack-session.jsonl', mimeType: 'application/x-ndjson;charset=utf-8',
      platform: conversation.provenance?.platform ?? conversation.messages[0]?.provenance?.platform ?? 'unknown',
      ...(conversation.provenance?.sourceId ? { sourceId: conversation.provenance.sourceId } : {}),
      format, messageCount: conversation.messages.length, sourceBytes: byteLength(content),
    };
  }

  private matchingMessages(original: Conversation, cache: CleanCache, request: PreviewFilters): { conversation: Conversation; matches: number[] } {
    if (!['cleaned', 'original'].includes(request.mode) || !['all', 'user', 'assistant', 'tool', 'system'].includes(request.role) || typeof request.query !== 'string' || request.query.length > 1000 || typeof request.changedOnly !== 'boolean' || typeof request.pinnedOnly !== 'boolean' || !Array.isArray(request.pinnedIds) || request.pinnedIds.some(id => typeof id !== 'string' || id.length > 500) || request.pinnedIds.length > original.messages.length) {
      throw new Error('Valid preview filters are required.');
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
    return { conversation, matches };
  }

  private query(original: Conversation, cache: CleanCache, request: QueryRequest): QueryResult {
    if (request.pageSize !== 30 || !Number.isSafeInteger(request.page) || request.page < 0) {
      throw new Error('Valid preview filters and a page number are required.');
    }
    const { conversation, matches } = this.matchingMessages(original, cache, request);
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

  private exportExcerpt(archive: ParsedArchive, original: Conversation, cache: CleanCache, request: ExportExcerptRequest): ExcerptExportResult {
    if (!['markdown', 'jsonl'].includes(request.format)) throw new Error('Choose a supported excerpt format.');
    const { conversation, matches } = this.matchingMessages(original, cache, request);
    if (!matches.length) throw new Error('No messages match the current filters.');
    // Match against the active view, but exports always use cleaned bodies and metadata.
    const ids = new Set(matches.map(index => conversation.messages[index]!.id));
    const excerpt = { ...cache.result.conversation, history: undefined, events: undefined,
      messages: cache.result.conversation.messages.filter(message => ids.has(message.id)) };
    const messageCount = excerpt.messages.length;
    const text = request.format === 'markdown'
      ? buildFilteredTranscript(excerpt, messageCount, request.language ?? 'en')
      : buildJsonl(excerpt);
    const conversationIndex = archive.conversations.findIndex(item => item.id === original.id);
    const suffix = archive.conversations.length > 1 ? `-${Math.max(0, conversationIndex) + 1}` : '';
    const extension = request.format === 'markdown' ? 'md' : 'jsonl';
    const mimeType = request.format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/x-ndjson;charset=utf-8';
    return { buffer: encoder.encode(text).buffer as ArrayBuffer, filename: `threadpack-excerpt${suffix}.${extension}`, mimeType, messageCount };
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

  private matchingSnippets(cache: CleanCache, request: SnippetFilters): { snippets: CodeSnippet[]; allTotal: number; languages: { language: string; count: number }[] } {
    const query = request.query === undefined ? '' : request.query;
    const rawLanguage = request.language === undefined ? '' : request.language;
    if (typeof query !== 'string' || query.length > 1000 || typeof rawLanguage !== 'string' || rawLanguage.length > 30) {
      throw new Error('Valid code filters are required.');
    }
    const language = normalizedSnippetLanguage(rawLanguage);
    if (language === null) throw new Error('Valid code filters are required.');
    const snippets = cache.snippets ??= extractCodeSnippets(cache.result.conversation);
    const counts = new Map<string, number>();
    for (const snippet of snippets) counts.set(snippet.language, (counts.get(snippet.language) ?? 0) + 1);
    const pattern = searchPattern(query);
    const matches = snippets.filter(snippet => {
      if (language && snippet.language !== language) return false;
      if (!pattern) return true;
      const content = cache.result.conversation.messages[snippet.messageIndex]!.content;
      return pattern.test(content.slice(snippet.start, snippet.end));
    });
    return { snippets: matches, allTotal: snippets.length,
      languages: [...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([language, count]) => ({ language, count })) };
  }

  private querySnippets(cache: CleanCache, request: QuerySnippetsRequest): SnippetQueryResult {
    if (request.pageSize !== 20 || !Number.isSafeInteger(request.page) || request.page < 0) {
      throw new Error('A valid code page number is required.');
    }
    const { snippets, allTotal, languages } = this.matchingSnippets(cache, request);
    const pageCount = Math.max(1, Math.ceil(snippets.length / 20));
    const page = Math.min(request.page, pageCount - 1);
    const items = snippets.slice(page * 20, (page + 1) * 20).map(snippet => {
      const content = cache.result.conversation.messages[snippet.messageIndex]!.content;
      let end = Math.min(snippet.end, snippet.start + MAX_SNIPPET_PREVIEW_CHARACTERS);
      // Keep a surrogate pair intact at the preview boundary.
      if (end < snippet.end && /[\uD800-\uDBFF]/.test(content[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(content[end] ?? '')) end--;
      return { id: snippet.id, language: snippet.language, messageIndex: snippet.messageIndex,
        fenceIndex: snippet.fenceIndex, lines: snippet.lines, characters: snippet.characters,
        preview: content.slice(snippet.start, end), shortened: end < snippet.end };
    });
    return { items, total: snippets.length, allTotal, languages, page, pageCount };
  }

  private exportSnippets(archive: ParsedArchive, cache: CleanCache, request: ExportSnippetsRequest): SnippetArchiveResult {
    const { snippets } = this.matchingSnippets(cache, request);
    if (!snippets.length) throw new Error('No code snippets match the current filters.');
    if (snippets.length > 65535) throw new Error('This archive contains too many code files. Apply a narrower code filter.');
    const bytes = buildCodeArchive(cache.result.conversation, snippets);
    const index = archive.conversations.findIndex(conversation => conversation.id === cache.result.conversation.id);
    const suffix = archive.conversations.length > 1 ? `-${Math.max(0, index) + 1}` : '';
    return { buffer: bytes.buffer, filename: `threadpack-code${suffix}.zip`, mimeType: 'application/zip', snippetCount: snippets.length };
  }

  private snippet(cache: CleanCache, id: string): { snippet: CodeSnippet; text: string } {
    if (typeof id !== 'string' || id.length > 100 || !/^message-\d+-code-\d+$/.test(id)) throw new Error('A valid code reference is required.');
    const snippets = cache.snippets ??= extractCodeSnippets(cache.result.conversation);
    const snippet = snippets.find(item => item.id === id);
    if (!snippet) throw new Error('This code snippet is unavailable.');
    return { snippet, text: cache.result.conversation.messages[snippet.messageIndex]!.content.slice(snippet.start, snippet.end) };
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

  private export(archive: ParsedArchive, cache: CleanCache, format: 'markdown' | 'jsonl' | 'report', language: OutputLanguage): ExportResult {
    const conversation = cache.result.conversation;
    const conversationIndex = archive.conversations.findIndex(item => item.id === conversation.id);
    const suffix = archive.conversations.length > 1 ? `-${Math.max(0, conversationIndex) + 1}` : '';
    const options = cache.options;
    const labels = outputLabels(language);
    let text: string;
    let filename: string;
    let mimeType: string;
    if (format === 'markdown') { text = buildTranscript(conversation, language); filename = `threadpack-transcript${suffix}.md`; mimeType = 'text/markdown;charset=utf-8'; }
    else if (format === 'jsonl') { text = buildJsonl(conversation); filename = `threadpack-transcript${suffix}.jsonl`; mimeType = 'application/x-ndjson;charset=utf-8'; }
    else if (format === 'report') {
      const warnings = [...archive.warnings, ...cache.result.warnings];
      text = JSON.stringify({ tool: 'ThreadPack', version: APP_VERSION, format: archive.format, sourcePlatform: archive.provenance?.platform ?? 'unknown',
        sourceBytes: archive.sourceBytes, integrity: archive.integrity, messageCount: conversation.messages.length, stats: cache.result.stats,
        warningCount: warnings.length, warnings: warnings.map(warning => localizeWarning(warning, language)),
        options: { stripImages: options.stripImages, trimToolOutputs: options.trimToolOutputs, toolLimit: options.toolLimit, deduplicate: options.deduplicate,
          redact: options.redact, redactEmails: options.redactEmails, customRuleCount: options.customSecrets?.length ?? 0 },
        scope: labels.reportScope,
      }, null, 2);
      filename = `threadpack-report${suffix}.json`; mimeType = 'application/json;charset=utf-8';
    } else throw new Error('Choose a supported export format.');
    return { buffer: encoder.encode(text).buffer as ArrayBuffer, filename, mimeType };
  }

  private handoff(cache: CleanCache, request: HandoffRequest): { text: string; summary: ReturnType<typeof buildHandoffWithSummary>['summary'] } {
    const keys = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
    if (!request.notes || keys.some(key => typeof request.notes[key] !== 'string' || request.notes[key].length > 12000) || !Array.isArray(request.pinnedIds) || request.pinnedIds.some(id => typeof id !== 'string')) {
      throw new Error('Valid handoff notes and pinned messages are required.');
    }
    const cleanedNotes = cleanConversation({ id: 'notes', title: '', source: 'notes', messages: keys.map(key => ({ id: key, role: 'user' as const, content: request.notes[key] })) }, { ...cache.options, trimToolOutputs: false, deduplicate: false });
    const notes = Object.fromEntries(cleanedNotes.conversation.messages.map(message => [message.id, message.content.replace(/\[(SECRET|EMAIL|CUSTOM)_(\d+)\]/g, '[NOTE_$1_$2]')])) as unknown as HandoffRequest['notes'];
    return buildHandoffWithSummary(cache.result.conversation, {
      ...notes,
      pinnedIds: request.pinnedIds,
      recentCount: request.recentCount,
      recentMode: request.recentMode,
      language: request.language,
      maxCharacters: request.maxCharacters,
    });
  }

  private exportBundle(archive: ParsedArchive, cache: CleanCache, request: ExportBundleRequest): ContextBundleResult {
    const notes: HandoffRequest['notes'] = request.notes ?? { goal: '', decisions: '', constraints: '', nextSteps: '' };
    const keys = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
    if (!request.notes || typeof request.notes !== 'object' || keys.some(key => typeof notes[key] !== 'string' || notes[key].length > 12000)) {
      if (request.notes !== undefined) throw new Error('Valid handoff notes are required.');
    }
    const pinnedIds = request.pinnedIds ?? [];
    if (!Array.isArray(pinnedIds) || pinnedIds.length > cache.result.conversation.messages.length || pinnedIds.some(id => typeof id !== 'string' || id.length > 500)) {
      throw new Error('Valid pinned message references are required.');
    }
    const recentCount = request.recentCount ?? 0;
    if (!Number.isSafeInteger(recentCount) || recentCount < 0 || recentCount > 1000) throw new Error('Recent context must be between 0 and 1,000 messages.');
    const recentMode = request.recentMode ?? 'source';
    if (recentMode !== 'source' && recentMode !== 'timestamp') throw new Error('Recent message selection must be source or timestamp.');
    const maxCharacters = request.maxCharacters ?? 16000;
    if (!Number.isFinite(maxCharacters) || maxCharacters < 1000 || maxCharacters > 10_000_000) throw new Error('Handoff budget must be between 1,000 and 10,000,000 characters.');
    const hasNotes = keys.some(key => notes[key].trim().length > 0);
    const handoff = hasNotes ? this.handoff(cache, {
      id: request.id, type: 'handoff', archiveId: request.archiveId, conversationId: request.conversationId,
      revision: request.revision, notes, pinnedIds, recentCount, recentMode, language: request.language, maxCharacters,
    }).text : undefined;
    const conversation = cache.result.conversation;
    const snippets = cache.snippets ??= extractCodeSnippets(conversation);
    const options = cache.options;
    const language = request.language ?? 'en';
    const warnings = [...archive.warnings, ...cache.result.warnings];
    const report = JSON.stringify({
      tool: 'ThreadPack', version: APP_VERSION, format: archive.format,
      sourcePlatform: archive.provenance?.platform ?? 'unknown', sourceBytes: archive.sourceBytes, integrity: archive.integrity,
      messageCount: conversation.messages.length, codeSnippetCount: snippets.length,
      handoffIncluded: hasNotes, stats: cache.result.stats,
      warningCount: warnings.length, warnings: warnings.map(warning => localizeWarning(warning, language)),
      options: { stripImages: options.stripImages, trimToolOutputs: options.trimToolOutputs, toolLimit: options.toolLimit,
        deduplicate: options.deduplicate, redact: options.redact, redactEmails: options.redactEmails,
        customRuleCount: options.customSecrets?.length ?? 0 },
      scope: outputLabels(language).reportScope,
    }, null, 2);
    const readme = buildContextBundleReadme(language, hasNotes, snippets.length);
    const bytes = buildContextBundle(conversation, snippets, {
      transcript: buildTranscript(conversation, language), messages: buildJsonl(conversation), report, readme, handoff,
    });
    const conversationIndex = archive.conversations.findIndex(item => item.id === conversation.id);
    const suffix = archive.conversations.length > 1 ? `-${Math.max(0, conversationIndex) + 1}` : '';
    return { buffer: bytes.buffer, filename: `threadpack-context${suffix}.zip`, mimeType: 'application/zip',
      fileCount: 4 + (hasNotes ? 1 : 0) + snippets.length, snippetCount: snippets.length, handoffIncluded: hasNotes };
  }
}
