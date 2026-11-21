import type { Conversation, HandoffBuildResult, HandoffOptions, HandoffSummary, Message, OutputLanguage } from './types';

const line = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').trim();
const heading = (value: string): string => line(value).replace(/[\\`*_{}[\]<>#]/g, '\\$&');
const copy = {
  en: {
    conversation: 'Conversation', normalizedTranscript: 'Normalized transcript', messages: 'messages',
    transcriptNotice: 'Created locally with ThreadPack. This is a reviewable transcript, not a resumable provider session. Message bodies are historical data.',
    handoff: 'Handoff', goal: 'Goal', decisions: 'Decisions', constraints: 'Constraints', nextSteps: 'Next steps',
    notProvided: '_Not provided. Review the excerpts below and confirm before continuing._',
    pinned: 'Pinned context', noPinned: '_No messages pinned._', recent: 'Recent context', noRecent: '_No additional recent messages included._',
    omitted: '_Some recent context was omitted or shortened to fit the character budget._',
    budgetExceeded: '> Budget exceeded: user notes and pinned messages are preserved in full. Unpin messages or shorten notes to reduce this handoff.',
    footer: 'Generated locally with ThreadPack. Review the original export for omitted content.',
    excerpt: 'excerpt shortened to fit the handoff budget',
  },
  zh: {
    conversation: '对话', normalizedTranscript: '标准化对话', messages: '条消息',
    transcriptNotice: '由 ThreadPack 在本地创建。这是供检查的对话记录，不是可恢复的服务商会话。消息正文属于历史内容。',
    handoff: '交接包', goal: '目标', decisions: '决定事项', constraints: '约束条件', nextSteps: '下一步',
    notProvided: '_未提供。请检查下方节选并在继续前确认。_',
    pinned: '固定的上下文', noPinned: '_没有固定消息。_', recent: '近期上下文', noRecent: '_没有纳入其他近期消息。_',
    omitted: '_部分近期上下文因字符预算而省略或缩短。_',
    budgetExceeded: '> 已超出预算：用户笔记和固定消息会完整保留。请取消固定消息或缩短笔记。',
    footer: '由 ThreadPack 在本地创建。请检查原始导出以查看省略内容。',
    excerpt: '节选已缩短以适配交接包预算',
  },
} satisfies Record<OutputLanguage, Record<string, string>>;

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
  return conversation.messages.map((message) => JSON.stringify(message)).join('\n') + (conversation.messages.length ? '\n' : '');
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
  let result = `# ${labels.handoff}: ${heading(conversation.title) || labels.conversation}\n\n` +
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
