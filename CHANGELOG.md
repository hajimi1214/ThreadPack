# Changelog

## 1.7.1 — URL credential redaction boundaries

- Redact credentials in bare database, Redis, and HTTP(S) URLs, including percent-encoded user information and IPv6 hosts.
- Prevent optional email detection from partially matching multi-`@` credential strings or URL authorities.
- Report custom-rule occurrences separately from custom replacements and total replacement spans.

## 1.7.0 — Markdown reading view

- Add optional GFM Markdown rendering for conversation messages and handoff previews.
- Keep raw HTML escaped, replace remote images with text labels, and preserve cleaned source text for copy and export.
- Integrate `react-markdown` and `remark-gfm` with offline license notices.

## 1.2.0 — 2026-11-19

- Open imported files in a compact workbench, keep export actions visible, and collapse mobile cleanup settings until needed.
- Increase contrast and readability of tool output, privacy reminders, and message controls.
- Read local files through Web Streams in a Web Worker, with progress and cancellation.
- Keep complete archives and cleanup results in the worker; return at most 30 bounded previews per query.
- Search complete original and packed text, reset scroll position on pagination, and build full exports in the worker using transferable ArrayBuffers.
- Add installable PWA support that caches only public application resources, plus explicit update controls that do not reload other tabs.
- Fix stale cleanup revisions and prevent failed handoff generation from leaving an old document available for download.

## 1.1.0 — 2026-11-19

- Add English, Simplified Chinese, Japanese, French, and Spanish interfaces with language detection and an accessible language menu.
- Refresh the interface with a blue and white palette, centered hero, floating illustration cards, and a grid workspace inspired by the supplied visual reference.
- Add custom literal redaction in the browser and CLI (`--redact-file`), including handoff notes; keep custom values out of reports and diagnostics.
- Preserve separate handoff drafts for each conversation while an archive remains open.
- Filter changed messages, show cleanup categories, and display search matches from the middle of long messages.
- Bind worker operations to explicit archive references so cancelled imports cannot change the file being cleaned.
- Reduce duplicate CI runs, group dependency updates, and keep release artifacts in version-specific directories.

## 1.0.0 — 2026-11-19

Initial stable release.

- Offline single-file browser workbench and Node.js CLI sharing a TypeScript processing core.
- Codex, Claude Code, ChatGPT, Claude, generic message JSON, Markdown, and text import.
- Reviewable removal of embedded image data, tool-output clipping, exact output deduplication, and local pattern-based redaction.
- Markdown, normalized JSONL, statistics reports, and handoff exports with user notes and pinned context.
- English and Simplified Chinese interfaces, responsive layout, and synthetic sample data.
- Core, CLI, browser, offline, file-protection, cancellation, and redaction regression tests.
