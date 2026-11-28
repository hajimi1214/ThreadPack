# ThreadPack stage 7 security and reliability checkpoint

Date: 2026-11-29

Candidate branch: `release-candidate/third-round-stage5-baseline`

Starting candidate HEAD: `f08bbeb963001307bca6e4593cfd1e758fbfe269`

Source commit: `437065946770a30b40a6c009ad8b0f83eff3e14a`

Test commits: `c670acf777ef11985e023eb8c16dcff91f2b4abc`, `3a69998fac16d7533f031cafa7cc491f0de585b5`

Status: **IN PROGRESS**. This checkpoint closes one verified browser-policy defect and records the broader audit boundary. It is not Stage 7 completion.

## Finding and change

The production HTML CSP restricted `connect-src` to same-origin and a local Vite WebSocket, while the optional memory-extraction UI accepts user-selected HTTPS endpoints. A Chromium test against a locally intercepted `https://threadpack-ai.example.invalid/v1/chat/completions` request showed `fetch` blocked by CSP and the Playwright route handler was never reached.

The production CSP now allows HTTPS connections and HTTP only for localhost/loopback hosts, while preserving the existing default-deny policy for scripts, workers, images, fonts, forms, and objects. The AI feature continues to require the explicit user opt-in, selected conversations, validated endpoint, and explicit submit action. Remote redirects remain rejected and browser credentials remain omitted. The browser regression now uses an `.invalid` HTTPS endpoint and intercepts the request locally, so no external network service receives test data.

## Validation

| Validation | Result |
| --- | --- |
| `npm run check` | VERIFIED, exit code 0 |
| `npm test` | VERIFIED, 262 passed, 0 failed, 0 skipped |
| `npm run build` | VERIFIED, single-file web and CLI builds completed |
| Remote-shaped AI endpoint with prior production CSP | VERIFIED reproduction, fetch blocked and route interception count 0 |
| AI extraction browser regression on Chromium | VERIFIED, 1/1 passed |
| AI extraction browser regression on Firefox | VERIFIED, 1/1 passed |
| AI extraction browser regression on WebKit | VERIFIED, 1/1 passed |
| `npm audit --audit-level=high` | VERIFIED, zero known vulnerabilities reported |
| `npm audit --omit=dev --audit-level=high` | VERIFIED, zero known production vulnerabilities reported |
| ZIP entry-count and expansion-bomb bounds | VERIFIED, 257 entries rejected; a 102,454-byte archive declaring 104,857,601 expanded bytes was rejected before decompression |
| 100 MiB-class saved-project import, persistence, reload, and search | VERIFIED, one synthetic sample on each of Chromium, Firefox and WebKit; measured values below |
| Linux, performance baselines, forced-kill recovery, and long-run memory | NOT VERIFIED |

The remote-shaped endpoint resolves to `.invalid` and is intercepted by Playwright. No test request was sent to an external service.

## Large-project measurements

The existing large-persistence browser test generated a 104,845,392-byte source and verified a 104,871,301-byte saved revision after reload and search. Timings are one sample per browser on this Windows host with a local production preview. They are observations, not acceptance thresholds.

| Browser | Cold page start | Navigation | Import and parse | Project persistence | Reload | Search to result | Renderer JS heap after import/search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Chromium | 391 ms | 192 ms | 3.05 s | 3.10 s | 191 ms | 3.07 s | 11.9 MB / 11.9 MB |
| Firefox | 661 ms | 541 ms | 3.32 s | 4.46 s | 295 ms | 2.05 s | unavailable |
| WebKit | 237 ms | 195 ms | 2.94 s | 5.28 s | 682 ms | 2.30 s | unavailable |

`performance.memory` was available only in Chromium and measures the page renderer's JavaScript heap, not total browser or worker-process memory. These single samples do not establish long-run stability, peak memory, Linux performance, or a cross-device target.

## Broader security findings

- **P1 external-client boundary remains open.** WorkBuddy 5.11.3's read-only ThreadPack model request was accompanied by a built-in workspace-root action outside the synthetic test authorization. The final response said the default workspace was empty, but execution of the directory read is not independently verifiable. No further WorkBuddy model calls were made. See `docs/release/phase-reports/ultimate-stage6-workbuddy-readonly-validation.md`.
- **P2 CSP tradeoff.** Supporting a user-configured HTTPS endpoint requires `connect-src https:`. The app sends data only through its explicit AI flow, but an application-script compromise could use the broader network allowance. A nonce/hash-based inline-script policy is not implemented because the production bundle is single-file and currently requires inline script/style allowances.
- **P2 Windows local credential permissions.** The MCP registry and config are user-local, but Windows ACL inheritance is not verified by the CLI.
- **NOT VERIFIED.** Peak decompression memory for complex/malformed archives, process-kill and disk-full recovery, multi-hour sessions, Windows ACL behavior, and Linux behavior have not been measured. The tested ZIP cases cover entry count and declared expansion size limits.

The WorkBuddy temporary service is disabled. The temporary configuration file and isolated test directory remain pending the user's action-time confirmation for an irreversible in-app connector deletion. They are not part of the repository or the MCP server's current active state.

## Evidence files

- `docs/release/evidence/ultimate-stage7/csp-remote-endpoint-reproduction.txt` records the pre-fix production-browser reproduction against a locally intercepted `.invalid` endpoint.
- `docs/release/evidence/ultimate-stage7/csp-remote-ai-chromium-e2e.txt`
- `docs/release/evidence/ultimate-stage7/csp-remote-ai-firefox-e2e.txt`
- `docs/release/evidence/ultimate-stage7/csp-remote-ai-webkit-e2e.txt`
- `docs/release/evidence/ultimate-stage7/csp-typecheck.txt`
- `docs/release/evidence/ultimate-stage7/csp-unit-tests-redacted.txt` records 261/261 tests. The committed copy redacts the test-only secret sentinel; the raw output remains in the ignored local `raw/` directory.
- `docs/release/evidence/ultimate-stage7/csp-production-build.txt`
- `docs/release/evidence/ultimate-stage7/npm-audit-all.txt`
- `docs/release/evidence/ultimate-stage7/npm-audit-production.txt`
- `docs/release/evidence/ultimate-stage7/stage7-security-unit-tests-redacted.txt` records the final 262/262 Node test run, including the ZIP-limit cases. The committed copy redacts a test-only sentinel; the original raw output remains in the ignored local `raw/` directory.
- `docs/release/evidence/ultimate-stage7/large-project-performance-chromium-final.txt`
- `docs/release/evidence/ultimate-stage7/large-project-performance-firefox-final.txt`
- `docs/release/evidence/ultimate-stage7/large-project-performance-webkit-final.txt`

## Files

- `index.html` widens `connect-src` to support the documented endpoint flow while retaining loopback-only HTTP.
- `tests/browser/project-memory.spec.ts` routes the AI extraction fixture through a remote-shaped HTTPS origin to exercise production CSP.
- `tests/browser/project-large-persistence.spec.ts` records one-sample cold/hot load, import, persistence, search, and renderer-heap measurements without changing its integrity assertions.
- `tests/worker.test.ts` rejects archives that exceed entry-count and declared expanded-size limits.
- `docs/security/threat-model.md` records assets, actors, controls, and unverified areas.
- `docs/security/trust-boundary.md` records instruction/data, fact/evidence, client/storage, and AI endpoint boundaries.
- `docs/release/evidence/ultimate-stage7/` holds the current checkpoint's test and audit logs.
