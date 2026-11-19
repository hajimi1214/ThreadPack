# Changelog

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
