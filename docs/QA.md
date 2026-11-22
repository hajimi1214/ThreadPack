# QA inventory

## Stage 3 project library coverage

- The project library is optional and explicit. In-memory imports remain the default until a conversation is saved to a named project.
- IndexedDB persistence is covered for project metadata, current status and important notes, multiple isolated projects, session search across all saved revisions, stable-ID updates, content-fingerprint duplicate detection, immutable history restoration, and clear/delete behavior.
- Versioned session JSONL retains the phase-two provenance and structured session data. Worker tests confirm project snapshots are generated from original conversation data, before cleanup redactions.
- Backup export and restore cover multiple revisions, project records, source metadata, SHA-256 verification, ordered records, staging cleanup on failure, and restoration as a separate project.
- Project-specific coverage includes persistence across reloads, duplicate imports, all-version content search, historical revision restore, backup round trip, corruption rejection, project isolation and deletion, ChatGPT inactive-branch preservation, narrow-screen fit, and operation when IndexedDB is disabled.
- Final Chromium browser regression: 80 tests passed with one worker. All five project-library browser tests passed in Chromium and WebKit. Core and CLI tests: 181 passed. `npm run build` and `npm pack --dry-run` succeeded, and `npm audit --omit=dev` reported zero vulnerabilities.
- Firefox and Linux were not validated in this run. The installed Firefox binary could not launch on this Windows host because Windows reported a Side-by-Side configuration error before the tests started. No Linux runner was available locally.

## Stage 4 project memory coverage

- Project memory is persisted in IndexedDB schema version 2. The migration retains version 1 projects, sessions, revisions, and backups.
- Facts retain category, topic, task progress, user or AI origin, confirmation/review/rejection/supersedence state, conflict links, and evidence. Conversation citations are checked against an immutable session version, message ID, exact quote, and message fingerprint. Repository and test records are explicitly user-recorded and are not represented as independently verified.
- Context generation is deterministic, query-ranked, character-budgeted, and tested to include conflict counterparts, label stale evidence, and report whole-record omissions without truncating facts.
- Optional AI extraction is tested with a mocked Chat Completions endpoint. The request is explicit and bounded. The response must cite exact excerpts from selected evidence, suggestions stay unconfirmed, and API keys do not enter IndexedDB backups.
- Browser coverage includes project-memory creation and correction, conflict rejection, budgeted context, AI proposal confirmation and duplicate suppression, v2 memory-backup round-trip, version 1 backup restoration, and migration of real version 1 IndexedDB stores with retained revisions and evidence-linked memory writes.
- Portable context-pack tests inspect its ZIP entries, evidence metadata, status labels, and tool instruction files. The synthetic continuation benchmark checks expected-fact recall and precision across four task queries, evidence labels, and budget bounds. These fixtures do not claim measured real-world productivity or model accuracy.
- Final stage 4 checks: 186 core/CLI tests passed, 84 Chromium browser tests passed, and all 9 project-library/project-memory browser tests passed in WebKit. The v1 IndexedDB migration was repeated three times in WebKit. `npm run build`, `npm pack --dry-run`, and `npm audit --omit=dev` passed with no reported production dependency vulnerabilities.
- Firefox and Linux were not validated for this stage. The installed Firefox binary cannot launch on this Windows host because Windows reports a Side-by-Side configuration error. No Linux runner was available locally.

## Stage 5 cross-AI continuation coverage

- A portable context package exports a budgeted context snapshot, structured evidence/status JSON, and `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` entry instructions. The package is tested for source references, review-state retention, and absence of API keys.
- No provider account is connected and no undocumented API is used. The package must be imported through each product's supported file/project controls or placed in the project repository for coding agents. It does not auto-sync after export.
- The deterministic continuation benchmark contains four synthetic task queries and four labeled facts. Final benchmark precision and recall are both 1.0 for this fixture; it also checks evidence status and character budgets. This is a retrieval regression metric, not a real-world productivity study or a model-quality claim.
- Final stage 5 checks: 188 core/CLI tests passed, 84 Chromium browser tests passed, 9 project/library/memory browser tests passed in WebKit, production build and package dry-run passed, and the production dependency audit reported zero vulnerabilities.
- Firefox and Linux remain unverified because of the Windows Firefox Side-by-Side launch failure and the absence of a Linux runner.

