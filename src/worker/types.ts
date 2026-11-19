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
export interface QueryRequest extends RequestBase, RevisionSelection {
  type: 'query'; mode: 'cleaned' | 'original'; query: string; role: 'all' | Role;
  changedOnly: boolean; page: number; pageSize: 30;
}
export interface ExportRequest extends RequestBase, RevisionSelection { type: 'export'; format: 'markdown' | 'jsonl' | 'report' }
export interface HandoffRequest extends RequestBase, RevisionSelection {
  type: 'handoff'; notes: HandoffNotes; pinnedIds: string[];
  recentCount: number; maxCharacters: number;
}
export interface ClearRequest extends RequestBase { type: 'clear' }
export type WorkerRequest = ParseRequest | CleanRequest | QueryRequest | ExportRequest | HandoffRequest | ClearRequest;
export type WorkerResult = ParseInfo | CleanSummary | QueryResult | ExportResult | HandoffResult | null;
export type WorkerResponse = { id: number; data: WorkerResult } | { id: number; error: string } | { id: number; progress: ImportProgress };
export interface WorkerResultMap { parse: ParseInfo; clean: CleanSummary; query: QueryResult; export: ExportResult; handoff: HandoffResult; clear: null }
