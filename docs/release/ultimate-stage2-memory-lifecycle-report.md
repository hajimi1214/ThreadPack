# ThreadPack 阶段 2 验收报告：可信记忆生命周期

报告日期：2026-11-28

项目：hajimi1214/ThreadPack

候选分支：release-candidate/third-round-stage5-baseline

阶段 2 源码提交：59ecf052f508e7425af2f53bd797a44d724ad0b5

## 验收结论

**CONDITIONAL PASS**

阶段 2 的可信记忆生命周期已实现并验证。事实可被提议、审查、确认、拒绝、撤销、取代和到期。终态历史保留，AI 不能自动确认，也不能用新 ID 自动恢复已拒绝的同一主张。用户可以通过显式链接，以新待审事实重新考虑历史主张。

条件项包括 Linux 缺少运行证据，以及 Firefox/WebKit 两项涉及本地文件/OPFS 能力的测试跳过。WebKit 有个别长组合 suite 的浏览器上下文/工件失败，相关下载、导入竞态和生命周期用例在隔离进程复测通过。未发现本阶段范围内未关闭的 P0/P1。

## 基线与提交

- 阶段 2 开始 HEAD 为 10e6edc956bfc0a79818180fa28d87533df44bda。
- 阶段 2 源码提交为 59ecf052f508e7425af2f53bd797a44d724ad0b5。
- 候选分支为 release-candidate/third-round-stage5-baseline。
- 原始 main 未修改，已有候选提交未被覆盖。
- 阶段验收报告和证据日志会另行提交并推送到同一候选分支。

## 阶段目标核对

| 要求 | 结论 | 实现与验证 |
| --- | --- | --- |
| Proposed / Needs Review / User Recorded / Confirmed | VERIFIED | AI 提取保持 origin=ai、status=proposed。用户未确认录入为 origin=user、status=needs-review。User Recorded 由来源与审阅状态分开表达。Confirmed 必须经过用户操作及本地签名确认。 |
| Rejected | VERIFIED | 用户拒绝产生 rejected 终态及状态历史。原记录、来源和 evidence 保留，状态更新不会删除历史。 |
| Superseded | VERIFIED | 用户纠正时新旧事实通过 supersedes 和 supersededBy 双向关联。原确认追加签名撤销事件。浏览器测试覆盖取代、历史和后续重新考虑。 |
| Expired | VERIFIED | 用户可设置 expiresAt。记忆读取、审核、任务查询、共享更新箱处理和备份导出会惰性物化 expired。Context/MCP 投影也即时过滤到期事实。 |
| Revoked | VERIFIED | 用户撤销事实或已接受客户端更新进入独立 revoked 状态，不与用户拒绝混为一谈。 |
| 用户偏好 | VERIFIED | 新增 preference 记忆类别，覆盖五种 UI 语言、AI 提取候选解析、MCP 候选 schema、上下文和备份。 |
| AI 不自动确认 | VERIFIED | AI 候选写入被强制限制为 proposed。模型输出不能自动改变审阅状态。 |
| 拒绝事实防止换 ID 重入 | VERIFIED | 同一项目内按 NFKC、空格折叠、大小写归一后的主张文本和 task state 检查 rejected、superseded、expired、revoked 历史。重复候选被阻止，语义近似检测仍依赖冲突审核。 |
| 显式重新考虑 | VERIFIED | 用户新建 needs-review 项并用 reconsiders 指向终态旧记录。旧事实只读，历史状态与 evidence 不变。 |
| 冲突处理 | VERIFIED | 冲突事实标记 needs-review；冲突解除不会把剩余事实自动升级为 confirmed。 |
| 生命周期认证 | VERIFIED | 本地信任密钥可用时为拒绝、撤销、过期、取代事件签名，状态历史项绑定事件 ID、哈希和 signer key ID。 |
| 密钥不可用时仍可拒绝 | VERIFIED | 用户仍可拒绝事实。缺少本地签名密钥时结果保留为终态，lifecycleTrust 明确未认证，不显示虚假签名。Chromium、Firefox、WebKit 均有测试。 |
| 确认签名和生命周期签名区分 | VERIFIED | 原确认事件与后续撤销事件分别保存在 trust event chain。过期确认会显示原确认撤销及过期生命周期状态。 |
| Context、JSON 和 MCP 投影 | VERIFIED | 终态事实从当前上下文及任务集合排除。JSON Context Pack 与 MCP 单独给出 historical-only 终态台账，MCP 结构化返回 terminalHistory 和 omissions。 |
| 导入与信任恢复 | VERIFIED | 静态备份的 lifecycleTrust 默认降级未认证。生命周期源项目 ID 保留。使用匹配恢复密钥重新信任后，按原 sourceProjectId 和签名链重新验证。 |
| 项目隔离和持久化 | VERIFIED | 状态和去重查询均限制在项目 ID 内。备份字段向后兼容，无 IndexedDB schema 升级。项目库加载时显示忙碌态，避免异步空列表诱发误建项目。 |
| 历史上限 | VERIFIED | 每个事实的 statusHistory 上限为 10,000 项。达到上限后拒绝新转换，避免静默截断审计历史。 |

类别、来源、生命周期状态、确认认证、生命周期事件认证、evidence binding 和 evidence relation 互相独立。用户的本地签名只证明该项目密钥签署了事件，不证明现实身份或事实真伪。

## 源码变更

阶段 2 源码提交 59ecf052f508e7425af2f53bd797a44d724ad0b5 包含：

