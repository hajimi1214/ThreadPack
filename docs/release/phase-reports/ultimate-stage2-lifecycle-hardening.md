# ThreadPack stage 2 lifecycle hardening addendum

Date: 2026-11-29

Candidate branch: `release-candidate/third-round-stage5-baseline`

Baseline before this follow-up: `cc5e75a326eb9c87927ab4dc4ff58f38228f418e`

Source commits: `d19a1d504a31a1c893a90c34124df63e8e4f0a55`, `92600d913b62d1c8f0926ef13e6a138f9f785ea3`

## Conclusion

The lifecycle hardening changes and their affected flows are **VERIFIED** on the listed Windows test environment. The broader stage 2 acceptance remains **CONDITIONAL PASS** because Linux has not been exercised and Firefox/WebKit each skip one isolated-device test that depends on browser-specific local file capabilities. This addendum does not claim the whole ThreadPack roadmap is complete.

The replacement flow now leaves the existing authenticated fact current while creating a replacement as a review candidate. A signed transaction then revokes the prior confirmation, records the terminal supersession, and links both facts. Only after that transaction succeeds does ThreadPack confirm the replacement through its own signed confirmation event. An interruption before supersession leaves the prior fact current and the candidate in review. An interruption after supersession leaves the old fact historical and the replacement in review, ready for explicit confirmation. The two current confirmed facts state is avoided by this ordering.

## Changes

| File | Change |
| --- | --- |
| `src/projects/store.ts` | Restricts supersession to an authenticated, conflict-free existing fact on the same category and normalized topic. Stages a confirmed replacement request as `needs-review`, commits the prior fact revocation and both relationship links together, then explicitly confirms the replacement. Restricts AI duplicate merging to other AI proposals. Preserves the original and recovery errors if candidate-review recovery also fails. |
| `src/projects/ProjectMemoryPanel.tsx` | Offers only authenticated, conflict-free current facts as replacement targets. Saving a replacement for review does not record a supersession link. |
| `tests/browser/project-memory.spec.ts` | Verifies AI suggestions cannot merge into user facts, review-only replacement leaves the former fact nonterminal, and confirmed supersession retains reciprocal links and signed lifecycle history. |
| `tests/browser/project-shared-state.spec.ts` | Registers the synthetic test MCP client with its project-scoped credential to match the current authenticated client contract. |

The source changes are split into two reviewable commits. The first protects replacement eligibility and proposal recovery. The second stages replacement facts before superseding history, closing the interruption window that could otherwise expose both old and new claims as current.

## Verification

Environment: Windows build `10.0.26200`, Node `v24.14.1`, npm `11.11.0`, Playwright `1.65.1`. Test data is synthetic.

| Command or scope | Result |
| --- | --- |
| `npm run check` | **VERIFIED**, exit code 0 after the final source changes. |
| `npm test` | **VERIFIED**, 261 passed, 0 failed, 0 skipped after the final source changes. |
| `npm run build` | **VERIFIED**, single-file web build and CLI build completed after the final source changes. |
| Chromium project-memory and shared-state regression, one worker | **VERIFIED**, 24/24 passed after the final source changes. |
| Replacement lifecycle tests on Chromium | **VERIFIED**, 2/2 passed after the final source changes. |
| Replacement lifecycle tests on Firefox | **VERIFIED**, 2/2 passed after the final source changes. |
| Replacement lifecycle tests on WebKit | **VERIFIED**, 2/2 passed after the final source changes. |
| Full Firefox project-memory and shared-state suite | **VERIFIED with one skip** on the immediately preceding code state. The modified replacement flow was rerun after the final change and passed 2/2. |
| Full WebKit project-memory and shared-state suite | **VERIFIED with one skip** on the immediately preceding code state. The modified replacement flow was rerun after the final change and passed 2/2. |
| Linux | **NOT VERIFIED**. |
| Fault-injected interruption and the double-failure candidate-recovery branch | **NOT VERIFIED**. The transaction ordering and diagnostic behavior were reviewed, while these specific failure paths were not fault-injected. |

The initial 8-worker Chromium project-suite attempt had four failures, including navigation timeout and state assertions. A one-worker rerun passed 24/24. The cause was not conclusively isolated, so the parallel-run instability remains an explicit **P2** rather than being described as fixed. The initial failures are retained in the evidence logs.

## Remaining risks

- **P2 — Platform coverage.** Linux remains unverified. Firefox and WebKit skip the isolated-device re-trust case due to browser capability limitations. Chromium covers the local-file path.
- **P2 — Parallel browser-test stability.** The 8-worker run had four failures, while the serialized rerun passed. The reason is not proven and should be investigated before relying on high-parallelism CI results.
- **NOT VERIFIED — Failure injection.** No test forcibly terminated the replacement flow between its durable lifecycle steps, and no test forced both proposal review and its recovery transaction to fail. The ordinary replacement, review, restore and shared-state paths passed.
- **Existing scope limits.** Exact normalized duplicate detection does not identify semantic paraphrases. Local signatures authenticate the project event chain, not real-world identity or factual truth.

No P0/P1 defect remains known in the tested lifecycle flows. Stage 2 remains conditional pending the platform and failure-injection evidence above.

## Evidence files

Final-source evidence is stored under `docs/release/evidence/ultimate-stage2/`:

Committed log copies use normalized line endings and whitespace. The original command output files are preserved locally under the ignored `docs/release/evidence/ultimate-stage2/raw/` directory. The committed unit-test log redacts one synthetic test sentinel only; test counts and results are unchanged.

- `lifecycle-atomicity-typecheck.txt`
- `lifecycle-atomicity-unit-redacted.txt` (the test-only sentinel is redacted in the committed copy; the raw local output remains in the ignored evidence directory)
- `lifecycle-atomicity-build.txt`
- `final-project-browser-chromium-atomicity.txt`
- `lifecycle-atomicity-chromium.txt`
- `lifecycle-atomicity-firefox.txt`
- `lifecycle-atomicity-webkit.txt`
- `final-project-browser-chromium.txt` for the initial parallel attempt
- `final-project-browser-firefox.txt` and `final-project-browser-webkit-rerun.txt` for the preceding full cross-browser runs
- `project-browser-webkit-interrupted-attempt.txt` for the incomplete earlier run, superseded by the completed WebKit rerun

## Repository state

The implementation commits are on `release-candidate/third-round-stage5-baseline`. The report and selected test logs are added in a separate documentation/evidence commit. The remote `main` branch and its history were not changed.
