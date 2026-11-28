# ThreadPack 阶段 6 客户端生态与多项目管理进展报告

## 结论

**阶段状态为 IN PROGRESS。当前实现和自动化验证不构成阶段 6 完成验收。**

阶段 6 前序检查点完成了项目归档/恢复、MCP 本地配置诊断、配置片段引导和元数据连接日志。当前检查点新增本地 MCP 客户端凭据注册、项目级权限、令牌轮换与撤销，并把认证参数加入配置引导。外部 WorkBuddy/Codex/Claude Code 的连接和模型工具调用仍未形成可复核证据，因此不能认定阶段 6 已通过。

本检查点的 bearer token 只认证 ThreadPack 本地注册主体的令牌持有者，不证明外部平台账号或人员身份。注册表只保存令牌摘要。默认只读模式仍可省略身份注册，写入权限必须由注册表和服务运行参数双重授权。更新收件箱中的历史客户端标签仍是未签名的协调元数据。

## 基线与工作区

| 项目 | 实际值 |
| --- | --- |
| 候选分支 | `release-candidate/third-round-stage5-baseline` |
| 本阶段修改前 HEAD | `5ca5bfadbfbae92945b1ba0edfabc05a787c08bf` |
| 修改前远程候选 HEAD | `5ca5bfadbfbae92945b1ba0edfabc05a787c08bf` |
| 本检查点开始时 HEAD 与远程候选 | `345b83407410ee014477886bbe3d04697ab8262f`，本地与远端相同 |
| `origin/main` | `77a197696480e8edebdc9bde7bca43443d3a759b` |
| 原始 main 工作区 | `D:\Github项目\ThreadPack`，HEAD 为 `2ce4bff99a59d51fefb424eed2cfabeba37af4c1` |
| 原始 main 工作区状态 | 本次检查时有 19 个已修改文件和 3 个未跟踪文件，未对其进行编辑 |
| 运行环境 | Windows 10.0.26200、Node.js 24.14.1、npm 11.11.0、Playwright 1.65.1 |

候选工作区与原始 main 工作区是两个独立 Git worktree。原始 main 的领先提交和未提交文件均未被本次操作覆盖。`origin/main` 未修改。

本认证检查点从候选 HEAD `357149f3ba6c9d158c3e01d7169d398fb20d0c12` 开始。候选分支与远程候选分支在检查点开始时相同，工作区干净。

## 本阶段实现

### 项目归档和恢复

项目记录新增 `archivedAt` 生命周期字段。归档项目从活动列表隐藏并进入已归档列表。恢复会清除该字段，原项目 ID、项目数据和会话版本继续使用原记录。该操作不会删除项目记录，也不会撤销已经配置的 MCP 共享文件访问。界面已提供英文、简体中文、日语、法语和西班牙语文案，并明确提示归档不会撤销共享文件访问。

### MCP 本地诊断

`threadpack mcp --check` 只读解析指定备份和收件箱，校验项目范围，报告本地只读或写入开关及当前可用工具，然后退出。诊断将收件箱状态区分为 `absent` 和 `valid`。缺少收件箱时不会自动创建文件。该检查不启动 MCP 会话，不探测外部客户端，也不判断写入目录的实际可写性。

### MCP 配置引导

项目页增加本地配置片段生成器，可生成 Codex TOML 或 JSON `mcpServers` 示例，并为 Claude Code、WorkBuddy 和通用目标标出建议文件名。配置以当前项目 ID 限定访问，默认显式只读。候选写入和任务协调可分别开启。启用写权限时片段会带入本地 client label 和相应开关，并提示用户保护配置及 inbox。生成器不会读取或改写客户端配置，且明确要求用户按客户端版本自行核对格式并运行本地诊断。客户端版本兼容和实机连接依然未验证。

### MCP 连接日志与能力观察

新增可选的 `--connection-log <file>`。默认不创建日志。`threadpack mcp --check` 会只读检查日志路径状态，实际启动时才创建文件。日志与项目备份和更新收件箱必须分开；拒绝符号链接、非普通文件、POSIX 上权限过宽的既有文件、缺少换行终止符的尾记录，以及超过 4 MiB 的文件。新建 POSIX 日志权限为当前用户可读写。达到 4 MiB 或写入失败后会向 stderr 发出提示并停止日志记录，MCP 请求继续运行。用户轮换日志后可重新启用。

