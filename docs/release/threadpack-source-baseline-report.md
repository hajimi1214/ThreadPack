# ThreadPack 第三轮第五阶段整改 · 第一阶段源码基线报告

日期：2026-11-24（Asia/Shanghai）
审查范围：原始工作区的全部源码、文档、测试及两个未跟踪文件。
候选分支：release-candidate/third-round-stage5-baseline

## 1. 原始基线与远程关系

- 仓库：https://github.com/hajimi1214/ThreadPack.git
- 原始审计 HEAD：2ce4bff99a59d51fefb424eed2cfabeba37af4c1
- 审计时 origin/main：77a197696480e8edebdc9bde7bca43443d3a759b
- 原始 main 分支领先远程 11 个提交，落后 0 个提交。
- 原始工作区有 19 个已修改文件，无暂存改动，另有 2 个未跟踪浏览器测试文件。
- 原始 main 工作区仍完整保留这些修改。候选通过独立 worktree 建立，没有 checkout 覆盖、reset、clean 或删除操作。

11 个领先提交，按从旧到新排列：

| 短 SHA | 完整 SHA | 提交说明 |
|---|---|---|
| ef93e68 | ef93e68db39d499833c924b4413687351c59b12c | fix: improve large archive and browser stability |
| 869fce2 | 869fce2dc776680403d74695250d1ee8b544bc85 | fix: preserve original file byte statistics |
| ce3e079 | ce3e079681aebb572938fad55aea20c50fbd4ebc | feat: preserve multi-platform session structure |
| 097b45a | 097b45aa67748206a8e6b7afd3954f800dafbb28 | feat: add durable local project memory |
| 8fd9269 | 8fd9269cc0fc48fc6fedc916db3684ed03fc0ef6 | feat: add evidence-based project memory |
| ffe4f85 | ffe4f8525753b39d521353fbe553772207e49cd4 | feat: export portable cross-ai context packs |
| 838f11e | 838f11eb55979648194e7ae4bd46fcdf3b317f27 | fix: refresh project metadata on duplicate imports |
| e57e51f | e57e51f689ea957e28019a96b65ced58416943ed | fix: restore large project sessions reliably |
| 709736a | 709736a9cc384a111d7f57dd929f1bafca9b9b19 | fix: keep project memory exports consistent |
| 2964c5c | 2964c5c0cedd7016068f4b018bb8ed7b2e4b0338 | security: mark context package data as untrusted |
| 2ce4bff | 2ce4bff99a59d51fefb424eed2cfabeba37af4c1 | feat: add authorized local MCP context bridge |

此前独立审计未能从本地历史、文档或代码恢复原始第六阶段目标。本报告不推测阶段六目标。

## 2. 原始状态备份

原始状态已完整保全至：

D:\Github项目\ThreadPack-source-baseline-backup-20261124-190319

内容包括：

- repository.bundle：完整 Git refs、领先提交和 tags。git bundle verify 通过，包含完整历史。
- complete-workspace.tar.gz：完整原始工作树归档，包含 Git 元数据、忽略目录和文件。
- worktree.patch：相对原始 HEAD 的二进制安全差异。
- staged.patch、unstaged.patch：原工作区没有暂存修改，两者均为 0 字节。
- untracked-files：两个未跟踪浏览器测试的逐文件副本。
- original-test-records：49 份 artifacts-*.log 原始测试记录。
- Git status、revision、ahead/behind 和备份 SHA-256 清单。
- 初始备份 SHA-256 清单包含 59 个构件，逐项复核无失败。另从完整归档提取 21 个受审文件并与原始工作区逐字节比较，差异为 0；比较副本保存在 workspace-source-verification。

原始 worktree.patch 保持不变。Windows 命令行备份写入时将补丁行尾转成 CRLF，故另生成 worktree-lf.patch，仅规范化行尾。该副本应用检查通过，随后按它在原始 HEAD 上恢复候选内容。

## 3. 全部修改文件审查

