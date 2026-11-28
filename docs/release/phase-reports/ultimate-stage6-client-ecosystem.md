# ThreadPack 阶段 6 客户端生态与多项目管理进展报告

## 结论

**阶段状态为 IN PROGRESS。当前实现和自动化验证不构成阶段 6 完成验收。**

阶段 6 前序检查点完成了项目归档/恢复、MCP 本地配置诊断和配置片段引导，相关代码与测试依据见本报告后文。本次继续补充元数据连接日志。客户端身份管理、主动外部能力检测和真实客户端运行仍未完成或验证，因此不能认定阶段 6 已通过。

本次后续检查点增加了显式启用的 MCP 元数据连接日志，并把该选项加入配置引导。连接日志只记客户端初始化声明、实际观察到的方法/工具名、结果和耗时，不记工具参数或项目上下文内容。日志不认证客户端身份，客户端声明的能力也不等于目标客户端兼容性测试。阶段 6 仍未完成。

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

### 本检查点文件变更

| 文件或文件组 | 修改内容 |
| --- | --- |
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
| 多个独立 MCP 实例 | PARTIAL | 实例可分别配置项目范围和工具授权；`--client-id` 仍是未认证标签 |
| 客户端身份管理 | NOT IMPLEMENTED | `--client-id` 仍是未经认证的本地标签。没有客户端注册、凭据或撤销机制 |
| MCP 配置向导 | PARTIAL | 项目页可生成 Codex TOML 与通用 JSON stdio 示例，并可选择元数据日志路径；不会写入用户配置。Claude Code、WorkBuddy 与其他客户端的版本兼容性 NOT VERIFIED |
| MCP 健康检查 | VERIFIED, LIMITED | 本地 `--check` 覆盖备份、收件箱解析、项目范围和工具授权配置，不代表外部客户端连接成功 |
| 客户端能力观察 | PARTIAL | 可记录 MCP initialize 声明的能力名称和实际观察到的方法调用。没有主动探测或验证 WorkBuddy、Codex、Claude Code 等客户端的完整能力 |
| 配置诊断 | PARTIAL | 可诊断 ThreadPack 本地文件和权限参数；不解析用户级客户端配置。CLI 保持通用错误隐藏，不输出未筛选的底层错误 |
| 持久连接日志 | VERIFIED, LIMITED | 可选本地 JSONL 元数据日志记录初始化、观察到的方法/工具名、结果和耗时；不记录参数和内容，4 MiB 后停止并告警。客户端身份仍未经验证 |
| WorkBuddy、Codex、Claude Code 与其他 MCP 客户端实机验证 | NOT VERIFIED | 本阶段没有启动这些客户端或执行模型调用 |
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
| 产品源码与文档的 `git diff --check` | VERIFIED | 不含发布目录原始运行日志 |
| Firefox、WebKit、Linux | NOT VERIFIED | 本次未执行 |
| 外部 MCP 客户端与真实模型调用 | NOT VERIFIED | 本次未执行 |

`e2e-project-archive-stale-port.log` 保留了一次测试环境失败记录。Playwright 复用了 4318 端口上的旧预览服务器，因此页面快照不含候选构建中的归档控件。随后改用隔离的 43917 与 43918 端口运行归档专项和项目库套件，分别 1/1 与 7/7 通过。首次调用 Playwright 时因使用了未配置名称的 `chromium` 项目而退出，随后依照配置设置 `THREADPACK_BROWSER=chromium` 重跑。上述失败均未被计入通过结果。

配置引导迭代中，在 8 个 worker 下运行 Chromium 项目库套件时出现 6 项超时，记录在 `e2e-project-library-8worker-timeout.log`。使用相同测试、单 worker、独立端口重跑后 8/8 通过，结果保存在 `e2e-project-library-wizard-final.log`。单独的配置引导专项也通过。没有跳过或删除测试。

保留原始运行日志会带入少量终端格式化空格，因此对全部暂存文件运行 `git diff --cached --check` 会报告日志行末空格和空白尾行。本检查点的生产构建日志和类型检查日志也有相同的原始终端格式。产品源码、测试源码、README 和报告本身已单独通过 whitespace 检查；未改写原始输出以消除这些日志特征。`SHA256SUMS.txt` 对运行日志换行做 LF 规范化后计算哈希。

本地检查确认 `origin/main` 保持原 SHA。候选代码提交 SHA 会在实现提交完成后写入本报告；文档更新提交记录本报告和路线图的后续修订。

## 风险与剩余工作

1. **P1（既有边界）** 客户端标签并非认证身份。当前机制只适用于用户控制的本地 stdio 进程和受操作系统权限保护的文件，不能作为多用户或远程授权边界。
2. **P2** 配置向导只生成手动粘贴的示例，尚无客户端注册/撤销界面，也不会主动探测外部客户端。连接日志按需启用，达到上限后需手动轮换。
3. **P2** 归档仅整理 ThreadPack 活动列表，不会撤销共享 MCP 文件连接。UI 已对此作出提示。
4. **P2** 本次只在 Windows Chromium 环境验证，Linux、Firefox、WebKit 与真实外部 AI 客户端均未验证。
5. **P2** POSIX 日志权限约束已写入实现，但本次运行环境为 Windows，Linux 权限行为未验证；Windows ACL 继承也未检查。
6. **P3** `--check` 对预期错误使用 CLI 现有的通用错误隐藏行为，失败可识别但原因可能需要手动检查参数和文件。

没有发现本次改动造成的 P0/P1 缺陷。由于阶段目标中的客户端身份管理、真实客户端能力验证和客户端实机验证仍缺失，阶段 6 保持 IN PROGRESS，不能以本报告宣布阶段完成或正式发布。

## 提交记录

| 项目 | 结果 |
| --- | --- |
| 阶段实现提交 | 归档与诊断 `2b2d9f80d4d3b39799ec7150101b32203bd0a305`；项目范围 MCP 配置引导 `b4d1ef6728df8203ecb73e6a8e473378dddab455` |
| 本检查点实现提交 | MCP 元数据连接日志 `5190d2f8bb8c3dbcae2d8c90c053116743becdd5` |
| 报告与路线图提交 | 本报告及路线图在实现提交之后另行提交，SHA 由其 Git 历史记录 |
| 候选分支 | `release-candidate/third-round-stage5-baseline` |
| 远程推送 | 仅推送候选分支，不触及 `main` |

下一步优先处理本地客户端身份/授权管理并取得真实客户端验证证据。后续阶段不得把本报告列出的 NOT VERIFIED 项改写成已支持能力，除非补充新的可复核证据。
