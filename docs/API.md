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

const result = cleanConversation(conversation, DEFAULT_OPTIONS);

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
type SourcePlatform = 'chatgpt' | 'codex' | 'claude' | 'claude-code' | 'openai' | 'generic' | 'text' | 'threadpack' | 'unknown';

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp?: string;
  kind?: 'message' | 'tool-call' | 'tool-result' | 'reasoning' | 'summary' | 'compaction' | 'metadata';
  parentId?: string;
  toolCallId?: string;
  toolName?: string;
  provenance?: MessageProvenance;
}

interface MessageProvenance {
  platform: SourcePlatform;
  platformId?: string;
  recordIndex?: number;
  recordType?: string;
  sourceNodeId?: string;
  parentSourceId?: string;
  toolCallSourceId?: string;
  conversationSourceId?: string;
  rawTimestamp?: string | number;
}

interface ConversationBranch { id: string; headMessageId: string; messageIds: string[]; sourceNodeIds?: string[] }
interface ConversationProvenance { platform: SourcePlatform; sourceId?: string; sourceRecordCount?: number }
interface SessionEvent { id: string; type: string; recordIndex: number; platform: SourcePlatform; content: string }

interface ConversationHistory {
  messages: Message[];
  branches: ConversationBranch[];
  activeBranchId: string;
}

interface IntegrityReport {
  status: 'complete' | 'partial';
  sourceRecordCount: number;
  importedMessageCount: number;
  branchCount: number;
  timelineEventCount: number;
  toolCallCount: number;
  issueCount: number;
  issues: { code: string; severity: 'warning' | 'error'; count: number }[];
}

interface Conversation {
  id: string;
  title: string;
  source: string;
  provenance?: ConversationProvenance;
  messages: Message[];
  history?: ConversationHistory;
  events?: SessionEvent[];
  integrity?: IntegrityReport;
}

interface ParsedArchive {
  format: string;
  conversations: Conversation[];
  warnings: string[];
  sourceBytes: number;
  provenance?: { platform: SourcePlatform; format: string; byteLength: number };
  integrity?: IntegrityReport;
}
```

`parseInput` assigns normalized sequential message and conversation references and keeps provider identifiers separately in provenance. Original platform references can contain sensitive data, so clean the conversation before exporting provenance. Valid timestamps are normalized for ordering while original timestamp values are retained as provenance; unsupported timestamps are omitted from the ordering field. `Conversation.messages` is the active branch used by existing workbench callers. ChatGPT mapping imports also expose every mapped message and branch through `Conversation.history`; branch `sourceNodeIds` retains mapping nodes that did not have a message body. Tool-call and tool-result records carry normalized call references, while source call IDs remain in provenance. Message kinds distinguish ordinary messages, tool calls/results, reasoning, summaries, compaction, and preserved metadata. `Conversation.events` retains non-message timeline records and malformed mapping/archive records for review and round-trip export.

`ParsedArchive.integrity` contains content-free issue codes and counts for malformed or unknown records, empty conversations, duplicate source IDs, missing or cyclic parent links, invalid branch references, and unmatched tool calls/results. Counts also include imported messages, branches, timeline events, and tool calls. `sourceBytes` measures the input string as UTF-8 unless the caller supplies its original byte length. Integrity checks validate structure and references, but do not provide a cryptographic checksum or prove that an export is authentic.

## `parseInput(text, filename, inputByteLength?)`

```ts
parseInput(text: string, filename: string, inputByteLength?: number): ParsedArchive
```

Pass the original byte length when it is already known to avoid encoding the complete input again for statistics. The value must be a nonnegative safe integer.

Imports Codex and Claude Code JSONL, ChatGPT and Claude JSON exports, OpenAI-compatible tool-call JSON/JSONL, generic messages JSON/JSONL, Markdown, plain text, and browser ZIP files containing one of those text exports. A filename extension informs detection; complete JSON and valid pasted JSONL are also recognized from text. Browser ZIP imports apply entry-count, expanded-size, and safe-path limits before selecting a supported export.

- ChatGPT imports follow `current_node` in `Conversation.messages` and preserve all mapped nodes, parent links, and leaf branches in `Conversation.history`.
- Explicit `.json` input must be valid JSON; invalid input throws.
- JSONL can import valid records while warning that malformed lines were skipped. No recognized records produces an error.
- Unknown JSONL records are retained as timeline events. Tool calls, results, and source references remain linked in the normalized model.
- An unknown JSON schema is preserved as one text message with a warning.
- Plain-text role headings are recognized outside fenced code blocks.

The caller must review warnings and `integrity` before treating an import as complete. The browser and CLI enforce a 100 MiB input limit; a direct core integration should apply its own size and memory limits.

`buildJsonl` emits ordinary message-per-line JSONL when the conversation has no branch graph, timeline events, or partial-import issues. It adds optional `provenance` fields to those message rows. Conversations with branch history, timeline events, or partial integrity use a versioned `threadpack_session`, `threadpack_message`, and `threadpack_event` record envelope so those relationships and content-free issue codes round-trip. The result is an interchange format, not a native provider session or resume file. Apply `cleanConversation` before exporting untrusted source provenance.

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
  redactEmails: true,
}
```