日志不保存 JSON-RPC 参数、消息正文或工具返回内容。初始化记录分别标记服务收到的客户端声明和 `notifications/initialized`，仅记录白名单中的客户端名称、符合版本号格式的版本、协议版本及能力名称。未知名称会统一归为 `unrecognized`，配置的原始 `--client-id` 不写入日志。后续记录观察到的 `tools/list`、资源请求和工具调用的名称、成败与耗时。客户端名称、版本和能力声明仍未经认证，不能用作身份凭证或外部兼容性结论。

### 本检查点新增的本地客户端注册

新增 `cli/mcp-client-registry.ts` 和 `threadpack mcp-client issue|list|rotate|revoke` 命令。签发时生成 32 字节随机 bearer token，只在命令输出中显示一次，注册表保存 SHA-256 摘要、客户端 ID、精确项目 ID、只读/候选更新/任务协调授权及创建/撤销时间。客户端令牌由 MCP 子进程环境变量提供，不出现在参数或连接日志中。客户端 ID 一旦配置，就必须提供注册表、项目 ID 和有效令牌。候选更新与任务协调的运行参数不能超过注册表中授予的权限。服务在进程启动和每次资源/工具请求时重新验证注册状态，所以轮换和撤销会使正在运行的旧凭据失效。

注册表拒绝符号链接、超大文件、未知 schema、重复身份和 POSIX 组/其他用户可读文件。读取时通过已打开文件句柄校验路径与文件标识，避免先检查后按路径读取的符号链接竞态。更新采用临时文件加原子改名，并使用 `.lock` 文件排除并发写。崩溃留下的锁须由操作者确认进程结束后手动清理。Windows ACL 使用父目录继承，本版本没有单独检查 ACL。配置向导将令牌环境变量限制为 `THREADPACK_` 前缀，并正确转义 TOML 控制字符。向导可以把一次性 bearer token 放入 MCP 客户端配置 `env` 字段，因此生成配置应按密钥保管。此设计只证明本机客户端进程持有本地令牌，不证明外部平台身份，也不防护同一操作系统账户下的恶意进程。

### 本检查点文件变更

| 文件或文件组 | 修改内容 |
| --- | --- |
| `cli/mcp-client-registry.ts`、`cli/index.ts` | 凭据签发、列出、轮换、撤销；安全读写本地注册表；CLI 分发与使用说明 |
| `cli/mcp-server.ts` | 要求已配置身份完成注册凭据验证；按项目和能力授权；启动和每个工具/资源请求重新验证；诊断及元数据日志区分本地认证主体和外部客户端声明 |
| `src/projects/McpSetupGuide.tsx`、`src/locales/*.ts` | 支持已登记 client ID、注册表路径、令牌环境名和一次性 token 配置示例；五种语言更新身份边界说明 |
| `tests/mcp.test.ts`、`tests/browser/project-library.spec.ts` | 凭据哈希、项目隔离、权限不足、token 轮换/撤销、运行时撤销和向导配置回归 |
| `docs/security/local-mcp-client-authentication.md`、MCP 架构与 README | 身份范围、密钥处理、文件权限与限制说明 |
| `docs/release/evidence/ultimate-stage6/client-auth-*.txt` | 本检查点类型检查、MCP 专项和全量测试、生产构建、Chromium 验证及两次失败重跑的原始记录 |
| `cli/mcp-connection-log.ts`、`cli/mcp-server.ts`、`cli/index.ts` | 新增安全检查、4 MiB 限额、只读诊断、stdio 元数据日志及 CLI 参数说明 |
| `src/projects/McpSetupGuide.tsx`、`src/locales/*.ts` | 配置引导可选择连接日志路径，支持五种界面语言 |
| `tests/mcp.test.ts`、`tests/browser/project-library.spec.ts` | 增加日志隐私、隔离、截断尾部、容量上限和配置生成验证 |
| `README.md`、`README.zh-CN.md` | 说明日志内容边界、容量和限制 |
| `docs/release/evidence/ultimate-stage6/connection-log-*.log`、`SHA256SUMS.txt` | 本轮类型检查、完整单元测试、构建和 Chromium 专项的原始输出及校验和 |
| 本阶段报告 | 更新目标矩阵、风险、测试结果和遗留项 |

## 阶段 6 目标核对

