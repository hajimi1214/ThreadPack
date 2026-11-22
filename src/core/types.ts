export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type MessageKind = 'message' | 'tool-call' | 'tool-result' | 'reasoning' | 'summary' | 'compaction' | 'metadata';

export type SourcePlatform = 'chatgpt' | 'codex' | 'claude' | 'claude-code' | 'openai' | 'generic' | 'text' | 'threadpack' | 'unknown';

export interface MessageProvenance {
  platform: SourcePlatform;
  platformId?: string;
  recordIndex?: number;
  recordType?: string;
  sourceNodeId?: string;
  parentSourceId?: string;
  toolCallSourceId?: string;
  conversationSourceId?: string;
  conversationSourceRecordCount?: number;
  conversationTitle?: string;
  conversationSource?: string;
  rawTimestamp?: string | number;
}

export interface SessionEvent {
  id: string;
  type: string;
  recordIndex: number;
  platform: SourcePlatform;
  sourceId?: string;
  rawTimestamp?: string | number;
  timestamp?: string;
  content: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp?: string;
  kind?: MessageKind;
  parentId?: string;
  toolCallId?: string;
  toolName?: string;
  provenance?: MessageProvenance;
}

export interface ConversationBranch {
  id: string;
  headMessageId: string;
  messageIds: string[];
  sourceNodeIds?: string[];
}

export interface ConversationHistory {
  messages: Message[];
  branches: ConversationBranch[];
  activeBranchId: string;
}

export interface ConversationProvenance {
  platform: SourcePlatform;
  sourceId?: string;
  sourceRecordCount?: number;
}

export interface SourceProvenance {
  platform: SourcePlatform;
  format: string;
  byteLength: number;
}

export interface IntegrityIssue {
  code: 'malformed-record' | 'unknown-record' | 'empty-conversation' | 'missing-parent' | 'cyclic-parent' | 'duplicate-source-id' | 'orphan-tool-result' | 'unmatched-tool-call' | 'invalid-branch-reference' | 'invalid-provenance';
  severity: 'warning' | 'error';
  count: number;
}

export interface IntegrityReport {
  status: 'complete' | 'partial';
  sourceRecordCount: number;
  importedMessageCount: number;
  branchCount: number;
  timelineEventCount: number;
  toolCallCount: number;
  issueCount: number;
  issues: IntegrityIssue[];
}

export interface Conversation {
  id: string;
  title: string;
  source: string;
  messages: Message[];
  events?: SessionEvent[];
  provenance?: ConversationProvenance;
  history?: ConversationHistory;
  integrity?: IntegrityReport;
}

export interface ParsedArchive {
  format: string;
  conversations: Conversation[];
  warnings: string[];
  sourceBytes: number;
  provenance?: SourceProvenance;
  integrity?: IntegrityReport;
}

export interface CleanOptions {
  stripImages: boolean;
  trimToolOutputs: boolean;
  toolLimit: number;
  deduplicate: boolean;
  redact: boolean;
  redactEmails: boolean;
  customSecrets?: string[];
}

export interface Change {
  messageId: string;
  kind: 'image' | 'tool' | 'duplicate' | 'secret' | 'email' | 'custom';
  count: number;
  removedBytes: number;
}

export interface CleanStats {
  beforeBytes: number;
  afterBytes: number;
  removedBytes: number;
  imagesRemoved: number;
  outputsTrimmed: number;
  duplicatesRemoved: number;
  secretsRedacted: number;
  emailsRedacted: number;
  customRedacted: number;
  /** Occurrences of deduplicated custom rules, including overlapping matches. */
  customRuleMatches: number;
  /** Disjoint replacement spans across body/title/source before tool truncation. */
  redactionReplacements: number;
}

export interface CleanResult {
  conversation: Conversation;
  changes: Change[];
  stats: CleanStats;
  warnings: string[];
}

export interface HandoffOptions {
  goal: string;
  decisions: string;
  constraints: string;
  nextSteps: string;
  pinnedIds: string[];
  recentCount: number;
  recentMode?: RecentSelectionMode;
  language?: OutputLanguage;
  maxCharacters?: number;
}

export type RecentSelectionMode = 'source' | 'timestamp';
export type OutputLanguage = 'en' | 'zh' | 'ja' | 'fr' | 'es';

export interface HandoffSummary {
  selectionMode: RecentSelectionMode;
  maxCharacters: number;
  budgetExceeded: boolean;
  requestedRecentCount: number;
  eligibleMessageCount: number;
  selectedRecentMessageCount: number;
  completeMessageCount: number;
  omittedMessageCount: number;
  omittedMessageIds: string[];
  truncatedMessageCount: number;
  truncatedMessageIds: string[];
  notSelectedMessageCount: number;
  missingTimestampCount: number;
  timeRange: { start: string; end: string } | null;
}

export interface HandoffBuildResult {
  text: string;
  summary: HandoffSummary;
}
