export type MemoryCategory = 'goal' | 'decision' | 'constraint' | 'task' | 'risk' | 'open-question';
export type MemoryStatus = 'proposed' | 'confirmed' | 'needs-review' | 'rejected' | 'superseded';
export type MemoryOrigin = 'user' | 'ai';
export type EvidenceKind = 'conversation' | 'repository' | 'test' | 'user';
export type TaskState = 'not-started' | 'in-progress' | 'done' | 'blocked' | 'unclear';
export type ProjectUpdateStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'revoked';
export type ProjectTaskClaimAction = 'claimed' | 'renewed' | 'released';

export interface ProjectTaskClaimEvent {
  key: string;
  id: string;
  projectId: string;
  claimId: string;
  taskId: string;
  client: string;
  idempotencyKey: string;
  action: ProjectTaskClaimAction;
  createdAt: number;
  leaseSeconds?: number;
  expiresAt?: number;
}

export interface ProjectTaskClaim {
  projectId: string;
  claimId: string;
  taskId: string;
  client: string;
  action: ProjectTaskClaimAction;
  active: boolean;
  claimedAt: number;
  leaseSeconds?: number;
  expiresAt?: number;
  releasedAt?: number;
  taskTopic?: string;
  taskStatement?: string;
}

export interface ProjectUpdateStatusChange {
  status: ProjectUpdateStatus;
  changedAt: number;
}

export type ProjectUpdateAction = 'submitted' | 'review-started' | 'edited' | 'accepted' | 'rejected' | 'revoked' | 'review-reopened';

export interface ProjectUpdateAuditEntry {
  action: ProjectUpdateAction;
  actor: 'mcp-client' | 'user';
  clientClaim?: string;
  status: ProjectUpdateStatus;
  changedAt: number;
  snapshot: {
    category: MemoryCategory;
    topic: string;
    statement: string;
    taskState?: TaskState;
    evidenceReference: string;
    evidenceQuote: string;
    sessionId?: string;
    sessionVersion?: number;
    messageId?: string;
    taskId?: string;
    claimId?: string;
  };
}

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
  proposalId?: string;
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
  proposalId?: string;
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

export interface ProjectUpdateProposal {
  key: string;
  id: string;
  projectId: string;
  client: string;
  idempotencyKey: string;
  sessionId?: string;
  sessionVersion?: number;
  messageId?: string;
  taskId?: string;
  claimId?: string;
  category: MemoryCategory;
  taskState?: TaskState;
  topic: string;
  statement: string;
  evidenceReference: string;
  evidenceQuote: string;
  status: ProjectUpdateStatus;
  statusHistory: ProjectUpdateStatusChange[];
  auditHistory: ProjectUpdateAuditEntry[];
  acceptedFactId?: string;
  reviewingSince?: number;
  createdAt: number;
  reviewedAt?: number;
  reviewNote?: string;
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
