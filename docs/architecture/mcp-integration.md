# MCP 集成架构与能力状态

## 服务入口

ThreadPack 提供本地 stdio MCP 服务，入口位于 `cli/mcp-server.ts`。客户端启动服务进程并通过标准输入/输出交换 JSON-RPC/MCP 消息。上下文和任务列表工具默认可用。只读实例可以不配置客户端身份，但只暴露显式选择的本地备份范围。配置 `--client-id` 时，必须同时提供项目 ID、本地客户端注册表和令牌环境变量。候选更新和任务协调除需在客户端注册表中分别授权外，也需在服务配置中通过 `--allow-candidate-updates` 与 `--allow-task-coordination` 开启。

## 共享读取语义

`threadpack_project_context` 和 `threadpack_project_tasks` 使用 `src/projects/memory-projection.ts` 的规范项目状态。Context 支持文本查询、预算、事实类别/状态/信任过滤、来源过滤及基线差异。Tasks 只输出符合服务规则的项目任务。客户端传入的 baseline 视为未验证的比较输入，不能修改服务端状态。

服务在每次资源或工具读取时重新加载显式配置的 JSONL 文件。若用户在浏览器中将该文件连接为本地共享状态，审阅并保存后的项目变更会写入该文件，后续 MCP 请求读取新快照。没有浏览器共享连接时，静态备份保持原版本，需要用户重新导出。

上下文、会话内容、证据引用和工具输出是参考数据，不是用户当前授权的操作。bindingStatus、relation、confirmationTrust 与 lifecycleTrust 分别保留，来源匹配不会自动成为支持关系。

## 本地客户端身份与更新权限

`threadpack mcp-client issue` 为客户端项目组合生成 256 位随机 bearer token。注册表仅保存 SHA-256 摘要，不保存令牌明文。`list` 不显示摘要或令牌，`rotate` 立即使旧令牌失效，`revoke` 保留撤销记录。MCP 服务在启动及每次资源/工具请求前重新验证客户端、项目范围和权限。令牌从环境变量读取，不出现在命令参数或连接日志中。

这是 ThreadPack 本机注册主体的持有者认证。它不能证明 WorkBuddy、Codex、Claude Code 等外部平台的账号或操作者身份，也不提供跨 Windows 用户账户、远程网络服务或同一操作系统账户内恶意进程的隔离。凭据注册表在 POSIX 系统上要求仅当前用户访问；Windows ACL 由文件父目录继承，本版本没有独立读取和验证 Windows ACL。客户端配置可能包含 bearer token，应按密钥文件保管。

MCP 候选更新通路写入单独 inbox，并由用户审核后才可能影响正式项目记录。运行中已认证的主体可提交候选，但共享 inbox 中的历史客户端标签和任务认领仍不具备离线密码学签名，默认继续作为未验证协调元数据展示。精确项目 ID 会在每次读取或写入前与备份项目 ID 比较。用户仍须通过操作系统文件权限保护共享备份、凭据注册表和 inbox。此机制不提供远程授权。

## 验证状态

MCP 工具 schema、Context/Tasks 投影、候选 inbox、默认只读、按能力写入授权、项目范围校验、凭据哈希存储、轮换/撤销、运行中撤销生效、客户端参数伪造拒绝和备份校验由 Node 测试覆盖，具体用例及汇总见 `tests/mcp.test.ts` 与阶段验收报告。Windows 本地测试已执行。Linux 部署及 WorkBuddy、Codex、Claude Code 的真实模型调用仍需独立验证。

`threadpack mcp --check` 以只读方式验证备份、收件箱、项目范围和本地进程配置下可用的工具，并输出诊断 JSON 后退出。它不启动 MCP stdio 会话，不探测外部 AI 客户端，也不证明对端已经连接。

外部 AI 产品是否能配置 stdio、本地服务进程权限及模型自动调用工具取决于客户端版本和用户授权。仅有 MCP 服务可启动或协议工具可被测试不代表任意客户端真实支持或已完成接续。