The sign-off covers the supported local workflows, not semantic summarization or native session recovery.

| User claim / control | Functional check | Visual states |
| --- | --- | --- |
| Import and local demo | File chooser, pasted text, archive selection, invalid JSON | Empty, populated, error |
| Cleanup recipe | Toggle every rule on/off; compare bytes and changed content; reset | Default, original mode, clipped tool block |
| Review and handoff | Search/filter; pin/unpin; edit each note; recent/budget selection | Search empty, pinned, handoff preview |
| Exports | Read real Markdown, JSONL, report, handoff downloads | Format dialog and handoff |
| Offline processing | Open production HTML via file URL with network disabled | Local file in desktop browser |
| Privacy | No external requests; no persistent transcript storage unless explicitly saved to a project; clear workspace | Privacy notice and cleared workspace |
| Five interface languages | Select English, Chinese, Japanese, French, and Spanish; detect region preferences; reload saved preference | Desktop and mobile language states |
| Responsive layout | Desktop 1440px and mobile 390px; assert horizontal fit | Contact sheet of actual browser captures |
| Accessibility basics | Dialog escape/focus return; keyboard navigation | Focus state and dialog |

Exploratory scenarios: switch conversations after pinning; change recipes while processing; import malformed input while another conversation is open; show original after cleanup; code containing HTML and role-like strings; clear after handoff notes.

Preview limits: 30 messages per page; long preview text shortened without changing export; original base64 hidden from display. Large archives are limited to 100 MiB and parsed in an inline worker. Handoff preserves pinned evidence and notes even when they exceed the chosen budget, with an explicit warning.

## Verified release: 1.0.0

Date: 2026-11-19. Local validation used Windows and the installed Google Chrome through Playwright; the included CI workflow also targets Ubuntu and Windows, but remote CI has not been run before publication.

- `npm test`: 44 passing core and CLI tests.
- `npm run test:e2e`: 8 passing browser tests, including delayed-file-read cancellation, last-selection ordering, content-free reports, and offline `file://` import/download.
- `npm run build`: TypeScript check, single-file production web build, and CLI bundle succeeded.
- `npm audit`: no reported vulnerabilities in the locked dependency tree at validation time.
- Real downloads were read and checked for content and format. The synthetic demo decreased from 231.3 KiB to 5.4 KiB of message text with default settings; this is a fixture-specific result.
- Desktop, Chinese, handoff, format dialog, 390px mobile top and transcript views were captured and reviewed in thumbnail contact sheets. No observed horizontal overflow, overlapping controls, or unreadable primary content remained.
- Manual exploration covered pinning, note edits, comparison mode, language changes, downloading, and navigation between the workbench and handoff. Browser tests additionally cover the complete settings cycles and keyboard dialog behavior.

Screenshots: `docs/assets/demo.png` and `docs/assets/demo.zh-CN.png`. No real user conversation was used in validation.

## Version 1.1.0 coverage

Added coverage for literal custom redaction, content-free rule reports, invalid rules, rule-file protection, per-conversation drafts, cancelled candidate archives, changed-message filtering, and search hits beyond the first 12,000 characters.

Every supported language has a complete nonblank dictionary, and language selection tests cover browser detection, stored preferences, mobile layout, actual cleanup controls, and dialog focus. Only the language preference is stored; conversations, custom values, and drafts remain in memory.