The function returns a new conversation without mutating the input. Cleanup removes selected inline image payloads, replaces exact repeated tool output, scans retained content for recognized secrets and email addresses by default, and clips long tool output while retaining its beginning and end. Set `redactEmails: false` to explicitly preserve email addresses. URL credentials are scanned independently of email matching. Redaction precedes clipping so a clipping boundary cannot remove a recognized credential's prefix and leave its suffix unmasked.

Aliases are consistent within a cleaning pass, including recognized values in the conversation title and source label. They are not a reversible lookup map. The same value can receive a different alias in a separate call.

With `redact: true`, bare URLs with a `scheme://userinfo@host` authority have their complete user information replaced by a secret alias. The last literal `@` in the authority delimits the host, covering passwords with literal `@` and percent-encoded user information. Protocol, host, IPv6 brackets, port, path, query, and fragment retain their source spelling unless another rule matches them. Existing credential-assignment rules can still replace a whole assigned URL.

Email matching excludes URL authorities even when `redact` is off. Standalone multi-`@` strings and numeric-only domains are excluded from email matches. Such unrecognized strings require a credential context or an exact custom rule to be redacted. Email redaction is enabled by default.

`customSecrets` supplies additional literal, case-sensitive values. They are replaced with consistent `[CUSTOM_1]` aliases even when `redact` and `redactEmails` are false. These values are not regular expressions; meaningful leading and trailing whitespace is preserved. Explicit values are useful for private names and internal identifiers that generic credential rules do not recognize. Email addresses are redacted by default. Use `redactEmails: false` only when the caller explicitly intends to preserve them.

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
  customRuleMatches: number;
  redactionReplacements: number;
}

interface CleanResult {
  conversation: Conversation;
  changes: Change[];
  stats: CleanStats;
  warnings: string[];
}
```

Byte statistics measure UTF-8 message bodies, excluding metadata and export formatting. Redaction counters count recognized occurrences; changes can include multiple categories for a message. These measurements do not estimate provider tokens or cost. The core accepts a finite tool limit from 200 to 1,000,000 characters; browser and CLI controls intentionally expose narrower ranges.

`customRuleMatches` counts each occurrence of each deduplicated custom rule, including overlapping matches. `customRedacted` retains its existing meaning: replacement intervals whose winning alias category is `CUSTOM`. `redactionReplacements` counts disjoint replacement intervals across all categories and equals `secretsRedacted + emailsRedacted + customRedacted`. These counters include message bodies after image removal and before tool truncation/deduplication, plus the title and source label. They count processing events, so aliases later omitted by tool cleanup still contribute. For example, two custom substrings inside one longer URL credential produce two custom rule matches, zero custom replacements, and one total replacement.

### `validateCustomSecrets(value)`

```ts
validateCustomSecrets(value: unknown): string[]
```

Validates an array with at most 50 values. Each must be a nonblank string containing 3–1000 Unicode code points. The original array length is checked before duplicate values are removed. Accepted strings retain their original whitespace; repeated values are deduplicated. An invalid input throws a fixed error that does not echo the rejected value. `cleanConversation` also validates supplied custom values.

Report integrations must omit `customSecrets` and any original rule-file path from public output. Export aggregate `stats.customRuleMatches`, `stats.customRedacted`, and `stats.redactionReplacements`. The CLI's `--redact-file` parses a UTF-8 file of at most 64 KiB, ignores blank lines, and passes the remaining lines through this validator.

## Export functions

### `extractCodeSnippets(conversation)`

Returns metadata for closed Markdown fenced blocks, including language, message/fence indices, line and character counts, and start/end offsets into the message content. It does not execute code or duplicate complete code bodies. Call it on `cleanConversation(...).conversation` to extract cleaned code:

```ts
import { extractCodeSnippets, snippetExtension } from './src/core/index.ts';

