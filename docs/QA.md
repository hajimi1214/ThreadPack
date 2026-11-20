# QA inventory

The sign-off covers the supported local workflows, not semantic summarization or native session recovery.

| User claim / control | Functional check | Visual states |
| --- | --- | --- |
| Import and local demo | File chooser, pasted text, archive selection, invalid JSON | Empty, populated, error |
| Cleanup recipe | Toggle every rule on/off; compare bytes and changed content; reset | Default, original mode, clipped tool block |
| Review and handoff | Search/filter; pin/unpin; edit each note; recent/budget selection | Search empty, pinned, handoff preview |
| Exports | Read real Markdown, JSONL, report, handoff downloads | Format dialog and handoff |
| Offline processing | Open production HTML via file URL with network disabled | Local file in desktop browser |
| Privacy | No external requests; no transcript storage; clear workspace | Privacy notice and cleared workspace |
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

Measured layout and RPC comparisons are recorded in [ARCHITECTURE.md](ARCHITECTURE.md). README screenshots use a 1440 × 900 viewport so they show the same persistent export controls a desktop user sees.
