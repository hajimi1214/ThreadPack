# ThreadPack acceptance matrix

This matrix is updated at each product stage. `PASS` denotes direct evidence for the named scope. `NOT VERIFIED` denotes missing platform or external-client evidence.

| Area | Stage 0 | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Current limitation |
| --- | --- | --- | --- | --- | --- | --- |
| TypeScript check | PASS | PASS | PASS | PASS | PASS | Windows host only |
| Node unit and MCP tests | PASS | PASS | PASS, 245 tests | PASS, 247 tests | PASS, 253 tests | Stage 4 candidate regression log in release evidence |
| Production web and CLI build | PASS | PASS | PASS | PASS | PASS | Linux build NOT VERIFIED |
| Chromium E2E | PASS | PASS | PASS, 101 tests across serial groups | PASS, 19/19 | CONDITIONAL, 21 passed and 1 flaky passed on retry | Candidate full-suite first failure and retry retained |
| Firefox E2E | NOT VERIFIED | PASS | CONDITIONAL, capability skips | PASS, 18 pass and 1 capability skip | CONDITIONAL, 19 pass, 1 capability skip, 1 flaky passed on retry | Coordinated task file-handle feature unavailable |
| WebKit E2E | PASS with one capability skip | PASS | CONDITIONAL, capability skips and grouped target-close failure | PASS, 18 pass and 1 capability skip | CONDITIONAL, 17 pass, 1 capability skip, 3 flaky passed on retry | Coordinated task file-handle feature unavailable |
| Trust lifecycle | NOT IN SCOPE | PASS | PASS in targeted tests | PASS in migration/restore coverage | PASS in projection regression | Physical multi-device account transfer NOT VERIFIED |
| Expiration, rejection, supersession and reconsideration | NOT IN SCOPE | NOT IN SCOPE | PASS | PASS in restore/round-trip | PASS across shared projections | Semantic duplicate detection is exact-text normalization |
| Canonical Browser/Markdown/JSON/MCP Context/Tasks projection | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | PASS | Agent handoff client exchange remains manual |
| Filtered incremental context and historical deltas | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | PASS | User must exchange a project-bound baseline file |
| Linux | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Requires Linux CI or host |
| Backup migration v1-v8 to v9 | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | PASS with generated fixtures | PASS regression | Real-world historic backup corpus NOT VERIFIED |
| v9 manifest tamper and staging rollback | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | PASS | PASS regression | Arbitrary process-kill timing and disk-full recovery NOT VERIFIED |
| Real cross-AI client exchange | NOT VERIFIED | NOT IN SCOPE | NOT IN SCOPE | NOT IN SCOPE | NOT VERIFIED | Planned for stage 9 with authorized clients |

Firefox and WebKit skips are tied to tests requiring local file-handle permission or Chromium Origin Private File System capabilities. Chromium runs those paths. Stage 4 browser runs used CI retry policy, and all flaky retries passed. The first-attempt failures remain recorded in the full logs and are classified as conditional results. Tests were not removed or weakened to obtain these results. Stage 4 detailed evidence is in `docs/release/ultimate-stage4-context-projection-report.md`.

After the Stage 4 export-boundary regression fixes, the context generation, incremental export, and empty-project pack flows each passed 3/3 in Chromium, Firefox, and WebKit. The complete Chromium project-memory suite passed 21 cases and had 1 additional case pass on retry. Detailed candidate logs are under `docs/release/evidence/ultimate-stage4/`.
