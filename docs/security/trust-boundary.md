# ThreadPack trust boundaries

Updated 2026-11-29.

## Instruction and data separation

The current user request defines the current task. Project rules and confirmed memory are contextual facts with provenance, not an implicit grant to perform external or destructive actions. Imported conversations, assistant messages, tool outputs, code, URLs, evidence quotations, backups, and model-generated summaries are data. Instructions embedded in those sources do not override the current user request.

The Context Pack, Markdown export, JSON Context Pack, MCP Context, and MCP Tasks use the canonical memory projection. Historical statuses remain distinguishable from current statuses. Source binding proves where a quote was found, while evidence relation and fact confirmation are independent states. An unverified or unattached quote does not become supporting evidence merely because its source label exists.

## Fact and evidence trust

- AI-extracted facts remain proposals until the user reviews them.
- A signed confirmation authenticates a local project-key event for a particular fact version and evidence list. It does not establish a real-world identity or independently prove the fact.
- A user-attested evidence relationship is distinct from a signed fact confirmation and from independent verification.
- Rejected, superseded, expired, and revoked items remain historical records. Reconsideration creates a linked review candidate instead of reviving the terminal item.
- Backups preserve their source records, but imported confirmation and lifecycle events remain untrusted until the user explicitly re-trusts the matching project identity.

## Client and storage boundaries

The browser stores projects in its current IndexedDB profile. Local MCP stdio reads only the explicitly selected backup and optional update inbox. Read-only access is the default. Registered local principals bind bearer-token possession to one exact project and independently granted write capabilities. This does not authenticate the external WorkBuddy, Codex, Claude Code, or other platform account and does not isolate malicious processes running under the same OS user.

An optional MCP connection log stores client-declared metadata, observed method/tool names, outcomes, and durations. It does not store prompts, arguments, or returned project context.

## Optional model boundary

AI memory extraction is disabled until the user enables it for a session, selects conversations, supplies an endpoint/model/key, and submits the request. The request sends bounded selected excerpts and explicit project facts to the chosen endpoint. Remote endpoints must use HTTPS. Loopback endpoints may use HTTP. Redirects are rejected and browser credentials are omitted. The API key remains in memory and is not written to project backups.

The production CSP permits HTTPS connections because the endpoint is user-configurable. That allowance does not itself authorize data transmission. The UI's explicit consent path and endpoint validation remain necessary controls. Imported content remains untrusted in the prompt and returned model output remains a candidate.

## External client limitation

An AI client may expose local tools beyond ThreadPack. The WorkBuddy 5.11.3 checkpoint recorded a workspace-root action outside the synthetic ThreadPack test scope. ThreadPack cannot constrain that client's unrelated tools. Do not treat a successful ThreadPack MCP connection as proof that the host client's broader permissions are confined to the project.