The visual reference supplied for this iteration was a saved local VelaMost HTML page. It was rendered with scripts disabled and remote requests blocked. The adaptation uses ThreadPack's own code and identity: blue and white surfaces, centered typography, floating illustration cards, a rounded header, and a grid workspace. Reference scripts and third-party page assets are not distributed with ThreadPack.

Release validation: 66 core/CLI/localization/preview tests and 22 browser tests passed. The browser suite covers all five languages at 390px, real downloads, offline single-file operation, cancelled imports, and preserved drafts. The production web and CLI builds succeeded; the locked dependency audit reported no vulnerabilities. Visual review covered the empty landing page, populated workbench, mobile workspace, handoff, custom rules, and a settled export dialog. No observed horizontal overflow or overlapping controls remained in the reviewed states.

## Version 1.2.0 coverage

- 86 core, CLI, Worker RPC, Web Streams, preview, localization, and Service Worker tests passed.
- 31 browser tests passed with two workers, matching CI concurrency. They cover compact desktop/mobile layout, full original search, 30-message transport, complete export across pages, stream progress and cancellation, scroll resets, offline PWA reload, and the standalone HTML.
- Rapid recipe changes were repeated to verify that stale revisions cannot overwrite the current UI. A simulated handoff failure verifies that old notes are cleared and copy/download remain disabled until a new result succeeds.
- The production web and CLI build and the locked dependency audit passed.
- Visual checks covered the desktop workspace, collapsed and expanded mobile settings, and the handoff. Tool text, privacy reminders, pin controls, and changed-message filters use stronger contrast.

## Follow-up verification: message review tools

The follow-up iteration adds a worker-side pinned-message filter, an explicit full-message copy action for the active original or packed view, distinct ordinal filenames for multi-conversation exports, and independent reading positions for each conversation and filter view.

- `npm test`: 96 core, CLI, localization, preview, and Worker tests passed.
- `npm run test:e2e -- --workers=2`: 41 browser tests passed in installed Chrome, including pinned-filter composition, copying a message longer than the display preview, per-conversation scroll restoration, production Service Worker installation, offline operation, and standalone HTML exports.
- `npm run check` and `npm run build`: passed.
- `npm audit --omit=dev`: no production dependency vulnerabilities reported.
- No real conversation archive was used; all new copy and scroll fixtures are synthetic.

## Follow-up verification: cleanup recipes and message comparison

The current iteration adds one-click Balanced, Share safely, and Keep text recipes, plus a per-message before/after review that uses bounded Worker excerpts and keeps imported markup as text.

- `npm test`: 101 core, CLI, localization, preview, Worker, and cleanup-recipe tests passed.
- `npm run test:e2e -- --workers=2`: 44 browser tests passed in installed Chrome, including custom-rule preservation, safe text rendering, long-message excerpt notices, mobile dialog width, a single note-protection dialog after replacing files from comparison, offline installation, and standalone HTML exports.
- `npm run check` and `npm run build`: passed.
- All recipe labels, explanations, and comparison warnings are present in English, Simplified Chinese, Japanese, French, and Spanish.
- The landing page shows a synthetic before/after example and opens the matching demo. The existing five-language tests exercise this entry point on mobile. Thumbnail contact-sheet reviews covered the landing page, desktop workbench, desktop comparison, mobile cleanup sheet, and mobile comparison.

Measured layout and RPC comparisons are recorded in [ARCHITECTURE.md](ARCHITECTURE.md). README screenshots use a 1440 × 900 viewport so they show the same persistent export controls a desktop user sees.

## Follow-up verification: feedback, filtered exports, and screen adaptation