| 文件 | 修改类型/原因 | 产品行为影响 | 测试结果影响 | 保留 | 是否需重新验证 |
|---|---|---:|---:|---|---|
| README.md | 文档：实时 MCP、任务协作、支持限制 | 否 | 否 | 是 | 发布前核对文档与行为 |
| README.zh-CN.md | 中文版对应能力和限制 | 否 | 否 | 是 | 发布前核对中文术语 |
| SECURITY.md | 新增共享文件、只读、租约、身份与权限边界 | 否 | 否 | 是 | 后续安全审查复核声明 |
| cli/index.ts | 更新 MCP 参数和帮助 | CLI 帮助输出 | 帮助测试 | 是 | CLI 帮助测试已覆盖 |
| cli/mcp-server.ts | 快照读取、候选写入、锁/幂等、任务租约、只读、备份和信任校验 | 是 | 是 | 是 | check/unit/build 通过；真实客户端待后续 |
| src/App.tsx | 分块 UTF-8 字节统计，降低大文本临时分配 | 是，大小统计 | 是 | 是 | check/unit/build 已通过 |
| src/locales/en.ts | 英文共享/认领/审核文案 | 仅文案 | 字典完整性 | 是 | 字典测试已覆盖 |
| src/locales/es.ts | 西班牙文对应文案 | 仅文案 | 字典完整性 | 是 | 字典测试已覆盖 |
| src/locales/fr.ts | 法文对应文案 | 仅文案 | 字典完整性 | 是 | 字典测试已覆盖 |
| src/locales/ja.ts | 日文对应文案 | 仅文案 | 字典完整性 | 是 | 字典测试已覆盖 |
| src/locales/zh.ts | 中文对应文案 | 仅文案 | 字典完整性 | 是 | 字典测试已覆盖 |
| src/projects/ProjectLibrary.tsx | 共享连接、候选审查、任务认领活动 UI | 是 | 浏览器流程 | 是 | 本阶段禁跑；后续浏览器 E2E |
| src/projects/limits.ts | 共享上限和分块 UTF-8 字节计数 | 是 | 是 | 是 | check/unit/build 已通过 |
| src/projects/memory-types.ts | 审计、租约及证据来源类型 | 无独立运行时行为 | 类型检查 | 是 | check 已通过 |
| src/projects/projects.css | 共享、候选和任务面板样式 | 仅视觉 | 浏览器视觉 | 是 | 本阶段禁跑；后续视觉/E2E |
| src/projects/store.ts | IndexedDB 迁移、共享备份、候选状态机/恢复、租约、v7 备份 | 是，数据核心 | 是 | 是 | check/unit/build 已通过；后续并发/浏览器复验 |
| src/worker/engine.ts | 分块 UTF-8 会话大小检查 | 是，大小测量 | 是 | 是 | check/unit/build 已通过 |
| tests/mcp.test.ts | 收件箱、并发/幂等、租约、只读和信任边界回归 | 否 | 是 | 是，fixture 待负责人确认 | 197 项测试通过；Ubuntu MCP 专项 8 轮 |
| tests/project-memory.test.ts | UTF-8 代理项边界测试 | 否 | 是 | 是 | unit 已通过 |
| tests/browser/project-coordination.spec.ts | 任务认领、审核、冲突、备份恢复 E2E | 否 | 新增覆盖 | 是 | 本阶段禁跑；后续运行 |
| tests/browser/project-shared-state.spec.ts | 共享文件、收件箱、审核恢复 E2E | 否 | 新增覆盖 | 是 | 本阶段禁跑；后续运行 |

合计为 19 个原修改文件和 2 个原未跟踪测试文件。没有发现额外的未跟踪源码或配置文件。

## 4. tests/mcp.test.ts fixture 独立审查

Linux 审计测试发现的 fixture 差异如下：

- 并发测试中 Codex 的初次幂等键为 codex-task-claim。
- Claude Code 的初次幂等键为 claude-task-claim。
- 胜出的客户端若为 claude-code，旧 fixture 通过字符串拼接生成 claude-code-task-claim。这与首次请求键不同，因此不是幂等重试。产品拒绝该请求是正确行为。
- 当前 fixture 根据胜出客户端选择首次请求的原键，再验证响应为 already-recorded。
- 伪造其他客户端释放的拒绝断言、并发互斥断言、所有其他测试断言均保留，且新增了事件审计和十轮租约循环测试。
- 调整只改变测试请求参数，不修改生产代码、条件、断言数量或通过标准。
- 修正后 Ubuntu MCP 专项重复执行 8 轮，每轮 5/5 通过；候选单元测试 197/197 通过。

判断：这是一项对测试竞争 fixture 的必要修正，没有证据显示其掩盖产品缺陷。因原任务要求原则上只读，仍由负责人决定是否批准保留。

## 5. 独立候选分支与提交

- 候选分支：release-candidate/third-round-stage5-baseline
- 候选源码及测试提交 SHA：0259745261b34386722184aca5964e2434f43f70
- 该源码提交以原始审计 HEAD 为父提交，包含上述 19 个修改文件和 2 个新增测试文件，共 21 个路径。
- 提交前在候选 worktree 执行了 npm run check、npm test、npm run build，分别通过；npm test 为 197/197。依本阶段约束，未运行浏览器测试。
- 本报告为单独的审计文档提交。代码/测试候选 SHA 保持为上面的 SHA；分支最终 HEAD 是源码提交加报告提交，handoff 会同时提供。
- 源码候选暂存区通过 git diff --cached --check。报告文档提交后复核最终候选 worktree：干净，无 staged、unstaged 或 untracked 文件。
- docs/release 报告路径被原有 .gitignore 的 release/ 规则匹配。仅对用户指定的这一个报告文件使用 git add -f；未修改忽略规则，也未添加发布目录或发布产物。

## 6. 未解决项与第二阶段前置条件

1. 负责人审核本表全部 21 个路径，并决定是否接受 MCP fixture 修正及候选源码提交 0259745261b34386722184aca5964e2434f43f70。
2. 第二阶段真实 Claude Code MCP 接续测试需要 relay 确认兼容 Claude Code CLI 的模型解析路径。此前直接 /v1/messages 调用可成功，但 Claude Code CLI 对该模型返回 HTTP 404。需先确认可用模型名/别名与 Anthropic-compatible base URL，再按负责人授权的费用上限测试。
3. 需真实客户端从共享状态读取项目、提交一个经用户审查的候选更新，并由另一真实客户端读取相同更新后接续。
4. 真实供应商导出样本须获授权并适当脱敏。合成样本不得替代该项证据。
5. Firefox、WebKit、Linux 浏览器矩阵仍需后续验证。
6. 原始第六阶段目标继续待项目负责人确认。

本阶段只建立本地候选源码基线，不表示产品发布通过。没有推送、合并、发布或部署。
