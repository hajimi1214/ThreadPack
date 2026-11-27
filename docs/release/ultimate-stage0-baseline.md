# ThreadPack 源码冻结与开发基线报告

审计日期：2026-11-27（Asia/Shanghai）

阶段：长期目标阶段 0

阶段结论：**PASS，候选源码具备本地冻结条件**

本文区分 **VERIFIED**（当前代码/命令/运行结果直接证明）、**FAILED**（当前未满足）和 **NOT VERIFIED**（缺少充分证据）。本报告仅涵盖源码保全和冻结基线，不代表 ThreadPack 整体产品已通过发布验收。

## 1. 仓库与提交基线

| 项目 | 结果 |
|---|---|
| 候选 worktree | **VERIFIED** `D:\Github项目\ThreadPack-阶段资料\发布候选\第三轮第五阶段` |
| 候选分支 | **VERIFIED** `release-candidate/third-round-stage5-baseline` |
| 阶段 0 开始时 HEAD | **VERIFIED** `fb72be2e99942f159e8dbccf096f9bc9947c8f77` |
| 远程 origin/main | **VERIFIED** `77a197696480e8edebdc9bde7bca43443d3a759b`，由 2026-11-27 实时 `git ls-remote` 查询确认 |
| 本地 main | **VERIFIED** `2ce4bff99a59d51fefb424eed2cfabeba37af4c1`，本地仍比 origin/main 领先 11 个提交 |
| 候选相对 origin/main | **VERIFIED** 阶段开始时 ahead 15、behind 0，包含 11 个 main 产品提交和 4 个候选基线审计提交 |
| 原始 main 工作区 | **VERIFIED** 保留原 19 个已修改文件和 2 个未跟踪测试文件，HEAD 未变且本阶段未触碰 |
| 阶段 0 源码冻结提交 | **VERIFIED** `97761a3503e2885c1b35e338253459d35dac9213`（完整 SHA 在本报告末尾交付信息中，报告提交 SHA 可由当前 HEAD 查询） |
| 远程写入 | **VERIFIED** 未推送、合并或发布 |

## 2. 阶段 3 修改与差异审查

开始时确认为 14 个已跟踪修改文件和 2 个未跟踪文件。阶段 0 修复和跨浏览器门禁调整后，候选 worktree 共 17 个已修改文件和 2 个新增文件。完整路径和每个文件的 SHA-256 见 `D:\Github项目\ThreadPack-阶段资料\阶段验收证据\ultimate-stage0-candidate-files-sha256.csv`。

| 文件 | 审查结论 |
|---|---|
| `cli/mcp-server.ts` | **VERIFIED** 使用统一消息级证据绑定；静态备份的未认证关系历史降为 unverified；候选 evidence 绑定精确 revision/message/quote |
| `src/projects/evidence-binding.ts` | **VERIFIED** 新增统一绑定核心，校验项目/来源映射、会话、版本、revision、唯一 message ID、消息和 quote 指纹及 UTF-8 字节范围 |
| `src/projects/memory-types.ts` | **VERIFIED** 新增 binding/relation/basis、错误码、来源身份、V2 指纹及审阅事件类型，旧字段仍可读取 |
| `src/projects/store.ts` | **VERIFIED** 浏览器保存、展示、备份恢复和 MCP 候选导入复用验证器。阶段 0 增加遗失/损坏 revision 的可诊断降级，并保持存储错误继续传播 |
| `src/projects/memory-context.ts` | **VERIFIED** source match 本身不再获得支持关系排序加分；旧确认状态明确提示为未认证 |
| `src/projects/memory-export.ts` | **VERIFIED** Markdown 与 JSON 对绑定、关系、可信边界分别表达 |
| `src/projects/ProjectMemoryPanel.tsx` | **VERIFIED** 显示 binding 与 relation 并分开记录用户对事实和证据关系的审阅 |
| `src/projects/ProjectLibrary.tsx` | **VERIFIED** 阶段 0 修复 shared-file UI 对部分 File System Access 实现的误判，检查安全上下文、picker 与 FileSystemFileHandle 的读写和权限方法 |
| `src/locales/en.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/ja.ts`, `src/locales/zh.ts` | **VERIFIED** 为证据关系、来源绑定状态及导入历史提示补齐五种语言文案 |
| `tests/evidence-binding.test.ts` | **VERIFIED** 新增绑定、关系、V1 旧指纹、UTF-8、恶意 evidence、AI 字段拒绝及绑定字段缺失等测试 |
| `tests/mcp.test.ts` | **VERIFIED** 新增 MCP 的精确 messageId/messageFingerprint 校验；V2 fixture 包含真实 quote fingerprint 和 UTF-8 range |
| `tests/project-memory.test.ts` | **VERIFIED** 调整证据状态投影断言；保留 1,000 字符预算，并覆盖整条超长记录省略 |
| `tests/browser/project-memory.spec.ts` | **VERIFIED** 覆盖浏览器恢复、Context Pack、MCP 结果一致性，伪造 relationHistory 安全降级，revision 缺失和损坏时保留事实 |
| `tests/browser/project-coordination.spec.ts` | **VERIFIED** 测试 fixture 仅在原生 picker、OPFS 与文件句柄权限 API 均存在时模拟连接；不再把部分 API 当作完整支持 |
| `tests/browser/project-shared-state.spec.ts` | **VERIFIED** 同一完整能力判定，并将 fallback 断言限制在“Connect live local state”面板 |

