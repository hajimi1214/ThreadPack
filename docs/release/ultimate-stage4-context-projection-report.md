# ThreadPack 阶段 4 验收报告：统一项目记忆与上下文投影

日期：2026-11-28

## 结论

**CONDITIONAL PASS**

在候选 worktree 中建立了共享的项目记忆投影，并将浏览器项目记忆界面、Markdown 上下文、JSON Context Pack、MCP Context 和 MCP Tasks 接入该投影。筛选、过期状态、历史状态、确认信任、证据绑定/关系和增量变化由共同逻辑解释。Windows 上类型检查、全量单元/MCP 测试、生产构建和三种 Playwright 浏览器验证通过。

条件项是 Linux 环境和真实客户端端到端接续没有在本阶段运行。Context baseline 是客户端提供的比较输入，状态 key 是确定性变化检测值，不构成认证或抗碰撞安全证明。数据状态只有在本地存储更新完成后重新生成投影才能反映更新。

## 基线与保护范围

- 仓库：hajimi1214/ThreadPack
- 候选分支：release-candidate/third-round-stage5-baseline
- 阶段 4 基线提交：a231b1d67deb76f40216a92d95ac135c03168cbf
- 阶段 4 本地候选 worktree：D:\Github项目\ThreadPack-阶段资料\发布候选\第三轮第五阶段
- 远端 main：77a197696480e8edebdc9bde7bca43443d3a759b
- 原始 main worktree HEAD：2ce4bff99a59d51fefb424eed2cfabeba37af4c1，已有本地提交和未提交修改均未触碰。
- 完成前候选 worktree HEAD：a231b1d67deb76f40216a92d95ac135c03168cbf；阶段实现及验收报告已在后续候选提交中记录。

## 实现

src/projects/memory-projection.ts 负责创建只读、纯函数式的项目状态投影，规范化当前与终态事实、到期状态、AI 来源声明、确认/生命周期信任、证据 binding/relation，以及结构化筛选。来源过滤的组合条件必须由同一条证据满足。

src/projects/memory-context.ts 根据该投影生成带有可信状态标识、来源信息、信任边界、冲突提示、预算和遗漏统计的上下文，并计算与基线的差异。baseline 按项目绑定，输入结构经过严格检查。增量结果区分新增、修改、首次终态化、既存终态历史修改、移除和相关冲突。已经处于拒绝/废弃/过期等终态的记录若有变化，也会进入历史变化集；它仍只作为历史资料输出。

src/projects/memory-export.ts 使用投影状态 key 校验 Markdown 输入快照和 JSON 包记录。导出前重新计算状态，内容或事实状态过期时拒绝导出。空项目也使用其明确的项目 ID 构造投影，允许导出不含事实的上下文包，同时阻止该包被另一个空项目复用。增量包仅携带符合上下文预算的终态历史变化。浏览器记忆面板共享投影用于状态展示和过滤。异步读取有序号保护，迟到的旧响应不能覆盖较新的面板数据。项目保存或刷新时禁用生成与导出按钮，避免用更新前快照生成交接。

MCP 的 threadpack_project_context 和 threadpack_project_tasks 使用同一投影和过滤规则。任务输出仅包含符合当前任务状态条件的项目记录，历史文本和工具输出仍标记为数据，不授予执行权限。MCP 更新收件箱和审核流程没有在本阶段改变。

## 证据解释边界

- 来源绑定只证明精确绑定规则匹配，不证明语义相关或支持某项事实。
- 证据 relation 不会因为进入投影而升级。无效 binding 时 relation 降为 unverified，basis 归为 none。
- AI 来源事实若旧数据自称 confirmed，会在投影中降至待审并保留 storedStatus 警告，不伪造持久化的用户状态变更。
- 经有效本地事件签名确认的 AI 来源候选可在当前投影中显示为用户签名确认状态，不再误标为未确认的 AI proposal。
- 已确认事实仅表示用户确认记录状态，不等同于独立验证。
- 终态历史作为历史资料展示，不能成为当前指令。
- projection stateKey 和单记录 recordKey 使用确定性变更检测摘要，仅用于状态比较。它们不是签名、身份验证或安全完整性承诺。MCP 的用户授权仍由既有服务配置与访问边界执行。

## 文件审查

### 产品源码与测试

- src/projects/memory-projection.ts：新增规范投影、状态 key、项目绑定基线、差异计算与筛选。
- src/projects/memory-types.ts：新增投影、筛选、基线和历史变化类型。
- src/projects/memory-context.ts：生成器改为使用规范投影，修复筛选组合和历史增量边界。
- src/projects/memory-export.ts：Markdown/JSON 导出改用投影状态与一致性检查。
- src/projects/ProjectMemoryPanel.tsx：展示投影状态，增加过滤及增量基线 UI，防止旧异步响应覆盖新状态及刷新期间旧快照导出。
- cli/mcp-server.ts：MCP Context 与 Tasks 接入规范投影，增加来源与信任筛选。
- src/locales/en.ts、es.ts、fr.ts、ja.ts、zh.ts：补齐增量与筛选界面文字。
- src/projects/projects.css：增量与筛选控件样式。
- tests/project-memory.test.ts：测试状态规范化、跨项目基线、终态历史变化、筛选、空项目包项目绑定及预算边界。
- tests/mcp.test.ts：测试 MCP projection/Tasks、筛选和状态信任输出。
- tests/browser/project-memory.spec.ts：测试面板恢复、拒绝状态、增量导出、异步读取及用户交互。

