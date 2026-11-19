#!/usr/bin/env node
import { readFile, stat, realpath, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  parseInput, cleanConversation, DEFAULT_OPTIONS,
  buildTranscript, buildJsonl, buildHandoff,
} from '../src/core/index';

declare const __THREADPACK_VERSION__: string;
const MAX_BYTES = 100 * 1024 * 1024;
class CliError extends Error {}
const HELP = `ThreadPack — carry the useful parts of an AI conversation.

Usage: threadpack <input.jsonl|json|md|txt|-> --out <file> [options]

Options:
  --format <markdown|jsonl|handoff|report>  Output format (default: markdown)
  --conversation <N>                      Select a conversation, starting at 1
  --tool-limit <N>                        Characters per tool output (500–100000)
  --recent <N>                            Recent messages in a handoff (0–100)
  --keep-images                          Keep inline image payloads
  --keep-tool-outputs                    Keep full tool output text
  --keep-duplicates                      Keep repeated tool outputs
  --no-redact                            Disable rule-based secret redaction
  --redact-emails                        Also replace email addresses
  --force                                Replace an existing output file
  --help, -h                             Show this help
  --version                              Show the installed version

Use '-' as input to read UTF-8 text from stdin. Input is limited to 100 MiB.
Your input is never overwritten. Exports are portable copies, not native sessions.
Handoffs contain deterministic excerpts, not an AI-generated summary.
`;

function integer(value: string | undefined, fallback: number, min: number, max: number, flag: string) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new CliError(`${flag} requires an integer between ${min} and ${max}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new CliError(`${flag} requires an integer between ${min} and ${max}.`);
  return n;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fileInfo(path: string) {
  try { return await stat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string' }, format: { type: 'string' },
        conversation: { type: 'string' }, 'tool-limit': { type: 'string' }, recent: { type: 'string' },
        'keep-images': { type: 'boolean' }, 'keep-tool-outputs': { type: 'boolean' },
        'keep-duplicates': { type: 'boolean' }, 'no-redact': { type: 'boolean' },
        'redact-emails': { type: 'boolean' }, force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
      },
    });
  } catch { throw new CliError('Invalid command-line options. Run threadpack --help for usage.'); }

  const values = args.values;
  if (values.help) { process.stdout.write(HELP); return; }
  if (values.version) { process.stdout.write(`${__THREADPACK_VERSION__}\n`); return; }
  if (args.positionals.length !== 1 || typeof values.out !== 'string' || !values.out.trim()) {
    throw new CliError('Provide one input and --out <file>. Run threadpack --help for usage.');
  }
  const format = typeof values.format === 'string' ? values.format : 'markdown';
  if (!['markdown', 'jsonl', 'handoff', 'report'].includes(format)) throw new CliError('Use --format markdown, jsonl, handoff, or report.');
  const selected = integer(values.conversation as string | undefined, 1, 1, 100000, '--conversation');
  const toolLimit = integer(values['tool-limit'] as string | undefined, DEFAULT_OPTIONS.toolLimit, 500, 100000, '--tool-limit');
  const recent = integer(values.recent as string | undefined, 8, 0, 100, '--recent');
  const input = args.positionals[0];
  const output = resolve(values.out);
  let text: string;
  if (input === '-') {
    text = await readStdin();
  } else {
    const inputPath = resolve(input);
    const inputInfo = await stat(inputPath);
    if (!inputInfo.isFile()) throw new CliError('Input must be a regular file.');
    if (inputInfo.size > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
    const inputReal = await realpath(inputPath);
    const outputInfo = await fileInfo(output);
    const outputReal = outputInfo ? await realpath(output) : output;
    if (inputReal.toLowerCase() === outputReal.toLowerCase()
      || (outputInfo && inputInfo.dev === outputInfo.dev && inputInfo.ino === outputInfo.ino)) {
      throw new CliError('Input and output must be different files, including aliases.');
    }
    text = await readFile(inputPath, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
  }
  if (!text.trim()) throw new CliError('Input is empty.');
  const archive = parseInput(text, input === '-' ? 'stdin.txt' : basename(input));
  const conversation = archive.conversations[selected - 1];
  if (!conversation) throw new CliError(`Conversation ${selected} is unavailable; this input contains ${archive.conversations.length}.`);
  const result = cleanConversation(conversation, {
    ...DEFAULT_OPTIONS,
    stripImages: !values['keep-images'], trimToolOutputs: !values['keep-tool-outputs'],
    deduplicate: !values['keep-duplicates'], redact: !values['no-redact'],
    redactEmails: Boolean(values['redact-emails']), toolLimit,
  });
  let rendered: string;
  if (format === 'jsonl') rendered = buildJsonl(result.conversation);
  else if (format === 'handoff') rendered = buildHandoff(result.conversation, {
    goal: '', decisions: '', constraints: '', nextSteps: '', pinnedIds: [], recentCount: recent,
  });
  else if (format === 'report') rendered = JSON.stringify({
    tool: 'ThreadPack', version: __THREADPACK_VERSION__, format: archive.format,
    conversation: selected, conversationCount: archive.conversations.length,
    messages: result.conversation.messages.length, stats: result.stats,
    warningCount: archive.warnings.length + result.warnings.length,
    note: 'Statistics describe normalized message text. No transcript or detected secret values are included.',
  }, null, 2);
  else rendered = buildTranscript(result.conversation);

  if (values.force) {
    const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, rendered, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, output);
    } finally { await unlink(temporary).catch(() => {}); }
  } else {
    await writeFile(output, rendered, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  const warnings = archive.warnings.length + result.warnings.length;
  process.stderr.write(`ThreadPack: exported ${result.conversation.messages.length} messages; ${result.stats.beforeBytes} → ${result.stats.afterBytes} bytes of message text.\n`);
  process.stderr.write(`Changes: ${result.stats.imagesRemoved} images, ${result.stats.outputsTrimmed} trimmed outputs, ${result.stats.duplicatesRemoved} duplicates, ${result.stats.secretsRedacted} secrets, ${result.stats.emailsRedacted} emails.\n`);
  if (warnings) process.stderr.write(`Review needed: ${warnings} parser/cleaner warnings. Inspect the browser preview before sharing an unfamiliar format.\n`);
}

main().catch((error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  const safeSystemErrors: Record<string, string> = {
    EEXIST: 'Output already exists. Choose another file or use --force.',
    ENOENT: 'Input file or output directory was not found.',
    EACCES: 'File permission denied.', EPERM: 'The operation is not permitted.',
    EISDIR: 'Expected a file, received a directory.', ENOSPC: 'Not enough disk space.',
  };
  const message = code ? (safeSystemErrors[code] ?? 'A filesystem operation failed.')
    : error instanceof CliError ? error.message : 'Processing failed. Check the input format in the browser preview.';
  // Never echo parser exceptions: their text can contain transcript fragments.
  process.stderr.write(`ThreadPack: ${message}\n`);
  process.exitCode = 1;
});
