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
| English/Chinese | Switch both directions, reopen with preference | Chinese desktop |
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
