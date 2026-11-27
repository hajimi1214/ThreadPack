# Trusted memory model

## Independent dimensions

Each memory fact keeps its category, author origin, lifecycle status, confirmation authenticity and lifecycle-event authenticity as separate fields.

- `category` identifies goals, decisions, user preferences, constraints, tasks, risks or open questions.
- `origin` identifies user-authored records and AI-extracted candidates. AI candidates remain `proposed`.
- `status` identifies review lifecycle state.
- `confirmationTrust` authenticates an explicit confirmation event against the locally trusted project event chain.
- `lifecycleTrust` authenticates the current terminal transition against the locally trusted project event chain.
- Evidence binding and evidence relation remain separate from both confirmation and lifecycle trust.

## Lifecycle states

Active states are `proposed`, `needs-review` and `confirmed`. Terminal history states are `rejected`, `superseded`, `expired` and `revoked`. The public status API does not transition a terminal fact back to an active state. A user may create a linked `needs-review` record with `reconsiders` to explicitly reopen consideration without rewriting history.

Replacement of an active fact records the old/new relationship with `supersedes` and `supersededBy`. User rejection prevents exact normalized duplicate claims from being silently recreated. The duplicate check applies across project sessions and does not claim semantic equivalence detection.

## Expiration

`expiresAt` is optional epoch-millisecond metadata. Expiration is materialized lazily by project memory reads, status operations, task listing, update-inbox import and backup export. Context and MCP projections also apply expiration immediately even before the stored terminal transition is materialized. Confirmed facts that expire preserve the original confirmation event and append a separate signed confirmation-revocation lifecycle event.

## Trust and backup behavior

Lifecycle events use the Stage 1 signed project event chain. The status-history entry stores the event ID, event hash and signer key ID. Lifecycle material binds the source project identity, fact revision/content, status, expiration, replacement and reconsideration links, plus evidence fingerprints.

Backups preserve lifecycle fields and event-chain entries. Restored facts start with unauthenticated lifecycle trust. After a matching local recovery key re-trusts the imported project, the lifecycle event is revalidated against the original source project ID and signed chain. Static MCP readers display terminal history as historical reference data and never promote backup-supplied status or keys to local trust.

Lifecycle history is bounded at 10,000 transitions per fact. New transitions are refused at the limit to preserve prior audit history.
