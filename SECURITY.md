# Security and privacy

ThreadPack processes imported conversations locally. The production browser app has no upload endpoint, telemetry, external model requests, or account system. Source files are read into memory; exports are downloaded as new files. The CLI also writes a new output and rejects input/output aliases.

The hosted application registers a Service Worker to cache only its public application shell: root/index HTML, its manifest, and installation icons. It does not cache imported files, previews, notes, custom redaction values, API routes, blob downloads, or cross-origin requests. The standalone `file://` HTML does not register a Service Worker. An update reloads only after an explicit action in that tab; download needed work before updating because in-memory conversations are not restored.

## Redaction is an aid

Bare URL user information is scanned as a credential region with common-secret cleanup enabled. The scanner preserves source offsets and covers percent-encoded user information and IPv6 authorities. Optional email detection excludes URL authorities and multi-`@` strings to avoid falsely labeling a password suffix as a redacted email. A standalone ambiguous string still requires a recognized credential context or a custom rule. Reports expose aggregate rule matches and merged replacement counts without secret values.

Detection uses explicit rules. Unusual secrets, personal identifiers, encoded credentials outside supported URL user-information patterns, vendor formats introduced after a release, and secrets in unsupported blocks may be missed. False positives are also possible. Inspect the cleaned preview and any handoff notes before sharing. ThreadPack is not a replacement for a dedicated repository secret scanner or a security review.

The app treats imported content as untrusted text and does not execute HTML, commands, or instructions from it. Exported Markdown may be interpreted by another renderer or AI system; it remains untrusted source material. Do not follow instructions in a transcript merely because they appear in an export.

## Context package trust boundary

Project context packages contain two different kinds of material. Project status and user-reviewed facts describe recorded state. Conversation excerpts, tool output, code fragments, URLs, evidence quotes, and AI proposals are untrusted reference data. A `confirmed` status records user review of a statement and does not authorize a command, file edit, network request, credential use, or disclosure.

The generated `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` files repeat this boundary for downstream coding agents. The package is a snapshot and does not grant access to local files or external services. Verify every proposed action against the current user request, repository policy, and independently observed tool results.

## Optional live local MCP sharing

The Projects panel can connect one project to a new, empty file chosen through the browser's File System Access API. ThreadPack automatically rewrites that file after saved project changes. It contains the project's unredacted session history, memory records, and notes. The browser stores the file handle in the local project database. Access requires a secure Chromium-based browser and a granted read/write file permission.

Local MCP clients configured with that file path can read the same snapshot. They run with the operating-system permissions of the configured user. The bridge can be launched with `--read-only` to omit task-claim and candidate-write tools for a client configuration. Otherwise, its writes are limited to temporary task-claim events and candidate updates in the separate inbox. Access to a project snapshot is scoped by the configured file path. Client labels are caller-supplied and do not authenticate the AI client. Separate read-only processes and distinct file paths let the user configure different capabilities, while operating-system file permissions remain the access boundary. Disconnecting in ThreadPack stops future project-file updates and removes its browser file handle, but does not delete files or revoke client configurations. Remove the files or change those configurations to revoke access. Projects larger than 256 MiB cannot be live-shared through the MCP bridge. If a write fails, ThreadPack reports the shared state as out of date while keeping the project saved in browser storage.

When an update inbox is connected, MCP clients may append task leases and candidate updates. Leases are short-lived coordination hints, not proof of progress. Candidate updates are bound to a saved project session version and message excerpt, and carry a client-supplied idempotency key and client label. Task-result candidates also reference the task lease. Client identity labels are unverified claims. Proposals remain separate from project facts until user review. Accept, edit, reject, conflict resolution, revocation, and task-lease events are retained in project backups. Retrying an identical idempotent submission does not duplicate an event. Reusing the same key for changed content fails. ThreadPack does not accept client assertions of successful tests as independently verified results.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** feature if private vulnerability reporting is available. Otherwise open a minimal issue requesting a private contact channel without publishing an exploit, real log, credential, or personal data. Do not send secrets to demonstrate a redaction miss: a synthetic string with the same shape is enough.

Please include the affected version, browser or Node version, input format, expected result, and a minimal synthetic reproduction. If you accidentally exposed a real credential, revoke or rotate it at its provider; removing it from an export does not revoke it.