- 新增 memory-lifecycle 状态转换、终态判断、到期投影及规范化去重模块。
- 扩展记忆类型，新增 expired、revoked、preference、expiresAt、expiredAt、reconsiders 和 lifecycleTrust。
- 扩展本地签名事件，覆盖拒绝、撤销、到期和取代，并兼容阶段 1 旧事件格式。
- 实现惰性过期、拒绝防重入、显式重新考虑、只读终态、项目隔离及签名状态历史。
- Context、Markdown/JSON Context Pack、MCP Context、MCP Tasks、候选审核和备份恢复统一处理终态。
- 增加偏好类别、五种语言文案、有效期字段和重新考虑 UI。
- 保留生命周期签名的源项目身份，以支持可信备份恢复后的再验证。
- 修复项目异步加载竞态，增加明确的本地项目加载状态和测试等待条件。
- npm test 固定为单并发，避免此 Windows 主机 Node/esbuild 并行运行内存耗尽，完整保留全部测试。
- 增加 lifecycle 单测、偏好/MCP schema 测试和终态、重新考虑、到期、撤销、备份恢复浏览器测试。

设计文档位于 docs/release/ultimate-stage2-memory-lifecycle-design.md。架构、路线图和测试矩阵位于 docs/architecture/trusted-memory-model.md、docs/roadmap/ultimate-product-roadmap.md、docs/testing/acceptance-matrix.md。

## 测试证据

环境为 Windows 11，Node.js 满足仓库版本要求。测试使用合成数据。

| 测试 | 结果 |
| --- | --- |
| npm run check | VERIFIED，退出码 0 |
| npm test | VERIFIED，245/245 通过，失败 0，跳过 0 |
| npm run build | VERIFIED，Web 与 CLI 生产构建成功 |
| Chromium 通用浏览器组 | VERIFIED，36 + 39 项通过 |
| Chromium 项目、记忆和共享组 | VERIFIED，26/26 通过 |
| Firefox 通用浏览器组 | VERIFIED，36 + 39 项通过 |
| Firefox 项目组 | VERIFIED，23 项通过、2 项浏览器能力跳过 |
| Firefox 用户证据关系早期组合运行 | CONDITIONAL，20 项通过、1 项超时、2 项能力跳过；该用例隔离复测通过，后续项目组 23 项全部通过 |
| Firefox 大文件保存恢复 | VERIFIED，隔离进程通过 |
| WebKit 通用浏览器组 | VERIFIED，36 项通过 |
| WebKit 项目组 | VERIFIED，23 项通过、2 项浏览器能力跳过 |
| WebKit workbench 与易用性组 | CONDITIONAL，38 项通过；1 项组合运行中遇到 browser context 提前关闭，下载用例隔离复测通过 |
| WebKit 大文件保存恢复和下载 | VERIFIED，隔离进程通过 |
| Lifecycle 核心流程 | VERIFIED，三浏览器分别通过拒绝、过期、取代、偏好、密钥丢失、确认撤销、evidence 关系、用户 attestation 和共享状态测试 |
| MCP terminalHistory 与 preference schema | VERIFIED，Node/MCP 测试通过 |
| Linux | NOT VERIFIED |

Firefox 和 WebKit 两项 skip 涉及安全本地文件权限及 Chromium Origin Private File System，相关权限共享路径由 Chromium 覆盖。Firefox 早期组合运行有一项用户证据关系用例超时，隔离复测通过，后续项目组运行中该用例通过。WebKit 的导入竞态在完整组合运行中超时，浏览器下载在 workbench 组合运行中遇到 context closed，两项隔离复测均通过。组间按单 worker 执行，测试未被删除或弱化。Firefox 早期超时记录保存在 `e2e-firefox-user-relation-combined-attempt.txt`。

日志副本存放于 docs/release/evidence/ultimate-stage2/。副本为 Git 友好的行尾空白/换行规范化副本，未经规范化的命令日志原件保存在 D:\Github项目\ThreadPack-阶段资料\ultimate-stage2-progress。

## 问题分级与限制

- P0：未发现。
- P1：未发现。
- P2：本机可用内存限制长时间 Node/浏览器组合测试。默认 npm test 已串行化，Playwright 采用分组单 worker。WebKit/Firefox 个别组合测试曾出现 context、OPFS 或 timeout 类问题，受影响功能在隔离进程通过。
- P2：Linux 构建和运行未验证，需要后续 Linux CI 或主机。
- P2：拒绝去重识别精确规范化重复，不提供语义等价判断。
- 信任边界：签名不证明现实身份或客观事实。静态 MCP 备份上的终态历史不具备本地 lifecycle 身份认证。
- NOT VERIFIED：真实 Linux、物理设备间恢复、真实外部 AI 客户端双向写回。
- 后续阶段：v1-v8 完整历史迁移、幂等迁移、中断恢复和迁移回滚属于阶段 3。本阶段没有执行批量迁移。

## 后续阶段

阶段 3 的工作范围是完整备份、恢复和历史迁移。必须在副本上验证 v1-v8 迁移、迁移前备份、幂等性、中断恢复、回滚、数据数量、evidence 指纹、签名链及损坏备份拒绝。

## GitHub 候选交付

阶段 2 源码提交为 59ecf052f508e7425af2f53bd797a44d724ad0b5。此报告和测试证据作为独立文档提交到 `release-candidate/third-round-stage5-baseline`，与源码提交分开记录。原始 main 工作区未修改。

### 后续生命周期加固

2026-11-29 的候选分支补充修复了替代确认顺序、AI 提案去重边界、候选恢复错误报告和 MCP 测试客户端认证。对应源码提交为 `d19a1d504a31a1c893a90c34124df63e8e4f0a55` 和 `92600d913b62d1c8f0926ef13e6a138f9f785ea3`。更新后的验证结果和条件项见 [阶段 2 生命周期加固补充报告](phase-reports/ultimate-stage2-lifecycle-hardening.md)。
