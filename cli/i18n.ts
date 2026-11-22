import type { CleanStats, OutputLanguage } from '../src/core';

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
  --language <en|zh|ja|fr|es>              CLI 输出语言（默认 en）
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
--language 也会本地化 Markdown、交接包、报告说明和警告。
默认启用严格邮箱脱敏；使用 --no-redact-emails 可保留邮箱。
笔记、规则、原始副本、清理输出和输入文件必须互不相同。
原始副本按输入字节保存，输入文件不会被修改。
`;

export const HELP_JA = `ThreadPack — AI 会話の要点を持ち運ぶツール。

使い方：threadpack <input.jsonl|json|md|txt|-> --out <file> [オプション]

オプション：
  --format <markdown|jsonl|handoff|report>  出力形式（既定：markdown）
  --conversation <N>                      会話を選択（1 から開始）
  --tool-limit <N>                        ツール出力ごとの文字数（500–100000）
  --recent <N>                             引き継ぎに含める最近のメッセージ（0–100、既定：8）
  --recent-mode <source|timestamp>         元の順序または有効なタイムスタンプで選択（既定：source）
  --notes-file <file>                     JSON ファイルから引き継ぎメモを読み込む
  --pin <N>                               会話内のメッセージ番号を固定（繰り返し可）
  --original-out <file>                   未変更の元ファイルを保存
  --language <en|zh|ja|fr|es>              CLI の出力言語（既定：en）
  --keep-images                           埋め込み画像データを保持
  --keep-tool-outputs                     ツール出力をすべて保持
  --keep-duplicates                       重複出力を保持
  --no-redact                             組み込みの秘密情報検出を無効化
  --redact-emails                         メールアドレスをマスキング（既定で有効）
  --no-redact-emails                      メールアドレスをそのまま保持
  --redact-file <file>                    UTF-8 ファイルからマスキング値を読み込む
  --force                                 既存の出力ファイルを置換
  --help, -h                              このヘルプを表示
  --version                               バージョンを表示

入力に '-' を指定すると stdin から UTF-8 を読み込みます。上限は 100 MiB です。
メールアドレスは既定でマスキングされます。--no-redact-emails で保持できます。
入力、出力、元ファイルのコピー、メモ、マスキングルールは別々のファイルにしてください。
`;

export const HELP_FR = `ThreadPack — emporter l’essentiel d’une conversation IA.

Utilisation : threadpack <input.jsonl|json|md|txt|-> --out <file> [options]

Options :
  --format <markdown|jsonl|handoff|report>  Format de sortie (défaut : markdown)
  --conversation <N>                      Choisir une conversation, à partir de 1
  --tool-limit <N>                        Caractères par sortie d’outil (500–100000)
  --recent <N>                             Messages récents du dossier (0–100, défaut : 8)
  --recent-mode <source|timestamp>         Sélection par ordre source ou horodatage valide (défaut : source)
  --notes-file <file>                     Lire les notes du dossier depuis un JSON
  --pin <N>                               Épingler le numéro d’un message, option répétable
  --original-out <file>                   Enregistrer une copie intacte de la source
  --language <en|zh|ja|fr|es>              Langue de sortie du CLI (défaut : en)
  --keep-images                           Conserver les images intégrées
  --keep-tool-outputs                     Conserver toutes les sorties d’outil
  --keep-duplicates                       Conserver les sorties répétées
  --no-redact                             Désactiver la détection intégrée des secrets
  --redact-emails                         Masquer les e-mails (activé par défaut)
  --no-redact-emails                      Conserver les adresses e-mail
  --redact-file <file>                    Lire les valeurs à masquer depuis un fichier UTF-8
  --force                                 Remplacer les fichiers de sortie existants
  --help, -h                              Afficher cette aide
  --version                               Afficher la version

Avec '-' en entrée, le texte UTF-8 est lu depuis stdin. Limite : 100 MiB.
Les adresses e-mail sont masquées par défaut. --no-redact-emails les conserve.
L’entrée, les sorties, la copie originale, les notes et les règles doivent être distinctes.
`;

export const HELP_ES = `ThreadPack — conserva lo importante de una conversación con IA.

Uso: threadpack <input.jsonl|json|md|txt|-> --out <file> [opciones]

