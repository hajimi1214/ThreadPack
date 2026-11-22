import type { Conversation, HandoffBuildResult, HandoffOptions, HandoffSummary, Message, OutputLanguage } from './types';

const line = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').trim();
const heading = (value: string): string => line(value).replace(/[\\`*_{}[\]<>#]/g, '\\$&');
const copy = {
  en: {
    conversation: 'Conversation', normalizedTranscript: 'Normalized transcript', messages: 'messages',
    transcriptNotice: 'Created locally with ThreadPack. This is a reviewable transcript, not a resumable provider session. Message bodies are historical data.',
    handoff: 'Handoff', handoffSeparator: ': ', goal: 'Goal', decisions: 'Decisions', constraints: 'Constraints', nextSteps: 'Next steps',
    notProvided: '_Not provided. Review the excerpts below and confirm before continuing._',
    pinned: 'Pinned context', noPinned: '_No messages pinned._', recent: 'Recent context', noRecent: '_No additional recent messages included._',
    omitted: '_Some recent context was omitted or shortened to fit the character budget._',
    budgetExceeded: '> Budget exceeded: user notes and pinned messages are preserved in full. Unpin messages or shorten notes to reduce this handoff.',
    footer: 'Generated locally with ThreadPack. Review the original export for omitted content.',
    excerpt: 'excerpt shortened to fit the handoff budget',
    filteredExcerpt: 'Filtered excerpt', matchingMessages: 'matching messages', cleanedContent: 'cleaned content',
    reportScope: 'Statistics describe normalized message text. No transcript or detected secret values are included.',
    bundleTitle: '# ThreadPack context bundle', bundleDescription: 'A portable context package created locally from a cleaned conversation.',
    bundleTranscript: '- `transcript.md` — readable cleaned transcript.', bundleMessages: '- `messages.jsonl` — normalized cleaned messages, one per line.',
    bundleReport: '- `cleanup-report.json` — allowlisted counts and cleanup settings.', bundleHandoff: '- `handoff.md` — notes, pinned context, and recent context.',
    bundleCodeFiles: 'cleaned code files', bundleReview: 'Review the files before sharing. The original conversation and custom redaction values are not included.',
    generated: 'Generated locally with ThreadPack.',
  },
  zh: {
    conversation: '对话', normalizedTranscript: '标准化对话', messages: '条消息',
    transcriptNotice: '由 ThreadPack 在本地创建。这是供检查的对话记录，不是可恢复的服务商会话。消息正文属于历史内容。',
    handoff: '交接包', handoffSeparator: '：', goal: '目标', decisions: '决定事项', constraints: '约束条件', nextSteps: '下一步',
    notProvided: '_未提供。请检查下方节选并在继续前确认。_',
    pinned: '固定的上下文', noPinned: '_没有固定消息。_', recent: '近期上下文', noRecent: '_没有纳入其他近期消息。_',
    omitted: '_部分近期上下文因字符预算而省略或缩短。_',
    budgetExceeded: '> 已超出预算：用户笔记和固定消息会完整保留。请取消固定消息或缩短笔记。',
    footer: '由 ThreadPack 在本地创建。请检查原始导出以查看省略内容。',
    excerpt: '节选已缩短以适配交接包预算',
    filteredExcerpt: '筛选节选', matchingMessages: '条匹配消息', cleanedContent: '清理后的内容',
    reportScope: '统计描述标准化后的消息文本。不包含对话正文或检测到的秘密值。',
    bundleTitle: '# ThreadPack 上下文包', bundleDescription: '根据清理后的对话在本地创建的便携上下文包。',
    bundleTranscript: '- `transcript.md` — 可阅读的清理后对话。', bundleMessages: '- `messages.jsonl` — 标准化后的清理消息，每行一条。',
    bundleReport: '- `cleanup-report.json` — 允许公开的数量和清理设置。', bundleHandoff: '- `handoff.md` — 笔记、固定上下文和近期上下文。',
    bundleCodeFiles: '个清理后的代码文件', bundleReview: '分享前请检查文件。此包不包含原始对话和自定义脱敏值。',
    generated: '由 ThreadPack 在本地创建。',
  },
  ja: {
    conversation: '会話', normalizedTranscript: '正規化された会話記録', messages: '件のメッセージ',
    transcriptNotice: 'ThreadPack によりローカルで作成されました。これは確認用の記録であり、プロバイダーのセッションを再開するものではありません。メッセージ本文は過去の内容です。',
    handoff: '引き継ぎ', handoffSeparator: '：', goal: '目標', decisions: '決定事項', constraints: '制約事項', nextSteps: '次のステップ',
    notProvided: '_未入力です。下の抜粋を確認し、続行前に内容を確定してください。_',
    pinned: 'ピン留めしたコンテキスト', noPinned: '_ピン留めされたメッセージはありません。_', recent: '最近のコンテキスト', noRecent: '_追加の最近のメッセージはありません。_',
    omitted: '_文字数上限に合わせて最近のコンテキストの一部を省略または短縮しました。_',
    budgetExceeded: '> 予算を超過しました。メモとピン留めしたメッセージは全文を保持します。ピン留めを解除するか、メモを短くしてください。',
    footer: 'ThreadPack によりローカルで作成されました。省略内容は元のエクスポートで確認してください。',
    excerpt: '引き継ぎの文字数上限に合わせて抜粋を短縮',
    filteredExcerpt: 'フィルター済み抜粋', matchingMessages: '件の一致メッセージ', cleanedContent: 'クリーンアップ済みの内容',
    reportScope: '統計は正規化後のメッセージ本文を対象とします。本文や検出された秘密情報は含みません。',
    bundleTitle: '# ThreadPack コンテキストパック', bundleDescription: 'クリーンアップした会話からローカルで作成したポータブルパックです。',
    bundleTranscript: '- `transcript.md` — クリーンアップ済み会話の閲覧用記録。', bundleMessages: '- `messages.jsonl` — 正規化されたメッセージ。1 行に 1 件。',
    bundleReport: '- `cleanup-report.json` — 公開可能な件数と設定。', bundleHandoff: '- `handoff.md` — メモ、ピン留め、最近のコンテキスト。',
    bundleCodeFiles: '件のクリーンアップ済みコードファイル', bundleReview: '共有前にファイルを確認してください。元の会話とカスタムマスキング値は含まれません。',
    generated: 'ThreadPack によりローカルで作成されました。',
  },
  fr: {
    conversation: 'Conversation', normalizedTranscript: 'Transcription normalisée', messages: 'messages',
    transcriptNotice: 'Créé localement avec ThreadPack. Cette transcription est destinée à la consultation et ne permet pas de reprendre une session fournisseur. Les messages sont historiques.',
    handoff: 'Transmission', handoffSeparator: ' : ', goal: 'Objectif', decisions: 'Décisions', constraints: 'Contraintes', nextSteps: 'Prochaines étapes',
    notProvided: '_Non renseigné. Vérifiez les extraits ci-dessous et confirmez avant de continuer._',
    pinned: 'Contexte épinglé', noPinned: '_Aucun message épinglé._', recent: 'Contexte récent', noRecent: '_Aucun autre message récent inclus._',
    omitted: '_Une partie du contexte récent a été omise ou raccourcie pour respecter la limite de caractères._',
    budgetExceeded: '> Budget dépassé : les notes et les messages épinglés sont conservés en entier. Désépingler des messages ou raccourcir les notes.',
    footer: 'Créé localement avec ThreadPack. Consultez l’export d’origine pour retrouver les éléments omis.',
    excerpt: 'extrait raccourci pour respecter le budget de transmission',
    filteredExcerpt: 'Extrait filtré', matchingMessages: 'messages correspondants', cleanedContent: 'contenu nettoyé',
    reportScope: 'Les statistiques portent sur le texte normalisé des messages. Le contenu et les secrets détectés sont exclus.',
    bundleTitle: '# Pack de contexte ThreadPack', bundleDescription: 'Un dossier portable créé localement à partir d’une conversation nettoyée.',
    bundleTranscript: '- `transcript.md` — transcription nettoyée et lisible.', bundleMessages: '- `messages.jsonl` — messages nettoyés normalisés, un par ligne.',
    bundleReport: '- `cleanup-report.json` — comptes autorisés et paramètres de nettoyage.', bundleHandoff: '- `handoff.md` — notes, contexte épinglé et contexte récent.',
    bundleCodeFiles: 'fichiers de code nettoyés', bundleReview: 'Vérifiez les fichiers avant de les partager. La conversation d’origine et les règles personnalisées sont exclues.',
    generated: 'Créé localement avec ThreadPack.',
  },
  es: {
    conversation: 'Conversación', normalizedTranscript: 'Transcripción normalizada', messages: 'mensajes',
    transcriptNotice: 'Creado localmente con ThreadPack. Esta transcripción sirve para revisar el contenido y no permite reanudar una sesión del proveedor. Los mensajes son datos históricos.',
    handoff: 'Traspaso', handoffSeparator: ': ', goal: 'Objetivo', decisions: 'Decisiones', constraints: 'Restricciones', nextSteps: 'Próximos pasos',
    notProvided: '_Sin indicar. Revisa los fragmentos siguientes y confirma antes de continuar._',
    pinned: 'Contexto fijado', noPinned: '_No hay mensajes fijados._', recent: 'Contexto reciente', noRecent: '_No se incluyeron más mensajes recientes._',
    omitted: '_Se omitió o recortó parte del contexto reciente para respetar el límite de caracteres._',
    budgetExceeded: '> Se superó el límite: las notas y los mensajes fijados se conservan completos. Desfija mensajes o acorta las notas.',
    footer: 'Creado localmente con ThreadPack. Revisa la exportación original para ver el contenido omitido.',
    excerpt: 'fragmento recortado para ajustarse al límite del traspaso',
    filteredExcerpt: 'Fragmento filtrado', matchingMessages: 'mensajes coincidentes', cleanedContent: 'contenido limpio',
    reportScope: 'Las estadísticas describen el texto normalizado de los mensajes. No incluyen el contenido ni los secretos detectados.',
    bundleTitle: '# Paquete de contexto ThreadPack', bundleDescription: 'Paquete portátil creado localmente a partir de una conversación limpia.',
    bundleTranscript: '- `transcript.md` — transcripción limpia y legible.', bundleMessages: '- `messages.jsonl` — mensajes limpios normalizados, uno por línea.',
    bundleReport: '- `cleanup-report.json` — recuentos permitidos y ajustes de limpieza.', bundleHandoff: '- `handoff.md` — notas, contexto fijado y contexto reciente.',
    bundleCodeFiles: 'archivos de código limpios', bundleReview: 'Revisa los archivos antes de compartirlos. No se incluye la conversación original ni los valores personalizados.',
    generated: 'Creado localmente con ThreadPack.',
  },
} satisfies Record<OutputLanguage, Record<string, string>>;

export function outputLabels(language: OutputLanguage): Readonly<Record<string, string>> {
  return copy[language];
}

export function buildFilteredTranscript(conversation: Conversation, messageCount: number, language: OutputLanguage): string {
  const labels = copy[language];
  return `# ${labels.filteredExcerpt}\n\n${messageCount} ${labels.matchingMessages} · ${labels.cleanedContent}\n\n${buildTranscript(conversation, language)}`;
}

export function buildContextBundleReadme(language: OutputLanguage, hasHandoff: boolean, codeFileCount: number): string {
  const labels = copy[language];
  return [
    labels.bundleTitle, '', labels.bundleDescription, '',
    labels.bundleTranscript, labels.bundleMessages, labels.bundleReport,
    ...(hasHandoff ? [labels.bundleHandoff] : []),
    ...(codeFileCount ? [`- code/ — ${codeFileCount} ${labels.bundleCodeFiles}.`] : []), '',
    labels.bundleReview, '', labels.generated, '',
  ].join('\n');
}

function quoted(content: string): string {
  let fenceLength = 3;
  for (const match of content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  return `${fence}text\n${content}\n${fence}`;
}

function messageBlock(message: Message): string {
  const timestamp = message.timestamp ? ` · ${line(message.timestamp)}` : '';
  return `### ${message.role.toUpperCase()} · ${heading(message.id)}${timestamp}\n\n${quoted(message.content)}`;
}

export function buildTranscript(conversation: Conversation, language: OutputLanguage = 'en'): string {
  const labels = copy[language];
  return `# ${heading(conversation.title) || labels.conversation}\n\n` +
    `${labels.normalizedTranscript} · ${heading(conversation.source)} · ${conversation.messages.length} ${labels.messages}\n\n` +
    `> ${labels.transcriptNotice}\n\n` +
    conversation.messages.map(messageBlock).join('\n\n') + '\n';
}

export function buildJsonl(conversation: Conversation): string {
  if (conversation.history || conversation.events?.length
    || conversation.integrity?.status === 'partial' || !conversation.messages.length) {
    const records = [{
      type: 'threadpack_session', version: 2,
      id: conversation.id, title: conversation.title, source: conversation.source,
      ...(conversation.provenance ? { provenance: conversation.provenance } : {}),
      ...(conversation.integrity ? { integrity: conversation.integrity } : {}),
      branches: conversation.history?.branches ?? [],
      activeBranchId: conversation.history?.activeBranchId ?? '',
    }, ...(conversation.history?.messages ?? conversation.messages).map(message => ({ type: 'threadpack_message', message })),
    ...(conversation.events ?? []).map(event => ({ type: 'threadpack_event', event }))];
    return records.map(record => JSON.stringify(record)).join('\n') + '\n';
  }
  return conversation.messages.map(message => {
    if (!conversation.provenance) return JSON.stringify(message);
    return JSON.stringify({ ...message, provenance: {
      ...message.provenance,
      platform: message.provenance?.platform ?? conversation.provenance.platform,
      ...(conversation.provenance.sourceId ? { conversationSourceId: conversation.provenance.sourceId } : {}),
      ...(conversation.provenance.sourceRecordCount !== undefined ? { conversationSourceRecordCount: conversation.provenance.sourceRecordCount } : {}),
      conversationTitle: conversation.title,
      conversationSource: conversation.source,
    } });
  }).join('\n') + (conversation.messages.length ? '\n' : '');
}

function excerpt(content: string, budget: number, language: OutputLanguage): string {
  const marker = `\n[ThreadPack: ${copy[language].excerpt}]\n`;
  if (content.length <= budget) return content;
  if (budget <= marker.length) return marker.trim();
  const available = budget - marker.length;
  const head = Math.ceil(available * 0.6);
  return content.slice(0, head) + marker + content.slice(-(available - head));
}

function messageBlockOverhead(message: Message): number {
  const emptyBlockLength = messageBlock({ ...message, content: '' }).length;
  let fenceLength = 3;
  for (const match of message.content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  return emptyBlockLength + (fenceLength - 3) * 2;
}

function allocateContentBudgets(messages: Message[], totalBudget: number): number[] {
  const allocations = new Array<number>(messages.length).fill(0);
  let remainingBudget = totalBudget;
  let active = messages.map((_, index) => index);
  while (active.length > 0) {
    const share = Math.floor(remainingBudget / active.length);
    const complete = active.filter((index) => messages[index]!.content.length <= share);
    if (complete.length === 0) {
      for (const index of active) allocations[index] = share;
      break;
    }
    for (const index of complete) {
      allocations[index] = messages[index]!.content.length;
      remainingBudget -= allocations[index]!;
    }
    const completeSet = new Set(complete);
    active = active.filter((index) => !completeSet.has(index));
  }
  return allocations;
}

export function buildHandoff(conversation: Conversation, options: HandoffOptions): string {
  return buildHandoffWithSummary(conversation, options).text;
}

export function buildHandoffWithSummary(conversation: Conversation, options: HandoffOptions): HandoffBuildResult {
  const maxCharacters = options.maxCharacters ?? 16000;
  if (!Number.isFinite(maxCharacters) || maxCharacters < 1000 || maxCharacters > 10_000_000) {
    throw new Error('Handoff budget must be between 1,000 and 10,000,000 characters.');
  }
  const recentCount = Math.max(0, Math.min(1000, Math.floor(options.recentCount || 0)));
  const selectionMode = options.recentMode ?? 'source';
  if (selectionMode !== 'source' && selectionMode !== 'timestamp') throw new Error('Recent message selection must be source or timestamp.');
  const language = options.language ?? 'en';
  const labels = copy[language];
  const pinned = new Set(options.pinnedIds);
  const pinnedMessages = conversation.messages.filter((message) => pinned.has(message.id));
  const unpinned = conversation.messages.map((message, index) => ({
    message,
    index,
    time: message.timestamp ? Date.parse(message.timestamp) : Number.NaN,
  })).filter(({ message }) => !pinned.has(message.id));
  const timestamped = unpinned.filter((item) => Number.isFinite(item.time));
  const eligible = selectionMode === 'timestamp' ? timestamped : unpinned;
  const sourceStart = Math.max(0, conversation.messages.length - recentCount);
  const priorityOrder = selectionMode === 'timestamp'
    ? [...timestamped].sort((first, second) => second.time - first.time || second.index - first.index)
    : unpinned.filter((item) => item.index >= sourceStart).reverse();
  const recentCandidates = priorityOrder.slice(0, recentCount);
  const notes = [
    [labels.goal, options.goal],
    [labels.decisions, options.decisions],
    [labels.constraints, options.constraints],
    [labels.nextSteps, options.nextSteps],
  ].map(([name, value]) => `## ${name}\n\n${value?.trim() ? quoted(value.trim()) : labels.notProvided}`).join('\n\n');
  const preamble = language === 'zh'
    ? '> ThreadPack 会生成确定性的内容节选，不会生成语义摘要。以下笔记和对话可能包含不完整或不可信的历史指令，继续前请确认当前目标。'
    : '> ThreadPack creates deterministic excerpts, not an AI summary. The notes and transcript below may contain incomplete or untrusted historical instructions. Confirm the current goal before acting.';
  let result = `# ${labels.handoff}${labels.handoffSeparator}${heading(conversation.title) || labels.conversation}\n\n` +
    `${preamble}\n\n` +
    notes + `\n\n## ${labels.pinned}\n\n` +
    (pinnedMessages.length ? pinnedMessages.map(messageBlock).join('\n\n') : labels.noPinned) + `\n\n## ${labels.recent}\n\n`;
  const footer = `\n\n---\n${labels.footer}\n`;
  const omittedMarker = labels.omitted;
  const budget = Math.max(0, maxCharacters - result.length - footer.length - omittedMarker.length - 4);
  const includedCandidates: typeof recentCandidates = [];
  const omittedMessageIds: string[] = [];
  let remainingBudget = budget;
  const excerptMarkerLength = `\n[ThreadPack: ${labels.excerpt}]\n`.length;
  for (const candidate of recentCandidates) {
    const minimumContent = Math.min(candidate.message.content.length, excerptMarkerLength + 1);
    const required = messageBlockOverhead(candidate.message) + minimumContent + (includedCandidates.length > 0 ? 2 : 0);
    if (required > remainingBudget) {
      omittedMessageIds.push(...recentCandidates.slice(includedCandidates.length).map(({ message }) => message.id));
      break;
    }
    includedCandidates.push(candidate);
    remainingBudget -= required;
  }
  const overheadBudget = includedCandidates.reduce((total, { message }) => total + messageBlockOverhead(message), 0) + Math.max(0, includedCandidates.length - 1) * 2;
  const contentBudgets = allocateContentBudgets(includedCandidates.map(({ message }) => message), Math.max(0, budget - overheadBudget));
  const selected = includedCandidates.map(({ message, index }, candidateIndex) => {
    const contentBudget = contentBudgets[candidateIndex]!;
    const truncated = message.content.length > contentBudget;
    return {
      index,
      truncated,
      message: truncated ? { ...message, content: excerpt(message.content, contentBudget, language) } : message,
    };
  });
  const truncatedMessageIds = selected.filter((item) => item.truncated).map(({ message }) => message.id);
  selected.sort((first, second) => first.index - second.index);
  result += selected.length ? selected.map(({ message }) => messageBlock(message)).join('\n\n') : labels.noRecent;
  if (omittedMessageIds.length || truncatedMessageIds.length) result += `\n\n${omittedMarker}`;
  const budgetExceeded = result.length + footer.length > maxCharacters;
  if (budgetExceeded) {
    result += `\n\n${labels.budgetExceeded}`;
  }
  const includedTimes = selected.map(({ message }) => message.timestamp ? Date.parse(message.timestamp) : Number.NaN)
    .filter(Number.isFinite).sort((first, second) => first - second);
  const timeRange = includedTimes.length ? {
    start: new Date(includedTimes[0]!).toISOString(),
    end: new Date(includedTimes.at(-1)!).toISOString(),
  } : null;
  const sourceIndexes = new Map(conversation.messages.map((message, index) => [message.id, index]));
  const sourceIndex = (id: string) => sourceIndexes.get(id) ?? -1;
  omittedMessageIds.sort((first, second) => sourceIndex(first) - sourceIndex(second));
  truncatedMessageIds.sort((first, second) => sourceIndex(first) - sourceIndex(second));
  const summary: HandoffSummary = {
    selectionMode,
    maxCharacters,
    budgetExceeded,
    requestedRecentCount: recentCount,
    eligibleMessageCount: eligible.length,
    selectedRecentMessageCount: recentCandidates.length,
    completeMessageCount: pinnedMessages.length + selected.filter((item) => !item.truncated).length,
    omittedMessageCount: omittedMessageIds.length,
    omittedMessageIds,
    truncatedMessageCount: truncatedMessageIds.length,
    truncatedMessageIds,
    notSelectedMessageCount: Math.max(0, eligible.length - recentCandidates.length),
    missingTimestampCount: selectionMode === 'timestamp' ? unpinned.length - timestamped.length : 0,
    timeRange,
  };
  return { text: result + footer, summary };
}