- `npm test`: 106 tests passed, including full filtered exports, combinations of filters, cleaned exports from Original-mode searches, and stale/invalid export requests.
- The full browser suite passed 58 tests. New checks cover pending/success/error copy states, duplicate-click prevention, export progress, stale export completion after file replacement, copy feedback across conversations, command-menu focus, and filter reset.
- Screen tests cover 320 × 568, 600 × 740, 768 × 1024, 844 × 390, 1024 × 600, 1920 × 1080, and 2560 × 1440. They assert readable transcript height, reachable exports, header fit, and preserved filters/pins across orientation changes. Final CSS adjustments were rechecked with the eight screen tests.
- Production web/CLI builds and TypeScript checks passed. All five languages use shorter task-oriented copy and include new action labels.
- Thumbnail contact sheets were reviewed for copy feedback, command menus, excerpt dialogs, portrait phones, tablets, landscape windows, and wide desktop layouts. Short screens use document scrolling with actions in normal flow; the narrow cleanup sidebar keeps one setting per row.

## Version 1.3.0: code extraction and discovery

- `npm test`: 118 tests passed, including fenced-code parsing, safe language/file-name handling, complete cleaned snippet copy/export, bounded previews, metadata, and link-preview image dimensions.
- The browser suite passed 62 tests. New scenarios cover long code beyond the preview, redaction in code, snippet paging, imported HTML as text, the built-in code sample, project-only sharing, and the JavaScript-free import guide. The final pagination focus adjustment was checked with the focused snippet suite.
- Code, sharing, and import-guide labels are provided in all five supported interface languages.
- Project metadata uses the canonical public URL; sharing does not serialize conversation state or page parameters. Search-engine indexing and audience growth depend on external discovery and are not measured by these checks.
- Production web/CLI builds passed, and `npm audit --omit=dev` reported no production dependency vulnerabilities. Visual review used thumbnail contact sheets for the landing page, desktop/mobile code dialogs, import guide, and 1200 × 630 sharing card.

## Version 1.4.0: offline code highlighting and ZIP archives

- `npm test`: 123 tests cover fenced-code extraction, bounded syntax highlighting, exact text reconstruction, safe plain-text fallback, Worker ZIP contents, safe filenames, and third-party license notices.
- `npm run test:e2e -- --workers=2`: 64 browser tests cover language and text filters, full cleaned code downloads, cross-page ZIPs, malicious-looking code as text, the built-in sample, Help license notices, PWA offline behavior, sharing, the JavaScript-free import guide, and prior workflows.
- `npm run build`, the production dependency audit, npm package dry-run, and TypeScript checks passed. GitHub Windows/Linux CI passed.
- The offline HTML is 582,090 bytes (174,848 gzip bytes with maximum compression), compared with 460,245 bytes (135,168 gzip bytes) in 1.3.0. The selected syntax grammars and runtime notices are bundled locally; runtime grammar requests are not made.
- Visual review covered highlighted code and empty search on desktop and mobile, the license disclosure, import guide, and updated share card.

## Version 1.5.0: portable context bundles

- `npm test`: 125 tests passed, including cleaned bundle contents, safe code paths, optional handoff omission, custom-value exclusion, and stale revision rejection.
- `npm run test:e2e -- --workers=2`: 65 browser tests passed, including the main export dialog bundle download, ZIP inspection, five interface languages, mobile layouts, offline behavior, and existing exports.
- `npm run build`, `npm audit --omit=dev`, and `npm pack --dry-run` passed. The single-file HTML is 587,000 bytes (176,105 gzip bytes with maximum compression).
- Portable bundles contain cleaned Markdown, normalized JSONL, aggregate cleanup metadata, a manifest, and cleaned code files. `handoff.md` is included only when handoff notes are nonblank; original-view text and custom redaction values are excluded.

## Version 1.6.0: ZIP imports and global compatibility

- `npm test`: 128 tests passed, including direct ZIP selection, unsafe path rejection, expanded-size limits, and `arrayBuffer()` file fallback.
- `npm run test:e2e -- --workers=2`: 66 browser tests cover direct ZIP import, five interface languages, mobile layouts, offline behavior, and existing workflows.
- The PWA manifest includes desktop display fallbacks, categories, and shortcuts. Media-query listeners support both modern and legacy browser APIs.
- Production web and CLI builds, package dry-run, browser checks, and production dependency audit pass.

