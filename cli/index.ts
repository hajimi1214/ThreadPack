#!/usr/bin/env node
import { readFile, stat, realpath, writeFile, rename, unlink, copyFile, chmod } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { OutputLanguage } from '../src/core';
import {
  parseInput, cleanConversation, DEFAULT_OPTIONS, validateCustomSecrets,
  buildTranscript, buildJsonl, buildHandoffWithSummary,
} from '../src/core/index';
import { localizeDiagnostic, localizeSummary, localizeWarning, localizedHelp } from './i18n';

declare const __THREADPACK_VERSION__: string;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_REDACTION_BYTES = 64 * 1024;
const MAX_NOTES_BYTES = 256 * 1024;
const NOTE_KEYS = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
type CliNotes = Record<typeof NOTE_KEYS[number], string>;
let diagnosticLanguage: OutputLanguage = 'en';
class CliError extends Error {}
const HELP = `ThreadPack — carry the useful parts of an AI conversation.

Usage: threadpack <input.jsonl|json|md|txt|-> --out <file> [options]

Options:
  --format <markdown|jsonl|handoff|report>  Output format (default: markdown)
  --conversation <N>                      Select a conversation, starting at 1
  --tool-limit <N>                        Characters per tool output (500–100000)
  --recent <N>                            Recent messages in a handoff (0–100, default: 8)
  --recent-mode <source|timestamp>        Select recent messages by source order or valid timestamps (default: source)
  --notes-file <file>                    JSON handoff notes (each field up to 12000 characters)
  --pin <N>                              Pin message number N in the selected conversation (repeatable)
  --original-out <file>                  Save an unmodified copy of the original input
  --language <en|zh|ja|fr|es>            CLI text language (default: en)
  --keep-images                          Keep inline image payloads
  --keep-tool-outputs                    Keep full tool output text
  --keep-duplicates                      Keep repeated tool outputs
  --no-redact                            Disable built-in secret recognition
  --redact-emails                        Enable email redaction (enabled by default)
  --no-redact-emails                     Keep email addresses unchanged
  --redact-file <file>                   Exact values to redact, one per UTF-8 line
  --force                                Replace existing cleaned and original outputs
  --help, -h                             Show this help
  --version                              Show the installed version

Use '-' as input to read UTF-8 text from stdin. Input is limited to 100 MiB.
Browser ZIP imports allow up to 256 entries and 100 MiB expanded content.
Redaction files are limited to 64 KiB, with up to 50 values of 3–1000 characters.
Notes files are limited to 256 KiB, with up to 12000 characters in each field.
Blank lines are ignored. Other whitespace is significant. Custom rules stay active
with --no-redact. Input, cleaned output, original copy, notes, and redaction files
must be different files, including aliases.
Email addresses are redacted by default; --no-redact-emails preserves them.
The original copy preserves the input bytes. --force replaces both output files.
--language selects English, Chinese, Japanese, French, or Spanish for reader-facing CLI output, reports, and handoffs.
Source files are never overwritten. Normalized JSONL is for data exchange, not native session recovery.
Handoffs contain deterministic excerpts, not an AI-generated summary.
`;