| 目标 | 状态 | 证据或限制 |
| --- | --- | --- |
| 多项目创建与切换 | VERIFIED | 现有项目库 UI 和隔离测试 |
| 项目唯一 ID 与独立本地存储 | VERIFIED | 浏览器项目隔离测试 |
| 项目级 MCP 读取范围 | VERIFIED | MCP 固定项目 ID 校验测试 |
| 项目归档与恢复 | VERIFIED | Chromium 页面重载后恢复测试，保留相同项目 ID、会话及版本 |
| 项目备份导入与导出 | VERIFIED | Chromium 项目库回归测试 |
| 多个独立 MCP 实例 | VERIFIED, LOCAL PRINCIPAL SCOPE | 已登记令牌绑定一个项目和独立权限；收件箱里的历史标签仍是未签名元数据 |
| 客户端身份管理 | VERIFIED, LOCAL TOKEN SCOPE | 本地注册、哈希存储、项目授权、独立权限、轮换、撤销及运行中撤销均有 Node 测试；注册表竞态防护和 token 环境变量约束已检查。外部平台身份未认证 |
| MCP 配置向导 | PARTIAL | 支持凭据注册字段、token environment 及 Codex TOML/JSON `env` 示例；不写入用户配置。Claude Code、WorkBuddy 与其他客户端的配置 schema 仍未验证 |
| MCP 健康检查 | VERIFIED, LIMITED | 本地 `--check` 覆盖备份、收件箱解析、项目范围和工具授权配置，不代表外部客户端连接成功 |
| 客户端能力观察 | PARTIAL | 可记录 MCP initialize 声明的能力名称和实际观察到的方法调用。没有主动探测或验证 WorkBuddy、Codex、Claude Code 等客户端的完整能力 |
| 配置诊断 | PARTIAL | 可诊断 ThreadPack 本地文件和权限参数；不解析用户级客户端配置。CLI 保持通用错误隐藏，不输出未筛选的底层错误 |
| 持久连接日志 | VERIFIED, LIMITED | 可选本地 JSONL 元数据日志记录初始化声明、注册的本地主体、观察到的方法/工具名、结果和耗时；不记录参数和内容，4 MiB 后停止并告警。外部客户端声明仍未经验证 |
| 凭据配置引导与 TOML 转义 | VERIFIED, CHROMIUM | 配置向导测试覆盖注册字段、项目范围、权限、token 注入、系统环境变量拒绝和引号转义 |
| WorkBuddy、Codex、Claude Code 与其他 MCP 客户端实机验证 | NOT VERIFIED | 本检查点尚未确认 WorkBuddy 5.11.3 的 MCP 用户配置入口，也未执行真实模型调用 |
| ChatGPT 正式接入方式 | NOT VERIFIED | 未验证能否建立受支持的本地 MCP 接入，不能声称网页会话直连 |

## 验证证据

所有最终日志位于 `docs/release/evidence/ultimate-stage6/`。`SHA256SUMS.txt` 对 UTF-8 文本先将 CRLF/CR 换行统一为 LF 再计算 SHA-256，以适应 Git 的跨平台换行规范化。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| `npm run check` | VERIFIED | `type-check.log` |
| `npm test` | VERIFIED，254 通过，0 失败 | `unit-tests.log` |
| `npm run build` | VERIFIED，包含 Web 与 CLI 构建 | `production-build.log` |
| Chromium 项目库套件 | VERIFIED，7 通过 | `e2e-project-library-chromium.log` |
| 归档页面重载及恢复专项 | VERIFIED，1 通过 | `e2e-project-archive.log` |
| MCP 配置引导专项 | VERIFIED，1 通过 | `e2e-mcp-setup-guide.log` |
| 配置引导后的 Chromium 项目库套件 | VERIFIED，8 通过，单 worker | `e2e-project-library-wizard-final.log` |
| 配置引导后的生产构建 | VERIFIED，包含 Web 与 CLI 构建 | `production-build-wizard.log` |
| 配置引导后的类型检查与全量单元测试 | VERIFIED，254 通过，0 失败 | `type-check-wizard.log`、`unit-tests-wizard.log` |
| 新连接日志改动的类型检查 | VERIFIED | `connection-log-type-check.log` |
| 新连接日志改动的全量单元测试 | VERIFIED，259 通过，0 失败；覆盖敏感客户端元数据排除、日志调用记录、路径隔离、无效/截断日志拒绝和满额时服务继续运行 | `connection-log-unit-tests.log` |
| 新连接日志改动的生产构建 | VERIFIED，Web 与 CLI 构建通过 | `connection-log-build.log` |
| 配置引导连接日志选项的 Chromium 专项 | VERIFIED，1 通过，单 worker | `connection-log-e2e-chromium.log` |
| 本检查点类型检查 | VERIFIED | `client-auth-type-check-final.txt` |
| 本检查点 MCP 专项测试 | VERIFIED，19 通过，0 失败 | `client-auth-mcp-tests-final.txt` |
| 本检查点全量单元测试 | VERIFIED，261 通过，0 失败 | `client-auth-unit-tests-final.txt` |
| 本检查点生产构建 | VERIFIED，Web 与 CLI 构建通过 | `client-auth-production-build-final.txt` |
| 本检查点 Chromium 项目库套件 | VERIFIED，8 通过，单 worker | `client-auth-chromium-e2e-final.txt` |
| 产品源码与文档的 `git diff --check` | VERIFIED | 不含发布目录原始运行日志 |
| Firefox、WebKit、Linux | NOT VERIFIED | 本次未执行 |
| 外部 MCP 客户端与真实模型调用 | NOT VERIFIED | 本次未执行 |

