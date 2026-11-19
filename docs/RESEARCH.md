# Why ThreadPack exists

Research snapshot: **2026-11-19**. These are public reports and project descriptions, not claims that every user has the same problem or evidence of future star growth.

## Observed needs

| Public source | Reported need | Product response |
| --- | --- | --- |
| [openai/codex #28316](https://github.com/openai/codex/issues/28316) — “Codex should not resend large base64 image tool outputs in subsequent context” | Embedded image data can make subsequent conversation context much larger | Make inline image payload removal explicit and show message-text byte changes |
| [openai/codex #26740](https://github.com/openai/codex/issues/26740) | A request to export local conversation history instead of relying on unstable manual copy/paste for a long conversation | Accept local files and export readable, portable copies |
| [anthropics/claude-code #24792](https://github.com/anthropics/claude-code/issues/24792) | A report that compaction damaged task chronology and caused the agent to act on stale context | Let the user write current goals and next steps, pin evidence, and review deterministic excerpts |

The reports were inspected through GitHub's public search/API and public project pages during selection. They motivate the use cases; ThreadPack does not claim to fix the upstream bugs or replace provider compaction.

## Existing tools and the gap

- [ccusage](https://github.com/ccusage/ccusage) focuses on usage analysis. ThreadPack focuses on the content being carried into a fresh conversation.
- [chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) makes ChatGPT export and sharing easier. ThreadPack starts from exported files across multiple formats and adds explicit cleanup and a handoff composition step.
- [claude-code-trace](https://github.com/delexw/claude-code-trace) provides a richer conversation/trace viewing environment. ThreadPack aims for a smaller workflow: open a single offline page, load a file, inspect changes, and download a copy.
- [Gitleaks](https://github.com/gitleaks/gitleaks) is a dedicated secret scanner. ThreadPack's rule-based redaction is an export convenience and does not replace such a scanner.

The intended difference is the combination of **offline, no setup, cross-format input, inspectable cleanup, and a user-authored handoff**, rather than another token counter or a claim to automatically understand a whole project.

## Scope decisions

1. **No model dependency.** Keeps the workflow available without credentials and avoids sending the very logs being inspected to another service. The tradeoff is that users supply the actual decisions and current state themselves.
2. **Portable exports instead of native log surgery.** Provider session schemas evolve. A normalized copy is easier to inspect and safer than overwriting files used by an active agent.
3. **Explicit loss markers.** Tool-output truncation and payload removal should be visible so users can decide whether the lost material matters.
4. **Stable placeholders.** Repeated recognized values receive consistent aliases within one cleaning pass, preserving relationships without exposing the original secret.
5. **Honest measurements.** Show text bytes and counts; do not call estimated counts provider billing tokens or promise a fixed percentage reduction.

## What this research cannot establish

These sources validate concrete problems, not market size, a unique category, or future popularity. Useful next evidence is whether real users can complete a handoff with their own exports, which formats fail, and which lost details they need to pin. Public launch copy should describe implemented behavior and show a reproducible synthetic example.