function integer(value: string | undefined, fallback: number, min: number, max: number, flag: string) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new CliError(`${flag} requires an integer between ${min} and ${max}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new CliError(`${flag} requires an integer between ${min} and ${max}.`);
  return n;
}

async function readStdin(keepOriginal: boolean): Promise<{ text: string; originalBytes?: Buffer }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
    chunks.push(buffer);
  }
  const originalBytes = Buffer.concat(chunks);
  return { text: originalBytes.toString('utf8'), ...(keepOriginal ? { originalBytes } : {}) };
}

async function writeOutput(path: string, content: string | Buffer, force: boolean): Promise<void> {
  if (!force) {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function copyOriginalFile(source: string, destination: string, force: boolean): Promise<void> {
  if (!force) {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
    return;
  }
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function fileInfo(path: string) {
  try { return await stat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function sameFile(first: string, second: string): Promise<boolean> {
  const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (normalize(resolve(first)) === normalize(resolve(second))) return true;
  const [firstInfo, secondInfo] = await Promise.all([fileInfo(first), fileInfo(second)]);
  if (!firstInfo || !secondInfo) return false;
  if (firstInfo.dev === secondInfo.dev && firstInfo.ino === secondInfo.ino) return true;
  return normalize(await realpath(first)) === normalize(await realpath(second));
}

async function readRedactionFile(path: string): Promise<string[]> {
  const info = await stat(path);
  if (!info.isFile()) throw new CliError('The redaction file must be a regular UTF-8 file.');
  if (info.size > MAX_REDACTION_BYTES) throw new CliError('The redaction file exceeds the 64 KiB limit.');
  const content = await readFile(path);
  if (content.byteLength > MAX_REDACTION_BYTES) throw new CliError('The redaction file exceeds the 64 KiB limit.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch { throw new CliError('The redaction file must contain valid UTF-8 text.'); }
  // Preserve meaningful leading/trailing spaces; only blank lines are ignored.
  const rules = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  try { return validateCustomSecrets(rules); }
  catch { throw new CliError('Redaction rules require at most 50 values of 3–1000 Unicode characters.'); }
}

async function readNotesFile(path: string): Promise<CliNotes> {
  const info = await stat(path);
  if (!info.isFile()) throw new CliError('The notes file must be a regular UTF-8 JSON file.');
  if (info.size > MAX_NOTES_BYTES) throw new CliError('The notes file exceeds the 256 KiB limit.');
  const content = await readFile(path);
  if (content.byteLength > MAX_NOTES_BYTES) throw new CliError('The notes file exceeds the 256 KiB limit.');
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '');
    parsed = JSON.parse(text);
  } catch {
    throw new CliError('The notes file must contain valid UTF-8 JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('The notes file must be a JSON object containing goal, decisions, constraints, and nextSteps.');
  }
  const fields = parsed as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !NOTE_KEYS.includes(key as typeof NOTE_KEYS[number]))) {
    throw new CliError('The notes file contains an unsupported field.');
  }
  const notes = {} as CliNotes;
  for (const key of NOTE_KEYS) {
    const value = Object.hasOwn(fields, key) ? fields[key] : '';
    if (typeof value !== 'string' || value.length > 12000) {
      throw new CliError('Each notes field must be text containing at most 12000 characters.');
    }
    notes[key] = value;
  }
  return notes;
}

function requestedLanguage(arguments_: string[]): OutputLanguage {
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    const value = argument === '--language' ? arguments_[index + 1] : argument.startsWith('--language=') ? argument.slice('--language='.length) : undefined;
    if (value === 'en' || value === 'zh' || value === 'ja' || value === 'fr' || value === 'es') return value;
  }
  return 'en';
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string' }, format: { type: 'string' },
        conversation: { type: 'string' }, 'tool-limit': { type: 'string' }, recent: { type: 'string' },
        'recent-mode': { type: 'string' },
        'notes-file': { type: 'string' }, pin: { type: 'string', multiple: true },
        'original-out': { type: 'string' }, language: { type: 'string' },
        'keep-images': { type: 'boolean' }, 'keep-tool-outputs': { type: 'boolean' },
        'keep-duplicates': { type: 'boolean' }, 'no-redact': { type: 'boolean' },
        'redact-emails': { type: 'boolean' }, 'no-redact-emails': { type: 'boolean' },
        'redact-file': { type: 'string' }, force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
      },
    });
  } catch {
    diagnosticLanguage = requestedLanguage(process.argv.slice(2));
    throw new CliError('Invalid command-line options. Run threadpack --help for usage.');
  }

  const values = args.values;
  if (values.help) {
    const helpLanguage = values.language === 'en' || values.language === 'zh' || values.language === 'ja' || values.language === 'fr' || values.language === 'es'
      ? values.language : 'en';
    process.stdout.write(localizedHelp(helpLanguage, HELP));
    return;
  }
  if (values.version) { process.stdout.write(`${__THREADPACK_VERSION__}\n`); return; }
  const language = values.language === undefined ? 'en' : values.language;
  if (language !== 'en' && language !== 'zh' && language !== 'ja' && language !== 'fr' && language !== 'es') {
    throw new CliError('--language must be en, zh, ja, fr, or es.');
  }
  diagnosticLanguage = language;
  if (values['redact-emails'] && values['no-redact-emails']) {
    throw new CliError('Choose either --redact-emails or --no-redact-emails, not both.');
  }
  if (args.positionals.length !== 1 || typeof values.out !== 'string' || !values.out.trim()) {
    throw new CliError('Provide one input and --out <file>. Run threadpack --help for usage.');
  }
  const format = typeof values.format === 'string' ? values.format : 'markdown';
  if (!['markdown', 'jsonl', 'handoff', 'report'].includes(format)) throw new CliError('Use --format markdown, jsonl, handoff, or report.');
  const includesHandoff = format === 'handoff' || format === 'report';
  const pinValues = values.pin as string[] | undefined;
  if ((values['notes-file'] !== undefined || pinValues?.length || values['recent-mode'] !== undefined) && !includesHandoff) {
    throw new CliError('--notes-file, --pin, and --recent-mode require --format handoff or report.');
  }
  const selected = integer(values.conversation as string | undefined, 1, 1, 100000, '--conversation');
  const toolLimit = integer(values['tool-limit'] as string | undefined, DEFAULT_OPTIONS.toolLimit, 500, 100000, '--tool-limit');
  const recent = integer(values.recent as string | undefined, 8, 0, 100, '--recent');
  const recentMode = values['recent-mode'] === undefined ? 'source' : values['recent-mode'];
  if (recentMode !== 'source' && recentMode !== 'timestamp') {
    throw new CliError('--recent-mode must be source or timestamp.');
  }
  const input = args.positionals[0];
  const output = resolve(values.out);
  const redactionFile = values['redact-file'];
  const notesFile = values['notes-file'];
  const originalOut = values['original-out'];
  if (originalOut !== undefined && (typeof originalOut !== 'string' || !originalOut.trim())) {
    throw new CliError('Provide a file with --original-out.');
  }
  const originalOutput = typeof originalOut === 'string' ? resolve(originalOut) : undefined;
  if (redactionFile !== undefined && (typeof redactionFile !== 'string' || !redactionFile.trim())) {
    throw new CliError('Provide a regular UTF-8 file with --redact-file.');
  }
  if (input !== '-' && await sameFile(resolve(input), output)) {
    throw new CliError('Input and output must be different files, including aliases.');
  }
  if (typeof redactionFile === 'string') {
    const rulesPath = resolve(redactionFile);
    if (await sameFile(rulesPath, output) || (input !== '-' && await sameFile(rulesPath, resolve(input)))) {
      throw new CliError('The redaction file must differ from input and output, including aliases.');
    }
  }
  if (notesFile !== undefined && (typeof notesFile !== 'string' || !notesFile.trim())) {
    throw new CliError('Provide a UTF-8 JSON file with --notes-file.');
  }
  if (typeof notesFile === 'string') {
    const notesPath = resolve(notesFile);
    if ((input !== '-' && await sameFile(notesPath, resolve(input))) || await sameFile(notesPath, output) ||
        (typeof redactionFile === 'string' && await sameFile(notesPath, resolve(redactionFile)))) {
      throw new CliError('The notes file must differ from input, output, and redaction files, including aliases.');
    }
  }
  if (originalOutput && ((input !== '-' && await sameFile(resolve(input), originalOutput)) || await sameFile(output, originalOutput) ||
      (typeof notesFile === 'string' && await sameFile(resolve(notesFile), originalOutput)) ||
      (typeof redactionFile === 'string' && await sameFile(resolve(redactionFile), originalOutput)))) {
    throw new CliError('The original copy must differ from input, output, notes, and redaction files, including aliases.');
  }
  if (!values.force && (await fileInfo(output) || (originalOutput && await fileInfo(originalOutput)))) {
    throw new CliError('Output already exists. Choose another file or use --force.');
  }
  const customSecrets = typeof redactionFile === 'string' ? await readRedactionFile(resolve(redactionFile)) : [];
  const noteValues = typeof notesFile === 'string' ? await readNotesFile(resolve(notesFile)) : {
    goal: '', decisions: '', constraints: '', nextSteps: '',
  };
  let text: string;
  let originalBytes: Buffer | undefined;
  if (input === '-') {
    const inputData = await readStdin(Boolean(originalOutput));
    text = inputData.text;
    originalBytes = inputData.originalBytes;
    if (originalOutput) {
      await writeOutput(originalOutput, originalBytes!, Boolean(values.force));
      originalBytes = undefined;
    }
  } else {
    const inputPath = resolve(input);
    const inputInfo = await stat(inputPath);
    if (!inputInfo.isFile()) throw new CliError('Input must be a regular file.');
    if (inputInfo.size > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
    if (originalOutput) await copyOriginalFile(inputPath, originalOutput, Boolean(values.force));
    const parsePath = originalOutput ?? inputPath;
    text = await readFile(parsePath, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new CliError('Input exceeds the 100 MiB limit.');
  }
  if (!text.trim()) throw new CliError('Input is empty.');
  const archive = parseInput(text, input === '-' ? 'stdin.txt' : basename(input));
  const conversation = archive.conversations[selected - 1];
  if (!conversation) throw new CliError(`Conversation ${selected} is unavailable; this input contains ${archive.conversations.length}.`);
  const cleanOptions = {
    ...DEFAULT_OPTIONS,
    stripImages: !values['keep-images'], trimToolOutputs: !values['keep-tool-outputs'],
    deduplicate: !values['keep-duplicates'], redact: !values['no-redact'],
    redactEmails: !Boolean(values['no-redact-emails']), toolLimit, customSecrets,
  };
  const result = cleanConversation(conversation, cleanOptions);
  const pinnedIds = [...new Set((pinValues ?? []).map((value) => {
    if (!/^\d+$/.test(value)) throw new CliError('--pin requires a message number within the selected conversation.');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > conversation.messages.length) {
      throw new CliError(`--pin message number must be between 1 and ${conversation.messages.length}.`);
    }
    return conversation.messages[number - 1]!.id;
  }))];
  let handoffConversation = result.conversation;
  const duplicateMarker = '[ThreadPack: duplicate tool output omitted; identical to message ';
  const restoredPinIds = new Set(pinnedIds.filter((id) => {
    const message = result.conversation.messages.find((item) => item.id === id);
    return !message || message.content.startsWith(duplicateMarker);
  }));
  if (includesHandoff && restoredPinIds.size > 0) {
    // Restore explicitly pinned content when cleanup replaces it with a duplicate marker.
    const fullClean = cleanConversation(conversation, { ...cleanOptions, deduplicate: false }).conversation;
    const retainedMessages = new Map(result.conversation.messages
      .filter((message) => !restoredPinIds.has(message.id)).map((message) => [message.id, message]));
    const allCleanMessages = new Map(fullClean.messages.map((message) => [message.id, message]));
    const pinnedSet = new Set(pinnedIds);
    handoffConversation = {
      ...result.conversation,
      messages: conversation.messages.flatMap((message) => {
        if (!retainedMessages.has(message.id) && !pinnedSet.has(message.id)) return [];
        const cleaned = retainedMessages.get(message.id) ?? allCleanMessages.get(message.id);
        return cleaned ? [cleaned] : [];
      }),
    };
  }
  let cleanNotes = noteValues;
  if (includesHandoff) {
    const notesConversation = cleanConversation({
      id: 'cli-notes', title: '', source: 'notes',
      messages: NOTE_KEYS.map((key) => ({ id: key, role: 'user' as const, content: noteValues[key] })),
    }, { ...cleanOptions, trimToolOutputs: false, deduplicate: false });
    cleanNotes = Object.fromEntries(notesConversation.conversation.messages.map((message) => [
      message.id,
      message.content.replace(/\[(SECRET|EMAIL|CUSTOM)_(\d+)\]/g, '[NOTE_$1_$2]'),
    ])) as CliNotes;
  }
  const handoff = includesHandoff ? buildHandoffWithSummary(handoffConversation, {
    ...cleanNotes, pinnedIds, recentCount: recent, recentMode, language,
  }) : undefined;
  const warnings = [...archive.warnings, ...result.warnings];
  const localizedWarnings = warnings.map((warning) => localizeWarning(warning, language));
  let rendered: string;
  if (format === 'jsonl') rendered = buildJsonl(result.conversation);
  else if (format === 'handoff') rendered = handoff!.text;
  else if (format === 'report') rendered = JSON.stringify({
    tool: 'ThreadPack', version: __THREADPACK_VERSION__, format: archive.format,
    conversation: selected, conversationCount: archive.conversations.length,
    messages: result.conversation.messages.length, stats: result.stats,
    warningCount: archive.warnings.length + result.warnings.length,
    warnings: localizedWarnings,
    handoff: { ...handoff!.summary },
    note: localizeSummary(language, result.stats, result.conversation.messages.length).reportNote,
  }, null, 2);
  else rendered = buildTranscript(result.conversation, language);

  await writeOutput(output, rendered, Boolean(values.force));

  const summary = localizeSummary(language, result.stats, result.conversation.messages.length);
  process.stderr.write(`${summary.exported}\n${summary.changes}\n${summary.redaction}\n`);
  if (warnings.length) {
    process.stderr.write(`${summary.warningCount(warnings.length)}\n`);
    for (const warning of localizedWarnings) process.stderr.write(`${summary.warning} ${warning}\n`);
  }
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
  process.stderr.write(`ThreadPack: ${localizeDiagnostic(message, diagnosticLanguage)}\n`);
  process.exitCode = 1;
});