Opciones:
  --format <markdown|jsonl|handoff|report>  Formato de salida (predeterminado: markdown)
  --conversation <N>                      Elegir conversación, empezando en 1
  --tool-limit <N>                        Caracteres por salida de herramienta (500–100000)
  --recent <N>                             Mensajes recientes del traspaso (0–100, predeterminado: 8)
  --recent-mode <source|timestamp>         Elegir por orden de origen o marcas de tiempo válidas (predeterminado: source)
  --notes-file <file>                     Leer notas del traspaso desde JSON
  --pin <N>                               Fijar el número de un mensaje, opción repetible
  --original-out <file>                   Guardar una copia intacta del archivo de origen
  --language <en|zh|ja|fr|es>              Idioma de salida del CLI (predeterminado: en)
  --keep-images                           Conservar imágenes incrustadas
  --keep-tool-outputs                     Conservar todas las salidas de herramientas
  --keep-duplicates                       Conservar salidas repetidas
  --no-redact                             Desactivar la detección integrada de secretos
  --redact-emails                         Ocultar correos (activado por defecto)
  --no-redact-emails                      Conservar direcciones de correo
  --redact-file <file>                    Leer valores para ocultar desde UTF-8
  --force                                 Reemplazar archivos de salida existentes
  --help, -h                              Mostrar esta ayuda
  --version                               Mostrar la versión

