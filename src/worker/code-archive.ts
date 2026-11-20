import { Zip, ZipDeflate } from 'fflate';
import type { Conversation } from '../core/types';
import { snippetExtension } from '../core/snippets';
import type { CodeSnippet } from '../core/snippets';

const encoder = new TextEncoder();
const chunkCharacters = 64 * 1024;
const languagesByExtension: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', sh: 'bash', ps1: 'powershell',
  sql: 'sql', json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss', html: 'html', xml: 'xml', md: 'markdown',
  yaml: 'yaml', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', vue: 'vue', svelte: 'svelte', toml: 'toml', ini: 'ini', txt: 'text',
};

/** Normalize only the same allowlisted language aliases accepted by extraction. */
export function normalizedSnippetLanguage(value: string): string | null {
  if (!value) return '';
  const lower = value.toLowerCase();
  const extension = snippetExtension(lower);
  if (extension === 'txt' && !['text', 'plaintext', 'txt'].includes(lower)) return null;
  return languagesByExtension[extension] ?? null;
}

export function codeSnippetFilename(snippet: CodeSnippet): string {
  return `threadpack-code-${snippet.messageIndex + 1}-${snippet.fenceIndex + 1}.${snippetExtension(snippet.language)}`;
}

/** Compress one cleaned block at a time; no second collection of full code bodies is allocated. */
export function buildCodeArchive(conversation: Conversation, snippets: readonly CodeSnippet[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let failed = false;
  let completed = false;
  const zip = new Zip((error, data, final) => {
    if (error) { failed = true; return; }
    chunks.push(data); size += data.length;
    if (final) completed = true;
  });
  for (const snippet of snippets) {
    const file = new ZipDeflate(codeSnippetFilename(snippet), { level: 6 });
    file.mtime = new Date(1980, 0, 1);
    zip.add(file);
    const content = conversation.messages[snippet.messageIndex]!.content;
    if (snippet.start === snippet.end) file.push(new Uint8Array(0), true);
    for (let start = snippet.start; start < snippet.end;) {
      let end = Math.min(snippet.end, start + chunkCharacters);
      if (end < snippet.end && /[\uD800-\uDBFF]/.test(content[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(content[end] ?? '')) end--;
      file.push(encoder.encode(content.slice(start, end)), end === snippet.end);
      start = end;
    }
    if (failed) break;
  }
  zip.end();
  if (failed || !completed) throw new Error('Unable to build the code archive. Try again.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
