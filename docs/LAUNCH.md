# Publishing ThreadPack

The project is ready to publish as source with an offline build. Replace repository-specific links only after the actual repository and Pages site exist. Do not advertise a live demo URL before verifying it.

## Repository presentation

Suggested repository description:

> Pack bloated AI chats into smaller transcripts and portable handoffs. Local, offline, no API key. Codex · Claude Code · ChatGPT.

Suggested topics: `ai-tools`, `local-first`, `offline`, `codex`, `claude-code`, `chatgpt`, `conversation-export`, `privacy`, `typescript`.

Include the real screenshot from `docs/assets/demo.png`, the two README languages, the MIT license, and a tagged release containing the offline HTML and CLI bundle. In GitHub repository settings, enable Pages with GitHub Actions, then manually run **Deploy Pages**. Check the published page and demo before adding its URL to the repository's About panel.

## Short English introduction

> I built ThreadPack after running into a practical problem with long AI coding sessions: a lot of the history is screenshots and repeated tool output, while the decisions you need for a fresh chat are scattered through it.
>
> It is a local browser tool that imports Codex, Claude Code, and ChatGPT exports, removes selected bulk, replaces recognized secrets, and lets you compose a handoff from your notes and pinned messages. No account, API key, or external model. The production app is one offline HTML file; there is also a CLI using the same engine.
>
> Handoffs are excerpts, not AI summaries, and redaction is rule-based. I would particularly appreciate synthetic examples of export formats it fails to parse.

## 中文介绍

> 做了个叫 ThreadPack 的开源小工具，解决 AI 编程长会话里的一个具体问题：截图和工具输出占了很多空间，真正需要带到下一轮的决定却很难整理。
>
> 它可以在本地导入 Codex、Claude Code 和 ChatGPT 对话，按开关清理内嵌图片、过长或重复输出，对可识别的秘密做脱敏，再用自己的笔记和置顶消息生成交接包。无需账号、API Key 或大模型；网页产物只有一个 HTML，断网也能用，另有同引擎 CLI。
>
> 交接包是摘录，不冒充 AI 摘要；脱敏也不能保证覆盖全部秘密。欢迎用合成样例反馈不兼容的导出格式。

## After release

Respond to format bugs with a minimal fixture and a regression test. Document unsupported blocks and release behavior changes. Add a live demo only when hosting works, and a release download link only when a release exists. Ask for feedback on the workflow; do not buy stars, use engagement exchanges, or imply guaranteed popularity.
