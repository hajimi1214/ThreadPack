import type { OutputLanguage } from '../src/core';

export const HELP_ZH = `ThreadPack — 携带 AI 对话中的重要内容。

用法：threadpack <input.jsonl|json|md|txt|-> --out <file> [选项]

选项：
  --format <markdown|jsonl|handoff|report>  导出格式（默认 markdown）
  --conversation <N>                      选择会话，从 1 开始
  --tool-limit <N>                         单条工具输出字符数（500–100000）
  --recent <N>                             交接包近期消息数（0–100，默认 8）
  --recent-mode <source|timestamp>         按源顺序或有效时间戳选择（默认 source）
  --notes-file <file>                      从 JSON 文件读取交接笔记
  --pin <N>                                固定所选会话中的消息序号，可重复使用
  --original-out <file>                    保存未经修改的原始输入副本
  --language <en|zh>                       CLI 输出语言（默认 en）
  --keep-images                            保留内嵌图片数据
  --keep-tool-outputs                      保留完整工具输出
  --keep-duplicates                        保留重复工具输出
  --no-redact                              关闭内置秘密识别
  --redact-emails                          启用邮箱脱敏（默认开启）
  --no-redact-emails                       保留邮箱地址
  --redact-file <file>                     从 UTF-8 文件逐行读取精确脱敏值
  --force                                  替换已存在的输出文件
  --help, -h                               显示帮助
  --version                                显示版本

输入为 '-' 时从 stdin 读取 UTF-8 内容，输入上限为 100 MiB。
默认启用严格邮箱脱敏；使用 --no-redact-emails 可保留邮箱。
笔记、规则、原始副本、清理输出和输入文件必须互不相同。
原始副本按输入字节保存，输入文件不会被修改。
`;

const DIAGNOSTICS_ZH: Record<string, string> = {
  'Input exceeds the 100 MiB limit.': '输入超过 100 MiB 限制。',
  'The redaction file must be a regular UTF-8 file.': '脱敏规则文件必须是普通 UTF-8 文件。',
  'The redaction file exceeds the 64 KiB limit.': '脱敏规则文件超过 64 KiB 限制。',
  'The redaction file must contain valid UTF-8 text.': '脱敏规则文件必须包含有效的 UTF-8 文本。',
  'Redaction rules require at most 50 values of 3–1000 Unicode characters.': '脱敏规则最多 50 项，每项须为 3–1000 个 Unicode 字符。',
  'The notes file must be a regular UTF-8 JSON file.': '笔记文件必须是普通 UTF-8 JSON 文件。',
  'The notes file exceeds the 256 KiB limit.': '笔记文件超过 256 KiB 限制。',
  'The notes file must contain valid UTF-8 JSON.': '笔记文件必须包含有效的 UTF-8 JSON。',
  'The notes file must be a JSON object containing goal, decisions, constraints, and nextSteps.': '笔记文件必须是 JSON 对象，可包含 goal、decisions、constraints 和 nextSteps 字段。',
  'The notes file contains an unsupported field.': '笔记文件包含不支持的字段。',
  'Each notes field must be text containing at most 12000 characters.': '每个笔记字段必须是文本且最多 12000 个字符。',
  'Invalid command-line options. Run threadpack --help for usage.': '命令行选项无效。运行 threadpack --help 查看用法。',
  'Provide one input and --out <file>. Run threadpack --help for usage.': '请提供一个输入和 --out <file>。运行 threadpack --help 查看用法。',
  'Use --format markdown, jsonl, handoff, or report.': '请使用 --format markdown、jsonl、handoff 或 report。',
  '--notes-file, --pin, and --recent-mode require --format handoff or report.': '--notes-file、--pin 和 --recent-mode 仅适用于 handoff 或 report 格式。',
  '--recent-mode must be source or timestamp.': '--recent-mode 必须为 source 或 timestamp。',
  '--language must be en or zh.': '--language 必须为 en 或 zh。',
  'Choose either --redact-emails or --no-redact-emails, not both.': '不能同时使用 --redact-emails 和 --no-redact-emails。',
  'Provide a regular UTF-8 file with --redact-file.': '请为 --redact-file 提供普通 UTF-8 文件。',
  'Input and output must be different files, including aliases.': '输入和输出必须是不同文件，包括文件别名。',
  'The redaction file must differ from input and output, including aliases.': '脱敏规则文件必须与输入和输出不同，包括文件别名。',
  'Provide a UTF-8 JSON file with --notes-file.': '请为 --notes-file 提供 UTF-8 JSON 文件。',
  'The notes file must differ from input, output, and redaction files, including aliases.': '笔记文件必须与输入、输出和脱敏规则文件不同，包括文件别名。',
  'The original copy must differ from input, output, notes, and redaction files, including aliases.': '原始副本必须与输入、清理输出、笔记和脱敏规则文件不同，包括文件别名。',
  'Provide a file with --original-out.': '请为 --original-out 提供文件路径。',
  'Input must be a regular file.': '输入必须是普通文件。',
  'Input is empty.': '输入为空。',
  '--pin requires a message number within the selected conversation.': '--pin 需要指定所选会话范围内的消息序号。',
  'Output already exists. Choose another file or use --force.': '输出文件已存在。请选择其他文件或使用 --force。',
  'Input file or output directory was not found.': '未找到输入文件或输出目录。',
  'File permission denied.': '文件权限不足。',
  'The operation is not permitted.': '不允许执行此操作。',
  'Expected a file, received a directory.': '需要文件路径，但收到的是目录。',
  'Not enough disk space.': '磁盘空间不足。',
  'A filesystem operation failed.': '文件系统操作失败。',
  'Processing failed. Check the input format in the browser preview.': '处理失败。请在浏览器预览中检查输入格式。',
  'Handoff budget must be between 1,000 and 10,000,000 characters.': '交接包预算必须为 1,000–10,000,000 个字符。',
};