## Version 1.7.0: Markdown reading view

- `npm test`: 130 tests cover GFM rendering, escaped raw HTML, omitted remote images, safe link schemes, and runtime license notices.
- `npm run test:e2e -- --workers=2`: 68 browser tests cover Text/Markdown switching in messages and handoff previews, source-preserving copy, ZIP import, offline mode, five languages, and responsive layouts.
- `npm run build`, `npm audit --omit=dev`, and `npm pack --dry-run` pass. The single-file HTML is 783,342 bytes (233,531 gzip bytes at maximum compression).
- Markdown reading changes presentation only. Imported HTML remains escaped, external images are replaced by text, and copied or exported messages retain their cleaned source.

## Version 1.7.1: URL credential redaction

- `npm test`: 141 tests cover URL user information, percent encoding, IPv6 authorities, email boundaries, overlap counters, and secret-free exports.
- `npm run test:e2e -- --workers=2`: 69 browser tests cover URL credential cleanup in the workbench, reports, and handoff output, along with the full existing workflow suite.
- `npm run check`, `npm run build`, and `npm audit --omit=dev` pass.

## Stage 1 stability and engineering validation

Validation date: 2026-11-22. The repository currently remains at version 1.7.1; this verification does not publish a release.

- `npm test`: 169 core, CLI, localization, preview, parser, and Worker tests passed with Node.js 20.19.0 on Windows.
- `npm run check`, `npm run build`, and `npm pack --dry-run` passed. The production dependency audit reported no vulnerabilities.
- `npm run test:e2e -- --workers=1`: all 74 tests passed in Windows Chrome/Chromium and WebKit, and all 74 passed in Linux Firefox running under Ubuntu WSL. The suite covers offline imports, Worker cancellation, export integrity, code extraction, note protection, keyboard focus, mobile widths, and screen orientation.
- JSONL parsing now consumes decoded lines and parsed records incrementally rather than holding both full intermediate arrays. Browser and CLI callers pass known UTF-8 source byte lengths to avoid another full-input encoding allocation. Stream chunk references are released once decoding completes.
- Dialog focus returns to the control that opened it across pointer and keyboard interaction. Mobile cleanup actions return focus to the transcript, quick actions are available on the first paint, short-window archive changes preserve reading positions, and 320px Firefox/Chromium layouts fit the header.
- Large JSON parsing still retains the decoded input and normalized conversation model. The 100 MiB limit remains, so memory use still scales with archive size. No remote GitHub Actions run was part of this local validation.

## Stage 2 session structure validation

- Validation date: 2026-11-23. Package version remains 1.7.1; no release tag was created.
- `npm test`: 180 core, CLI, localization, preview, parser, and Worker tests passed on Windows Node.js 20.19.0 and Node.js 24.14.1.
- `npm run check`, `npm run build`, `npm audit`, and `npm pack --dry-run` passed. The dependency audit reported zero vulnerabilities.
- The complete 75-test browser suite passed on Windows Chrome/Chromium, Linux Firefox, and Linux WebKit. It covers content-free import integrity, ChatGPT branch exports, offline processing, Worker cancellation, handoff drafts, responsive layouts, and keyboard focus.
- Synthetic fixtures cover Codex reasoning and tool events, Claude Code tool-use/result pairing, Claude parent links and timestamps, OpenAI-compatible JSON/JSONL calls, ChatGPT branch history including nodes without message bodies, malformed mapping nodes, unknown archive/JSONL records, structural integrity checks, and versioned JSONL round-trips.
- Provider coverage uses synthetic fixtures rather than redacted production archives. Provider formats continue to evolve. Parsing retains decoded input and the normalized session model in memory under the existing 100 MiB limit. Integrity checks cover structural links but do not calculate cryptographic source checksums. No remote GitHub Actions run was part of this local validation.