未新增第三方依赖，未删除既有断言，也未降低预算或数据完整性条件。最终 `git diff --check` 通过。

## 3. 独立复核发现与处置

### P1：缺失或损坏 evidence revision 导致整个项目记忆读取中断

**VERIFIED CLOSED** 原实现经 `getProjectSession` 读取 evidence，来源被删除或损坏时可能使 `listProjectMemory` 整体抛错。阶段 0 改为读取 session/revision 原始行，明确区分 missing、integrity、structure 和 invalid-content 状态。单条缺失来源保留引用并返回 `unverified/missing_revision`，指纹或结构损坏则返回相应 invalid issue。IndexedDB 访问异常不会被 catch 隐藏。

**VERIFIED** Chromium/WebKit 项目记忆 E2E 验证来源删除后项目和 fact 仍显示，绑定降级为未验证；revision 字节篡改显示 `revision_integrity`。两浏览器均通过。

### P1：MCP/浏览器绑定曾缺少统一精确消息关联

**VERIFIED CLOSED** 浏览器与 MCP 读取/恢复及候选 evidence 采用同一验证器；错误 messageId、重复 ID、错误指纹和另一个消息中的相同 quote 均不能被当成有效引用。来源匹配不产生语义 supports。

### P2：用户 evidence relation 的静态备份认证

**VERIFIED MITIGATED / REMAINS** 本地关系审阅事件能关联 claim 和 evidence 内容指纹，但无密钥备份 fingerprint 不能证明真实设备身份。浏览器备份恢复与 MCP 快照不会认证导入的 supports 事件，关系会降级为 unverified；恶意/伪造事件在 Markdown、JSON Context Pack 和 MCP 全部仍为 unverified。后续需要阶段 1 的签名身份方案完成跨设备认证。

### 证据 revision 缓存审查更正

**VERIFIED** `evidenceReader` 只保留一个 revision 索引，因此先前“多个大型 message Map 同时驻留”的风险判断不成立。交错引用可能重复读取和解析历史 revision，属于尚未测量的性能优化风险，不作为阶段 0 阻断问题。单项缓存维持内存上界。

### 浏览器文件共享能力边界

**VERIFIED FIXED** 早期 UI 只检查 `showSaveFilePicker`，部分浏览器可能暴露 picker 但缺少 ThreadPack 所需的 FileSystemFileHandle 权限方法。产品现在同时校验 read/write、getFile、queryPermission 和 requestPermission。WebKit 无完整 API 时显示本地降级状态；依赖 Chromium 文件句柄权限的端到端协调场景标记 skipped，原因与测试日志可追溯。Chromium 全量对应场景通过。

## 4. 实际验证

