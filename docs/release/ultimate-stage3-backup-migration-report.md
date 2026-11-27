# ThreadPack 阶段 3 验收报告：完整备份、恢复与历史迁移

日期：2026-11-28

## 验收结论

**CONDITIONAL PASS**

本阶段实现了 v1–v8 项目备份导入到当前 v9 格式、确定性迁移账本、v9 有序完整性 manifest、损坏备份拒绝和失败暂存清理。代表性合成历史在 Chromium、Firefox 和 WebKit 验证通过。旧格式确认和生命周期状态导入后保持未认证，迁移账本和历史事实均保留。

条件项是 Linux、真实历史备份语料、磁盘耗尽和任意时点进程强制终止尚未验证。失败导入可用未修改的源备份重试，已经写入的隐藏暂存项目不会被项目列表当成完整项目。系统没有实现从持久化游标继续同一次大型导入，暂存项目在过期清理前最多保留 24 小时。

## 基线和保护范围

- 仓库：`hajimi1214/ThreadPack`
- 候选分支：`release-candidate/third-round-stage5-baseline`
- 阶段 3 开始提交：`35786ea6e5f16b4b81d26af872890aa1c3e9fbf0`
- 阶段 2 源码提交：`59ecf052f508e7425af2f53bd797a44d724ad0b5`
- 阶段 3 源码提交：`e534644a0e2d148456f4595ac80b0fc525b1dee5`（`feat: add v9 project backup migration ledger`）
- 远程 `main`：`77a197696480e8edebdc9bde7bca43443d3a759b`
- 阶段 3 不提高 IndexedDB 版本，仍为 v7，避免旧应用因数据库降级而不能打开项目。
- 阶段 3 代码和测试在上述候选 worktree 修改。原始 `main` worktree 未修改，main 分支未重置或覆盖。
- 阶段 3 报告、验收日志和路线图随后的文档提交会推送到同一候选分支。

## 实现结果

### v1–v8 历史导入

同一恢复入口继续接受备份版本 v1–v8。恢复会验证格式字段、记录顺序、项目计数、会话与 revision 连续性、revision 内容 SHA-256、memory fingerprint、严格 evidence 绑定、任务与候选更新关联，以及 v8 trust event chain。

导入生成新的项目副本，原文件和已有项目不会被覆盖。旧版 `confirmed` 声明保留为状态历史，但 `confirmationTrust` 降级为 `legacy-unverified`。旧版终态记录的 `lifecycleTrust` 同样不获得本地认证。v8 随备份提供的密钥和签名链经过完整性校验后仍标记 `untrusted-import`，只有用户在本地显式重新信任后才可复核。

浏览器合成夹具分别覆盖 v1 到 v8 的 header 能力差异、会话/revision、memory 记录、迁移来源、计数及未认证确认状态。真实历史用户备份语料没有纳入本次验证。

### v9 完整性与迁移账本

项目备份升级到 JSONL v9。末尾 manifest 使用逐条 SHA-256 digest 链绑定已验证记录顺序和各类型记录计数。revision digest 引用已经验证的内容 fingerprint 及固定元数据，避免为清单再次序列化大型对话正文。manifest 仅用于完整性和遗漏检测，不提供身份认证或内容真实性证明。

每次成功导入会在现有项目记录的可选 `migrationHistory` 字段中原子保存迁移事件。事件包含确定性 ID、源格式版本、源备份摘要、各类型记录数量、规则版本、信任处置和导入时间。项目恢复发布时，同一项目记录事务同时写入迁移账本并清除暂存标记。重复迁移 ID 和备份内部重复 ID 会被拒绝，单测验证相同来源产生相同迁移 ID，浏览器恢复测试验证重复迁移事件被拒绝。该可选字段不会改变 IndexedDB v7 schema，旧应用可以忽略未知字段。

Browser restore 和 MCP backup reader 共用 `src/projects/backup-format.ts` 的 digest、manifest 和 migration record 规则。MCP 对 v9 migration 记录及 manifest 执行验证，清单不匹配时不向客户端提供上下文。

### 失败与重试

恢复先创建隐藏暂存项目，验证整个输入和关系后才发布。损坏 manifest、记录不全或结构关系错误时进入失败清理路径，暂存 project、session、revision、memory、trust、update、claim 数据一并移除。浏览器测试对比损坏导入前后项目记录计数，在同一原始有效备份上重试成功，再导出并恢复该项目，最后验证重复迁移事件拒绝且已发布项目与历史记录保持原样。本轮还发现并修复了从导入项目再次导出时 trust event 外层项目标识校验不一致的问题。

受控异常失败和用户重新选择原始备份的重试已验证。操作系统强制结束进程、磁盘空间不足、浏览器崩溃期间的恢复和进度游标续传 **NOT VERIFIED**。恢复失败不会修改原备份，但当前实现是重新从文件头校验并导入。

## 十五项目标对照

