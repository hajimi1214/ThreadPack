<div align="center">

![ThreadPack](docs/assets/banner.png)

# ThreadPack

**Clean conversation exports. Extract code. Carry context forward.**

Open Codex, Claude Code, ChatGPT, and Claude exports, including ZIP downloads, in a local browser application or TypeScript CLI.

[![CI](https://github.com/hajimi1214/ThreadPack/actions/workflows/ci.yml/badge.svg)](https://github.com/hajimi1214/ThreadPack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js: >=20.19](https://img.shields.io/badge/Node.js-%3E%3D20.19-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)

[Live application](https://hajimi1214.github.io/ThreadPack/) · [Download release](https://github.com/hajimi1214/ThreadPack/releases/latest) · [简体中文](README.zh-CN.md)

[Import guide](https://hajimi1214.github.io/ThreadPack/import-guide.html) · [Core API](docs/API.md) · [Architecture and performance](docs/ARCHITECTURE.md) · [Research](docs/RESEARCH.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

## Overview

ThreadPack processes exported AI conversations without uploading them to another service. It removes selected image payloads and tool-output bulk, applies rule-based redaction, and exports a reviewable transcript or a handoff containing user-written notes and selected messages.

The browser application runs from a single self-contained HTML file. The CLI shares its parsing, cleaning, and export engine. Both work locally without an account or API key.

Importing opens a compact workbench with the conversation in the first screen and persistent export actions. Mobile cleanup settings expand on demand. Full-text search covers both original and packed conversations, including text omitted from display previews.

Use the **Text / Markdown** switch to read message bodies or handoff previews as formatted Markdown. GFM tables, task lists, and fenced code are supported. Raw HTML remains text, images stay offline, and copying still returns the original cleaned message.

Use **Export filtered results** to download every matching message as Markdown or JSONL, including messages on other pages. Search, role, change, and pin filters combine. Matching follows the selected view; exported message text always uses your cleanup settings.

Open **Code snippets** to collect fenced code blocks across the selected conversation. Search code, filter by language, switch between wrapping and horizontal scrolling, and preview, copy, or download cleaned code. Long code stays complete when copied or downloaded. Use **Download ZIP** for every matching block across pages. The offline app bundles [lowlight](https://github.com/wooorm/lowlight), selected BSD-3-Clause [highlight.js](https://github.com/highlightjs/highlight.js) grammars, [fflate](https://github.com/101arrowz/fflate), and the [react-markdown](https://github.com/remarkjs/react-markdown) GFM renderer. Full license notices appear in Help and release downloads. Try the built-in demo or [this Markdown sample](examples/code-snippets.md).

Use **Portable context bundle** to download one safe ZIP containing the cleaned Markdown transcript, normalized JSONL, aggregate cleanup report, a short manifest, code files, and an optional handoff note. It is designed for issue reports, team handoffs, and archives; the bundle is created in the Worker and never includes original-view content or custom redaction values. Normalized JSONL preserves source references, tool-call links, timeline events, and branches where available. It is an interchange format, not a native session or resume file.

Useful for restarting a long coding session, collecting generated code, or preparing a smaller transcript to share. The **Share ThreadPack** button copies only the tool's public address, with no conversation text or current-page parameters.

Press **Ctrl+K** (or **⌘K** on Mac) to open quick actions for importing, search, export, recipes, and page navigation. Copy buttons show pending, success, or failure at the point of interaction. The toolbar can clear all filters in one click.

Layout adapts to both screen width and height. Phones and short landscape windows use page scrolling so the transcript keeps a usable height. Tablets switch cleanup settings to a sheet, the transcript toolbar follows its own available width, and ultrawide screens get a larger workspace. Rotating or resizing keeps the open conversation, filters, and pins.

Files are read with Web Streams inside a Web Worker, with progress and cancellation. The interface receives at most 30 preview messages at a time; a full message crosses into the interface only when you explicitly copy it. Complete exports are built in the worker and transferred as buffers. See the [measured comparison](docs/ARCHITECTURE.md#measured-comparison).

The interface supports **English, 简体中文, 日本語, Français, and Español**. Use the language menu in the top navigation. The initial language follows your browser preferences, and a manual choice is remembered. Imported conversation content is not translated. Reader-facing export headings, warnings, reports, and handoff text use the selected language; JSON keys, message roles, and machine aliases remain stable.

![ThreadPack workbench with a synthetic conversation](docs/assets/demo.png)

<details>
<summary>Code extraction preview</summary>

![Copying and downloading complete code blocks](docs/assets/code-snippets.png)

</details>

## Supported formats

| Input | Handling |
| --- | --- |
| Codex rollout JSONL | Messages, function calls and results, session metadata, compaction, and timeline records |
| Claude Code JSONL | User and assistant messages, ordered tool-use/result blocks, summaries, and source links |
| ChatGPT export JSON | Single or multiple conversations; shows `current_node` and retains all mapped branches |
| Claude export JSON | Conversations containing `chat_messages` |
| OpenAI-compatible JSON / JSONL | `messages` with `tool_calls`, function arguments, and linked tool results |
| Generic JSON / JSONL | `messages` arrays or records with `role` and `content` |
| Markdown / plain text | Explicit role headings where present; otherwise retained as text |

Provider exports change over time. Unsupported records and partial imports produce warnings and content-free integrity issue counts. Normalized JSONL retains branch graphs and timeline events when present. Asset references without embedded image data cannot recover the original image.

## Processing workflow

1. **Import** a local file, ZIP export, paste text, or load the included synthetic demo. ThreadPack selects a supported text export inside a ZIP and keeps the compressed input under the 100 MiB limit. Select a conversation if the archive contains several.
2. **Configure cleanup:** start with a balanced, share-safe, or keep-text recipe, then adjust individual rules. Remove embedded images, clip long tool outputs, collapse exact repeats, and redact recognized secrets, email addresses, or your own exact values.
3. **Review** the packed and original views. Filter to changed or pinned messages, open a bounded before/after review on any changed message, search within long messages, copy a complete message in the selected view, and pin the context that should remain in a handoff.
4. **Export** a Markdown transcript, normalized JSONL, aggregate cleanup report, portable context bundle, or a handoff with goal, decisions, constraints, and next steps.

Original files are not modified. The interface reports UTF-8 message-text bytes and change counts; these measurements exclude source metadata and are not provider token or billing estimates.

While a conversation is loaded, **Download original file** saves the exact imported bytes separately from cleaned exports. For ZIP imports it downloads the original ZIP. For pasted text it saves the entered text as UTF-8. The source stays available until the workspace is cleared or another import succeeds.

Handoffs include your notes, pinned messages, and recent context. If the selected text budget is exceeded, the export marks it.

Switching conversations in the same archive preserves each conversation's notes, pins, and handoff settings in memory. Use **Export draft** and **Import draft** in the handoff view to save or restore those settings as a separate versioned JSON file. Drafts are limited to 256 KiB. Notes remain unredacted in the draft, so treat it as sensitive. Pinned message numbers are checked against the source conversation before import. Clearing the workspace, replacing the archive, or closing the tab removes in-memory drafts. Custom redactions also clear when the workspace or archive is replaced. By default, conversation text, notes, and custom values are not saved to browser storage.

For longer-lived work, open **Projects** and create a local project. Project status, important notes, and conversations are saved only after you choose a save action. Re-importing an unchanged session does not create a duplicate version. When the source provides a stable session ID, updated imports append a snapshot while retaining the previous version. Restoring an older version appends it as a new current version. Sources without a stable ID are deduplicated by exact normalized snapshot fingerprint, so changed content is saved as a separate session. Project search includes saved conversation text and all of its versions. Download a project backup regularly to move or recover it. Backups contain unredacted conversation history and project notes. They are sensitive files. By default, the project library uses this browser profile's local storage and does not sync or encrypt data. Optional live MCP sharing writes one selected project to a user-chosen file. Browser cleanup may remove local project data. The ordinary in-memory workflow continues to work without a project library.

The project-memory section records goals, decisions, constraints, tasks, risks, and open questions with explicit origins, review states, and evidence links to immutable session versions and message excerpts. Conflicting facts are marked for review. Superseding a fact keeps its history. The offline context builder ranks relevant facts, respects a character budget without clipping individual records, and reports omissions, conflicts, old evidence, and unconfirmed suggestions.

AI extraction is optional and off by default. To use it, choose an HTTPS Chat Completions endpoint and model, enter an API key for the current tab, select up to four conversations, and start extraction. ThreadPack sends bounded excerpts, project status, and confirmed fact summaries only after that action. The endpoint and key are not saved. AI results remain unconfirmed proposals and must cite exact excerpts from the selected messages. Repository and test evidence can be recorded with a commit, path, command, and output excerpt. ThreadPack stores those user-provided records but does not independently inspect the repository or rerun tests.

Use **Export AI context pack** to create a portable snapshot with the selected context, evidence metadata, and instruction-file entry points for Codex, Claude Code, and Gemini coding workflows. Place the instruction and context files in a repository for coding agents, or upload the context files through a browser tool's supported project controls. The pack does not sync automatically. ThreadPack does not claim direct ChatGPT or Claude account integration.

### Live local project state over MCP

In Projects, choose **Connect live local state** and select a new empty `.jsonl` file in a location you control. ThreadPack writes the selected project's versioned state to that file after project details, sessions, or memory facts change. The file contains unredacted history. The connection handle is stored in this browser profile. If the browser revokes file permission, reconnect from the project panel. A sync indicator shows whether the file matches the latest saved project state. Ordinary IndexedDB projects continue to work when live sharing is unavailable.

Configure each local stdio MCP instance on the same computer to launch `threadpack mcp --backup /path/to/threadpack-shared-project.jsonl --inbox /path/to/threadpack-project-updates.jsonl`. Instances expose only context and task-list tools by default. Read-only instances may omit a client identity and remain limited to the explicitly selected local backup. For an authenticated local principal, first run `threadpack mcp-client issue --registry /path/to/threadpack-mcp-clients.json --id codex --project-id <exact-project-id>`. This prints a 256-bit bearer token once and stores only its SHA-256 hash. Supply the token to the MCP child process as `THREADPACK_CLIENT_TOKEN`, then configure `--client-id codex --client-registry /path/to/threadpack-mcp-clients.json --project-id <exact-project-id>`. To grant candidate submission or task coordination, add the corresponding permission when issuing the credential and enable `--allow-candidate-updates` or `--allow-task-coordination` in the server command. Server permissions cannot exceed the registered grants, and registry changes are checked before each resource or tool request. Use `threadpack mcp-client list`, `rotate`, and `revoke` to inspect, replace, or disable credentials. Protect the registry and MCP client configuration because the latter may contain the bearer token. This authenticates possession of a ThreadPack-local credential, not an external WorkBuddy/Codex/Claude account or person. It does not isolate malicious processes running under the same OS user. Windows ACL inheritance is not inspected by the current CLI.

The `threadpack_project_context` tool and `threadpack://project/context` resource reread the shared state on each request and include a snapshot version and project update time. `threadpack_project_tasks` lists confirmed, conflict-free unfinished tasks and active temporary claims. A client can claim, renew, or release a task lease through `threadpack_project_claim_task`, which helps reduce duplicate work without treating a task label as proof of progress. Task results may be submitted with the task and claim IDs through `threadpack_project_submit_update`. Each candidate must cite an exact quote from a saved session version and message ID, and include a retry-safe idempotency key. The browser project panel imports claims and candidates and requires user review before a candidate becomes a project fact. Shared inbox labels remain unsigned, unverified coordination metadata. Users can edit or reject candidates, review status history and claim activity, and revoke an accepted candidate while retaining its audit trail. Conflicting accepted facts enter the existing conflict review flow. A client can compare versions between reads. The bridge never accesses browser storage, AI account credentials, or network services, and it does not synchronize across computers. These local file integrations work for clients that support user-configured stdio MCP servers. They do not connect ChatGPT or Claude web conversations that lack that capability. Disconnecting stops browser updates but leaves the files in place, so remove the files or update client configurations to revoke access. Project backups remain separately available for recovery.

In the project library, **MCP client setup guide** generates a project-scoped stdio configuration example. It defaults to read-only. When local authentication or write permissions are selected, provide the registered client ID, registry path, and one-time token. The token is included in the generated example, so protect copied configuration and clipboard history. The guide does not read or edit client settings. Confirm the generated format against the client version you use and run `threadpack mcp --check` with the same local paths and token environment. A generated example does not establish client compatibility or external account identity.

Run `threadpack mcp --check --backup /path/to/threadpack-shared-project.jsonl --inbox /path/to/threadpack-project-updates.jsonl` to validate the local backup, inbox and effective tool permissions without starting an MCP session or changing either file. This checks the ThreadPack side only and does not prove that an AI client can launch or use the server.

The setup guide can optionally add `--connection-log <path>`. Logging is disabled by default. The local JSONL log records allowlisted client names, version-shaped metadata and capability names from initialize, plus observed MCP methods/tool names with outcomes and durations. Unknown client names are reduced to `unrecognized`, configured client labels are not written, and tool arguments or returned project context are never stored. The log must be separate from the backup and inbox, is restricted to the current user on POSIX, and has a 4 MiB cap. Once full or if a write fails, logging stops with a stderr notice while MCP requests continue. Rotate the file manually to resume logging. Client-declared names and capabilities remain unverified metadata.

Live file connection requires a secure Chromium-based browser with the File System Access API and is limited to shared backup files up to 256 MiB. Firefox, Safari, and browser environments without this API keep the local project workflow and ordinary backup import/export. ChatGPT or Claude web conversations that do not support user-configured local MCP processes cannot use the bridge directly.

## Installation and usage

### Browser application

Use the [hosted application](https://hajimi1214.github.io/ThreadPack/), or download the offline HTML from the [latest release](https://github.com/hajimi1214/ThreadPack/releases/latest) and open it directly in a browser. The downloaded application can process files without an internet connection or local server.

The hosted application is also an installable PWA. In a supporting browser, use **Install app** or the browser's installation menu. After a successful first visit, the application shell is available offline. Only public application files are cached; conversations, notes, redaction rules, and downloaded exports are excluded. Updates require an explicit action so you can download your in-memory work before reloading.

To run from source, install **Node.js 20.19 or newer**:

```sh
git clone https://github.com/hajimi1214/ThreadPack.git
cd ThreadPack
npm ci
npm run dev
```

Open the local URL printed by Vite. To create the production application and CLI:

```sh
npm run build
```

The browser artifact is **`dist/index.html`**. The CLI artifact is **`dist-cli/threadpack.mjs`**. Third-party and ThreadPack licenses are included in `THIRD_PARTY_NOTICES.md` and `LICENSE`.

### Command-line interface

Build the CLI separately with `npm run build:cli`, or use the CLI bundle from a release.

```sh
node dist-cli/threadpack.mjs session.jsonl --out cleaned.md
node dist-cli/threadpack.mjs session.jsonl --out cleaned.md --original-out source-copy.jsonl
node dist-cli/threadpack.mjs session.jsonl --out portable.jsonl --format jsonl
node dist-cli/threadpack.mjs export.json --conversation 2 --out handoff.md --format handoff
node dist-cli/threadpack.mjs session.jsonl --out handoff.md --format handoff --notes-file notes.json --pin 2 --pin 7
node dist-cli/threadpack.mjs session.jsonl --out dated-handoff.md --format handoff --recent 12 --recent-mode timestamp
node dist-cli/threadpack.mjs session.jsonl --out report.json --format report
```

The repository includes a synthetic fixture for local verification:

```sh
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

Import [`examples/code-snippets.md`](examples/code-snippets.md) in the browser to test code extraction and ZIP download with a small fixture.

After building, `npm link` makes the `threadpack` command available locally:

```sh
threadpack session.jsonl --out cleaned.md --tool-limit 4000
threadpack session.jsonl --out cleaned.md --original-out source-copy.jsonl --language zh
threadpack session.jsonl --out cleaned-custom.md --redact-file redact-values.txt
threadpack session.jsonl --out handoff.md --format handoff --recent 12
threadpack session.jsonl --out handoff.md --format handoff --notes-file notes.json --pin 2 --pin 7
threadpack session.jsonl --out dated-handoff.md --format handoff --recent 12 --recent-mode timestamp
threadpack --help
```

The notes file is a UTF-8 JSON object. Any of the four fields may be omitted and defaults to an empty string:

```json
{
  "goal": "Ship the compatibility fix",
  "decisions": "Keep the existing export format",
  "constraints": "Do not include credentials",
  "nextSteps": "Run the regression suite"
}
```

| Option | Description |
| --- | --- |
| `--format markdown\|jsonl\|handoff\|report` | Export format; defaults to `markdown` |
| `--original-out FILE` | Save an unmodified byte-for-byte copy of the input alongside the cleaned export |
| `--language en\|zh\|ja\|fr\|es` | Localize Markdown labels, report warnings, and CLI diagnostics; defaults to English |
| `--conversation N` | Conversation selection, starting at 1 |
| `--tool-limit N` | Character limit per tool output, from 500 to 100000 |
| `--keep-images` | Retain inline image payloads |
| `--keep-tool-outputs` | Retain full tool output |
| `--keep-duplicates` | Retain repeated tool output |
| `--no-redact` | Disable built-in secret recognition; custom rules stay active |
| `--redact-emails` | Explicitly enable email redaction; enabled by default |
| `--no-redact-emails` | Preserve email addresses |
| `--redact-file FILE` | Redact exact values from a local UTF-8 file, one value per line |
| `--recent N` | Recent messages included in a handoff, from 0 to 100; defaults to 8 |
| `--recent-mode MODE` | Select by `source` order (default) or valid timestamps; only for handoffs and reports |
| `--notes-file FILE` | Add handoff notes from UTF-8 JSON, up to 12000 characters per field; only for handoffs and reports |
| `--pin N` | Pin a 1-based message number from the selected source conversation; repeatable for handoffs and reports |
| `--force` | Replace an existing output file |

The browser accepts local text exports and ZIPs up to **100 MiB**. ZIP imports allow at most **256 entries** and **100 MiB of expanded content**; unsafe paths and unsupported entries are rejected without exposing archive names. Custom redaction editors accept up to **50 values**, **3–1000 characters each**, with a **51,000-character total input limit**. The CLI requires `--out`; use `-` as the input to read UTF-8 text from stdin. `--original-out` copies those original input bytes to a separate file and never changes the input. Existing outputs are rejected unless `--force` is supplied, which replaces the cleaned output and original copy. Input, output, original-copy, notes, and redaction files must all be distinct, including file aliases. Parser and cleaner warning details are printed to stderr and included in JSON reports, while transcript and note content remain excluded.

For values that generic secret detectors cannot recognize, supply `--redact-file redact-values.txt`. The file must be UTF-8 and at most **64 KiB**, with up to **50 nonblank lines**, each containing **3–1000 Unicode characters**. Matching is literal and case-sensitive, not a regular expression. Blank lines are ignored; other leading and trailing spaces remain significant. Repeated values receive stable `[CUSTOM_1]` aliases. These rules remain active with `--no-redact`, which only disables built-in secret recognition.

Common-secret cleanup also detects bare URL credentials, including database, Redis, and HTTP(S) URLs with IPv6 hosts or percent-encoded user information. Email cleanup excludes URL authorities and standalone multi-`@` tokens. Reports distinguish `customRuleMatches` (every custom-rule occurrence), `customRedacted` (intervals using a custom alias), and `redactionReplacements` (all merged replacement intervals). A custom substring already covered by a larger secret replacement still counts as a rule match.

Strict email redaction is enabled by default in the core and CLI. Use `--no-redact-emails` to retain addresses in CLI exports; the browser email switch can be turned off explicitly. The balanced browser preset also preserves email addresses. URL user information is scanned independently, and malformed multi-`@` strings are never partially labeled as email aliases.

`--no-redact` disables built-in credential patterns but leaves the default email scanner enabled. To preserve email addresses in CLI output, pass `--no-redact-emails` explicitly.

Timestamp selection chooses the most recently dated messages with valid timestamps. Equal timestamps use later source positions first for selection, then selected messages are rendered in source order. Missing or invalid timestamps are excluded from timestamp selection. The browser handoff preview and CLI JSON report show the recent-context time range, complete-message count, messages outside the recent limit, budget status, budget-omitted IDs, and truncated IDs. Long messages retain an inline excerpt marker.

When the text budget is tight, ThreadPack reserves space for message structure and excerpt markers, then distributes the remaining context space across multiple recent messages. Short messages use only the space they need, which leaves more room for longer excerpts. Messages that cannot fit even a useful marked excerpt are listed as omitted. This remains deterministic excerpting rather than semantic compression.

The CLI defaults to English. `--language` selects English, Chinese, Japanese, French, or Spanish for reader-facing Markdown headings, filtered excerpts, handoffs, report notes and warnings, context-bundle documents, and diagnostics. JSON property names, message roles, report option names, and machine aliases such as `[SECRET_1]` remain unchanged.

For handoffs, `--notes-file` accepts `goal`, `decisions`, `constraints`, and `nextSteps` strings. Each field is limited to 12000 characters and the JSON file to 256 KiB. Notes use the same enabled built-in, email, and custom redaction rules as the conversation, with independent `[NOTE_SECRET_n]`, `[NOTE_EMAIL_n]`, and `[NOTE_CUSTOM_n]` aliases. Repeat `--pin N` to include messages by their 1-based order in the original selected conversation. Notes and pins can also be passed with `--format report` to calculate its handoff summary without including note text.

Custom values and note contents are omitted from diagnostics and reports; reports expose warning details and aggregate match counts. Treat redaction and notes files as sensitive local data and keep them out of version control.

## Privacy and limitations

- **Local processing:** the application has no upload endpoint, analytics, external model calls, or account system. Conversation data remains in tab memory; only the language preference is stored locally.
- **Rule-based redaction:** recognized provider token formats, common credential assignments, authorization values, private keys, and email addresses are replaced with consistent aliases by default. Detection can miss secrets and can produce false positives. Review exports before sharing.
- **Custom literal redaction:** explicit values can cover private names and internal identifiers that built-in rules do not recognize. Only exact, case-sensitive matches are replaced; encoded, reformatted, or differently cased variants require separate rules.
- **Portable exports:** normalized JSONL is an interchange format, not a native Codex or Claude session file. ThreadPack does not repair native compaction or resume an agent directly. Handoff draft JSON stores notes and selection settings, not conversation data.
- **Lossy cleanup:** removed images no longer carry visual information; clipped output and omitted messages may contain relevant details. Keep the source export.
- **Normalized references:** exported message IDs are sequential references rather than provider IDs. Valid timestamps are normalized. Browser handoff notes use a separate `NOTE_` alias namespace when redacted.
- **Untrusted source material:** imported content is rendered as text, without executing HTML, commands, or embedded instructions. Exported transcripts remain historical material that must be reviewed before another system acts on them.

See [SECURITY.md](SECURITY.md) for reporting guidance and security boundaries.

## Architecture and development

The pure TypeScript engine in [`src/core/`](src/core/) provides parsing, cleanup, measurements, and exports. The React browser interface processes imports through a local Web Worker; the Node.js CLI bundles the same core. The source-level API is documented in [docs/API.md](docs/API.md).

```sh
npm test                 # Core and CLI integration tests
npm run check            # TypeScript checks
npm run build            # Offline HTML and CLI
npx playwright install chromium
npm run test:e2e         # Browser workflow, download, mobile, and offline checks
```

CI runs tests and builds on Linux and Windows, with browser tests on Linux. The **Deploy Pages** workflow publishes the static application automatically after changes reach `main` and GitHub Pages is configured to use GitHub Actions.

For parser reports, provide a minimal synthetic fixture, the source tool/version, and the expected result. Do not attach real conversation archives or credentials. Contribution requirements are in [CONTRIBUTING.md](CONTRIBUTING.md); selection evidence and scope decisions are in [docs/RESEARCH.md](docs/RESEARCH.md).

## License

[MIT](LICENSE). ThreadPack is an independent project and is not affiliated with or endorsed by OpenAI or Anthropic.
