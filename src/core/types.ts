export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp?: string;
}

export interface Conversation {
  id: string;
  title: string;
  source: string;
  messages: Message[];
}

export interface ParsedArchive {
  format: string;
  conversations: Conversation[];
  warnings: string[];
  sourceBytes: number;
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
