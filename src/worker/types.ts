import type { Change, CleanOptions, CleanStats, Message, Role } from '../core';

export interface ConversationInfo { id: string; title: string; source: string; messageCount: number }
export interface ParseInfo {
  archiveId: number;
  format: string;
  warnings: string[];
  sourceBytes: number;
  conversations: ConversationInfo[];
}
export interface CleanSummary {
  conversation: ConversationInfo;
  stats: CleanStats;
  warnings: string[];
  revision: number;
  changedMessageCount: number;
}
export interface PreviewMessage {
  message: Message;
  index: number;
  bytes: number;
  changes: Change[];
  shortened: boolean;
}
export interface QueryResult { items: PreviewMessage[]; total: number; page: number; pageCount: number }
export interface ExportResult { buffer: ArrayBuffer; filename: string; mimeType: string }
export interface ExcerptExportResult extends ExportResult { messageCount: number }
export interface SnippetPreview {
  id: string; language: string; messageIndex: number; fenceIndex: number;
  lines: number; characters: number; preview: string; shortened: boolean;
}
export interface SnippetQueryResult { items: SnippetPreview[]; total: number; page: number; pageCount: number }
export interface CopyMessageResult { text: string }
export interface MessageReviewExcerpt { text: string; shortened: boolean; imageHidden: boolean }
export interface CompareMessageResult { original: MessageReviewExcerpt; cleaned: MessageReviewExcerpt; changes: Change[] }
export interface HandoffNotes { goal: string; decisions: string; constraints: string; nextSteps: string }
export interface HandoffResult { text: string }
export interface ImportProgress { loaded: number; total: number }
interface RequestBase { id: number }
interface Selection { archiveId: number; conversationId: string }
interface RevisionSelection extends Selection { revision: number }
export interface ParseRequest extends RequestBase {
  type: 'parse'; archiveId: number; keepArchiveId: number | null;
  text?: string; filename?: string; file?: File;
}
export interface CleanRequest extends RequestBase, Selection { type: 'clean'; options: CleanOptions }
export interface PreviewFilters {
  mode: 'cleaned' | 'original'; query: string; role: 'all' | Role;
  changedOnly: boolean; pinnedOnly: boolean; pinnedIds: string[];
}
export interface QueryRequest extends RequestBase, RevisionSelection, PreviewFilters {
  type: 'query'; page: number; pageSize: 30;
}
export interface ExportRequest extends RequestBase, RevisionSelection { type: 'export'; format: 'markdown' | 'jsonl' | 'report' }
export interface ExportExcerptRequest extends RequestBase, RevisionSelection, PreviewFilters { type: 'export-excerpt'; format: 'markdown' | 'jsonl' }
export interface CopyMessageRequest extends RequestBase, RevisionSelection { type: 'copy-message'; messageId: string; mode: 'cleaned' | 'original' }
export interface CompareMessageRequest extends RequestBase, RevisionSelection { type: 'compare-message'; messageId: string }
export interface QuerySnippetsRequest extends RequestBase, RevisionSelection { type: 'query-snippets'; page: number; pageSize: 20 }
export interface CopySnippetRequest extends RequestBase, RevisionSelection { type: 'copy-snippet'; snippetId: string }
export interface ExportSnippetRequest extends RequestBase, RevisionSelection { type: 'export-snippet'; snippetId: string }
export interface HandoffRequest extends RequestBase, RevisionSelection {
  type: 'handoff'; notes: HandoffNotes; pinnedIds: string[];
  recentCount: number; maxCharacters: number;
}
export interface ClearRequest extends RequestBase { type: 'clear' }
export type WorkerRequest = ParseRequest | CleanRequest | QueryRequest | ExportRequest | ExportExcerptRequest | CopyMessageRequest | CompareMessageRequest | QuerySnippetsRequest | CopySnippetRequest | ExportSnippetRequest | HandoffRequest | ClearRequest;
export type WorkerResult = ParseInfo | CleanSummary | QueryResult | SnippetQueryResult | ExportResult | ExcerptExportResult | CopyMessageResult | CompareMessageResult | HandoffResult | null;
export type WorkerResponse = { id: number; data: WorkerResult } | { id: number; error: string } | { id: number; progress: ImportProgress };
export interface WorkerResultMap { parse: ParseInfo; clean: CleanSummary; query: QueryResult; export: ExportResult; 'export-excerpt': ExcerptExportResult; 'copy-message': CopyMessageResult; 'compare-message': CompareMessageResult; 'query-snippets': SnippetQueryResult; 'copy-snippet': CopyMessageResult; 'export-snippet': ExportResult; handoff: HandoffResult; clear: null }
