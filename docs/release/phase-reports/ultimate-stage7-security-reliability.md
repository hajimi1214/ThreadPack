# ThreadPack stage 7 security and reliability checkpoint

Date: 2026-11-29

Candidate branch: `release-candidate/third-round-stage5-baseline`

Starting candidate HEAD: `f08bbeb963001307bca6e4593cfd1e758fbfe269`

Source commit: `437065946770a30b40a6c009ad8b0f83eff3e14a`

Status: **IN PROGRESS**. This checkpoint closes one verified browser-policy defect and records the broader audit boundary. It is not Stage 7 completion.

## Finding and change

The production HTML CSP restricted `connect-src` to same-origin and a local Vite WebSocket, while the optional memory-extraction UI accepts user-selected HTTPS endpoints. A Chromium test against a locally intercepted `https://threadpack-ai.example.invalid/v1/chat/completions` request showed `fetch` blocked by CSP and the Playwright route handler was never reached.

The production CSP now allows HTTPS connections and HTTP only for localhost/loopback hosts, while preserving the existing default-deny policy for scripts, workers, images, fonts, forms, and objects. The AI feature continues to require the explicit user opt-in, selected conversations, validated endpoint, and explicit submit action. Remote redirects remain rejected and browser credentials remain omitted. The browser regression now uses an `.invalid` HTTPS endpoint and intercepts the request locally, so no external network service receives test data.

## Validation

| Validation | Result |
| --- | --- |
| `npm run check` | VERIFIED, exit code 0 |
| `npm test` | VERIFIED, 261 passed, 0 failed, 0 skipped |
| `npm run build` | VERIFIED, single-file web and CLI builds completed |
| Remote-shaped AI endpoint with prior production CSP | VERIFIED reproduction, fetch blocked and route interception count 0 |
| AI extraction browser regression on Chromium | VERIFIED, 1/1 passed |
| AI extraction browser regression on Firefox | VERIFIED, 1/1 passed |
| AI extraction browser regression on WebKit | VERIFIED, 1/1 passed |
| `npm audit --audit-level=high` | VERIFIED, zero known vulnerabilities reported |
| `npm audit --omit=dev --audit-level=high` | VERIFIED, zero known production vulnerabilities reported |
| Linux, performance baselines, forced-kill recovery, and long-run memory | NOT VERIFIED |

The remote-shaped endpoint resolves to `.invalid` and is intercepted by Playwright. No test request was sent to an external service.

## Broader security findings

- **P1 external-client boundary remains open.** WorkBuddy 5.11.3's read-only ThreadPack model request was accompanied by a built-in workspace-root action outside the synthetic test authorization. The final response said the default workspace was empty, but execution of the directory read is not independently verifiable. No further WorkBuddy model calls were made. See `docs/release/phase-reports/ultimate-stage6-workbuddy-readonly-validation.md`.
- **P2 CSP tradeoff.** Supporting a user-configured HTTPS endpoint requires `connect-src https:`. The app sends data only through its explicit AI flow, but an application-script compromise could use the broader network allowance. A nonce/hash-based inline-script policy is not implemented because the production bundle is single-file and currently requires inline script/style allowances.
- **P2 Windows local credential permissions.** The MCP registry and config are user-local, but Windows ACL inheritance is not verified by the CLI.
- **NOT VERIFIED.** Large adversarial archives, peak decompression memory, process-kill and disk-full recovery, multi-hour sessions, Windows ACL behavior, and Linux behavior have not been measured.

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

## Files

- `index.html` widens `connect-src` to support the documented endpoint flow while retaining loopback-only HTTP.
- `tests/browser/project-memory.spec.ts` routes the AI extraction fixture through a remote-shaped HTTPS origin to exercise production CSP.
- `docs/security/threat-model.md` records assets, actors, controls, and unverified areas.
- `docs/security/trust-boundary.md` records instruction/data, fact/evidence, client/storage, and AI endpoint boundaries.
- `docs/release/evidence/ultimate-stage7/` holds the current checkpoint's test and audit logs.
