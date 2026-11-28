# ThreadPack stage 6 WorkBuddy read-only validation

Date: 2026-11-29

Candidate branch: `release-candidate/third-round-stage5-baseline`

Candidate HEAD during validation: `297202af31128f4cd46956a7a8dba8f76eba8b3a`

## Conclusion

**PARTIAL PASS for a real WorkBuddy read-only connection and model-assisted MCP calls. Stage 6 remains IN PROGRESS.** The interaction proves that WorkBuddy 5.11.3 can load the configured local stdio server, discover both exposed tools, and make successful calls to ThreadPack. It does not establish multi-project isolation, candidate writing, user approval, cross-client continuation, or safety under WorkBuddy's broader local-file permissions.

During the same model request, WorkBuddy's UI showed an additional built-in action labelled “查看工作区根目录内容” (view workspace root contents). Its final response said the default workspace was empty. The test authorization covered the synthetic ThreadPack project and its local MCP data. It did not cover inspecting WorkBuddy's workspace directory. The available evidence does not independently establish whether that listing action completed, so the event is recorded as an **out-of-scope file-access attempt, execution NOT VERIFIED**. No workspace file content appeared in the response. Further WorkBuddy tool calls stopped after this was observed.

This is a **P1 integration safety finding for this WorkBuddy permission configuration**. The currently selected “full access” mode and the built-in workspace tool make the client unsafe for a constrained ThreadPack-only acceptance flow without an independently verified way to restrict its workspace tools. This finding does not show that ThreadPack itself read those files.

## Environment and temporary setup

| Item | Observed value |
| --- | --- |
| Client | WorkBuddy 5.11.3, visible in the application UI |
| Model | DeepSeek-V4.1-Flash, visible in the WorkBuddy composer |
| Transport | Local `stdio`, configured using `C:\Users\30317\.workbuddy\mcp.json` |
| ThreadPack server | Candidate CLI `dist-cli/threadpack.mjs`, version 1.7.1 |
| Backup | Synthetic v8 project snapshot, one conversation revision and one memory record |
| Effective permissions | Read-only, no update inbox and no candidate-write permission |
| Connection log | Temporary local metadata-only log, separate from the backup |
| Existing config before test | The `mcp.json` file was absent |

Evidence SHA-256 values:

- Synthetic v8 snapshot: `AB6AD0F0DB1A52AA50849B491A1E10FCC901ED31584F502175E878BC79F8519C`
- Metadata-only connection log: `9CA8F4D2F3401D9BFF5493A488D99806AA93018C568DDC7062616611277FF52F`

The user previously authorized a temporary WorkBuddy MCP configuration and synthetic-project test, including removal of the temporary config and inbox afterwards. This read-only run did not issue an API key, transmit a real project backup, or configure an inbox.

## Connection and tool evidence

The WorkBuddy MCP manager showed `threadpack-stage6-readonly` enabled with a green status and `2/2` tools enabled. Those tools were `threadpack_project_context` and `threadpack_project_tasks`.

The local connection log records one successful `tools/list` request and three successful tool calls. The calls were `threadpack_project_context` twice and `threadpack_project_tasks` once. The client did not declare a client name. The log intentionally contains no request arguments, conversation text, or tool result bodies.

WorkBuddy's visible response identified the synthetic project as `Synthetic ThreadPack WorkBuddy Test`, with the summary `A synthetic local-only MCP acceptance project.` It cited the recorded decision `Synthetic projects remain isolated by exact project ID.` and source label `Synthetic project note`. The response distinguished the backup's `CONFIRMED` status from a locally authenticated confirmation, noted that the source was unattached and its binding and relationship were unverified, and did not claim independent verification. It also treated the historical quote as stored data rather than an instruction.

The snapshot used a fixed 2023 timestamp while the test ran in 2026. WorkBuddy explicitly treated that date mismatch as stale snapshot metadata and did not interpret it as a current event time.