Usa '-' como entrada para leer texto UTF-8 desde stdin. Límite: 100 MiB.
Los correos se ocultan de forma predeterminada. --no-redact-emails los conserva.
La entrada, las salidas, la copia original, las notas y las reglas deben ser archivos distintos.
`;

export function localizedHelp(language: OutputLanguage, english: string): string {
  if (language === 'zh') return HELP_ZH;
  if (language === 'ja') return HELP_JA;
  if (language === 'fr') return HELP_FR;
  if (language === 'es') return HELP_ES;
  return english;
}

const DIAGNOSTICS_ZH: Record<string, string> = {
  'This file exceeds the 100 MiB limit. Split it into smaller exports first.': '文件超过 100 MiB 限制，请先拆分为较小的导出文件。',
  'This conversation contains no usable messages.': '此文件中没有可用的对话消息。',
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
  'This file could not be read. Choose it again or paste its text.': '无法读取此文件，请重新选择或粘贴文本。',
  'This ZIP could not be read. Choose a valid conversation export.': '无法读取此 ZIP，请选择有效的对话导出文件。',
  'This conversation is unavailable. Import the conversation again.': '所选会话不可用，请重新导入。',
  'No messages match the current filters.': '当前筛选条件没有匹配的消息。',
  'No code snippets match the current filters.': '当前筛选条件没有匹配的代码片段。',
  '--recent-mode must be source or timestamp.': '--recent-mode 必须为 source 或 timestamp。',
  '--language must be en, zh, ja, fr, or es.': '--language 必须为 en、zh、ja、fr 或 es。',
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

const DIAGNOSTICS_JA: Record<string, string> = {
  'This file exceeds the 100 MiB limit. Split it into smaller exports first.': 'ファイルが 100 MiB の上限を超えています。小さなエクスポートに分割してください。',
  'This conversation contains no usable messages.': 'このファイルに利用可能な会話メッセージはありません。',
  'Export failed. Please try again.': 'エクスポートに失敗しました。もう一度お試しください。',
  'Could not load the comparison. Please try again.': '比較を読み込めませんでした。もう一度お試しください。',
  '--language must be en, zh, ja, fr, or es.': '--language は en、zh、ja、fr、es のいずれかを指定してください。',
  'Choose either --redact-emails or --no-redact-emails, not both.': '--redact-emails と --no-redact-emails は同時に指定できません。',
  'Input exceeds the 100 MiB limit.': '入力が 100 MiB の上限を超えています。',
  'The redaction file must be a regular UTF-8 file.': 'マスキングルールは通常の UTF-8 ファイルである必要があります。',
  'The redaction file exceeds the 64 KiB limit.': 'マスキングルールが 64 KiB の上限を超えています。',
  'The redaction file must contain valid UTF-8 text.': 'マスキングルールに有効な UTF-8 テキストが必要です。',
  'Redaction rules require at most 50 values of 3–1000 Unicode characters.': 'マスキングルールは最大 50 件、各 3～1000 Unicode 文字です。',
  'The notes file must be a regular UTF-8 JSON file.': 'メモファイルは通常の UTF-8 JSON ファイルである必要があります。',
  'The notes file exceeds the 256 KiB limit.': 'メモファイルが 256 KiB の上限を超えています。',
  'The notes file must contain valid UTF-8 JSON.': 'メモファイルに有効な UTF-8 JSON が必要です。',
  'The notes file contains an unsupported field.': 'メモファイルに未対応の項目があります。',
  'Each notes field must be text containing at most 12000 characters.': '各メモ項目は 12000 文字以下のテキストである必要があります。',
  'Invalid command-line options. Run threadpack --help for usage.': 'コマンドラインのオプションが正しくありません。threadpack --help で使い方を確認してください。',
  'The operation is not permitted.': 'この操作は許可されていません。',
  'File permission denied.': 'ファイルへのアクセスが拒否されました。',
  'Not enough disk space.': 'ディスクの空き容量が不足しています。',
  'Output already exists. Choose another file or use --force.': '出力ファイルは既に存在します。別のファイルを選ぶか --force を指定してください。',
  'Input is empty.': '入力が空です。',
  'This file could not be read. Choose it again or paste its text.': 'ファイルを読み込めません。再選択するか、テキストを貼り付けてください。',
  'This ZIP could not be read. Choose a valid conversation export.': 'ZIP を読み込めません。有効な会話エクスポートを選択してください。',
  'This conversation is unavailable. Import the conversation again.': 'この会話は利用できません。もう一度インポートしてください。',
  'No messages match the current filters.': '現在のフィルターに一致するメッセージはありません。',
  'No code snippets match the current filters.': '現在のフィルターに一致するコードスニペットはありません。',
  'Input must be a regular file.': '入力には通常のファイルを指定してください。',
  'Use --format markdown, jsonl, handoff, or report.': '--format は markdown、jsonl、handoff、report のいずれかを指定してください。',
  'Provide a file with --original-out.': '--original-out にファイルパスを指定してください。',
  'Provide a UTF-8 JSON file with --notes-file.': '--notes-file に UTF-8 JSON ファイルを指定してください。',
  'The original copy must differ from input, output, notes, and redaction files, including aliases.': '元ファイルのコピー先は入力、出力、メモ、マスキングルールと別のファイルにしてください。別名も確認されます。',
  'Processing failed. Check the input format in the browser preview.': '処理に失敗しました。ブラウザーのプレビューで入力形式を確認してください。',
};

const DIAGNOSTICS_FR: Record<string, string> = {
  'This file exceeds the 100 MiB limit. Split it into smaller exports first.': 'Le fichier dépasse la limite de 100 Mio. Divisez-le en plusieurs exports plus petits.',
  'This conversation contains no usable messages.': 'Ce fichier ne contient aucun message de conversation exploitable.',
  'Export failed. Please try again.': 'Échec de l’export. Veuillez réessayer.',
  'Could not load the comparison. Please try again.': 'Impossible de charger la comparaison. Veuillez réessayer.',
  '--language must be en, zh, ja, fr, or es.': '--language doit être en, zh, ja, fr ou es.',
  'Choose either --redact-emails or --no-redact-emails, not both.': 'Choisissez --redact-emails ou --no-redact-emails, pas les deux.',
  'Input exceeds the 100 MiB limit.': 'Le fichier d’entrée dépasse la limite de 100 Mio.',
  'The redaction file must be a regular UTF-8 file.': 'Le fichier de règles doit être un fichier UTF-8 standard.',
  'The redaction file exceeds the 64 KiB limit.': 'Le fichier de règles dépasse la limite de 64 Kio.',
  'The redaction file must contain valid UTF-8 text.': 'Le fichier de règles doit contenir du texte UTF-8 valide.',
  'Redaction rules require at most 50 values of 3–1000 Unicode characters.': 'Les règles acceptent 50 valeurs maximum, de 3 à 1000 caractères Unicode chacune.',
  'The notes file must be a regular UTF-8 JSON file.': 'Le fichier de notes doit être un fichier JSON UTF-8 standard.',
  'The notes file exceeds the 256 KiB limit.': 'Le fichier de notes dépasse la limite de 256 Kio.',
  'The notes file must contain valid UTF-8 JSON.': 'Le fichier de notes doit contenir du JSON UTF-8 valide.',
  'The notes file contains an unsupported field.': 'Le fichier de notes contient un champ non pris en charge.',
  'Each notes field must be text containing at most 12000 characters.': 'Chaque champ de note doit contenir au plus 12000 caractères.',
  'Invalid command-line options. Run threadpack --help for usage.': 'Options de commande invalides. Consultez threadpack --help pour l’utilisation.',
  'The operation is not permitted.': 'Cette opération n’est pas autorisée.',
  'File permission denied.': 'Accès au fichier refusé.',
  'Not enough disk space.': 'Espace disque insuffisant.',
  'Output already exists. Choose another file or use --force.': 'Le fichier de sortie existe déjà. Choisissez un autre fichier ou utilisez --force.',
  'Input is empty.': 'Le fichier d’entrée est vide.',
  'This file could not be read. Choose it again or paste its text.': 'Impossible de lire ce fichier. Sélectionnez-le à nouveau ou collez son texte.',
  'This ZIP could not be read. Choose a valid conversation export.': 'Impossible de lire ce ZIP. Choisissez un export de conversation valide.',
  'This conversation is unavailable. Import the conversation again.': 'Cette conversation est indisponible. Importez-la à nouveau.',
  'No messages match the current filters.': 'Aucun message ne correspond aux filtres actuels.',
  'No code snippets match the current filters.': 'Aucun extrait de code ne correspond aux filtres actuels.',
  'Input must be a regular file.': 'L’entrée doit être un fichier standard.',
  'Use --format markdown, jsonl, handoff, or report.': 'Utilisez --format markdown, jsonl, handoff ou report.',
  'Provide a file with --original-out.': 'Indiquez un fichier avec --original-out.',
  'Provide a UTF-8 JSON file with --notes-file.': 'Indiquez un fichier JSON UTF-8 avec --notes-file.',
  'The original copy must differ from input, output, notes, and redaction files, including aliases.': 'La copie originale doit être distincte de l’entrée, de la sortie, des notes et des règles, y compris leurs alias.',
  'Processing failed. Check the input format in the browser preview.': 'Échec du traitement. Vérifiez le format dans l’aperçu du navigateur.',
};

const DIAGNOSTICS_ES: Record<string, string> = {
  'This file exceeds the 100 MiB limit. Split it into smaller exports first.': 'El archivo supera el límite de 100 MiB. Divídelo en exportaciones más pequeñas.',
  'This conversation contains no usable messages.': 'El archivo no contiene mensajes de conversación utilizables.',
  'Export failed. Please try again.': 'No se pudo exportar. Inténtalo de nuevo.',
  'Could not load the comparison. Please try again.': 'No se pudo cargar la comparación. Inténtalo de nuevo.',
  '--language must be en, zh, ja, fr, or es.': '--language debe ser en, zh, ja, fr o es.',
  'Choose either --redact-emails or --no-redact-emails, not both.': 'Elige --redact-emails o --no-redact-emails, no ambos.',
  'Input exceeds the 100 MiB limit.': 'La entrada supera el límite de 100 MiB.',
  'The redaction file must be a regular UTF-8 file.': 'El archivo de reglas debe ser un archivo UTF-8 normal.',
  'The redaction file exceeds the 64 KiB limit.': 'El archivo de reglas supera el límite de 64 KiB.',
  'The redaction file must contain valid UTF-8 text.': 'El archivo de reglas debe contener texto UTF-8 válido.',
  'Redaction rules require at most 50 values of 3–1000 Unicode characters.': 'Las reglas admiten hasta 50 valores de 3 a 1000 caracteres Unicode cada uno.',
  'The notes file must be a regular UTF-8 JSON file.': 'El archivo de notas debe ser un archivo JSON UTF-8 normal.',
  'The notes file exceeds the 256 KiB limit.': 'El archivo de notas supera el límite de 256 KiB.',
  'The notes file must contain valid UTF-8 JSON.': 'El archivo de notas debe contener JSON UTF-8 válido.',
  'The notes file contains an unsupported field.': 'El archivo de notas contiene un campo no admitido.',
  'Each notes field must be text containing at most 12000 characters.': 'Cada campo de notas debe tener como máximo 12000 caracteres.',
  'Invalid command-line options. Run threadpack --help for usage.': 'Las opciones de la línea de comandos no son válidas. Consulta threadpack --help.',
  'The operation is not permitted.': 'La operación no está permitida.',
  'File permission denied.': 'Permiso de archivo denegado.',
  'Not enough disk space.': 'No hay suficiente espacio en disco.',
  'Output already exists. Choose another file or use --force.': 'El archivo de salida ya existe. Elige otro archivo o usa --force.',
  'Input is empty.': 'La entrada está vacía.',
  'This file could not be read. Choose it again or paste its text.': 'No se pudo leer el archivo. Selecciónalo de nuevo o pega su texto.',
  'This ZIP could not be read. Choose a valid conversation export.': 'No se pudo leer el ZIP. Selecciona una exportación de conversación válida.',
  'This conversation is unavailable. Import the conversation again.': 'Esta conversación no está disponible. Impórtala de nuevo.',
  'No messages match the current filters.': 'Ningún mensaje coincide con los filtros actuales.',
  'No code snippets match the current filters.': 'Ningún fragmento de código coincide con los filtros actuales.',
  'Input must be a regular file.': 'La entrada debe ser un archivo normal.',
  'Use --format markdown, jsonl, handoff, or report.': 'Usa --format markdown, jsonl, handoff o report.',
  'Provide a file with --original-out.': 'Indica un archivo con --original-out.',
  'Provide a UTF-8 JSON file with --notes-file.': 'Indica un archivo JSON UTF-8 con --notes-file.',
  'The original copy must differ from input, output, notes, and redaction files, including aliases.': 'La copia original debe ser distinta de la entrada, la salida, las notas y las reglas, incluidos sus alias.',
  'Processing failed. Check the input format in the browser preview.': 'No se pudo procesar. Comprueba el formato en la vista previa del navegador.',
};

const WARNINGS_JA: Record<string, string> = {
  'This is a lossy, normalized copy for review and handoff. Keep the original export; the copy is not a resumable agent session.': 'これは確認と引き継ぎ用の非可逆な正規化コピーです。元のエクスポートを保管してください。このコピーからエージェントのセッションは再開できません。',
  'Redaction uses local patterns and exact custom values and can miss secrets or personal information. Review the export before sharing.': 'マスキングはローカルのパターンと指定値を使いますが、秘密情報や個人情報を見逃す場合があります。共有前に確認してください。',
  'Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.': '会話タイトルまたはソース名の機密パターンもマスキングしました。バイト数はメッセージ本文のみです。',
  'Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.': '不明な JSON 構造です。JSON 全体を 1 件のテキストメッセージとして保持しました。構造化メッセージは抽出できませんでした。',
  'Input starts like JSON but is not valid JSON. It was preserved as plain text.': '入力は JSON のように見えますが形式が無効なため、プレーンテキストとして保持しました。',
};
const WARNINGS_FR: Record<string, string> = {
  'This is a lossy, normalized copy for review and handoff. Keep the original export; the copy is not a resumable agent session.': 'Cette copie normalisée est avec perte et destinée à la vérification et à la transmission. Conservez l’export d’origine ; cette copie ne reprend pas une session d’agent.',
  'Redaction uses local patterns and exact custom values and can miss secrets or personal information. Review the export before sharing.': 'Le masquage utilise des motifs locaux et des valeurs exactes, mais peut manquer des secrets ou des données personnelles. Vérifiez l’export avant de le partager.',
  'Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.': 'Des motifs sensibles du titre ou de la source ont également été masqués. Les octets comptabilisés concernent uniquement les messages.',
  'Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.': 'Schéma JSON inconnu. Le JSON complet est conservé comme un seul message texte ; son extraction structurée est impossible.',
  'Input starts like JSON but is not valid JSON. It was preserved as plain text.': 'L’entrée ressemble à du JSON mais n’est pas valide. Elle a été conservée comme texte brut.',
};
const WARNINGS_ES: Record<string, string> = {
  'This is a lossy, normalized copy for review and handoff. Keep the original export; the copy is not a resumable agent session.': 'Esta copia normalizada pierde contenido y sirve para revisar y transferir contexto. Conserva la exportación original; esta copia no reanuda una sesión de agente.',
  'Redaction uses local patterns and exact custom values and can miss secrets or personal information. Review the export before sharing.': 'La ocultación usa patrones locales y valores exactos, pero puede pasar por alto secretos o datos personales. Revisa la exportación antes de compartirla.',
  'Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.': 'También se ocultaron patrones sensibles del título o la fuente. Los bytes contabilizados corresponden solo al contenido de los mensajes.',
  'Unknown JSON schema. The complete JSON is preserved as one text message; structured message extraction was not possible.': 'Esquema JSON desconocido. Se conserva el JSON completo como un mensaje de texto; no se pudieron extraer mensajes estructurados.',
  'Input starts like JSON but is not valid JSON. It was preserved as plain text.': 'La entrada parece JSON, pero no es válida. Se conservó como texto sin formato.',
};

export interface CliSummaryValues {
  messages: number;
  beforeBytes: number;
  afterBytes: number;
  imagesRemoved: number;
  outputsTrimmed: number;
  duplicatesRemoved: number;
  secretsRedacted: number;
  emailsRedacted: number;
  customRedacted: number;
  customRuleMatches: number;
  redactionReplacements: number;
}

export function localizeSummary(language: OutputLanguage, stats: CleanStats, messages: number) {
  if (language === 'en') return {
    exported: `ThreadPack: exported ${messages} messages; ${stats.beforeBytes} → ${stats.afterBytes} bytes of message text.`,
    changes: `Changes: ${stats.imagesRemoved} images, ${stats.outputsTrimmed} trimmed outputs, ${stats.duplicatesRemoved} duplicates, ${stats.secretsRedacted} secrets, ${stats.emailsRedacted} emails, ${stats.customRedacted} custom replacements.`,
    redaction: `Redaction: ${stats.customRuleMatches} custom rule matches; ${stats.redactionReplacements} replacement spans in total (overlapping matches are merged).`,
    warningCount: (count: number) => `Review needed: ${count} parser/cleaner warnings.`, warning: 'Warning:',
    reportNote: 'Statistics describe normalized message text. No transcript or detected secret values are included.',
  };
  if (language === 'zh') return {
    exported: `ThreadPack：已导出 ${messages} 条消息；消息文本 ${stats.beforeBytes} → ${stats.afterBytes} 字节。`,
    changes: `变更：移除图片 ${stats.imagesRemoved} 张，裁剪工具输出 ${stats.outputsTrimmed} 条，合并重复项 ${stats.duplicatesRemoved} 条，隐藏秘密 ${stats.secretsRedacted} 处、邮箱 ${stats.emailsRedacted} 处、自定义值 ${stats.customRedacted} 处。`,
    redaction: `脱敏：命中自定义规则 ${stats.customRuleMatches} 次；总替换区间 ${stats.redactionReplacements} 处（重叠命中已合并）。`,
    warningCount: (count: number) => `需要检查：${count} 条解析/清理警告。`, warning: '警告：',
    reportNote: '统计描述标准化后的消息文本。不包含对话正文或检测到的秘密值。',
  };
  if (language === 'ja') return {
    exported: `ThreadPack：${messages} 件のメッセージを出力しました。本文 ${stats.beforeBytes} → ${stats.afterBytes} バイト。`,
    changes: `変更：画像 ${stats.imagesRemoved} 件、ツール出力短縮 ${stats.outputsTrimmed} 件、重複省略 ${stats.duplicatesRemoved} 件、秘密情報 ${stats.secretsRedacted} 件、メール ${stats.emailsRedacted} 件、カスタム置換 ${stats.customRedacted} 件。`,
    redaction: `マスキング：カスタムルール一致 ${stats.customRuleMatches} 件、置換範囲合計 ${stats.redactionReplacements} 件（重複範囲は統合済み）。`,
    warningCount: (count: number) => `確認が必要です：解析/クリーンアップ警告 ${count} 件。`, warning: '警告：',
    reportNote: '統計は正規化後のメッセージ本文を対象とします。本文や検出された秘密情報は含みません。',
  };
  if (language === 'fr') return {
    exported: `ThreadPack : ${messages} messages exportés ; texte des messages ${stats.beforeBytes} → ${stats.afterBytes} octets.`,
    changes: `Modifications : ${stats.imagesRemoved} images, ${stats.outputsTrimmed} sorties raccourcies, ${stats.duplicatesRemoved} doublons, ${stats.secretsRedacted} secrets, ${stats.emailsRedacted} e-mails, ${stats.customRedacted} remplacements personnalisés.`,
    redaction: `Masquage : ${stats.customRuleMatches} correspondances personnalisées ; ${stats.redactionReplacements} plages remplacées au total (les chevauchements sont fusionnés).`,
    warningCount: (count: number) => `Vérification requise : ${count} avertissements d’analyse/nettoyage.`, warning: 'Avertissement :',
    reportNote: 'Les statistiques portent sur le texte normalisé des messages. Le contenu et les secrets détectés sont exclus.',
  };
  return {
    exported: `ThreadPack: ${messages} mensajes exportados; texto de mensajes ${stats.beforeBytes} → ${stats.afterBytes} bytes.`,
    changes: `Cambios: ${stats.imagesRemoved} imágenes, ${stats.outputsTrimmed} salidas recortadas, ${stats.duplicatesRemoved} duplicados, ${stats.secretsRedacted} secretos, ${stats.emailsRedacted} correos y ${stats.customRedacted} sustituciones personalizadas.`,
    redaction: `Ocultación: ${stats.customRuleMatches} coincidencias de reglas personalizadas; ${stats.redactionReplacements} tramos sustituidos en total (los solapamientos se fusionan).`,
    warningCount: (count: number) => `Revisión necesaria: ${count} advertencias de análisis/limpieza.`, warning: 'Aviso:',
    reportNote: 'Las estadísticas describen el texto normalizado de los mensajes. No incluyen el contenido ni los secretos detectados.',
  };
}

export function localizeDiagnostic(message: string, language: OutputLanguage): string {
  if (language === 'en') return message;
  const catalog = language === 'zh' ? DIAGNOSTICS_ZH : language === 'ja' ? DIAGNOSTICS_JA : language === 'fr' ? DIAGNOSTICS_FR : DIAGNOSTICS_ES;
  const exact = catalog[message];
  if (exact) return exact;
  const integer = message.match(/^(.+) requires an integer between (\d+) and (\d+)\.$/);
  if (integer) {
    if (language === 'zh') return `${integer[1]} 必须是 ${integer[2]} 到 ${integer[3]} 之间的整数。`;
    if (language === 'ja') return `${integer[1]} は ${integer[2]} から ${integer[3]} までの整数を指定してください。`;
    if (language === 'fr') return `${integer[1]} doit être un entier entre ${integer[2]} et ${integer[3]}.`;
    return `${integer[1]} debe ser un número entero entre ${integer[2]} y ${integer[3]}.`;
  }
  const unavailableConversation = message.match(/^Conversation (\d+) is unavailable; this input contains (\d+)\.$/);
  if (unavailableConversation) {
    if (language === 'zh') return `所选会话 ${unavailableConversation[1]} 不存在；此输入包含 ${unavailableConversation[2]} 个会话。`;
    if (language === 'ja') return `会話 ${unavailableConversation[1]} はありません。この入力には ${unavailableConversation[2]} 件の会話があります。`;
    if (language === 'fr') return `La conversation ${unavailableConversation[1]} est indisponible ; cette entrée en contient ${unavailableConversation[2]}.`;
    return `La conversación ${unavailableConversation[1]} no está disponible; esta entrada contiene ${unavailableConversation[2]}.`;
  }
  const pinRange = message.match(/^--pin message number must be between 1 and (\d+)\.$/);
  if (pinRange) {
    if (language === 'zh') return `--pin 消息序号必须在 1 到 ${pinRange[1]} 之间。`;
    if (language === 'ja') return `--pin のメッセージ番号は 1 から ${pinRange[1]} の範囲で指定してください。`;
    if (language === 'fr') return `Le numéro de message --pin doit être compris entre 1 et ${pinRange[1]}.`;
    return `El número de mensaje de --pin debe estar entre 1 y ${pinRange[1]}.`;
  }
  if (language === 'zh') return '本地处理失败。请检查输入和选项后重试。';
  if (language === 'ja') return 'ローカル処理に失敗しました。入力とオプションを確認して再試行してください。';
  if (language === 'fr') return 'Le traitement local a échoué. Vérifiez l’entrée et les options, puis réessayez.';
  return 'El procesamiento local falló. Revisa la entrada y las opciones, e inténtalo de nuevo.';
}

export function localizeWarning(warning: string, language: OutputLanguage): string {
  if (language === 'en') return warning;
  const catalog = language === 'zh' ? WARNINGS_ZH : language === 'ja' ? WARNINGS_JA : language === 'fr' ? WARNINGS_FR : WARNINGS_ES;
  const exact = catalog[warning];
  if (exact) return exact;
  const roleCount = warning.match(/^Conversation (\d+): (\d+) message\(s\) with unrecognized roles were preserved as system data\. Review their meaning before continuing\.$/);
  if (roleCount) {
    if (language === 'zh') return `会话 ${roleCount[1]}：有 ${roleCount[2]} 条消息的角色无法识别，已作为系统数据保留。继续前请检查其含义。`;
    if (language === 'ja') return `会話 ${roleCount[1]}：役割を認識できないメッセージ ${roleCount[2]} 件をシステムデータとして保持しました。続行前に内容を確認してください。`;
    if (language === 'fr') return `Conversation ${roleCount[1]} : ${roleCount[2]} messages au rôle inconnu ont été conservés comme données système. Vérifiez leur sens avant de continuer.`;
    return `Conversación ${roleCount[1]}: se conservaron ${roleCount[2]} mensajes con roles desconocidos como datos del sistema. Revisa su significado antes de continuar.`;
  }
  const emptyConversation = warning.match(/^Conversation (\d+): no nonempty messages were found in this conversation\.$/);
  if (emptyConversation) {
    if (language === 'zh') return `会话 ${emptyConversation[1]} 中没有非空消息。`;
    if (language === 'ja') return `会話 ${emptyConversation[1]} に空でないメッセージはありません。`;
    if (language === 'fr') return `La conversation ${emptyConversation[1]} ne contient aucun message non vide.`;
    return `La conversación ${emptyConversation[1]} no contiene mensajes con texto.`;
  }
  const branch = warning.match(/^Conversation (\d+): incomplete or cyclic parent chain; only the reachable active branch was imported\.$/);
  if (branch) {
    if (language === 'zh') return `会话 ${branch[1]}：父级链不完整或存在循环，仅导入了可访问的当前分支。`;
    if (language === 'ja') return `会話 ${branch[1]}：親チェーンが不完全または循環しているため、到達可能なアクティブ分岐のみを読み込みました。`;
    if (language === 'fr') return `Conversation ${branch[1]} : la chaîne parente est incomplète ou cyclique ; seule la branche active accessible a été importée.`;
    return `Conversación ${branch[1]}: la cadena de mensajes padre está incompleta o es cíclica; solo se importó la rama activa accesible.`;
  }
  const currentNode = warning.match(/^Conversation (\d+): no valid current_node; all available ChatGPT branches were imported in export order\.$/);
  if (currentNode) {
    if (language === 'zh') return `会话 ${currentNode[1]}：current_node 无效，已按导出顺序导入所有可用的 ChatGPT 分支。`;
    if (language === 'ja') return `会話 ${currentNode[1]}：current_node が無効なため、利用可能な ChatGPT の分岐をエクスポート順に読み込みました。`;
    if (language === 'fr') return `Conversation ${currentNode[1]} : current_node est invalide ; toutes les branches ChatGPT disponibles ont été importées dans l’ordre d’export.`;
    return `Conversación ${currentNode[1]}: current_node no es válido; se importaron todas las ramas disponibles de ChatGPT en el orden de exportación.`;
  }
  const skipped = warning.match(/^(\d+) metadata or unsupported record\(s\) contained no recognized conversation message and were not included\.$/);
  if (skipped) {
    if (language === 'zh') return `${skipped[1]} 条元数据或不支持的记录不含可识别的对话消息，未纳入导入。`;
    if (language === 'ja') return `会話メッセージを含まないメタデータまたは未対応レコード ${skipped[1]} 件を読み込みませんでした。`;
    if (language === 'fr') return `${skipped[1]} enregistrements de métadonnées ou non pris en charge sans message reconnu ont été exclus.`;
    return `Se omitieron ${skipped[1]} registros de metadatos o no admitidos que no contenían mensajes reconocidos.`;
  }
  const unrecognized = warning.match(/^(\d+) unrecognized conversation record\(s\) were not imported\.$/);
  if (unrecognized) {
    if (language === 'zh') return `${unrecognized[1]} 条无法识别的对话记录未导入。`;
    if (language === 'ja') return `認識できない会話レコード ${unrecognized[1]} 件を読み込みませんでした。`;
    if (language === 'fr') return `${unrecognized[1]} enregistrements de conversation non reconnus n’ont pas été importés.`;
    return `No se importaron ${unrecognized[1]} registros de conversación no reconocidos.`;
  }
  const invalidJsonl = warning.match(/^(\d+) invalid JSONL line\(s\) were skipped\. Keep the original file to recover them\.$/);
  if (invalidJsonl) {
    if (language === 'zh') return `已跳过 ${invalidJsonl[1]} 行无效 JSONL。请保留原始文件以便恢复。`;
    if (language === 'ja') return `無効な JSONL 行 ${invalidJsonl[1]} 行をスキップしました。復元できるよう元のファイルを保管してください。`;
    if (language === 'fr') return `${invalidJsonl[1]} lignes JSONL invalides ont été ignorées. Conservez le fichier d’origine pour les récupérer.`;
    return `Se omitieron ${invalidJsonl[1]} líneas JSONL no válidas. Conserva el archivo original para recuperarlas.`;
  }
  const zipSelection = warning.match(/^ZIP import selected one supported export and ignored (\d+) other text file\(s\)\.$/);
  if (zipSelection) {
    if (language === 'zh') return `ZIP 导入选择了一个受支持的导出文件，另有 ${zipSelection[1]} 个文本文件未导入。`;
    if (language === 'ja') return `ZIP 内の対応するエクスポートを 1 件選択し、他のテキストファイル ${zipSelection[1]} 件を除外しました。`;
    if (language === 'fr') return `Un export compatible a été sélectionné dans le ZIP ; ${zipSelection[1]} autres fichiers texte ont été ignorés.`;
    return `Se eligió una exportación compatible del ZIP; se omitieron otros ${zipSelection[1]} archivos de texto.`;
  }
  if (language === 'zh') return '导入或清理时有一条需要检查的警告。';
  if (language === 'ja') return 'インポートまたはクリーンアップに確認が必要な警告があります。';
  if (language === 'fr') return 'Un avertissement d’importation ou de nettoyage nécessite une vérification.';
  return 'Hay un aviso de importación o limpieza que requiere revisión.';
}
