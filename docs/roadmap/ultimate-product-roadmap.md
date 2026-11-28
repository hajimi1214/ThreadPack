# ThreadPack ultimate product roadmap

This roadmap tracks the ten-stage product mission in `docs/release/ultimate-stage0-baseline.md` and the referenced project brief. Status is based on committed implementation and current evidence, not plans alone.

| Stage | Scope | Status | Candidate evidence |
| --- | --- | --- | --- |
| 0 | Source preservation and reproducible baseline | PASS | `docs/release/ultimate-stage0-baseline.md` |
| 1 | User confirmation events and local trust authentication | PASS | `docs/release/ultimate-stage1-trust-authentication.md` |
| 2 | Trusted memory lifecycle and terminal-history governance | CONDITIONAL PASS | `docs/release/ultimate-stage2-memory-lifecycle-report.md` |
| 3 | Complete backup, restoration and historical migration | CONDITIONAL PASS | Source `e534644a0e2d148456f4595ac80b0fc525b1dee5`; `docs/release/ultimate-stage3-backup-migration-report.md`; v1-v8 and v9 migration/recovery tests pass on Windows browsers. Linux and crash-resume continuation remain unverified. |
| 4 | Unified project memory and context projection | CONDITIONAL PASS | `docs/release/ultimate-stage4-context-projection-report.md`; Windows candidate check, 253 unit/MCP tests, production build, Chromium full memory suite with one retry, and focused export/delta flows on Chromium/Firefox/WebKit. Linux and real client exchange not verified. |
| 5 | Multi-AI bidirectional collaboration engine | CONDITIONAL PASS | `docs/release/ultimate-stage5-collaboration-report.md`; local stdio permissions and same-machine shared-file workflow verified. Client labels are not authenticated identities. |
| 6 | Multi-project management and client ecosystem | IN PROGRESS, NOT VERIFIED COMPLETE | `docs/release/phase-reports/ultimate-stage6-client-ecosystem.md`; WorkBuddy 5.11.3 performed a real read-only MCP query with 2/2 tools discovered and three successful ThreadPack calls. The same interaction surfaced an out-of-scope WorkBuddy workspace-root action, so further client calls are paused. Write-back, review, cross-project isolation, Codex/Claude Code and malicious-history validation remain open. |
| 7 | Security, reliability and performance | NOT STARTED | Long-run and adversarial verification remains open. |
| 8 | Complete product experience | NOT STARTED | Setup, migration and support workflows remain open. |
| 9 | Real cross-AI acceptance and delivery | NOT STARTED | Authorized real-client acceptance remains open. |

Stage 2 adds explicit rejected, superseded, expired and revoked fact states, signed lifecycle events when the local trust identity is available, exact duplicate rejection, user-linked reconsideration, optional expiration, terminal-history projections and a first-class user-preference category. Static backup import remains untrusted until locally re-trusted.

The 2026-11-29 lifecycle hardening follow-up stages a replacement as a review candidate, commits the prior confirmation revocation and reciprocal supersession links together, then signs the replacement confirmation. The regression is verified on Chromium, with the changed replacement flow also passing on Firefox and WebKit. See `docs/release/phase-reports/ultimate-stage2-lifecycle-hardening.md`. Stage 2 remains conditional pending Linux, browser capability and failure-injection evidence.

Stage 4 routes Browser memory views, Markdown and JSON Context Pack generation, MCP project Context and Tasks through one canonical in-memory projection. It adds project-bound comparison baselines and filtered incremental context. Baselines are client-supplied comparison inputs and do not provide authentication or automatic cross-process synchronization.

Stages 2–4 remain conditional on Linux verification, with the specific limitations recorded in each stage report. Stage 3 preserves the v7 IndexedDB schema, imports v1-v8 into untrusted v9 project copies, and validates v9 exports with an ordered manifest. Its remaining true continuation-after-crash limits are listed in the Stage 3 report. Real cross-AI exchange has not yet been verified.

Stage 5 defaults MCP instances to read-only and separates candidate submission from task coordination. Writable instances require a configured client label and exact project ID, and the model cannot override the configured label through tool arguments. The label is not authenticated client identity. WorkBuddy/Codex/Claude model calls and Linux deployment remain unverified. The Stage 6 checkpoint adds project archive/restore, a client-config snippet generator and read-only local `mcp --check` diagnostics. Stage 6 remains open for authenticated client identity, client-specific configuration validation, capability detection, connection observability and authorized external-client validation.
