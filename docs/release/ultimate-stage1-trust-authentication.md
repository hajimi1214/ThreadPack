# ThreadPack 阶段 1 验收报告：用户确认事件与本地信任认证

报告日期：2026-11-27

项目：`hajimi1214/ThreadPack`

候选分支：`release-candidate/third-round-stage5-baseline`

阶段 1 源码提交：`f0023381a1b5901fd0a8feeb276b191f6972a23c`

## 结论

**阶段 1：PASS。**

本结论仅表示阶段 1 的用户确认事件、本地信任身份、签名验证、撤销、恢复和历史链能力已按当前候选代码实现并通过所列验证。它不代表 ThreadPack 的长期开发目标或后续阶段已经完成。

浏览器和 Node 验证在 Windows 环境完成。Linux 未验证。Firefox 和 WebKit 因缺少项目使用的本地文件访问能力，各有两项明示的平台跳过，Chromium 全量套件无跳过。WebKit 在三 worker 并行全量运行时出现三项失败，随后单 worker 全量运行通过，三项失败用例也分别复测通过。原并行运行结果和复测结果均保留在证据目录中。

## 验收基线

- 阶段 1 开始时的候选 HEAD 为 `85ef48f0ae9a77118e3a510d27961eb85fc76ebc`。
- 已批准源码冻结提交为 `97761a3503e2885c1b35e338253459d35dac9213`。
- 源码提交 `f0023381a1b5901fd0a8feeb276b191f6972a23c` 基于候选分支建立，包含本阶段已审查的产品代码和测试。
- `origin/main` 未修改。本阶段成果提交到候选分支，未合并主分支。

## 阶段目标核验

| 要求 | 结果 | 实际实现与证据 |
| --- | --- | --- |
| ConfirmationEvent | VERIFIED | `SignedTrustEvent` 的 `claim.confirmed`、`claim.confirmation-revoked` 和证据关系事件形成追加式事件记录。 |
| 本地可信身份与公钥管理 | VERIFIED | 项目根密钥、恢复密钥、本地设备签名密钥和本地信任锚分别保存。签名私钥以不可导出的 P-256 `CryptoKey` 存入 IndexedDB。 |
| 用户确认事件签名 | VERIFIED | 使用 ECDSA P-256 / SHA-256 签名，规范化 JSON 参与事件摘要和签名校验。 |
| 确认对象指纹与版本 | VERIFIED | 确认事件绑定事实 ID、事实修订版本、主张内容指纹和关联 evidence 指纹。读取时会重新计算并比对。 |
| 确认撤销 | VERIFIED | 撤销事件引用原确认事件，事实状态和签名事件在同一 IndexedDB 事务中更新。拒绝、复核、纠正及 evidence 关系变化会撤销先前的有效确认。 |
| 密钥轮换 | VERIFIED | 新密钥由当前授权密钥签署加入事件链，轮换后的旧密钥可撤销。 |
| 密钥丢失恢复 | VERIFIED | 恢复包用 PBKDF2-SHA-256 派生密钥并以 AES-256-GCM 加密恢复私钥。恢复身份被绑定到原项目根公钥。密钥丢失后，恢复不会把此前无法验证的事实静默恢复为当前认证状态。 |
| 设备重新信任 | VERIFIED | 恢复包、口令、恢复公钥指纹、项目根身份及本地锚定历史前缀均需匹配。Chromium 隔离浏览器上下文的 v8 备份恢复流程通过。 |
| 公钥撤销 | VERIFIED | 撤销事件更新有效密钥集合，之后由已撤销密钥签署的事件会被拒绝。 |
| 历史确认验证 | VERIFIED | 读取事实时验证签名链、事件类型、对象版本、内容指纹、evidence 指纹和撤销记录。静态备份中的自签密钥不会自动成为本地可信身份。 |
| 防重放与防回滚 | VERIFIED | 事件 ID、顺序号、前序哈希、时间单调性和本地锚定链头共同检查重放、分叉与旧快照。删除项目时只保留最小公开锚定信息。 |
| 可信事件链 | VERIFIED | 事件按项目隔离，采用连续序号和前序事件哈希。签名事实状态和事件通过单一事务提交。 |
| 用户确认、证据支持、独立验证区分 | VERIFIED | 签名确认只表示本地受信任密钥签署了该主张。用户 evidence 关系需另行审阅。项目包明确将 `independentlyVerifiedClaims` 设为 0，系统不会把本地签名或用户 attestation 冒充独立验证。 |

本地签名不能证明现实身份或法律身份。密钥由谁持有和确认内容是否客观真实仍由用户的本地恢复流程与独立验证材料承担。

## 修改文件

