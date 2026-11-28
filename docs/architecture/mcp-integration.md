# MCP 集成架构与能力状态

## 服务入口

ThreadPack 提供本地 stdio MCP 服务，入口位于 `cli/mcp-server.ts`。客户端启动服务进程并通过标准输入/输出交换 JSON-RPC/MCP 消息。当前实现具有项目上下文读取、任务读取和候选更新相关工具。可用工具及权限取决于服务配置。

## 共享读取语义

`threadpack_project_context` 和 `threadpack_project_tasks` 使用 `src/projects/memory-projection.ts` 的规范项目状态。Context 支持文本查询、预算、事实类别/状态/信任过滤、来源过滤及基线差异。Tasks 只输出符合服务规则的项目任务。客户端传入的 baseline 视为未验证的比较输入，不能修改服务端状态。

上下文、会话内容、证据引用和工具输出是参考数据，不是用户当前授权的操作。bindingStatus、relation、confirmationTrust 与 lifecycleTrust 分别保留，来源匹配不会自动成为支持关系。

## 更新权限

MCP 候选更新通路写入单独 inbox，并由用户审核后才可能影响正式项目记录。阶段 4 没有新增客户端身份登记、项目级凭证、自动写回确认事实、在线订阅或并发冲突解决能力。服务实例的权限按显式配置设定，不因模型调用宣称权限而扩张。

## 验证状态

MCP 工具 schema、Context/Tasks 投影、候选 inbox、只读模式和备份校验由 Node 测试覆盖，具体用例及汇总见 `tests/mcp.test.ts` 与阶段验收报告。Windows 本地测试已执行。Linux 部署及 WorkBuddy、Codex、Claude Code 的阶段 4 真实模型调用不在本阶段的验证结果内，当前仍为 NOT VERIFIED。

外部 AI 产品是否能配置 stdio、本地服务进程权限及模型自动调用工具取决于客户端版本和用户授权。仅有 MCP 服务可启动或协议工具可被测试不代表任意客户端真实支持或已完成接续。
