# Ultimate Stage 5 collaboration report

## Result

**CONDITIONAL PASS for the verified local stdio workflow. The full ThreadPack development mission remains in progress.**

The candidate now defaults MCP instances to read-only and requires explicit, project-scoped local settings to enable candidate submission or task coordination. Existing user review, evidence binding, idempotency, task leases and shared-file refresh remain in the flow. No actual WorkBuddy, Codex or Claude model session was run in this stage.

## Baseline and scope

| Item | Verified value |
| --- | --- |
| Candidate branch | `release-candidate/third-round-stage5-baseline` |
| Parent commit before this stage | `74da06f11b3843ff301c0617c144662245a35361` |
| Remote candidate before this stage | `74da06f11b3843ff301c0617c144662245a35361` |
| `origin/main` | `77a197696480e8edebdc9bde7bca43443d3a759b` |
| Execution environment | Windows 11, Node.js 24.14.1, npm 11.11.0 |
| Test evidence | `docs/release/evidence/ultimate-stage5/` |

The worktree was on the candidate branch. The source changes were limited to the MCP CLI access policy, its tests, the affected browser integration fixtures and user/architecture/testing documentation. `main` was not checked out or modified. No push to `main`, release or deployment was performed.

## Implemented behavior

MCP context and task-list tools remain available by default. Candidate submission and task coordination have separate opt-in switches. Each writable process must also be configured with a syntactically valid `--client-id` and an exact `--project-id`. Every context, task, resource and write request validates the configured project ID against the selected backup project ID.

The MCP tool schemas no longer accept a client identity field. The server uses its local process configuration for audit and claim ownership, and rejects caller-supplied extra fields. A candidate cannot change project facts directly. It is appended to the separate inbox and remains subject to the existing user review flow. Retry keys and exact saved-message evidence requirements remain in place.

`--read-only` remains available as an explicit setting and cannot be combined with write permissions. Invalid permission combinations fail at startup. The updated CLI help and English and Chinese setup instructions explain the permission model and shared-file constraints.

## Identity and permission boundary

**VERIFIED** — The model cannot choose or override the configured client label through tool arguments. Read-only is the default. Candidate submission and task coordination can be enabled independently. Requests are restricted to the configured project ID, and tests verify that a mismatched project and spoofed client argument are rejected without writing to the inbox.

**NOT VERIFIED / limitation** — `--client-id` is an operator-configured, unauthenticated label. It is not proof of a WorkBuddy, Codex or other external application identity. Any process able to use the configured writable MCP instance inherits its permissions. The implementation does not provide a client registry, cryptographic client credentials or remote-user authentication. The current boundary is appropriate only for an operator-controlled local stdio setup with protected backup and inbox files.

## Functional verification

| Requirement | Result | Evidence |
| --- | --- | --- |
| Default tool list exposes read-only context and task tools | VERIFIED | `mcp-tests-final.log` |
| Candidate submission requires explicit permission | VERIFIED | `mcp-tests-final.log`, `e2e-permissions-targeted.log` |
| Task coordination is independently permissioned | VERIFIED | `mcp-tests-final.log` |
| Project mismatch is rejected on read and write paths | VERIFIED | `mcp-tests-final.log` |
| Model-supplied client identity is rejected | VERIFIED | `mcp-tests-final.log` |
| Candidate is not immediately promoted to project fact | VERIFIED | Existing MCP and browser review-flow tests |
| Retry-safe candidate submission and competing claims | VERIFIED | `mcp-tests-final.log` |
| Reviewed browser state is visible to later local MCP file reads | VERIFIED | `e2e-permissions-targeted.log` and Chromium full run |
| Actual external model calls and cross-platform client identity | NOT VERIFIED | No live AI client was invoked |
| Linux runtime | NOT VERIFIED | Linux environment unavailable in this run |

## Files reviewed and changed