| 文件 | 修改原因 |
| --- | --- |
| `src/projects/trust-crypto.ts` | 新增规范化签名、P-256 身份、公钥指纹、事件链、撤销与回滚校验、加密恢复包实现。 |
| `src/projects/memory-types.ts` | 增加信任状态、锚点、密钥、签名事件及事实认证状态类型。 |
| `src/projects/store.ts` | IndexedDB schema 升至 v7，增加身份和事件存储，提供确认、撤销、轮换、恢复、设备重新信任与锚点保留。事实和签名事件使用原子事务。删除导入副本时不会标记其源项目的锚点已删除。 |
| `src/projects/memory-context.ts` | 区分本地密钥签名确认、旧版无认证确认、无效签名、撤销及历史状态，降低未认证确认在上下文中的排序。 |
| `src/projects/memory-export.ts` | 在 Markdown / JSON Context Pack 中输出签名可信状态、证据关系和独立验证边界。 |
| `src/projects/ProjectMemoryPanel.tsx` | 增加身份设置、恢复包确认、密钥轮换/撤销、设备重新信任及事实认证状态展示。 |
| `src/projects/ProjectLibrary.tsx` | 删除确认提示说明保留最小本地锚点，并提供稳定项目 ID 属性供精确测试选择。 |
| `src/projects/projects.css` | 增加信任设置面板与认证状态样式。 |
| `src/locales/en.ts`、`src/locales/es.ts`、`src/locales/fr.ts`、`src/locales/ja.ts`、`src/locales/zh.ts` | 为信任身份、恢复、撤销、认证状态和删除后锚点提示补齐五种界面语言。 |
| `cli/mcp-server.ts` | 支持读取 v8 信任快照并验证签名链内部一致性，同时将静态备份中的状态保持为未认证导入。 |
| `tests/trust-crypto.test.ts` | 新增 13 项签名、链完整性、重放、防回滚、轮换、撤销及恢复包测试。 |
| `tests/browser/helpers/project-trust.ts` | 提供浏览器测试用的合成恢复包流程。 |
| `tests/browser/project-memory.spec.ts` | 覆盖签名确认、撤销、恢复、轮换、项目删除/导入锚点保护、跨设备恢复和跨输出语义。 |
| `tests/browser/project-coordination.spec.ts`、`tests/browser/project-shared-state.spec.ts`、`tests/mcp.test.ts` | 回归共享项目、任务协调及 MCP v8 静态备份信任校验。 |

本阶段将命令输出副本纳入 `docs/release/evidence/ultimate-stage1/`。为通过 Git 空白字符检查，副本只统一换行格式并去除行尾空格和多余的文件末尾空行，测试结果与命令内容保留。未经规范化的本机原始日志保存在 `D:\Github项目\ThreadPack-阶段资料\ultimate-stage1-progress`。

## 验证证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 类型检查 | VERIFIED，退出码 0 | `npm run check`，见 `evidence/ultimate-stage1/typecheck.txt` |
| Node 单元测试 | VERIFIED，237 通过、0 失败、0 跳过 | `npm test`，见 `evidence/ultimate-stage1/unit-tests.txt` |
| 生产构建 | VERIFIED，Web 与 CLI 构建成功 | `npm run build`，见 `evidence/ultimate-stage1/production-build.txt` |
| Chromium 全量浏览器测试 | VERIFIED，96 通过、0 失败 | `npm run test:e2e -- --workers=3`，见 `evidence/ultimate-stage1/e2e-chromium-full.txt` |
| Firefox 全量浏览器测试 | VERIFIED，94 通过、2 跳过、0 失败 | 同一 Playwright 命令，见 `evidence/ultimate-stage1/e2e-firefox-full.txt` |
| WebKit 全量浏览器测试 | VERIFIED，94 通过、2 跳过、0 失败 | `npm run test:e2e -- --workers=1`，见 `evidence/ultimate-stage1/e2e-webkit-full-serial.txt` |
| 签名确认与删除锚点专项 | VERIFIED，Chromium / Firefox / WebKit 各 2/2 通过 | 分别见 `trust-flow-chromium.txt`、`trust-flow-firefox.txt`、`trust-flow-webkit.txt` |
| WebKit 并行失败用例复测 | VERIFIED，三项逐项复测均通过 | 初次并行结果见 `e2e-webkit-parallel-attempt.txt`，逐项复测见三个 `webkit-*-isolated.txt` 文件 |
| Linux | NOT VERIFIED | 本次测试环境为 Windows，没有 Linux 构建或浏览器运行证据。 |

Firefox 和 WebKit 的两项跳过分别涉及 secure local file sharing 能力和依赖 Origin Private File System 的隔离设备测试。这些路径由 Chromium 全量 E2E 覆盖。Firefox/WebKit 跳过项没有以其他浏览器结果伪装为该浏览器通过。

WebKit 三 worker 并行全量运行曾报告导入竞态、文件流用例和项目记忆用例失败。完整错误日志已保留，三项在单 worker 全量运行中通过，且失败用例逐项复测也通过。为保证该平台的可重复结果，本阶段 WebKit 全量验收采用单 worker。并行 WebKit 测试稳定性列为 P2。

## 问题与剩余风险

- **P2：WebKit 并行 E2E 稳定性。** 三 worker 全量运行出现过三项失败，单 worker 全量以及三项单独复测均通过。后续应调查 Playwright WebKit 并行执行中的页面生命周期与资源竞争。
- **NOT VERIFIED：Linux。** 尚无 Linux 类型检查、构建、MCP 或浏览器验证。
- **NOT VERIFIED：真实物理设备间恢复。** 隔离浏览器上下文的导入和重信任已在 Chromium 验证，真实设备间的文件传输与用户身份交接尚未进行。
- **设计边界：本地签名仅证明相应项目密钥签署了事件，不证明现实身份或客观事实。**
- **后续阶段未完成。** 事实生命周期、完整 v1–v8 数据迁移、最终跨客户端协作和产品级整体验收仍属于后续阶段。

未发现阶段 1 范围内的 P0/P1 问题。

## GitHub 提交

阶段 1 源码与测试提交为 `f0023381a1b5901fd0a8feeb276b191f6972a23c`。本报告及测试证据将以独立提交追加到 `release-candidate/third-round-stage5-baseline`。提交后推送该候选分支，不推送或修改 `main`。