`e2e-project-archive-stale-port.log` 保留了一次测试环境失败记录。Playwright 复用了 4318 端口上的旧预览服务器，因此页面快照不含候选构建中的归档控件。随后改用隔离的 43917 与 43918 端口运行归档专项和项目库套件，分别 1/1 与 7/7 通过。首次调用 Playwright 时因使用了未配置名称的 `chromium` 项目而退出，随后依照配置设置 `THREADPACK_BROWSER=chromium` 重跑。上述失败均未被计入通过结果。

配置引导迭代中，在 8 个 worker 下运行 Chromium 项目库套件时出现 6 项超时，记录在 `e2e-project-library-8worker-timeout.log`。使用相同测试、单 worker、独立端口重跑后 8/8 通过，结果保存在 `e2e-project-library-wizard-final.log`。单独的配置引导专项也通过。没有跳过或删除测试。

本检查点第一次 Chromium 回归的新增断言误以为 HTML 文本输入会保留 CRLF，实际浏览器会将其归一化；修正断言后，第二次运行暴露出无效 token 环境变量时向导显示通用路径提示的问题。对应原始失败记录分别保存在 `client-auth-chromium-e2e.txt` 与 `client-auth-chromium-e2e-second-attempt.txt`。修复提示状态判断及五种语言文案后，完整 Chromium 项目库套件 8/8 通过，记录在 `client-auth-chromium-e2e-final.txt`。

保留原始运行日志会带入少量终端格式化空格，因此对全部暂存文件运行 `git diff --cached --check` 会报告日志行末空格和空白尾行。本检查点的生产构建日志和类型检查日志也有相同的原始终端格式。产品源码、测试源码、README 和报告本身已单独通过 whitespace 检查；未改写原始输出以消除这些日志特征。`SHA256SUMS.txt` 对运行日志换行做 LF 规范化后计算哈希。

本地检查确认 `origin/main` 保持原 SHA。候选代码提交 SHA 会在实现提交完成后写入本报告；文档更新提交记录本报告和路线图的后续修订。

## 风险与剩余工作

1. **P2** 注册令牌只认证本地 bearer token 持有者，不认证 WorkBuddy、Codex、Claude Code 等外部账号或实际人员；同一操作系统账户下的恶意进程可读取客户端配置或更改注册表。
2. **P2** 凭据签发、轮换和撤销目前通过 CLI 管理，配置向导只生成手动粘贴的示例，不会主动探测外部客户端。连接日志按需启用，达到上限后需手动轮换。
3. **P2** 归档仅整理 ThreadPack 活动列表，不会撤销共享 MCP 文件连接。UI 已对此作出提示。
4. **P2** 本次只在 Windows Chromium 环境验证，Linux、Firefox、WebKit 与真实外部 AI 客户端均未验证。
5. **P2** POSIX 注册表/日志权限行为未在 Linux 验证；Windows ACL 继承也未检查。
6. **P3** `--check` 对预期错误使用 CLI 现有的通用错误隐藏行为，失败可识别但原因可能需要手动检查参数和文件。

没有发现本检查点造成的 P0/P1 缺陷。阶段 6 仍有真实客户端能力验证和实机验证未完成，保持 IN PROGRESS，不能以本报告宣布阶段完成或正式发布。

## 提交记录

| 项目 | 结果 |
| --- | --- |
| 阶段实现提交 | 归档与诊断 `2b2d9f80d4d3b39799ec7150101b32203bd0a305`；项目范围 MCP 配置引导 `b4d1ef6728df8203ecb73e6a8e473378dddab455` |
| 本检查点实现提交 | `abc797aaaacd8027b194984b87adef85b2e9be92` |
| 报告提交 | 本报告在实现提交之后单独提交；其 SHA 由候选分支 Git 历史记录 |
| 候选分支 | `release-candidate/third-round-stage5-baseline` |
| 远程推送 | 实现和报告提交完成后仅推送候选分支，不触及 `main` |

下一步优先处理本地客户端身份/授权管理并取得真实客户端验证证据。后续阶段不得把本报告列出的 NOT VERIFIED 项改写成已支持能力，除非补充新的可复核证据。
