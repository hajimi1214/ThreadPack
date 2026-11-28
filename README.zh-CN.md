<div align="center">

![ThreadPack](docs/assets/banner.png)

# ThreadPack

**清理对话文件，提取代码，带走上下文。**

通过浏览器应用或共用核心引擎的 TypeScript CLI，检查、清理和导出 AI 对话文件，包括 ZIP 下载包。

[![CI](https://github.com/hajimi1214/ThreadPack/actions/workflows/ci.yml/badge.svg)](https://github.com/hajimi1214/ThreadPack/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js: >=20.19](https://img.shields.io/badge/Node.js-%3E%3D20.19-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)

[在线应用](https://hajimi1214.github.io/ThreadPack/) · [下载发布版本](https://github.com/hajimi1214/ThreadPack/releases/latest) · [English](README.md)

[导入指南](https://hajimi1214.github.io/ThreadPack/import-guide.html#zh) · [核心 API](docs/API.md) · [架构与性能](docs/ARCHITECTURE.md) · [需求调研](docs/RESEARCH.md) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md)

</div>

## 项目概述

ThreadPack 在本地处理 AI 对话导出文件，无需上传到其他服务。它可以按设置移除图片数据、裁剪和合并工具输出，执行规则脱敏，并导出可检查的记录，或包含用户笔记和选定消息的交接包。

浏览器产物是一个自包含 HTML 文件。CLI 和网页共用解析、清理与导出引擎；两者都在本地处理，无需账号或 API Key。

导入后直接进入紧凑工作台，首屏显示对话，导出操作保持可见；手机端按需展开清理设置。全文搜索覆盖原始与打包后的完整对话，也能找到预览未显示的中间文字。

用「文本 / Markdown」切换消息和交接包预览格式，支持 GFM 表格、任务列表和代码围栏。原始 HTML 按文本显示，图片不联网加载，复制仍使用完整清理后原文。

点击「导出筛选结果」可下载全部匹配消息，包含其他分页，支持 Markdown 和 JSONL。搜索、角色、变更和固定条件可以组合；匹配按当前视图进行，导出正文始终应用清理设置。

打开「代码片段」可集中查看对话里的围栏代码块，搜索代码、按语言筛选、切换自动换行，并复制或下载清理后的代码。长代码预览会缩短显示，复制和下载仍包含完整内容。「下载 ZIP」可打包所有符合条件的代码块，包含其他分页。预览使用本地语法高亮，ZIP 在 Worker 内生成；不需要联网。可用内置演示或[这份 Markdown 示例](examples/code-snippets.md)试用。

点击「便携上下文包」可以一次下载一个安全 ZIP，内含清理后的 Markdown、规范化 JSONL、汇总清理报告、简短清单、代码文件，以及可选的交接笔记。它适合提交 issue、团队交接和归档；文件在 Worker 内生成，不包含原始视图内容或自定义脱敏值。规范化 JSONL 会在可用时保留来源引用、工具调用关联、时间线事件和分支图。

语法高亮仅在本地处理最多 2,000 字符的预览；超长片段显示为纯文本，复制和下载仍保留完整清理后内容。应用将选定的语法包和 Markdown 阅读组件打包进离线 HTML；完整应用约 783 KB（gzip 约 234 KB）。在线版首次打开需下载应用文件，之后安装 PWA 可离线使用。

适合接续长时间编程会话、收集生成的代码，或整理一份便于分享的对话。「分享 ThreadPack」只复制工具的公开地址，不携带对话文本或当前页面参数。

按 **Ctrl+K**（Mac 为 **⌘K**）打开快捷操作，可导入、搜索、导出、切换预设和跳转页面。复制按钮会显示处理中、成功或失败状态，筛选条件可一键清除。

布局同时适配屏幕宽度和高度：手机及较矮的横屏窗口允许页面滚动，避免消息区被压缩；平板按需打开清理设置，工具栏随阅读面板的实际宽度调整，超宽屏使用更大的工作区。旋转屏幕或调整窗口时，会保留当前会话、筛选和固定消息。

文件通过 Web Streams 在 Web Worker 后台读取，提供进度与取消操作。界面每次最多接收 30 条消息预览；只有你主动点击复制时，完整单条消息才会传入页面。完整导出在后台生成，再通过缓冲区转移到页面。参见[实测数据](docs/ARCHITECTURE.md#measured-comparison)。

界面支持 **简体中文、English、日本語、Français 和 Español**。通过顶部语言菜单切换；首次打开会参考浏览器语言，手动选择后会记住偏好。界面切换不会翻译导入的对话正文；面向读者的导出标题、警告、报告说明和交接文字会使用当前语言，JSON 字段、消息角色和机器别名保持稳定。

![ThreadPack 工作台与合成对话示例](docs/assets/demo.zh-CN.png)

<details>
<summary>查看代码提取界面</summary>

![复制和下载完整代码块](docs/assets/code-snippets.png)

</details>

## 支持的格式

| 输入 | 处理方式 |
| --- | --- |
| Codex rollout JSONL | 消息、函数调用与结果、会话元数据、压缩记录和时间线事件 |
| Claude Code JSONL | 用户与助手消息、有序工具调用/结果、摘要和来源关联 |
| ChatGPT 导出 JSON | 单会话或多会话档案；显示 `current_node` 并保留全部映射分支 |
| Claude 导出 JSON | 包含 `chat_messages` 的会话 |
| OpenAI 兼容 JSON / JSONL | 包含 `tool_calls`、函数参数及关联工具结果的 `messages` |
| 通用 JSON / JSONL | `messages` 数组，或具有 `role` 和 `content` 的记录 |
| Markdown / 纯文本 | 按显式角色标题分段；没有标题时保留为文本 |

服务商导出结构可能变化。不支持的记录和不完整导入会产生警告与不含正文的完整性异常统计。存在分支或时间线事件时，规范化 JSONL 会保留对应关系。仅有资源引用、没有内嵌图片数据的记录，无法恢复原始图片。

## 处理流程

1. **导入：**选择本地文件、粘贴文字，或加载内置合成演示。多会话档案可以切换会话。
2. **设置清理：**先选均衡、安全分享或保留文本预设，再按需调整。移除内嵌图片、裁剪过长工具输出、合并重复内容，并隐藏常见密钥、邮箱或自定义精确值。
3. **检查：**切换原始与打包后视图，只看发生变更或已固定的消息；逐条查看变更前后内容，搜索长消息，复制完整消息，并固定要带入交接包的上下文。
4. **导出：**选择 Markdown、规范化 JSONL、汇总清理报告、便携上下文包，或包含目标、决定、约束与下一步的交接包。

原始文件不会被修改。界面统计 UTF-8 消息文本的字节数及变化数量，不包含导出元数据，也不代表服务商的 token 用量或计费。

导入成功后，工作区会提供「下载原始文件」，可与清理导出分开保存完全相同的输入字节。导入 ZIP 时下载原 ZIP；粘贴文本时按 UTF-8 保存输入文本。清空工作区或成功导入另一个文件后，原件引用随之释放或替换。

交接包包含笔记、固定消息和最近对话。如超出所选文本预算，文件会标明。

在同一档案内切换会话，会保留各自的笔记、固定消息与交接设置。在交接页使用「导出草稿」和「导入草稿」，可单独保存或恢复版本化 JSON 草稿，文件上限为 256 KiB。笔记按原文保存且不会自动脱敏，请按敏感文件保管。固定消息会在导入时与来源会话校验。清空、更换档案或关闭页面后，内存草稿会移除。清空或更换档案也会清除自定义脱敏值。默认情况下，对话、笔记和自定义值不会写入浏览器存储。

需要长期维护时，可打开「项目」并创建本地项目。只有主动保存后，项目状态、重要记录和会话才会写入本机。重复导入未变化的会话不会产生重复版本；来源提供稳定会话 ID 时，更新内容会追加为新版本并保留旧快照，恢复旧版本也会追加为当前版本。来源没有稳定 ID 时按规范化快照指纹去重，内容变化会另存为新会话。项目搜索包含会话正文及其全部版本。请定期下载项目备份，以便迁移或恢复。备份含有未脱敏的会话历史和项目记录，应作为敏感文件保管。默认情况下项目库只保存在当前浏览器配置中，不同步或加密。可选的 MCP 实时共享会将一个项目写入用户选择的本地文件。浏览器清理可能删除本地项目数据。不使用项目库时，原有内存工作流仍可正常运行。

项目记忆可记录目标、决定、约束、任务、风险和待解决问题，并保留来源、审查状态及指向不可变会话版本和消息摘录的证据。主题相同但内容不同的事实会标记待审；替代事实会保留历史。离线上下文生成器会按相关度排序，在字符预算内保留完整事实，并报告省略项、冲突、旧版本证据和未确认建议。

AI 提取默认关闭。使用时需设置 HTTPS Chat Completions 接口和模型，在当前标签页输入 API key，选择最多四段会话并主动开始提取。只有这一步会将所选会话的限长摘录、项目状态和已确认事实摘要发送到接口。接口与密钥不会保存。AI 结果始终是待确认建议，必须引用本次所选消息中的精确摘录。代码或测试证据可附提交、路径、命令和输出摘录；ThreadPack 记录这些用户提供的信息，但不会独立检查仓库或重新运行测试。

使用「导出跨 AI 上下文包」可生成包含已选上下文、证据元数据，以及 Codex、Claude Code 和 Gemini 代码工作流入口说明的快照。可将说明文件和上下文文件放入代码仓库，供代码 Agent 读取；也可通过浏览器 AI 工具支持的项目文件功能上传。上下文包不会自动同步，ThreadPack 不宣称已直接连接 ChatGPT 或 Claude 账号。

### 通过 MCP 实时共享本地项目状态

在“项目”面板选择“连接实时本地状态”，并指定一个位于你控制位置的新空 `.jsonl` 文件。项目详情、会话或记忆事实变更后，ThreadPack 会自动将该项目的版本化状态写入该文件。该文件包含未脱敏历史。文件句柄保存在当前浏览器配置文件中。浏览器撤销文件权限时，可在项目面板重新授权。同步状态会显示共享文件是否与项目最新状态一致。无法使用实时共享时，普通 IndexedDB 项目仍可继续使用。

在同一台电脑上，将每个本地 stdio MCP 实例配置为启动 `threadpack mcp --backup /path/to/threadpack-shared-project.jsonl --inbox /path/to/threadpack-project-updates.jsonl`。默认只开放上下文和任务列表工具。只读实例可以不配置客户端身份，但仅能访问显式指定的本地备份。需要认证的客户端先运行 `threadpack mcp-client issue --registry /path/to/threadpack-mcp-clients.json --id codex --project-id <精确项目ID>`。命令只显示一次 256 位 bearer token，注册表只保存其 SHA-256 哈希。将令牌提供给 MCP 子进程环境变量 `THREADPACK_CLIENT_TOKEN`，再配置 `--client-id codex --client-registry /path/to/threadpack-mcp-clients.json --project-id <精确项目ID>`。如需开放候选提交或任务协调，签发令牌时授予对应能力，并在 MCP 服务命令中启用 `--allow-candidate-updates` 或 `--allow-task-coordination`。服务权限不能超过注册表授权，并会在每次资源或工具请求前检查凭据状态。可用 `threadpack mcp-client list`、`rotate` 和 `revoke` 查看、轮换或撤销凭据。请保护注册表和可能包含 bearer token 的客户端配置。本地凭据只认证 ThreadPack 本地客户端主体的持有者，不能证明 WorkBuddy、Codex、Claude 等外部平台账号或操作者身份，也不能隔离同一操作系统用户下的恶意进程。当前 CLI 不读取或验证 Windows ACL。

`threadpack_project_context` 工具和 `threadpack://project/context` 资源会在每次请求时重新读取共享状态，并返回快照版本和项目更新时间。`threadpack_project_tasks` 列出已确认、无冲突且未完成的任务及临时认领状态。客户端可通过 `threadpack_project_claim_task` 认领、续期或释放任务，以降低重复工作。提交任务结果时，可通过 `threadpack_project_submit_update` 附上任务 ID 和认领 ID。每项候选仍须引用已保存会话版本和消息中的精确摘录，并提供可安全重试的幂等键。浏览器项目面板会导入认领和候选，并要求用户审查后才会写入项目事实。共享收件箱中的标签没有签名，仍属于未经验证的协调元数据。用户可以编辑或拒绝候选、查看状态历史和认领活动，也可以撤销已接受候选并保留其审计轨迹。接受后若与其他事实冲突，会进入现有冲突审查流程。客户端可在后续读取时比较版本。本地 stdio MCP 仅适用于支持用户配置本地 MCP 的 AI 客户端，不能接续不支持该功能的 ChatGPT 或 Claude 网页会话。桥接不会访问浏览器存储、AI 账号凭据或网络服务，也不会跨电脑同步。断开连接会停止浏览器更新，但保留文件；如需撤销客户端读取权限，请删除文件或修改客户端配置。项目备份功能仍独立保留，供恢复使用。

在项目库的 **MCP 客户端配置引导** 中，可以生成限定到当前项目的 stdio 配置示例。默认只读。选择本地认证或写权限时，需要填写已登记客户端 ID、注册表路径和一次性令牌。令牌会包含在生成的配置中，请妥善保护配置文件和剪贴板历史。引导不会读取或修改客户端设置。请按所用客户端版本核对示例格式，并使用相同本地路径及令牌环境运行 `threadpack mcp --check`。示例不能证明客户端兼容或外部平台账号身份。

运行 `threadpack mcp --check --backup /path/to/threadpack-shared-project.jsonl --inbox /path/to/threadpack-project-updates.jsonl` 可只读检查本地备份、收件箱和当前生效的工具权限，不会启动 MCP 会话，也不会修改文件。该检查只验证 ThreadPack 本地配置，不代表 AI 客户端能够启动或使用该服务。

配置引导可选添加 `--connection-log <path>`。日志默认关闭，启用后以本地 JSONL 记录初始化时白名单内的客户端名称、符合版本号格式的版本及能力名称，以及观察到的 MCP 方法和工具名、调用结果及耗时。未识别的客户端名称统一记为 `unrecognized`，不会写入原始 client label，也不保存工具参数或项目上下文返回内容。日志必须与备份和收件箱分开，在 POSIX 系统上限制为当前用户可读写，最大 4 MiB。日志达到上限或写入失败时会通过 stderr 提示并停止记录，MCP 请求仍会继续。手动轮换日志文件后可恢复记录。客户端声明的名称与能力仍是未经验证的元数据。

实时文件连接需要安全上下文中的 Chromium 浏览器及 File System Access API，共享文件上限为 256 MiB。Firefox、Safari 和不支持此 API 的环境仍可使用本地项目及普通备份导入导出。不支持用户配置本地 MCP 进程的 ChatGPT 或 Claude 网页对话无法直接使用此桥接。

## 安装与使用

### 浏览器应用

直接使用[在线应用](https://hajimi1214.github.io/ThreadPack/)，或从[最新发布版本](https://github.com/hajimi1214/ThreadPack/releases/latest)下载离线 HTML 后用浏览器打开。下载版无需联网或启动本地服务器即可处理文件。

在线应用也支持安装为 PWA。在支持的浏览器中点击“安装应用”或使用浏览器的安装菜单。首次成功访问后，可以离线打开。缓存仅包含公开网页资源，不包含对话、笔记、脱敏规则或导出文件。更新需要主动点击，便于你在重载前下载内存中的工作成果。

从源码运行需要 **Node.js 20.19 或更高版本**：

```sh
git clone https://github.com/hajimi1214/ThreadPack.git
cd ThreadPack
npm ci
npm run dev
```

打开 Vite 输出的本地地址。生成生产网页和 CLI：

```sh
npm run build
```

网页产物为 **`dist/index.html`**，命令行产物为 **`dist-cli/threadpack.mjs`**。完整许可证包含在发布文件中。

### 命令行

可使用 `npm run build:cli` 单独构建 CLI，也可以使用发布版本中的命令行文件。

```sh
node dist-cli/threadpack.mjs session.jsonl --out cleaned.md
node dist-cli/threadpack.mjs session.jsonl --out cleaned.md --original-out source-copy.jsonl
node dist-cli/threadpack.mjs session.jsonl --out portable.jsonl --format jsonl
node dist-cli/threadpack.mjs export.json --conversation 2 --out handoff.md --format handoff
node dist-cli/threadpack.mjs session.jsonl --out handoff.md --format handoff --notes-file notes.json --pin 2 --pin 7
node dist-cli/threadpack.mjs session.jsonl --out dated-handoff.md --format handoff --recent 12 --recent-mode timestamp
node dist-cli/threadpack.mjs session.jsonl --out report.json --format report
```

仓库提供了可用于本地验证的合成样例：

```sh
node dist-cli/threadpack.mjs examples/demo-session.jsonl --out demo-cleaned.md
```

构建后执行 `npm link`，即可在本机使用 `threadpack` 命令：

```sh
threadpack session.jsonl --out cleaned.md --tool-limit 4000
threadpack session.jsonl --out cleaned.md --original-out source-copy.jsonl --language zh
threadpack session.jsonl --out cleaned-custom.md --redact-file redact-values.txt
threadpack session.jsonl --out handoff.md --format handoff --recent 12
threadpack session.jsonl --out handoff.md --format handoff --notes-file notes.json --pin 2 --pin 7
threadpack session.jsonl --out dated-handoff.md --format handoff --recent 12 --recent-mode timestamp
threadpack --help
```

笔记文件使用 UTF-8 JSON 对象。四个字段都可以省略，省略时按空字符串处理：

```json
{
  "goal": "交付兼容性修复",
  "decisions": "保留现有导出格式",
  "constraints": "不要包含凭据",
  "nextSteps": "运行回归测试"
}
```

| 参数 | 说明 |
| --- | --- |
| `--format markdown\|jsonl\|handoff\|report` | 导出格式，默认 `markdown` |
| `--original-out FILE` | 将输入字节原样复制到独立文件，与清理导出分开保存 |
| `--language en\|zh\|ja\|fr\|es` | 本地化 Markdown 标题、报告警告和 CLI 诊断，默认英语 |
| `--conversation N` | 选择会话，从 1 开始 |
| `--tool-limit N` | 单条工具输出的字符上限，范围 500–100000 |
| `--keep-images` | 保留内嵌图片数据 |
| `--keep-tool-outputs` | 保留完整工具输出 |
| `--keep-duplicates` | 保留重复工具输出 |
| `--no-redact` | 关闭内置秘密识别，自定义规则仍生效 |
| `--redact-emails` | 显式开启邮箱脱敏；默认开启 |
| `--no-redact-emails` | 保留邮箱地址 |
| `--redact-file FILE` | 从本地 UTF-8 文件读取精确脱敏值，每行一个 |
| `--recent N` | 交接包中的近期消息数，范围 0–100，默认 8 |
| `--recent-mode MODE` | 按 `source` 源顺序（默认）或有效时间戳选择；适用于交接包和报告 |
| `--notes-file FILE` | 从 UTF-8 JSON 文件读取交接笔记，每个字段最多 12000 字符；适用于交接包和报告 |
| `--pin N` | 固定所选源会话中从 1 开始计数的消息，可重复传入，适用于交接包和报告 |
| `--force` | 替换已存在的输出文件 |

网页文本和 ZIP 输入上限为 **100 MiB**。ZIP 最多处理 **256 个条目**，解压后最多 **100 MiB**；危险路径和不支持的文件不会泄露文件名。浏览器自定义规则最多 **50 项**，每项 **3–1000 个字符**，输入框总上限 **51,000 个字符**。CLI 必须指定 `--out`；输入写为 `-` 时从 stdin 读取 UTF-8 文本。`--original-out` 将输入字节原样复制到独立文件，不修改输入。已有输出默认拒绝覆盖，传入 `--force` 后会替换清理输出和原始副本。输入、清理输出、原始副本、笔记和规则文件必须互不相同，包括文件别名。解析器和清理器警告详情会写入 stderr 与 JSON 报告，但不会包含对话或笔记内容。

对于通用规则无法识别的内容，可使用 `--redact-file redact-values.txt`。规则文件必须为 UTF-8，最多 **64 KiB**，包含至多 **50 个非空白行**，每项 **3–1000 个 Unicode 字符**。按字面值区分大小写匹配，不使用正则表达式。纯空白行被忽略，其他行的首尾空格有意义，会保留。重复值使用一致的 `[CUSTOM_1]` 别名；即使传入 `--no-redact`，自定义规则仍然生效，该开关只关闭内置秘密识别。

常见密钥清理也识别裸 URL 中的用户信息，包括数据库、Redis、HTTP(S)、IPv6 主机和百分号编码凭据。邮箱清理会跳过 URL authority 区域与独立的多 `@` 字符串。报告分别提供 `customRuleMatches`（自定义规则命中次数）、`customRedacted`（采用自定义别名的替换区间数）及 `redactionReplacements`（合并后的总替换区间数）。自定义值被更长的密钥规则整体覆盖时，仍会计入命中次数。缺少 URL 或赋值上下文的多 `@` 字符串需用自定义规则完整隐藏。

严格邮箱脱敏默认开启，CLI 可使用 `--no-redact-emails` 保留邮箱，浏览器也可显式关闭邮箱开关。「均衡」预设会保留邮箱。「安全分享」和新导入的默认设置会脱敏邮箱。URL 用户信息始终独立扫描；格式异常的多 `@` 字符串不会被部分替换成邮箱别名。

`--no-redact` 只关闭内置凭据规则，默认开启的邮箱扫描仍会执行。若要在 CLI 产物中保留邮箱，请显式传入 `--no-redact-emails`。

时间戳模式按有效时间戳选择最近消息；时间戳相同时，优先选择源序位置靠后的消息，最终仍按源顺序展示。缺失或无效时间戳不会参与此模式。浏览器交接预览和 CLI JSON 报告会显示近期上下文时间范围、完整消息数、超出近期数量的消息数、预算状态、因预算省略的消息 ID 和被截短的消息 ID。长消息正文保留节选提示。

文本预算不足时，ThreadPack 会先为消息结构和节选提示预留空间，再把剩余额度分配给多条近期消息。短消息只占用所需空间，余量可用于较长消息的节选。连带提示都放不下的消息会列入省略清单。此功能仍是确定性节选，不会进行语义压缩。

CLI 默认使用英语。`--language` 可选择英语、汉语、日语、法语或西班牙语，用于 Markdown 标题、筛选节选、交接包、报告说明与警告、上下文包文档和 CLI 诊断。JSON 字段名、消息角色、报告选项名及 `[SECRET_1]` 等机器别名保持不变。

交接包的 `--notes-file` 接受 `goal`、`decisions`、`constraints` 和 `nextSteps` 字符串字段。每个字段最多 12000 字符，JSON 文件最多 256 KiB。笔记使用与对话相同的启用内置秘密、邮箱和自定义规则脱敏，但别名独立使用 `[NOTE_SECRET_n]`、`[NOTE_EMAIL_n]` 和 `[NOTE_CUSTOM_n]`。可重复传入 `--pin N`，按所选源会话中从 1 开始的消息顺序固定消息。`--format report` 也可传入笔记和固定消息，用于计算对应交接摘要，报告不会包含笔记正文。

诊断和报告不包含自定义值或笔记内容，但会提供警告详情和汇总匹配数量。规则文件与笔记文件应按敏感本地资料保管，不要提交到版本控制。

## 隐私与限制

- **本地处理：**没有上传接口、分析埋点、外部模型调用或账号系统。对话仅保存在标签页内存中，只有语言偏好写入本地存储。
- **规则脱敏：**对部分已知服务商 token、常见凭据赋值、授权值、私钥及默认开启的邮箱脱敏使用一致别名。可能漏检或误判，分享前应检查导出结果。
- **自定义精确脱敏：**可以补充内置规则无法识别的私有名称或内部编号。仅替换区分大小写的精确匹配；编码、格式或大小写不同的内容需要单独提供规则。
- **交换格式：**规范化 JSONL 不是 Codex 或 Claude 的原生会话文件，不能直接恢复代理会话；ThreadPack 不修复原生上下文压缩。交接草稿 JSON 仅保存笔记与选择设置，不包含对话正文。
- **有损清理：**移除图片后不再保留其视觉信息；裁剪和省略的内容可能仍有价值，应保留原始导出文件。
- **规范化引用：**导出消息使用顺序编号，不保留服务商原生 ID；合法时间戳会被规范化。网页交接笔记脱敏时使用独立的 `NOTE_` 别名前缀。
- **不可信来源：**导入内容作为文本展示，不执行其中的 HTML、命令或指令。导出的记录仍然是历史材料，交给其他系统执行前需要核对。

安全边界与漏洞反馈方式见 [SECURITY.md](SECURITY.md)。

## 架构与开发

[`src/core/`](src/core/) 是纯 TypeScript 引擎，负责解析、清理、测量和导出。React 网页通过本地 Web Worker 处理导入；Node.js CLI 打包同一核心。源码级接口见 [docs/API.md](docs/API.md)。

```sh
npm test                 # 核心和 CLI 集成测试
npm run check            # TypeScript 检查
npm run build            # 离线 HTML 和 CLI
npx playwright install chromium
npm run test:e2e         # 浏览器流程、下载、移动端和离线检查
```

CI 在 Linux 和 Windows 上运行测试与构建，并在 Linux 上运行浏览器测试。**Deploy Pages** 会在 `main` 更新后自动发布，需要先将 GitHub Pages 来源设置为 GitHub Actions。

反馈格式问题时，请提供最小合成样例、来源工具版本和预期结果，不要上传真实会话或凭据。贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，选题证据与范围决策见 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 许可证

[MIT](LICENSE)。ThreadPack 为独立项目，与 OpenAI、Anthropic 无隶属或官方认可关系。