运行环境为 Windows 11 / Node.js 24.14.1，项目要求 Node.js >=20.19.0。浏览器测试由 Playwright 本地实际浏览器执行。

| 验证 | 结果 |
|---|---|
| TypeScript：Node 直接运行 `node_modules/typescript/bin/tsc --noEmit` | **VERIFIED PASS**，日志 `verification/build-check-stage0-final.log` |
| 全部 Node 单元测试，18 个文件串行 | **VERIFIED PASS** 223/223，失败 0，跳过 0；日志 `verification/npm-test-serial-stage0-final2.log` |
| 证据绑定 + MCP + 项目记忆专项 | **VERIFIED PASS** 40/40，日志 `verification/focused-stage0-final2.log` |
| Vite 单文件生产构建 | **VERIFIED PASS**，日志 `verification/build-web-stage0-final.log` |
| CLI 构建 | **VERIFIED PASS**，日志 `verification/build-cli-stage0-final.log` |
| Chromium 全量浏览器套件 | **VERIFIED PASS** 92/92，失败 0；日志 `verification/chromium-full-stage0-tracked.stdout.log`，退出码 0 |
| WebKit 全量浏览器套件 | **VERIFIED PASS WITH PLATFORM SKIP** 91 passed、1 skipped、0 failed；日志 `verification/webkit-full-stage0-tracked.stdout.log`，退出码 0 |
| WebKit 跳过项目 | **VERIFIED** `project-coordination.spec.ts` 需要原生 Chromium File System Access permission handle。WebKit 本地降级路径由 `project-shared-state.spec.ts` 的测试实际通过 |
| Firefox | **NOT VERIFIED** 当前 Firefox Playwright browser 无法在 Windows 启动（先前记录为 `spawn UNKNOWN`） |
| Linux | **NOT VERIFIED** 当前 WSL Ubuntu 未安装 Node.js，未执行构建和测试 |
| v1–v8 完整迁移 | **NOT VERIFIED / OUT OF SCOPE FOR STAGE 0** 未触碰真实数据库，未运行完整迁移 |

第一次并行 Node 全量测试因 Windows 子进程异常（退出码 3221226505 / V8 VirtualAlloc failed）失败，原始日志保留于 `verification/npm-test.log`。之后按原 18 个文件串行完整重跑，223/223 通过。测试未删除或弱化。

## 5. 备份与哈希

**VERIFIED** 只读/恢复备份目录：

`D:\Github项目\ThreadPack-阶段资料\阶段验收证据\ultimate-stage0-baseline-20261126`

包括候选所有 Git refs 的 `repository.bundle`、HEAD 与全部已跟踪工作区差异、两个新增源文件副本、第三阶段报告、浏览器/错误轨迹、各次验证日志和 SHA-256 清单。阶段 0 最终校验后，备份含当前差异快照 `source-freeze-commit.diff`，以及 `sha256-manifest-stage0-final.csv`。

**VERIFIED** `git bundle verify` 成功，bundle 包含本地 main、候选分支、origin/main 与版本 tags。

**VERIFIED** `git apply --check --reverse source-freeze-commit.diff` 成功。

**VERIFIED** 候选全部受审文件的 SHA-256 清单位于 `D:\Github项目\ThreadPack-阶段资料\阶段验收证据\ultimate-stage0-candidate-files-sha256.csv`。

原 main 工作区及未跟踪文件均未进入候选操作，也未被覆盖。

## 6. 冻结决定

**PASS**。阶段 0 核心目标已达成：第三阶段全部工作区内容已检查并保全，原 main 未改动，P1 缺陷已修复，核心单测、构建、Chromium 全量浏览器与 WebKit 除一项明确平台能力限制外的全量场景通过，平台能力差异和认证限制均有记录。没有未关闭的 P0/P1 阻断本地冻结。

阶段 0 源码冻结提交 `97761a3503e2885c1b35e338253459d35dac9213` 已包含 17 个已跟踪修改文件和 2 个新增源码/测试文件。本地提交未推送远程。阶段 1 的入口及未解决事项为：本地签名身份、公钥和确认事件、撤销/轮换/恢复策略，以及静态备份中用户关系审阅的可信跨设备验证。Firefox/Linux 与完整数据库迁移仍是后续质量门禁中的未验证事项。