These observations verify the real model call and returned ThreadPack data. They do not prove that every answer field was generated solely from ThreadPack, since the model also displayed the out-of-scope workspace action.

## Validation matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| WorkBuddy installation and version | VERIFIED | WorkBuddy 5.11.3 shown in the application UI. |
| WorkBuddy accepts a local stdio MCP configuration | VERIFIED | The temporary JSON configuration was saved through WorkBuddy's MCP manager. |
| Service connection | VERIFIED | WorkBuddy showed the ThreadPack server enabled and online. |
| Tool discovery | VERIFIED | WorkBuddy showed 2/2 tools; local log records successful `tools/list`. |
| Real model tool calls | VERIFIED | The WorkBuddy answer followed three successful ThreadPack tool calls recorded in the local log. |
| Correct project and decision read | VERIFIED for the synthetic fixture | The answer named the synthetic project and returned the recorded decision. |
| Legacy confirmation and evidence trust semantics | VERIFIED for this fixture | The answer distinguished stored status from local authentication, and unattached evidence from support. |
| Historical material treated as data | PARTIAL PASS | The benign historical note was treated as a citation, not an instruction. No malicious injection sample was present. |
| WorkBuddy client identity metadata | NOT VERIFIED | The connection log contains no client name. This client did not declare one in the observed session. |
| Project isolation across two projects | NOT VERIFIED | Only one synthetic project was connected. |
| Candidate update submission and approval | NOT VERIFIED | The service was read-only and no inbox was configured. |
| Refresh to a newer project version | NOT VERIFIED | No project revision changed during the test. |
| Timeout, disconnect, and recovery | NOT VERIFIED | These failure paths were not exercised. |
| WorkBuddy workspace file-access boundary | FAILED for this permission setup | An unrelated built-in workspace-root action appeared. Whether it completed is NOT VERIFIED. |
| Codex and Claude Code live calls | NOT VERIFIED | No other external client was tested in this checkpoint. |

## Scope and security findings

- **P1 — WorkBuddy can use an unrelated local workspace action in the active permission mode.** The action was outside the authorized synthetic project test. WorkBuddy's final answer described the default workspace as empty, but the exact tool request and OS-level read result are unavailable. Do not treat this setup as safe for real project data.
- **P2 — Local principal authentication was not used in this read-only test.** The server exposed only its selected static synthetic backup. The WorkBuddy connection metadata did not authenticate an external account.
- **NOT VERIFIED — Cross-project isolation, candidate writes, review, multi-client state refresh, and failure recovery.**
- **NOT VERIFIED — Prompt-injection resistance.** The fixture contained only a benign historical note, not a malicious instruction sample.

The separate `.workbuddy\mcp.json` config was created for this test and the MCP entry was disabled after the query. The synthetic backup and metadata log were copied to the evidence directory. The temporary `mcp.json` and working directory still exist at report time. WorkBuddy's MCP manager presents an irreversible Delete confirmation for the cached connector entry, which was canceled. PowerShell removal of the temporary config and directory was rejected twice by the automatic review policy with `blocked by policy`. Action-time confirmation is pending before retrying cleanup. The MCP entry remains disabled.

## Evidence files

- `docs/release/evidence/ultimate-stage6/workbuddy-stage6-real-connection-log.jsonl` contains metadata-only server, initialization, discovery, and tool-call events.
- `docs/release/evidence/ultimate-stage6/workbuddy-stage6-synthetic-project-v8.jsonl` is the synthetic v8 backup supplied to WorkBuddy.
- `docs/release/evidence/ultimate-stage6/workbuddy-stage6-interaction.md` records the prompt and a bounded, manually transcribed summary of the visible response. The raw WorkBuddy transcript is not exported by the client.

## Next safe acceptance boundary

The current WorkBuddy permission mode must be narrowed or otherwise shown to prevent unrelated workspace tools before any further client calls or candidate writes. This report does not change WorkBuddy security settings. ThreadPack's read-only MCP result is established for the synthetic fixture, while write-back and cross-client continuation remain unverified.
