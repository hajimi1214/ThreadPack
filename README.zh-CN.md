<div align="center">

# ThreadPack

**换一个 AI 会话，不必把工作从头讲一遍。**

把臃肿的 AI 对话整理成可检查的精简记录和交接包。
本地运行，无需账号、API Key 或大模型。

[English](README.md) · [需求调研](docs/RESEARCH.md) · [参与贡献](CONTRIBUTING.md)

![ThreadPack 对话工作台](docs/assets/demo.zh-CN.png)

</div>

长时间使用 AI 编程，记录里会积累大量截图、重复命令输出和调试时粘贴的凭据。换新会话又容易丢掉关键决定。ThreadPack 帮你看清记录里装了什么，清理占空间的内容，并选择真正需要带到下一轮的上下文。

## 立即运行

构建需要 **Node.js 20.19+**。无需配置后端或任何密钥。

```sh
npm install
npm run dev
```

打开 Vite 输出的本地地址，点击内置示例，或拖入自己的对话文件。

生成可离线使用的版本：

```sh
npm run build
```

直接用浏览器打开 **`dist/index.html`**。产物是一个自包含 HTML 文件，可以复制到另一台电脑使用，不需要服务器或网络。

## 能做什么

| 导入 | 检查与清理 | 导出 |
| --- | --- | --- |
| Codex rollout JSONL | 移除内嵌图片和 base64 数据 | 易读的 Markdown 对话 |
| Claude Code JSONL | 裁剪过长工具输出，保留头尾 | 规范化 JSONL |
| ChatGPT 导出 JSON | 替换完全重复的工具输出 | 包含手写笔记、置顶消息和近期对话的交接包 |
| Claude 导出 JSON | 用一致的占位符替换可识别的秘密 | 仅含汇总统计的报告 |
| 通用 messages JSON、Markdown、纯文本 | 可选邮箱脱敏 | 下载新副本，保留原始文件 |

每项清理都有明确开关。导出前检查结果，置顶关键消息，补充你想保留的目标、决定、约束和下一步。

**交接包是确定性摘录，不是 AI 摘要。** ThreadPack 不会猜测你的决定，也不保证被省略内容的语义仍然保留。体积变化统计针对规范化的消息文字，不等于原始文件大小或服务商计费 token。

## 命令行

命令行与网页共用同一套解析和清理引擎。

```sh
npm run build:cli

node dist-cli/threadpack.mjs session.jsonl --out cleaned.md
node dist-cli/threadpack.mjs session.jsonl --out portable.jsonl --format jsonl
node dist-cli/threadpack.mjs export.json --conversation 2 --out handoff.md --format handoff
node dist-cli/threadpack.mjs session.jsonl --out report.json --format report
```

仓库包含可直接试用的合成样例：

```sh
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

样例中的凭据和图片数据均为人为构造，不包含真实会话。

执行 `npm link` 后，也可以直接使用 `threadpack` 命令。

```sh
threadpack session.jsonl --out cleaned.md --tool-limit 4000 --redact-emails
threadpack session.jsonl --out handoff.md --format handoff --recent 12
threadpack --help
```

| 参数 | 作用 |
| --- | --- |
| `--conversation N` | 在多会话导出中选择一个会话，从 1 开始 |
| `--tool-limit N` | 单条工具输出的字符预算，范围 500–100000 |
| `--keep-images` | 保留内嵌图片数据 |
| `--keep-tool-outputs` | 保留完整工具输出 |
| `--keep-duplicates` | 保留重复工具输出 |
| `--no-redact` | 关闭秘密脱敏 |
| `--redact-emails` | 同时对邮箱地址脱敏 |
| `--recent N` | 交接包附带的近期消息数，范围 0–100 |
| `--force` | 替换已存在的输出文件 |

输入写成 `-` 可从 stdin 读取 UTF-8 文本，必须指定 `--out`。CLI 最多接收 100 MiB；默认不覆盖已有输出，只有显式传入 `--force` 才允许替换。即使指定该参数，也始终拒绝覆盖输入文件及其别名。诊断信息只输出汇总数量，不打印对话原文。

## 隐私与边界

- 对话在本机处理，没有上传接口、分析埋点、外部模型调用或账号系统。
- 对话数据只保存在当前标签页内存中，需要保留的结果请在关闭前下载。
- 脱敏使用规则，覆盖部分已知服务商 token、常见凭据赋值、授权值和私钥。**不能保证识别所有秘密和个人信息**，分享前仍需检查。
- 规范化 JSONL 是交换格式，**不能直接替代 Codex 或 Claude 的原生会话文件**。本工具不修复原生上下文压缩，也不恢复服务商会话。
- 导出结构可能随版本变化。解析警告意味着存在不支持或不完整的内容；首次处理陌生格式时请使用副本并检查预览。
- 导入内容只作为文字展示，不执行其中的命令、HTML 或指令。
- 导出使用顺序消息编号和规范化时间戳，不保留服务商的原生记录 ID。交接笔记中的脱敏别名使用独立的 `NOTE_` 前缀。

## 开发与部署

```sh
npm test
npm run build
npm run build:cli
```

`src/core/` 是不依赖浏览器或模型的 TypeScript 核心，负责解析、清理和导出。网页与 CLI 共用它。测试覆盖导出格式、清理行为、交接包和 CLI 的文件保护。

部署到 GitHub Pages：在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**，再手动运行仓库自带的 **Deploy Pages** 工作流。不部署也能使用离线构建产物。

反馈 bug 时请提供**最小合成样例**、预期结果和来源工具版本，不要提交真实日志或秘密。参见 [贡献指南](CONTRIBUTING.md)、[安全说明](SECURITY.md) 和[选题调研](docs/RESEARCH.md)。

## 许可证

[MIT](LICENSE)。本项目独立开发，与 OpenAI、Anthropic 无隶属关系。
