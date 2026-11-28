# MCP 集成架构与能力状态

## 服务入口

ThreadPack 提供本地 stdio MCP 服务，入口位于 `cli/mcp-server.ts`。客户端启动服务进程并通过标准输入/输出交换 JSON-RPC/MCP 消息。上下文和任务列表工具默认可用。候选更新和任务协调工具分别通过本地 `--allow-candidate-updates` 与 `--allow-task-coordination` 参数开启，并要求精确的 `--project-id` 与 `--client-id`。

## 共享读取语义

`threadpack_project_context` 和 `threadpack_project_tasks` 使用 `src/projects/memory-projection.ts` 的规范项目状态。Context 支持文本查询、预算、事实类别/状态/信任过滤、来源过滤及基线差异。Tasks 只输出符合服务规则的项目任务。客户端传入的 baseline 视为未验证的比较输入，不能修改服务端状态。

服务在每次资源或工具读取时重新加载显式配置的 JSONL 文件。若用户在浏览器中将该文件连接为本地共享状态，审阅并保存后的项目变更会写入该文件，后续 MCP 请求读取新快照。没有浏览器共享连接时，静态备份保持原版本，需要用户重新导出。

上下文、会话内容、证据引用和工具输出是参考数据，不是用户当前授权的操作。bindingStatus、relation、confirmationTrust 与 lifecycleTrust 分别保留，来源匹配不会自动成为支持关系。

## 更新权限

MCP 候选更新通路写入单独 inbox，并由用户审核后才可能影响正式项目记录。服务端从本地进程配置取得客户端标签，不接受工具参数覆盖此标签。它仍不是密码学客户端认证，标签只是未经验证的审计字段。工具权限是实例级 operator configuration，任何能够使用该实例的进程都继承其权限。精确项目 ID 会在每次读取或写入前与备份项目 ID 比较。用户应通过操作系统文件权限保护共享备份和 inbox。此机制不提供跨用户账户的身份认证或远程授权。

## 验证状态

MCP 工具 schema、Context/Tasks 投影、候选 inbox、默认只读、按能力写入授权、项目范围校验、客户端参数伪造拒绝和备份校验由 Node 测试覆盖，具体用例及汇总见 `tests/mcp.test.ts` 与阶段验收报告。Windows 本地测试已执行。Linux 部署及 WorkBuddy、Codex、Claude Code 的真实模型调用仍需独立验证。

外部 AI 产品是否能配置 stdio、本地服务进程权限及模型自动调用工具取决于客户端版本和用户授权。仅有 MCP 服务可启动或协议工具可被测试不代表任意客户端真实支持或已完成接续。