阶段 0 源码冻结提交 SHA：`97761a3503e2885c1b35e338253459d35dac9213`。文档提交完成后，最终候选 HEAD 以 `git rev-parse HEAD` 实时查询结果为准。


## 阶段 1 验收结果（2026-11-27）

阶段 1 在本地候选分支完成，结论为 **PASS**。实现包括 ECDSA P-256/SHA-256 项目签名身份、确认对象和 evidence 指纹、项目隔离信任事件链、防重放与防回滚、事实确认撤销、密钥轮换/撤销、PBKDF2-SHA-256 + AES-256-GCM 加密恢复包和设备重新信任。v8 备份中的自签密钥不会自动成为本地可信身份。用户确认、用户 evidence 关系和独立验证保持不同语义。

阶段 1 源码提交为 `f0023381a1b5901fd0a8feeb276b191f6972a23c`。完整实施与验收报告见 [ultimate-stage1-trust-authentication.md](ultimate-stage1-trust-authentication.md)，可复核的类型检查、单测、构建和浏览器日志保存在 `docs/release/evidence/ultimate-stage1/`。

最新 Windows 验证结果为 TypeScript 检查通过、237/237 Node 单测通过、生产构建通过、Chromium 96/96 通过、Firefox 94 通过且 2 项能力跳过、WebKit 94 通过且 2 项能力跳过。WebKit 使用单 worker 完成全量测试。Linux、真实物理设备间密钥恢复和完整产品验收仍未验证。后续阶段尚未开始。

## 阶段 2 验收结果（2026-11-28）

阶段 2 可信记忆生命周期结论为 **CONDITIONAL PASS**。事实终态、状态历史、拒绝去重、用户显式重新考虑、有效期、用户偏好类别、签名生命周期事件以及 Context、JSON、MCP 和备份中的终态投影已有实际实现和测试。阶段源码提交为 `59ecf052f508e7425af2f53bd797a44d724ad0b5`。详细报告见 [ultimate-stage2-memory-lifecycle-report.md](ultimate-stage2-memory-lifecycle-report.md)。

最终质量门禁：类型检查通过，npm test 245/245 通过，Web/CLI 生产构建通过。Chromium 项目组 26/26 通过；Firefox 项目组 23 通过、2 项平台能力跳过；WebKit 项目组 23 通过、2 项平台能力跳过。Firefox 与 WebKit 的超大项目持久化另有隔离运行通过。Linux 未验证。阶段 3 完整历史迁移尚未开始。

## 阶段 3 验收结果（2026-11-28）

阶段 3 完整备份、恢复与历史迁移结论为 **CONDITIONAL PASS**。项目备份升级为 v9，有序 manifest 校验、确定性迁移账本、v1–v8 格式导入及恢复暂存回滚均已实现。迁移账本作为可选项目记录字段持久化，IndexedDB 保持 v7，避免改动对象 store 版本。导入的旧确认和签名状态继续保持未认证。

阶段 3 源码提交为 `e534644a0e2d148456f4595ac80b0fc525b1dee5`。详细报告见 [ultimate-stage3-backup-migration-report.md](ultimate-stage3-backup-migration-report.md)，设计见 [ultimate-stage3-migration-design.md](ultimate-stage3-migration-design.md)。可复核的检查、247 项单测、构建、MCP 和 Chromium/Firefox/WebKit 项目记忆浏览器日志保存在 `docs/release/evidence/ultimate-stage3/`。

最终 Windows 门禁：类型检查通过、`npm test` 247/247 通过、Web/CLI 生产构建通过。Chromium 19/19；Firefox 18 通过、1 项隔离设备密钥恢复能力跳过；WebKit 18 通过、1 项同类能力跳过。v1–v8 迁移与 v9 损坏恢复专项用例在三个浏览器均 2/2 通过。Linux、真实旧版用户备份集合、任意进程强制终止、磁盘耗尽及从持久化游标续传未验证。阶段 4 统一项目记忆和上下文引擎仍未开始。
