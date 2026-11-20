import { Zip, ZipDeflate } from 'fflate';
import type { Conversation } from '../core/types';
import type { CodeSnippet } from '../core/snippets';
import { codeSnippetFilename } from './code-archive';

const encoder = new TextEncoder();
const chunkCharacters = 64 * 1024;

export interface ContextBundleFiles {
  transcript: string;
  messages: string;
  report: string;
  readme: string;
  handoff?: string;
}

function addText(zip: Zip, name: string, text: string): void {
  const file = new ZipDeflate(name, { level: 6 });
  file.mtime = new Date(1980, 0, 1);
  zip.add(file);
  if (!text.length) {
    file.push(new Uint8Array(0), true);
    return;
  }
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + chunkCharacters);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[end] ?? '')) end--;
    file.push(encoder.encode(text.slice(start, end)), end === text.length);
    start = end;
  }
}

/**
 * Create a portable, cleaned context bundle. Code blocks are read from the
 * cleaned conversation by offset and streamed into the ZIP one chunk at a time.
 */
export function buildContextBundle(conversation: Conversation, snippets: readonly CodeSnippet[], files: ContextBundleFiles): Uint8Array<ArrayBuffer> {
  if (snippets.length > 65535) throw new Error('This archive contains too many code files. Apply a narrower code filter.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let failed = false;
  let completed = false;
  const zip = new Zip((error, data, final) => {
    if (error) { failed = true; return; }
    chunks.push(data); size += data.length;
    if (final) completed = true;
  });

  addText(zip, 'README.md', files.readme);
  addText(zip, 'transcript.md', files.transcript);
  addText(zip, 'messages.jsonl', files.messages);
  addText(zip, 'cleanup-report.json', files.report);
  if (files.handoff !== undefined) addText(zip, 'handoff.md', files.handoff);

  for (const snippet of snippets) {
    const message = conversation.messages[snippet.messageIndex];
    if (!message || snippet.start < 0 || snippet.end < snippet.start || snippet.end > message.content.length) {
      failed = true;
      break;
    }
    const file = new ZipDeflate(`code/${codeSnippetFilename(snippet)}`, { level: 6 });
    file.mtime = new Date(1980, 0, 1);
    zip.add(file);
    if (snippet.start === snippet.end) {
      file.push(new Uint8Array(0), true);
      continue;
    }
    for (let start = snippet.start; start < snippet.end;) {
      let end = Math.min(snippet.end, start + chunkCharacters);
      if (end < snippet.end && /[\uD800-\uDBFF]/.test(message.content[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(message.content[end] ?? '')) end--;
      file.push(encoder.encode(message.content.slice(start, end)), end === snippet.end);
      start = end;
    }
  }
  zip.end();
  if (failed || !completed) throw new Error('Unable to build the context bundle. Try again.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
