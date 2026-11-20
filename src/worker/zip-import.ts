import { unzipSync } from 'fflate';

export const MAX_ZIP_ENTRIES = 256;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const supported = /\.(jsonl|ndjson|json|md|txt|log)$/i;

function safePath(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return Boolean(normalized) && !normalized.includes('\0') && !normalized.startsWith('/')
    && !/^[a-z]:\//i.test(normalized) && !normalized.split('/').includes('..');
}

function priority(name: string): number {
  const normalized = name.replace(/\\/g, '/').toLowerCase();
  if (normalized.endsWith('/conversations.json') || normalized === 'conversations.json') return 0;
  if (/\.(jsonl|ndjson)$/i.test(normalized)) return 1;
  if (/\.json$/i.test(normalized)) return 2;
  if (/\.(md|txt|log)$/i.test(normalized)) return 3;
  return 99;
}

/** Extract only one supported text export and keep archive metadata out of user-facing warnings. */
export function extractZipText(data: Uint8Array): { text: string; filename: string; warning?: string } {
  let entries = 0;
  let estimatedBytes = 0;
  const files = unzipSync(data, {
    filter(file) {
      if (++entries > MAX_ZIP_ENTRIES) throw new Error('This ZIP contains too many files. Remove unrelated files and try again.');
      const size = file.originalSize ?? 0;
      estimatedBytes += size;
      if (estimatedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error('This ZIP expands beyond the 100 MiB safety limit. Choose a smaller export.');
      return safePath(file.name) && supported.test(file.name);
    },
  });
  const candidates = Object.entries(files).filter(([name, value]) => safePath(name) && supported.test(name) && value.byteLength <= MAX_ZIP_UNCOMPRESSED_BYTES);
  if (!candidates.length) throw new Error('No supported text export was found inside this ZIP. Include a JSON, JSONL, Markdown, or text export.');
  candidates.sort(([left], [right]) => priority(left) - priority(right) || left.localeCompare(right));
  const [entry, bytes] = candidates[0]!;
  const filename = /\.(jsonl|ndjson)$/i.test(entry) ? 'archive.jsonl' : /\.json$/i.test(entry) ? 'archive.json' : /\.md$/i.test(entry) ? 'archive.md' : 'archive.txt';
  return { text: new TextDecoder('utf-8').decode(bytes), filename, warning: candidates.length > 1 ? `ZIP import selected one supported export and ignored ${candidates.length - 1} other text file(s).` : undefined };
}
