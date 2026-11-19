<div align="center">

# ThreadPack

**Your next AI chat shouldn't start from zero.**

Turn a bloated AI conversation into a smaller, reviewable transcript and a portable handoff.
Runs locally. No account. No API key. No model required.

[简体中文](README.zh-CN.md) · [Why this exists](docs/RESEARCH.md) · [Contributing](CONTRIBUTING.md)

![ThreadPack conversation workbench](docs/assets/demo.png)

</div>

Long coding sessions accumulate screenshots, repeated command output, and credentials pasted during debugging. Starting a fresh session can mean losing the decisions that mattered. ThreadPack helps you inspect what you are carrying, remove the bulk, and choose what the next conversation needs.

## Try it

Requires **Node.js 20.19+** to build. No backend or credentials to configure.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, then load the built-in demo or drop a conversation file.

For an offline copy:

```sh
npm run build
```

Open **`dist/index.html`** directly in your browser. The production app is a self-contained HTML file; you can move it to another computer and use it without a server or internet connection.

## What it does

| Bring in | Review and clean | Take out |
| --- | --- | --- |
| Codex rollout JSONL | Remove inline image/base64 payloads | Readable Markdown transcript |
| Claude Code JSONL | Trim long tool output, keeping its beginning and end | Portable normalized JSONL |
| ChatGPT export JSON | Replace exact repeated tool output | Handoff with your notes, pinned messages, and recent exchanges |
| Claude export JSON | Replace recognized secrets with consistent placeholders | Aggregate statistics report |
| Generic messages JSON, Markdown, text | Optionally redact email addresses | Downloaded copies; original files stay intact |

Cleaning switches are explicit. Review changes before exporting, pin important messages, and fill in the goal, decisions, constraints, and next steps you want to carry forward.

**Handoffs are deterministic excerpts, not AI summaries.** ThreadPack does not infer decisions or promise to preserve the meaning of omitted content. Byte reductions describe normalized message text, not native provider billing tokens or full source-file size.

## Command line

The CLI uses the same parser and cleaning engine as the browser.

```sh
npm run build:cli

node dist-cli/threadpack.mjs session.jsonl --out cleaned.md
node dist-cli/threadpack.mjs session.jsonl --out portable.jsonl --format jsonl
node dist-cli/threadpack.mjs export.json --conversation 2 --out handoff.md --format handoff
node dist-cli/threadpack.mjs session.jsonl --out report.json --format report
```

Try the included synthetic fixture:

```sh
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

The fixture contains deliberately fake credentials and image data, with no real conversation content.

After `npm link`, the command is also available as `threadpack`.

```sh
threadpack session.jsonl --out cleaned.md --tool-limit 4000 --redact-emails
threadpack session.jsonl --out handoff.md --format handoff --recent 12
threadpack --help
```

| Flag | Behavior |
| --- | --- |
| `--conversation N` | Select a conversation in a multi-conversation export; starts at 1 |
| `--tool-limit N` | Tool-output character budget, from 500 to 100000 |
| `--keep-images` | Keep inline image payloads |
| `--keep-tool-outputs` | Keep full tool output |
| `--keep-duplicates` | Keep repeated tool output |
| `--no-redact` | Disable secret redaction |
| `--redact-emails` | Also replace email addresses |
| `--recent N` | Number of recent messages in a handoff, from 0 to 100 |
| `--force` | Replace an existing output file |

Use `-` as input to read UTF-8 data from stdin. `--out` is required. The CLI accepts files up to 100 MiB, refuses an existing output unless `--force` is supplied, and always rejects overwriting the input, including file aliases. Its diagnostics contain aggregate counts rather than transcript text.

## Privacy and limits

- Conversation processing happens on your device. The app has no upload endpoint, analytics, external model call, or account system.
- Conversation data stays in the current tab's memory. Download the work you want to keep before closing it.
- Secret detection uses rules, including recognized provider token formats, common credential assignments, authorization values, and private keys. It **cannot guarantee finding every secret or personal identifier**. Review the result before sharing it.
- Normalized JSONL is an interchange format, **not a drop-in replacement for native Codex or Claude session files**. ThreadPack does not repair native compaction or resume a provider's session.
- Export formats evolve. Parser warnings indicate unsupported or incomplete content; test unfamiliar exports on a copy and check the preview.
- ThreadPack renders imported content as text. It does not execute commands, HTML, or instructions found in a transcript.

## Development

```sh
npm test
npm run build
npm run build:cli
```

The TypeScript core in `src/core/` handles parsing, cleaning, and exports without browser or model dependencies. The browser and CLI call that same core. Tests exercise parser formats, cleaning behavior, handoff construction, and CLI file protections.

To host the app on GitHub Pages, enable **Settings → Pages → Source → GitHub Actions**, then run the included **Deploy Pages** workflow manually. Publishing is optional; the offline build works on its own.

Please report a bug with a **small synthetic fixture**, its expected output, and the source tool/version. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Research and competitor context are recorded in [docs/RESEARCH.md](docs/RESEARCH.md).

## License

[MIT](LICENSE). ThreadPack is independent and is not affiliated with OpenAI or Anthropic.