for (const snippet of extractCodeSnippets(result.conversation)) {
  const code = result.conversation.messages[snippet.messageIndex]!.content.slice(snippet.start, snippet.end);
  const extension = snippetExtension(snippet.language);
  // Deliver `code` to the caller. The extension is allowlisted; unknown languages use txt.
}
```

Backtick and tilde fences are supported, with matching close markers of sufficient length. Inline, over-indented, and unclosed fences are excluded. Unknown language info is normalized to `text`; source info strings do not become file names.

The browser adds search and allowlisted language filters over cleaned snippets, then can stream all matching cleaned blocks into a ZIP archive in the Worker. The bundled preview highlighter uses selected local grammars; unsupported languages display as plain text. Browser UI and Worker dependencies include MIT `lowlight` with selected BSD-3-Clause `highlight.js` grammars and MIT `fflate`; they extend the UI and Worker, not this core API. Full runtime license texts appear in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The export dialog also offers a portable context bundle. The Worker creates a ZIP from the cleaned conversation containing `README.md`, `transcript.md`, `messages.jsonl`, `cleanup-report.json`, cleaned `code/` files, and `handoff.md` only when submitted notes contain nonblank text. The bundle uses allowlisted metadata and never includes original-view content or custom redaction values.

The handoff view can import and export a separate `threadpack-handoff-draft` JSON document, version 1, limited to 256 KiB. It contains the four handoff note fields, recent-message settings, a source fingerprint, and pinned message numbers with SHA-256 content fingerprints. It contains no message bodies or provider IDs. Notes remain unredacted in this file. Pinned messages are accepted only when the source conversation and the referenced messages match. The document stores editable handoff settings, not a native session or conversation recovery data.

The browser also provides an optional Markdown reading mode using `react-markdown` and `remark-gfm`. Raw HTML is not enabled, images render as text placeholders, and code is rendered as React text. This mode changes only presentation; message copy and exports continue using the full cleaned source text.

```ts
buildTranscript(conversation: Conversation, language?: OutputLanguage): string
buildJsonl(conversation: Conversation): string
```

`buildTranscript` returns Markdown with message bodies in code fences and localized reader-facing headings. `language` accepts `en`, `zh`, `ja`, `fr`, or `es` and defaults to `en`. Ordinary `buildJsonl` rows remain normalized messages with unchanged role and JSON key conventions; session envelopes use the `threadpack_session`, `threadpack_message`, and `threadpack_event` record types. Both accept the conversation passed to them without applying cleanup; pass `result.conversation` to export cleaned data.

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
  recentMode?: 'source' | 'timestamp';
  language?: 'en' | 'zh' | 'ja' | 'fr' | 'es';
  maxCharacters?: number;
}

buildHandoff(conversation: Conversation, options: HandoffOptions): string
buildHandoffWithSummary(conversation: Conversation, options: HandoffOptions): HandoffBuildResult
```

Creates a Markdown document containing explicit notes, pinned messages, and recent messages. Recent messages already pinned are not duplicated. Excerpts are deterministic and labeled as historical material, without generating a semantic summary.

`recentMode` defaults to `source`, which preserves the existing source window and renders messages in source order. `timestamp` selects only messages with valid timestamps, resolving equal timestamps by preferring the later source position. Both modes render selected messages in source order. `buildHandoffWithSummary` returns the same Markdown plus selection mode, included time range, complete/omitted/truncated counts and message IDs, timestamp exclusions, and budget overflow status. `buildHandoff` remains a text-only wrapper.

The remaining recent-context budget is distributed across as many priority-ordered messages as can fit their message structure and excerpt marker. Short messages release unused allocation to longer excerpts. Messages that cannot fit a marked excerpt are reported as omitted. This is deterministic excerpt selection, not semantic summarization or compression.

- `maxCharacters` defaults to 16000; valid budgets range from 1000 to 10,000,000.
- User notes and pinned messages are retained in full. If they exceed the budget, the output explicitly reports the overflow.
- Recent context is shortened or omitted to fit the remaining budget, with explanatory markers.
- Note text is not automatically redacted by this function. A caller accepting arbitrary notes must scan those notes separately before exporting. The browser does this and uses a distinct `NOTE_` alias namespace.

## Integration responsibilities

Apply input limits, review parser and cleanup warnings, and protect the source file when writing an export. Treat all imported text and generated transcripts as untrusted historical content. Rule-based redaction is an aid and cannot guarantee that an export contains no secrets or personal data. See [SECURITY.md](../SECURITY.md).
