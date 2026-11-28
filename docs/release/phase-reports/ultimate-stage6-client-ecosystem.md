# ThreadPack 阶段 6 客户端生态与多项目管理进展报告

## 结论

**阶段状态为 IN PROGRESS。当前实现和自动化验证不构成阶段 6 完成验收。**

本次候选改动补充了项目归档/恢复和 MCP 本地配置诊断，并验证归档跨页面重载后保留项目身份与会话历史。项目级存储隔离、备份导入导出和默认只读权限已有代码与测试依据。客户端身份管理、配置向导、能力检测、连接日志和真实客户端运行尚未完成或验证，因此不能认定阶段 6 已通过。

## 基线与工作区

| 项目 | 实际值 |
| --- | --- |
| 候选分支 | `release-candidate/third-round-stage5-baseline` |
| 本阶段修改前 HEAD | `5ca5bfadbfbae92945b1ba0edfabc05a787c08bf` |
| 修改前远程候选 HEAD | `5ca5bfadbfbae92945b1ba0edfabc05a787c08bf` |
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

## 阶段 6 目标核对

| 目标 | 状态 | 证据或限制 |
| --- | --- | --- |
| 多项目创建与切换 | VERIFIED | 现有项目库 UI 和隔离测试 |
| 项目唯一 ID 与独立本地存储 | VERIFIED | 浏览器项目隔离测试 |
| 项目级 MCP 读取范围 | VERIFIED | MCP 固定项目 ID 校验测试 |
| 项目归档与恢复 | VERIFIED | Chromium 页面重载后恢复测试，保留相同项目 ID、会话及版本 |
| 项目备份导入与导出 | VERIFIED | Chromium 项目库回归测试 |
| 多个独立 MCP 实例 | PARTIAL | 实例可分别配置项目范围和工具授权；`--client-id` 仍是未认证标签 |
| 客户端身份管理 | NOT VERIFIED | 尚无认证的客户端注册、凭据、撤销或身份验证流程 |
| MCP 配置向导 | PARTIAL | 项目页可生成 Codex TOML 与通用 JSON stdio 示例；不会写入用户配置。Claude Code、WorkBuddy 与其他客户端的版本兼容性 NOT VERIFIED |
| MCP 健康检查 | VERIFIED, LIMITED | 本地 `--check` 覆盖备份、收件箱解析、项目范围和工具授权配置，不代表外部客户端连接成功 |
| 外部客户端能力检测 | NOT IMPLEMENTED | 本阶段没有探测 WorkBuddy、Codex、Claude Code 或其他客户端；只能检查 ThreadPack 本地配置 |
| 配置诊断 | PARTIAL | 可诊断 ThreadPack 本地文件和权限参数；不解析用户级客户端配置。CLI 保持通用错误隐藏，不输出未筛选的底层错误 |
| 持久连接日志 | NOT IMPLEMENTED | 项目候选与任务审计不是客户端连接日志 |
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
| 产品源码与文档的 `git diff --check` | VERIFIED | 不含发布目录原始运行日志 |
| Firefox、WebKit、Linux | NOT VERIFIED | 本次未执行 |
| 外部 MCP 客户端与真实模型调用 | NOT VERIFIED | 本次未执行 |

`e2e-project-archive-stale-port.log` 保留了一次测试环境失败记录。Playwright 复用了 4318 端口上的旧预览服务器，因此页面快照不含候选构建中的归档控件。随后改用隔离的 43917 与 43918 端口运行归档专项和项目库套件，分别 1/1 与 7/7 通过。首次调用 Playwright 时因使用了未配置名称的 `chromium` 项目而退出，随后依照配置设置 `THREADPACK_BROWSER=chromium` 重跑。上述失败均未被计入通过结果。

配置引导迭代中，在 8 个 worker 下运行 Chromium 项目库套件时出现 6 项超时，记录在 `e2e-project-library-8worker-timeout.log`。使用相同测试、单 worker、独立端口重跑后 8/8 通过，结果保存在 `e2e-project-library-wizard-final.log`。单独的配置引导专项也通过。没有跳过或删除测试。

保留原始运行日志会带入少量终端格式化空格，因此对全部暂存文件运行 `git diff --cached --check` 会报告日志行末空格和空白尾行。产品源码、测试源码、README、架构、路线图、验收矩阵和报告本身已单独通过 whitespace 检查；未改写原始输出以消除这些日志特征。

本地检查确认 `origin/main` 保持原 SHA。候选代码提交 SHA 会在实现提交完成后写入本报告；文档更新提交记录本报告和路线图的后续修订。

## 风险与剩余工作

1. **P1（既有边界）** 客户端标签并非认证身份。当前机制只适用于用户控制的本地 stdio 进程和受操作系统权限保护的文件，不能作为多用户或远程授权边界。
2. **P2** 配置向导只生成手动粘贴的示例，尚无客户端注册/撤销界面、能力探测或持久连接日志。
3. **P2** 归档仅整理 ThreadPack 活动列表，不会撤销共享 MCP 文件连接。UI 已对此作出提示。
4. **P2** 本次只在 Windows Chromium 环境验证，Linux、Firefox、WebKit 与真实外部 AI 客户端均未验证。
5. **P3** `--check` 对预期错误使用 CLI 现有的通用错误隐藏行为，失败可识别但原因可能需要手动检查参数和文件。

没有发现本次改动造成的 P0/P1 缺陷。由于阶段目标中的身份管理、向导、能力检测、连接日志和客户端实机验证仍缺失，阶段 6 保持 IN PROGRESS，不能以本报告宣布阶段完成或正式发布。

## 提交记录

| 项目 | 结果 |
| --- | --- |
| 阶段实现提交 | 归档与诊断 `2b2d9f80d4d3b39799ec7150101b32203bd0a305`；项目范围 MCP 配置引导 `b4d1ef6728df8203ecb73e6a8e473378dddab455` |
| 报告与路线图提交 | 本报告及路线图在实现提交之后另行提交，SHA 由其 Git 历史记录 |
| 候选分支 | `release-candidate/third-round-stage5-baseline` |
| 远程推送 | 仅推送候选分支，不触及 `main` |

下一步继续阶段 6 的客户端配置和可观测性工作，并以真实、获授权的客户端能力验证为准。后续阶段不得把本报告列出的 NOT VERIFIED 项改写成已支持能力，除非补充新的可复核证据。
