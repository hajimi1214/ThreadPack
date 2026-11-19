# Contributing

Useful contributions include small parser fixtures, tests for redaction misses, accessibility improvements, and clearer export warnings.

## Run locally

Use Node.js 20.19 or newer, then run `npm install` and `npm run dev`. Before opening a pull request, run `npm test`, `npm run build`, and `npm run build:cli`.

The pure engine lives in `src/core/`. The browser and the CLI both consume it. Keep format-specific parsing in the core so behavior stays consistent.

## Reproduce safely

Create a short synthetic conversation that preserves the input structure but replaces every real identity, path, credential, image, and message. Include the source tool/version and expected normalized messages. Never attach a real rollout, export archive, or private key.

If a new parser drops an unsupported message block, return a warning instead of silently discarding it. If a cleaner removes text, leave an explicit marker. Never mutate source objects or write to an input file.

## Pull requests

Describe the concrete trigger and resulting behavior, include the smallest useful fixture, and explain how the change was verified. Add tests for transformations and safety checks where they protect behavior. Avoid snapshots that simply mirror the implementation.

UI changes should include a small screenshot showing the affected state and should remain usable with keyboard navigation and a narrow viewport. Keep conversation content local; do not add analytics, automatic uploads, or model calls to the core flow.

For a security issue, follow [SECURITY.md](SECURITY.md) instead of posting sensitive input in a public issue.
