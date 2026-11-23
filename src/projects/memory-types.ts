export type MemoryCategory = 'goal' | 'decision' | 'constraint' | 'task' | 'risk' | 'open-question';
export type MemoryStatus = 'proposed' | 'confirmed' | 'needs-review' | 'rejected' | 'superseded';
export type MemoryOrigin = 'user' | 'ai';
export type EvidenceKind = 'conversation' | 'repository' | 'test' | 'user';
export type TaskState = 'not-started' | 'in-progress' | 'done' | 'blocked' | 'unclear';

export interface MemoryStatusChange {
  status: MemoryStatus;
  changedAt: number;
}

export interface MemoryEvidence {
  id: string;
  kind: EvidenceKind;
  reference: string;
  quote: string;
  sessionId?: string;
  version?: number;
  messageId?: string;
  messageFingerprint?: string;
  commit?: string;
  command?: string;
  recordedAt: number;
  verification: 'source-matched' | 'user-recorded' | 'unattached';
}

export interface ProjectMemoryFact {
  key: string;
  id: string;
  projectId: string;
  normalizedTopic: string;
  category: MemoryCategory;
  topic: string;
  statement: string;
  taskState?: TaskState;
  origin: MemoryOrigin;
  status: MemoryStatus;
  statusHistory?: MemoryStatusChange[];
  reviewStateBeforeConflict?: 'confirmed' | 'proposed';
  evidence: MemoryEvidence[];
  conflictsWith: string[];
  supersedes?: string;
  supersededBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEvidenceInput {
  kind: EvidenceKind;
  reference: string;
  quote?: string;
  sessionId?: string;
  version?: number;
  messageId?: string;
  commit?: string;
  command?: string;
}

export interface ProjectMemoryInput {
  category: MemoryCategory;
  topic: string;
  statement: string;
  taskState?: TaskState;
  origin: MemoryOrigin;
  status: MemoryStatus;
  evidence: MemoryEvidenceInput[];
  supersedes?: string;
}

export interface MemoryProjectContext {
  name: string;
  summary: string;
  importantNotes: string;
}

export interface MemorySessionState {
  id: string;
  title: string;
  currentVersion: number;
}

export interface ContextOmission {
  id: string;
  topic: string;
  category: MemoryCategory;
  reason: 'budget' | 'not-relevant';
}

export interface GeneratedProjectContext {
  text: string;
  factStateKey?: string;
  projectStateKey?: string;
  budget: number;
  usedCharacters: number;
  includedFactIds: string[];
  omissions: ContextOmission[];
  omittedSections: string[];
  conflictCount: number;
  proposedCount: number;
  staleEvidenceCount: number;
  uncitedCount: number;
  unverifiedEvidenceCount: number;
}
