# ThreadPack v1

## SECTION 1: SPEC

**Purpose:** Turn an AI conversation export into a smaller, reviewable transcript and a portable context handoff.

**Users and use cases**
- As an AI coding user, I want to remove embedded image payloads and noisy tool output so that I can reuse useful text.
- As a developer, I want to inspect the cleaned text and redact common secrets before sharing it.
- As a user starting a new chat, I want to pin evidence and write the goal, decisions, constraints, and next steps.

**Requirements**
1. Import supported conversation exports or pasted text and select an individual conversation from an archive.
2. Display real text byte totals and explicit changes. [ASSUMPTION: normalized message content is the comparison unit, not the full original file.]
3. Independently toggle image removal, tool-output clipping, exact duplicate-tool removal, credential redaction, and email redaction.
4. Compare cleaned text with the original, search messages, and pin selected messages for handoff.
5. Download Markdown, normalized JSONL, a content-free report, and a handoff document.
6. Process locally, without an account or API key. [ASSUMPTION: a browser app and command-line program are the delivery formats.]
7. Offer English and Chinese interface text. [ASSUMPTION: English is the initial language.]
8. Never modify an imported file. Do not present deterministic excerpts as semantic summarization or native agent recovery.

**Edge cases:** An empty or invalid file produces an explanation. Partially valid JSONL produces warnings, never an unmarked success. Large text is paginated in the preview. Files over 100 MiB are rejected before reading. Unsupported structures are identified as text fallback. Secrets not recognized by rules may remain and require review.

**Acceptance criteria**
- Given a supported export, when imported, then the conversation title, roles, and readable messages appear.
- Given embedded image data and repeated tool output, when cleanup is enabled, then markers explain each removal and source messages remain unchanged.
- Given multiple archived conversations, when another conversation is selected, then preview and exported content change to the selection.
- Given pinned messages and notes, when a handoff is exported, then it includes the selected evidence and notes within its documented budget policy.
- Given the built single HTML file, when opened without a network connection, then import, cleanup, and download still function.
- Given a path to an existing output file, when the CLI runs without --force, then it refuses to overwrite it.

## SECTION 2: PLAN

**Stack and architecture:** [ASSUMPTION: TypeScript, React, Vite, an inline worker, and a shared pure core.] Static single-file build; a separately bundled Node CLI uses the same engine. No network-based parsing, analytics, remote fonts, or persistence of conversation text.

**Data model:** In-memory archives contain conversations with stable message IDs, roles, text, and optional timestamps. A clean result includes a new conversation, per-message change counts, aggregate byte statistics, and warnings. Only interface language is persisted.

**API contracts:** `parseInput(text, filename)`, `cleanConversation(conversation, options)`, `buildTranscript(conversation)`, `buildJsonl(conversation)`, and `buildHandoff(conversation, options)` are local functions. A worker accepts parse/clean operations with request IDs. No HTTP application API exists.

**Patterns:** Immutable transformations; React text escaping; bounded previews; cancellable worker generation by termination on a new import; no rendering imported HTML.

**Validation:** Engine unit tests cover actual input formats, malformed data, Unicode bytes, redaction, and crop behavior. CLI tests cover writing and overwrite safeguards. Browser tests exercise actual controls, imports, exports, offline opening, and mobile layout. Visual checks use thumbnail contact sheets.

**Security/performance:** No secrets in reports, diagnostic logging, or generated demo credentials. A 100 MiB import limit is applied before reads. Text is processed in a worker. [ASSUMPTION: this targets personal exports rather than unbounded datasets.] CSP blocks remote connections in production. Rules are heuristics and do not replace a dedicated secret scanner.

## SECTION 3: TASKS

### Task 1: Shared parsing and transformation engine
Build typed parsers, cleanup rules, exporters, and representative tests in `src/core` and `tests/core.test.ts`. Acceptance: supported fixtures parse, sources stay immutable, cleanup markers and counts match content. Dependencies: none.

### Task 2: Browser workbench
Build import, local demo, recipe controls, stats, comparison, search, pins, handoff notes, and downloads in `src`. Acceptance: actual browser interactions complete import-to-export and handoff workflows; mobile remains usable. Dependencies: core interfaces.

### Task 3: CLI and distribution
Bundle the shared core into a CLI and produce an offline HTML artifact. Acceptance: CLI exports real files, rejects accidental overwrites, and built HTML works offline. Dependencies: Task 1.

### Task 4: Open-source packaging and validation
Add bilingual documentation, a research rationale, MIT license, contributing/security guidance, CI, Pages deployment workflow, verified screenshots, and a release archive. Acceptance: documented commands pass and the deliverable contains runnable artifacts. Dependencies: Tasks 1–3.

**Review checkpoint:** Verify that removed data is visibly explained, exports are correct, and all positioning claims match actual implemented behavior.

## Assumptions to review
1. Browser and CLI delivery — HIGH; relevant if the product requires a native application.
2. Text payload byte comparison — MEDIUM; relevant when comparing original provider-specific serialization sizes.
3. Personal archives up to 100 MiB — MEDIUM; relevant for multi-gigabyte logs.
4. TypeScript/React/inline worker — LOW; no existing project stack was supplied.
5. English initial language with Chinese available — LOW.
