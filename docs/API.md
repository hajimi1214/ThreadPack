# Core API

The browser application and CLI share the pure TypeScript engine in [`src/core/`](../src/core/). These functions perform no network requests or filesystem writes. They return normalized data or strings; the caller controls storage and delivery.

This is a **source-level API**. The release CLI is bundled for execution, not published as an importable library entry point. Import the core from a TypeScript checkout when building integrations.

## Example

The following can be saved as `example.ts` at the repository root and run with `npx tsx example.ts` after `npm ci`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import {
  parseInput,
  cleanConversation,
  DEFAULT_OPTIONS,
  buildTranscript,
} from './src/core/index.ts';

const text = await readFile('examples/demo-session.jsonl', 'utf8');
const archive = parseInput(text, 'demo-session.jsonl');
const conversation = archive.conversations[0];
if (!conversation) throw new Error('No conversation was imported.');

const result = cleanConversation(conversation, {
  ...DEFAULT_OPTIONS,
  redactEmails: true,
});

// Review archive.warnings, result.warnings, and result.changes before sharing.
await writeFile('example-cleaned.md', buildTranscript(result.conversation), {
  encoding: 'utf8',
  flag: 'wx',
});
```

The example uses exclusive file creation. It will not replace an existing output.

## Data types

```ts
type Role = 'system' | 'user' | 'assistant' | 'tool';

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp?: string;
}

interface Conversation {
  id: string;
  title: string;
  source: string;
  messages: Message[];
}

interface ParsedArchive {
  format: string;
  conversations: Conversation[];
  warnings: string[];
  sourceBytes: number;
}
```

`parseInput` assigns normalized sequential message references instead of exporting provider message IDs. Valid timestamps are normalized; unsupported timestamps are omitted. `sourceBytes` measures the UTF-8 input string. `format` is derived from supported structural schemas, rather than arbitrary source metadata.

## `parseInput(text, filename)`

```ts
parseInput(text: string, filename: string): ParsedArchive
```

Imports Codex and Claude Code JSONL, ChatGPT and Claude JSON exports, generic messages JSON/JSONL, Markdown, and plain text. A filename extension informs detection; complete JSON and valid pasted JSONL are also recognized from text.

- ChatGPT imports follow `current_node` and its parent chain. Other branches are not included.
- Explicit `.json` input must be valid JSON; invalid input throws.
- JSONL can import valid records while warning that malformed lines were skipped. No recognized records produces an error.
- An unknown JSON schema is preserved as one text message with a warning.
- Plain-text role headings are recognized outside fenced code blocks.

The caller must review warnings before treating an import as complete. The browser and CLI enforce a 100 MiB input limit; a direct core integration should apply its own size and memory limits.

## `cleanConversation(conversation, options)`

```ts
interface CleanOptions {
  stripImages: boolean;
  trimToolOutputs: boolean;
  toolLimit: number;
  deduplicate: boolean;
  redact: boolean;
  redactEmails: boolean;
  customSecrets?: string[];
}

cleanConversation(conversation: Conversation, options: CleanOptions): CleanResult
```

`DEFAULT_OPTIONS` contains:

```ts
{
  stripImages: true,
  trimToolOutputs: true,
  toolLimit: 4000,
  deduplicate: true,
  redact: true,
  redactEmails: false,
}
```

The function returns a new conversation without mutating the input. Cleanup removes selected inline image payloads, replaces exact repeated tool output, scans retained content for recognized secrets and optional email addresses, and clips long tool output while retaining its beginning and end. Redaction precedes clipping so a clipping boundary cannot remove a recognized credential's prefix and leave its suffix unmasked.

Aliases are consistent within a cleaning pass, including recognized values in the conversation title and source label. They are not a reversible lookup map. The same value can receive a different alias in a separate call.

`customSecrets` supplies additional literal, case-sensitive values. They are replaced with consistent `[CUSTOM_1]` aliases even when `redact` and `redactEmails` are false. These values are not regular expressions; meaningful leading and trailing whitespace is preserved. Explicit values are useful for private names and internal identifiers that generic credential rules do not recognize.

```ts
interface Change {
  messageId: string;
  kind: 'image' | 'tool' | 'duplicate' | 'secret' | 'email' | 'custom';
  count: number;
  removedBytes: number;
}

interface CleanStats {
  beforeBytes: number;
  afterBytes: number;
  removedBytes: number;
  imagesRemoved: number;
  outputsTrimmed: number;
  duplicatesRemoved: number;
  secretsRedacted: number;
  emailsRedacted: number;
  customRedacted: number;
}

interface CleanResult {
  conversation: Conversation;
  changes: Change[];
  stats: CleanStats;
  warnings: string[];
}
```

Byte statistics measure UTF-8 message bodies, excluding metadata and export formatting. Redaction counters count recognized occurrences; changes can include multiple categories for a message. These measurements do not estimate provider tokens or cost. The core accepts a finite tool limit from 200 to 1,000,000 characters; browser and CLI controls intentionally expose narrower ranges.

### `validateCustomSecrets(value)`

```ts
validateCustomSecrets(value: unknown): string[]
```

Validates an array with at most 50 values. Each must be a nonblank string containing 3–1000 Unicode code points. The original array length is checked before duplicate values are removed. Accepted strings retain their original whitespace; repeated values are deduplicated. An invalid input throws a fixed error that does not echo the rejected value. `cleanConversation` also validates supplied custom values.

Report integrations must omit `customSecrets` and any original rule-file path from public output. Export aggregate `stats.customRedacted` instead. The CLI's `--redact-file` parses a UTF-8 file of at most 64 KiB, ignores blank lines, and passes the remaining lines through this validator.

## Export functions

```ts
buildTranscript(conversation: Conversation): string
buildJsonl(conversation: Conversation): string
```

`buildTranscript` returns Markdown with message bodies in code fences. `buildJsonl` returns one normalized `Message` object per line. Both accept the conversation passed to them without applying cleanup; pass `result.conversation` to export cleaned data.

Neither format is a native provider session file or a mechanism for resuming an agent.

### `buildHandoff(conversation, options)`

```ts
interface HandoffOptions {
  goal: string;
  decisions: string;
  constraints: string;
  nextSteps: string;
  pinnedIds: string[];
  recentCount: number;
  maxCharacters?: number;
}

buildHandoff(conversation: Conversation, options: HandoffOptions): string
```

Creates a Markdown document containing explicit notes, pinned messages, and recent messages. Recent messages already pinned are not duplicated. Excerpts are deterministic and labeled as historical material, without generating a semantic summary.

- `maxCharacters` defaults to 16000; valid budgets range from 1000 to 10,000,000.
- User notes and pinned messages are retained in full. If they exceed the budget, the output explicitly reports the overflow.
- Recent context is shortened or omitted to fit the remaining budget, with explanatory markers.
- Note text is not automatically redacted by this function. A caller accepting arbitrary notes must scan those notes separately before exporting. The browser does this and uses a distinct `NOTE_` alias namespace.

## Integration responsibilities

Apply input limits, review parser and cleanup warnings, and protect the source file when writing an export. Treat all imported text and generated transcripts as untrusted historical content. Rule-based redaction is an aid and cannot guarantee that an export contains no secrets or personal data. See [SECURITY.md](../SECURITY.md).
