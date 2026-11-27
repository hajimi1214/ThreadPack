# ThreadPack acceptance matrix

This matrix is updated at each product stage. `PASS` denotes direct evidence for the named scope. `NOT VERIFIED` denotes missing platform or external-client evidence.

| Area | Stage 0 | Stage 1 | Stage 2 | Current limitation |
| --- | --- | --- | --- | --- |
| TypeScript check | PASS | PASS | PASS | Windows host only for Stage 2 |
| Node unit and MCP tests | PASS | PASS | PASS, 245 tests | Run serially to keep the Windows runtime within available memory |
| Production web and CLI build | PASS | PASS | PASS | Linux build NOT VERIFIED |
| Chromium E2E | PASS | PASS | PASS, 101 tests across serial groups | Browser file APIs are covered on Chromium |
| Firefox E2E | NOT VERIFIED at Stage 0 | PASS | CONDITIONAL, 98 grouped passes, 2 capability skips, plus 1 isolated large-persistence pass | Coordinated task file-handle feature is unavailable in Firefox |
| WebKit E2E | PASS with one capability skip | PASS | CONDITIONAL, 97 grouped passes, 2 capability skips, 1 grouped target-close failure; affected download, import-race and large-persistence cases passed in isolation | WebKit file-handle coordination and combined-suite stability remain limited |
| Trust lifecycle | NOT IN SCOPE | PASS | PASS in targeted Chromium, Firefox and WebKit tests | Real physical multi-device account transfer NOT VERIFIED |
| Expiration, rejection, supersession and reconsideration | NOT IN SCOPE | NOT IN SCOPE | PASS in targeted browser and unit tests | Semantic duplicate detection is exact-text normalization, not semantic equivalence |
| MCP lifecycle projection | NOT IN SCOPE | PASS | PASS for expired history and preference schema | Static backups deliberately cannot establish local identity trust |
| Linux | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Requires Linux CI or a Linux host |
| Real cross-AI client exchange | NOT VERIFIED | NOT IN SCOPE | NOT IN SCOPE | Planned for later stages with authorized clients |

The current Firefox and WebKit skips are tied to the tests that need local file-handle permission or Chromium Origin Private File System capabilities. Chromium runs those paths. Tests were not removed or weakened to obtain these results.