| File | Change and impact | Verification |
| --- | --- | --- |
| `cli/mcp-server.ts` | Adds local access policy, project-scoped reads, opt-in write tools and server-configured client labels. Changes default MCP behavior to read-only. | MCP unit and browser integration tests |
| `cli/index.ts` | Documents the new MCP permission options and local trust boundary. | `cli-help.log`, type check, build |
| `tests/mcp.test.ts` | Covers default read-only, independent permissions, project scope, rejected identity spoofing, idempotency and claim ownership. Existing behavioral assertions remain. | 11 MCP tests passed |
| `tests/browser/project-coordination.spec.ts` | Runs the end-to-end coordination flow with explicit project-scoped options and waits for the confirmed memory record in the shared backup. | Chromium integration test passed |
| `tests/browser/project-shared-state.spec.ts` | Updates the MCP fixture to include explicit authorization and recomputes the v9 manifest after changing the fixture project name. It retains the restore-count and history assertions. | Chromium integration test passed |
| `README.md` | Documents default read-only behavior, explicit local grants and their limits. | Manual review and build |
| `README.zh-CN.md` | Adds the same permissions and scope explanation in Chinese. | Manual review and build |
| `docs/architecture/mcp-integration.md` | Records request-time project checking and the unauthenticated local-label boundary. | Manual review |
| `docs/architecture/system-architecture.md` | Documents the shared-file read path and instance-scoped permissions. | Manual review |
| `docs/testing/acceptance-matrix.md` | Adds Stage 5 behavior and evidence references. | Manual review |

The initial shared-state browser run correctly rejected a fixture whose project header changed without rebuilding its v9 manifest. The fixture was corrected to recompute the manifest using the production backup-format functions. The original restore-count and audit-history assertions remain. A separate initial TypeScript check also caught a missing `createHash` fixture import, which was fixed before the final full checks. The first WebKit run recorded six flaky cases that passed on retry. These initial outputs are retained alongside the final logs.

## Automated test evidence

All logs were produced on Windows 11. Raw logs and SHA-256 checksums are stored under `docs/release/evidence/ultimate-stage5/`. The checksum manifest hashes UTF-8 text after normalizing CRLF and CR line endings to LF so it remains verifiable across operating systems.

| Command or suite | Result | Log |
| --- | --- | --- |
| `npm test` | 253 passed, 0 failed | `unit-tests-final.log` |
| MCP-specific suite | 11 passed, 0 failed | `mcp-tests-final.log` |
| `npm run check` | Passed | `type-check-after-fixture.log` |
| `npm run build` | Passed, including web and CLI builds | `production-build-final.log` |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities reported | `dependency-audit.log` |
| Full Chromium E2E | 106 passed | `e2e-chromium-final.log` |
| Full Firefox E2E | 104 passed, 2 skipped for unsupported browser APIs | `e2e-firefox.log` |
| Full WebKit E2E | 98 passed, 2 skipped, 6 flaky cases passed on retry | `e2e-webkit.log` |
| Focused permissions and shared-state E2E | 2 passed without retry | `e2e-permissions-targeted.log` |

The browser skips are the suite's documented File System Access API and Chromium Origin Private File System limitations. Chromium exercised those paths. The WebKit retry observations remain a reliability risk and are not counted as a clean first-attempt run.

## Failure and recovery record

The initial fixture run failed because it produced an invalid v9 manifest after changing a backup project name. The fixture now recalculates the ordered record manifest and the targeted browser run passes. A separate synchronization assertion was strengthened to check for a confirmed `memory` record with the exact statement, rather than accepting any occurrence of the statement text. The final Chromium run and focused integration run pass. The original failure logs remain in the evidence directory.

No failed test was removed, skipped by configuration change or weakened to obtain these results. Browser skips are capability-based and are recorded in the raw logs.

## Remaining risks

| Severity | Status | Risk |
| --- | --- | --- |
| P1 | Open for broader deployments | Client labels are not authenticated identities. This implementation must not be used as a multi-user or remote authorization boundary. |
| P2 | Open | Linux runtime and filesystem behavior have not been exercised. |
| P2 | Open | Six WebKit cases were flaky before retry, even though the final suite completed successfully. |
| P2 | Open | Static backup files remain snapshots. Latest-state reads require the browser live shared-file connection on the same computer. |
| P2 | Open | No real WorkBuddy, Codex or Claude model call or cross-client handoff was tested. |

The P1 limitation is explicitly bounded to the local stdio configuration model and is not represented as authenticated client identity. It blocks claims of secure multi-user or remote client authorization. It does not block the verified operator-controlled local workflow. No P0 or P1 defect was found in the changed paths during this stage's tests.

## Next-stage entry

Stage 6 can build on the documented local permission boundary by adding client setup, health checks, capability diagnostics and clearer per-client configuration. It must preserve the read-only default and must not describe a configured label as external authentication. Actual platform support will require authorized real-client verification.

## Commit record

The implementation parent was `74da06f11b3843ff301c0617c144662245a35361`. The stage implementation and this report are committed on `release-candidate/third-round-stage5-baseline`; the resulting commit SHA is available in the candidate branch history.
