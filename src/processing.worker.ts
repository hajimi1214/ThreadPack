/// <reference lib="webworker" />
import { parseInput, cleanConversation } from './core';
import type { ParsedArchive, CleanOptions } from './core';

let archive: ParsedArchive | null = null;
const size = (text: string) => new TextEncoder().encode(text).byteLength;

function preview(text: string): string {
  const readable = text.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, '[Embedded image payload · hidden in preview]');
  return readable.length > 10000
    ? `${readable.slice(0, 7000)}\n\n[Preview shortened. Export includes the complete selected output.]\n\n${readable.slice(-2000)}`
    : readable;
}

self.onmessage = (event: MessageEvent<{ id: number; type: 'parse' | 'clean' | 'clear'; text?: string; filename?: string; conversationId?: string; options?: CleanOptions }>) => {
  const { id, type } = event.data;
  try {
    if (type === 'clear') { archive = null; self.postMessage({ id, data: null }); return; }
    if (type === 'parse') {
      archive = parseInput(event.data.text ?? '', event.data.filename ?? 'pasted.txt');
      self.postMessage({ id, data: {
        format: archive.format,
        warnings: archive.warnings,
        sourceBytes: archive.sourceBytes,
        conversations: archive.conversations.map(c => ({ id: c.id, title: c.title, source: c.source, messageCount: c.messages.length })),
      } });
      return;
    }
    const selected = archive?.conversations.find(c => c.id === event.data.conversationId);
    if (!selected || !event.data.options) throw new Error('Import a conversation before cleaning it.');
    const result = cleanConversation(selected, event.data.options);
    self.postMessage({ id, data: {
      result,
      original: { ...selected, messages: selected.messages.map(m => ({ ...m, content: preview(m.content) })) },
      originalSizes: Object.fromEntries(selected.messages.map(m => [m.id, size(m.content)])),
    } });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Unable to process this file.' });
  }
};