| 项目 | 结论 | 证据/限制 |
| --- | --- | --- |
| v1–v8 历史格式导入 | VERIFIED | 合成夹具逐格式在三浏览器迁移用例通过；真实存档语料 NOT VERIFIED |
| 新版备份格式 | VERIFIED | v9 JSONL manifest、迁移记录、信任状态和历史计数由浏览器往返及 MCP 测试覆盖 |
| 迁移版本记录 | VERIFIED | `migrationHistory` 保留源/目标版本、规则版本、计数、摘要和信任处置 |
| 幂等标识与重复拒绝 | VERIFIED | migration ID 由源版本、源摘要和目标版本确定；同一项目账本和备份内重复 ID 拒绝 |
| 中断后恢复 | CONDITIONAL | 文件未变，可重新选择原备份开始一次新的恢复；持久化游标续传 NOT VERIFIED |
| 迁移前备份 | VERIFIED | 导入只读取用户选择文件，导出仍为独立下载；源文件保护由恢复流程验证 |
| 回滚 | CONDITIONAL | 损坏导入暂存回滚通过，数据库 schema 保持 v7；旧二进制应用回滚实机验证 NOT VERIFIED |
| 迁移前后记录数量 | VERIFIED | v1–v8 header 计数及 v9 manifest 逐类型计数验证，损坏清理计数回归通过 |
| 证据指纹 | VERIFIED | revision、memory、update、claim、trust 和 manifest fingerprint 在恢复/MCP 校验 |
| 确认事件 | VERIFIED | v9 签名链往返；导入保留事件但不认证本机身份 |
| 拒绝和撤销历史 | VERIFIED | 生命周期浏览器回归验证 rejected、revoked、superseded 历史保留 |
| 密钥和签名状态 | VERIFIED | v9 trust state/event 链验证，恢复后为 untrusted-import；重新信任需用户操作 |
| 不可信内容 | VERIFIED | 历史引用仍按 evidence binding 与 relation 分离，导入不升级支持关系或事实认证 |
| 损坏备份拒绝 | VERIFIED | v9 manifest 篡改后恢复失败、暂存回滚，原始有效文件重新导入成功；MCP 返回通用错误 |
| 旧版导入不提升信任 | VERIFIED | v1–v8 生成项目的旧 confirmed 记录保持 `legacy-unverified` |

## 测试证据

执行环境为 Windows，Node.js 满足仓库 engines。浏览器使用当前安装的 Chromium、Firefox 和 WebKit。所有迁移样本为合成数据。

| 命令/测试 | 结果 |
| --- | --- |
| `npm run check` | VERIFIED，退出码 0 |
| `npm test` | VERIFIED，247/247 通过，失败 0，跳过 0 |
| `npm run build` | VERIFIED，TypeScript、Vite Web 和 CLI 构建成功 |
| 迁移账本单测 | VERIFIED，相同来源摘要生成相同 migration ID；格式与项目身份校验通过 |
| MCP v9 migration/manifest 专项 | VERIFIED，1/1 通过；篡改 manifest 时返回拒绝上下文的 JSON-RPC 错误 |
| Chromium `project-memory.spec.ts` | VERIFIED，19/19 通过 |
| Firefox `project-memory.spec.ts` | VERIFIED，18 通过、1 项隔离设备恢复能力跳过 |
| WebKit `project-memory.spec.ts` | VERIFIED，18 通过、1 项隔离设备恢复能力跳过 |
| v1–v8 迁移与 v9 损坏恢复用例 | VERIFIED，三个浏览器均 2/2 通过 |
| Linux | NOT VERIFIED |
| 真实历史存档集合 | NOT VERIFIED |
| 任意时点 kill、磁盘耗尽和崩溃恢复续传 | NOT VERIFIED |

可复核日志位于 `docs/release/evidence/ultimate-stage3/`。Playwright 为避免复用旧预览服务器导致代码版本不一致，按浏览器使用独立端口并以单 worker 执行。Firefox/WebKit 各跳过的隔离设备密钥重新信任用例属于浏览器 API 能力限制，v8 迁移自身和 v9 恢复用例没有跳过。

## 风险与问题分级

- P0：未发现。
- P1：未发现本阶段已验证范围内的数据丢失或信任升级缺陷。
- P2：Linux 无运行证据；没有覆盖用户真实历史备份的兼容语料；恢复不是游标续传；任意进程终止和磁盘耗尽未实际验证；旧二进制对 v7 数据库回滚未进行独立执行验证。
- P3：manifest 和 migration 摘要为 SHA-256 完整性信息，不证明现实身份或事实真实性。

## 下一阶段

阶段 4 目标为统一 Browser UI、Markdown、JSON Context Pack、MCP、Tasks、Agent Handoff 与备份的唯一可信状态投影，并验证筛选、来源、可信状态、版本追溯与上下文预算一致性。开始前以阶段 3 候选提交为基线。