### 验收证据

原始执行日志保存于 docs/release/evidence/ultimate-stage4/，SHA-256 清单见同目录的 SHA256SUMS.txt。阶段验收时的单元/MCP、类型检查和构建日志分别为 unit-tests-final.txt、type-check-final.txt、build-final.txt。对两处发现的导出边界修复后，候选复测日志为 unit-tests-candidate.txt、type-check-candidate.txt、build-candidate.txt。三浏览器的受影响流程复测记录于 browser-<engine>-candidate.txt，Chromium 完整套件记录于 browser-chromium-full-candidate.txt。

| 验证 | 结果 |
| --- | --- |
| Windows 11，Node.js v24.14.1，npm 11.11.0 | VERIFIED |
| npm run check | VERIFIED，候选复测退出码 0 |
| npm test | VERIFIED，候选复测 253/253 通过，失败 0，跳过 0 |
| npm run build | VERIFIED，候选复测的 TypeScript、Web single-file 和 CLI 生产构建成功 |
| MCP 专项 | VERIFIED，纳入 253 项全量测试；包括统一 Context/Tasks 投影、访问模式、候选 inbox 和备份校验 |
| Chromium project-memory.spec.ts | CONDITIONAL，完整套件 22 项，21 项通过，1 项首次失败后重试通过，0 跳过；候选复测日志记录首次失败。导出及增量核心流程单独 3/3 通过 |
| Firefox project-memory.spec.ts | CONDITIONAL，候选导出修复前的完整套件 19 pass、1 platform skip、1 flaky retry pass；修复后的受影响流程 3/3 通过；browser-firefox-serial-final-normalized.txt、browser-firefox-candidate.txt |
| WebKit project-memory.spec.ts | CONDITIONAL，候选导出修复前的完整套件 17 pass、1 platform skip、3 flaky retry pass；修复后的受影响流程 3/3 通过；browser-webkit-serial-final-normalized.txt、browser-webkit-candidate.txt |
| Chromium、Firefox、WebKit 受影响导出和增量流程 | VERIFIED，每种浏览器 3/3 通过，包括新增空项目 Context Pack 回归；日志为 browser-<engine>-candidate.txt |
| 恢复、迁移和大文件持久化回归 | VERIFIED，阶段 3 已有真实浏览器证据；本阶段全量测试及项目记忆浏览器套件继续覆盖备份恢复入口 |
| Linux 构建及测试 | NOT VERIFIED |
| WorkBuddy、Codex 或 Claude Code 对本阶段投影进行真实客户端接续 | NOT VERIFIED，本阶段未运行真实客户端 |

若浏览器套件报告个别平台能力 skip，日志记录的 skip 必须保留并按实际平台能力解释，不以另一浏览器通过代替。候选 Chromium 完整套件有一次异步恢复用例首轮失败，CI 重试通过；Firefox/WebKit 的完整套件是在导出边界修正前执行，flaky 及 retry 记录保留。修正后的相关导出逻辑已在三种浏览器中聚焦复测通过。

## 重点回归

- 用户拒绝、撤销、替代及过期事实不会作为当前事实进入投影，历史状态按历史引用呈现。
- 无效/缺失证据绑定不会被表示为语义支持。
- 项目筛选和证据来源筛选必须落在同一个来源证据上，避免将不同 evidence 字段组合拼接为伪命中。
- 增量模式在 Markdown、JSON 和 MCP 结构化结果中输出同一变化集合，并把已有终态记录的状态变化保留为历史更新。
- Context Pack 校验投影状态和源项目状态，旧快照过期时拒绝导出。
- 无事实的空项目可以导出带有正确项目标识的 Context Pack；增量终态历史受预算约束，不会在 JSON 包中泄露未进入预算的历史记录。
- WebKit 异步数据库读取 race 由读取序号保护；刷新或保存过程中禁用陈旧上下文生成与下载。
- 既有备份 schema、IndexedDB 版本和迁移实现未更改。

## 问题分级与限制

- P0：未发现本阶段已验证范围内的严重数据安全或隐私问题。
- P1：未发现阻断性错误。
- P2：Linux 没有本地运行证据；Chromium 候选完整套件有 1 项首次失败、重试通过，Firefox 原完整套件有 1 项、WebKit 原完整套件有 3 项重试通过；真实多客户端接续未运行；baseline 和 state key 不具备认证能力；基线采用客户端导入/导出，尚不提供跨进程自动同步。
- P3：结构化筛选暂不覆盖用户定义的任意布尔表达式，搜索仅使用确定性文本匹配。

本阶段不进入客户端身份认证、多客户端写回或冲突解决引擎。无授权的 AI 自动写回仍不支持。

## 后续

阶段 5 继续建设多 AI 双向协作引擎。必须基于阶段 4 的候选提交继续，逐步建立客户端身份登记、项目权限、候选更新审批、幂等、冲突处理和审计能力。真实客户端验证仍需要各目标客户端及明确授权。
