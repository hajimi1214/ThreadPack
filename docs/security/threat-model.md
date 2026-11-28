# ThreadPack threat model

Status: living Stage 7 checkpoint, updated 2026-11-29.

## Scope and assets

ThreadPack is an offline-first browser application with IndexedDB storage, user-selected imports and exports, an optional browser-to-AI request path, a local CLI, and a local stdio MCP server. The principal assets are original conversation exports, saved project histories, evidence and trust events, local signing keys, MCP client credentials, update inboxes, and optional AI endpoint credentials.

## Trust domains

| Domain | Trust treatment |
| --- | --- |
| Current user action in the ThreadPack UI | Authorizes only the action the user explicitly performs. |
| Imported messages, tool output, code, archives, and evidence quotations | Untrusted data. Text in these sources does not grant authority or become a current instruction. |
| AI-extracted memory | Candidate data until the user reviews it. A model output cannot create a signed confirmation event. |
| Local confirmed memory | A signed local event can authenticate that the project key recorded a user confirmation. It does not prove real-world identity or factual truth. |
| Imported signatures and lifecycle history | Validated for structural integrity, but remain untrusted until an explicit local recovery process re-trusts the source identity. |
| MCP client labels and initialize metadata | Untrusted unless bound to a local registered bearer credential. Local credential possession does not authenticate an external platform account or human. |
| MCP connection log | Metadata-only local diagnostics. Request arguments, conversation content, and tool results are excluded. |
| Optional AI endpoint | User-selected external recipient. Only selected conversation excerpts and the explicit project summary/current facts are sent after the user enables extraction and submits a request. |

## Threats and current controls

| Threat | Current controls | Remaining evidence |
| --- | --- | --- |
| Prompt injection in imported history or tool output | Context output labels historical material as untrusted; AI extraction prompts treat messages and tool output as quoted data; memory candidates require exact source citations and remain unconfirmed. | Real external clients can expose other tools outside ThreadPack. The WorkBuddy test in `ultimate-stage6-workbuddy-readonly-validation.md` surfaced an out-of-scope workspace-root action. |
| Project or client scope confusion | MCP instances use an explicit backup path. Registered principals bind to one exact project ID, and write grants are independent and revalidated per request. | Same-OS-user processes can read local configuration. Windows ACL enforcement and external account identity remain unverified. |
| Falsified or corrupted project backup | v9 ordered manifest, per-record validation, source/evidence binding, staged restore, and trust downgrade on import. | Arbitrary process termination, disk exhaustion, real-user backup corpus, and Linux migration remain unverified. |
| Archive path traversal and oversized input | ZIP entries are filtered, absolute/traversal paths rejected, entry count capped, compressed import capped, and estimated expansion capped. | Adversarial decompression peak memory and long-running large-archive behavior have not been measured. |
| Stored HTML or script injection in conversation text | React renders escaped text. Markdown preview omits raw HTML and remote images, and rejects unsafe link schemes. | Production CSP retains `unsafe-inline` for the single-file build. No successful XSS was found in the covered tests, but the policy does not provide a nonce/hash-based inline-script boundary. |
| Unintended AI endpoint disclosure | AI extraction is opt-in, sessions are selected explicitly, endpoint validation rejects URL credentials/query/fragment and non-HTTPS remote URLs, requests use `credentials: omit` and `redirect: error`, and the API key remains in memory. | User-selected HTTPS endpoints are not restricted to a vendor allowlist. The new CSP permits HTTPS so this documented feature works. A compromised app script could use that network allowance. |
| Local credential or connection-log leakage | MCP tokens are generated from cryptographic randomness, only hashes are stored, tokens stay out of command arguments and logs, registry scope is project-bound, and logs omit payloads. | Windows ACL inheritance is not verified or enforced by the CLI. The WorkBuddy UI test showed broader built-in workspace capabilities than the ThreadPack MCP server exposes. |
| Failure during review, replacement, or restore | Staged project restore and transaction-based trust updates preserve prior state on handled failures. Replacement keeps the old fact current while the new candidate is reviewed, then performs the signed supersession before confirming the replacement. | Forced process termination, disk-full behavior, and dual failure of candidate recovery transactions are not fault-injected. |

## Security checkpoint evidence

The production page's original `connect-src` allowed only same-origin traffic and the local Vite WebSocket, while the product accepts an explicit HTTPS AI endpoint. An intercepted browser test against `https://threadpack-ai.example.invalid` was blocked by CSP before the Playwright route handler ran. The policy now allows HTTPS destinations and loopback HTTP endpoints. The AI request remains gated by the user's explicit extraction action and endpoint validation. The same external-shaped endpoint is intercepted locally in Chromium, Firefox, and WebKit browser tests, so no request is sent to a real external service during validation.

`npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high` report zero known vulnerabilities for the audited dependency graph and production dependencies, respectively, on 2026-11-29.

Linux, performance baselines, multi-hour operation, memory growth under very large archives, browser-extension interference, Windows ACLs, forced-kill recovery, and real cross-AI write-back remain **NOT VERIFIED**. Stage 7 is in progress and this document does not imply full product security acceptance.