const WARNINGS_ZH: Record<string, string> = {
  'This is a lossy, normalized copy for review and handoff. Keep the original export; the copy is not a resumable agent session.': '这是用于检查和交接的有损标准化副本。请保留原始导出，此副本不能恢复代理会话。',
  'Redaction uses local patterns and exact custom values and can miss secrets or personal information. Review the export before sharing.': '脱敏使用本地模式和自定义精确值，仍可能漏掉秘密或个人信息。分享前请检查导出内容。',
  'Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.': '对话标题或来源标签中的敏感模式也已脱敏。字节统计仅描述消息正文。',
  'Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.': 'JSON 结构未知。完整 JSON 已作为一条文本消息保留，无法提取结构化消息。',
  'Input starts like JSON but is not valid JSON. It was preserved as plain text.': '输入看起来像 JSON，但格式无效，已按纯文本保留。',
};

export function localizeDiagnostic(message: string, language: OutputLanguage): string {
  if (language === 'en') return message;
  const exact = DIAGNOSTICS_ZH[message];
  if (exact) return exact;
  const integer = message.match(/^(.+) requires an integer between (\d+) and (\d+)\.$/);
  if (integer) return `${integer[1]} 必须是 ${integer[2]} 到 ${integer[3]} 之间的整数。`;
  const unavailableConversation = message.match(/^Conversation (\d+) is unavailable; this input contains (\d+)\.$/);
  if (unavailableConversation) return `所选会话 ${unavailableConversation[1]} 不存在；此输入包含 ${unavailableConversation[2]} 个会话。`;
  const pinRange = message.match(/^--pin message number must be between 1 and (\d+)\.$/);
  if (pinRange) return `--pin 消息序号必须在 1 到 ${pinRange[1]} 之间。`;
  return message;
}

export function localizeWarning(warning: string, language: OutputLanguage): string {
  if (language === 'en') return warning;
  const exact = WARNINGS_ZH[warning];
  if (exact) return exact;
  const roleCount = warning.match(/^Conversation (\d+): (\d+) message\(s\) with unrecognized roles were preserved as system data\. Review their meaning before continuing\.$/);
  if (roleCount) return `会话 ${roleCount[1]}：有 ${roleCount[2]} 条消息的角色无法识别，已作为系统数据保留。继续前请检查其含义。`;
  const emptyConversation = warning.match(/^Conversation (\d+): no nonempty messages were found in this conversation\.$/);
  if (emptyConversation) return `会话 ${emptyConversation[1]} 中没有非空消息。`;
  const branch = warning.match(/^Conversation (\d+): incomplete or cyclic parent chain; only the reachable active branch was imported\.$/);
  if (branch) return `会话 ${branch[1]}：父级链不完整或存在循环，仅导入了可访问的当前分支。`;
  const currentNode = warning.match(/^Conversation (\d+): no valid current_node; all available ChatGPT branches were imported in export order\.$/);
  if (currentNode) return `会话 ${currentNode[1]}：current_node 无效，已按导出顺序导入所有可用的 ChatGPT 分支。`;
  const skipped = warning.match(/^(\d+) metadata or unsupported record\(s\) contained no recognized conversation message and were not included\.$/);
  if (skipped) return `${skipped[1]} 条元数据或不支持的记录不含可识别的对话消息，未纳入导入。`;
  const unrecognized = warning.match(/^(\d+) unrecognized conversation record\(s\) were not imported\.$/);
  if (unrecognized) return `${unrecognized[1]} 条无法识别的对话记录未导入。`;
  const invalidJsonl = warning.match(/^(\d+) invalid JSONL line\(s\) were skipped\. Keep the original file to recover them\.$/);
  if (invalidJsonl) return `已跳过 ${invalidJsonl[1]} 行无效 JSONL。请保留原始文件以便恢复。`;
  return warning;
}
