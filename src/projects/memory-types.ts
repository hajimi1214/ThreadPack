import type { RecoveryBundle, SignedTrustEvent } from './trust-crypto';

export type ConfirmationTrustStatus = 'authenticated' | 'legacy-unverified' | 'invalid' | 'revoked' | 'inactive';
export type LifecycleTrustStatus = 'authenticated' | 'legacy-unverified' | 'invalid' | 'inactive';

export interface ProjectTrustState {
  projectId: string;
  sourceProjectId?: string;
  trustStatus: 'trusted-local' | 'untrusted-import';
  rootKeyId: string;
  rootPublicKeyJwk: JsonWebKey;
  recoveryKeyId: string;
  recoveryPublicKeyJwk: JsonWebKey;
  recoveryBundle: RecoveryBundle;
  recoveryAcknowledgedAt?: number;
  activeKeyId: string;
  sequence: number;
  headHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrustedProjectAnchor {
  key: [string, string];
  projectId: string;
  sourceProjectId: string;
  rootKeyId: string;
  rootPublicKeyFingerprint: string;
  recoveryKeyId: string;
  recoveryPublicKeyFingerprint: string;
  sequence: number;
  headHash: string;
  updatedAt: number;
  deletedAt?: number;
}

export interface LocalProjectSigningKey {
  key: [string, string];
  projectId: string;
  keyId: string;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
  createdAt: number;
}

export interface StoredProjectTrustEvent {
  key: [string, number];
  projectId: string;
  sequence: number;
  event: SignedTrustEvent;
}

export type MemoryCategory = 'goal' | 'decision' | 'preference' | 'constraint' | 'task' | 'risk' | 'open-question';
export type MemoryStatus = 'proposed' | 'confirmed' | 'needs-review' | 'rejected' | 'superseded' | 'expired' | 'revoked';
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
  trustEventId?: string;
  trustEventHash?: string;
  trustKeyId?: string;
}

export type EvidenceBindingStatus = 'source_matched' | 'unverified' | 'invalid';
export type EvidenceRelation = 'supports' | 'contradicts' | 'context_only' | 'insufficient' | 'unverified';
export type EvidenceRelationBasis = 'user_attestation' | 'independent_verification' | 'none';
export type EvidenceBindingIssue = 'project_mismatch' | 'missing_binding' | 'missing_revision' | 'revision_mismatch'
  | 'missing_project_scope' | 'source_mismatch' | 'missing_message' | 'message_fingerprint_mismatch'
  | 'revision_integrity' | 'revision_structure' | 'revision_content_invalid'
  | 'quote_mismatch' | 'quote_fingerprint_mismatch' | 'quote_range_mismatch' | 'relation_mismatch';

export interface EvidenceAssessment {
  bindingStatus: EvidenceBindingStatus;
  relation: EvidenceRelation;
  relationBasis: EvidenceRelationBasis;
  bindingIssue?: EvidenceBindingIssue;
}

export interface EvidenceRelationEvent {
  id: string;
  operationId: string;
  actor: 'user';
  relation: EvidenceRelation;
  relationBasis: 'user_attestation' | 'none';
  changedAt: number;
  claimFingerprint: string;
  evidenceFingerprint: string;
  trustEventId?: string;
  trustEventHash?: string;
  trustKeyId?: string;
}

/** One citation on one claim. Optional assessment fields keep legacy rows readable. */
export interface MemoryEvidence extends Partial<EvidenceAssessment> {
  id: string;
  kind: EvidenceKind;
  reference: string;
  quote: string;
  sessionId?: string;
  version?: number;
  messageId?: string;
  messageFingerprint?: string;
  messageFingerprintVersion?: 2;
  projectId?: string;
  revisionFingerprint?: string;
  sourceIdentity?: { platform?: string; sourceName?: string; sourceId?: string };
  quoteFingerprint?: string;
  quoteByteRange?: { start: number; end: number };
  relationHistory?: EvidenceRelationEvent[];
  legacyRelationHistory?: EvidenceRelationEvent[];
  sourceProjectId?: string;
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
  revision?: number;
  taskState?: TaskState;
  origin: MemoryOrigin;
  status: MemoryStatus;
  statusHistory?: MemoryStatusChange[];
  confirmationEventId?: string;
  confirmationProjectId?: string;
  confirmationVersion?: number;
  confirmationRevocationEventId?: string;
  confirmationTrust?: ConfirmationTrustStatus;
  lifecycleTrust?: LifecycleTrustStatus;
  lifecycleProjectId?: string;
  reviewStateBeforeConflict?: 'confirmed' | 'proposed';
  expiresAt?: number;
  expiredAt?: number;
  reconsiders?: string;
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
  expiresAt?: number;
  reconsiders?: string;
}

export interface ProjectUpdateProposal {
  key: string;
  id: string;
  projectId: string;
  client: string;
  idempotencyKey: string;
  sessionId?: string;
  sourceProjectId?: string;
  sessionVersion?: number;
  messageId?: string;
  messageFingerprint?: string;
  messageFingerprintVersion?: 2;
  revisionFingerprint?: string;
  quoteFingerprint?: string;
  quoteByteRange?: { start: number; end: number };
  sourceIdentity?: { platform?: string; sourceName?: string; sourceId?: string };
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
  reason: 'budget' | 'not-relevant' | 'terminal-status' | 'filtered';
}

export type MemoryTrustFilter = 'all' | 'authenticated' | 'unverified' | 'ai-proposal';

export interface MemoryProjectionFilters {
  category?: MemoryCategory;
  status?: MemoryStatus | 'active' | 'terminal';
  trust?: MemoryTrustFilter;
  factId?: string;
  sourceSessionId?: string;
  sourceVersion?: number;
  sourceKind?: EvidenceKind;
  sourceReference?: string;
  updatedAfter?: number;
}

export interface GeneratedProjectContext {
  text: string;
  projectionVersion: number;
  projectionAsOf: number;
  projectionStateKey: string;
  projectionIndex?: ProjectMemoryProjectionIndex;
  statusCounts: Record<MemoryStatus, number>;
  filtersApplied: MemoryProjectionFilters;
  deltaOnly: boolean;
  factStateKey?: string;
  projectStateKey?: string;
  budget: number;
  usedCharacters: number;
  includedFactIds: string[];
  includedHistoricalIds: string[];
  projectedFacts: ProjectedMemoryFactRecord[];
  omissions: ContextOmission[];
  omittedSections: string[];
  conflictCount: number;
  proposedCount: number;
  staleEvidenceCount: number;
  uncitedCount: number;
  unverifiedEvidenceCount: number;
  conflictingFactIds: string[];
  terminalHistory: ProjectedTerminalMemory[];
  omittedTerminalHistoryCount: number;
  delta?: ProjectMemoryDelta;
}

export interface ProjectedTerminalMemory {
  id: string;
  category: MemoryCategory;
  topic: string;
  statement: string;
  origin: MemoryOrigin;
  status: Extract<MemoryStatus, 'rejected' | 'superseded' | 'expired' | 'revoked'>;
  trust: 'historical-only';
  lifecycleTrust: LifecycleTrustStatus;
  statusHistory?: MemoryStatusChange[];
  supersedes?: string;
  supersededBy?: string;
  expiresAt?: number;
  expiredAt?: number;
  reconsiders?: string;
  confirmationEventId?: string;
  confirmationRevocationEventId?: string;
}

export interface ProjectedMemoryFactRecord {
  id: string;
  category: MemoryCategory;
  topic: string;
  statement: string;
  trust: string;
  origin: MemoryOrigin;
  status: MemoryStatus;
  lifecycleTrust: LifecycleTrustStatus;
  confirmationTrust: ConfirmationTrustStatus;
  storedStatus?: MemoryStatus;
  projectionWarnings: string[];
  statusHistory: MemoryStatusChange[];
  taskState?: TaskState;
  revision?: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  expiredAt?: number;
  reconsiders?: string;
  confirmationEventId?: string;
  confirmationProjectId?: string;
  confirmationVersion?: number;
  confirmationRevocationEventId?: string;
  conflictsWith: string[];
  supersedes?: string;
  supersededBy?: string;
  evidence: (MemoryEvidence & {
    bindingStatus: NonNullable<MemoryEvidence['bindingStatus']>;
    relation: NonNullable<MemoryEvidence['relation']>;
    relationBasis: NonNullable<MemoryEvidence['relationBasis']>;
    trust: 'untrusted-evidence';
    sessionTitle?: string;
  })[];
}

export interface ProjectMemoryProjectionIndex {
  projectionVersion: number;
  projectId: string;
  stateKey: string;
  facts: Record<string, { recordKey: string; status: MemoryStatus }>;
}

export interface ProjectMemoryDelta {
  projectionVersion: number;
  baselineTrust: 'unverified-client-supplied';
  fromStateKey: string;
  toStateKey: string;
  asOf: number;
  addedIds: string[];
  updatedIds: string[];
  terminalizedIds: string[];
  removedIds: string[];
  relatedConflictIds: string[];
  filtersApplied: MemoryProjectionFilters;
  omittedChangedCount: number;
  omittedRemovedCount: number;
  changedFacts: ProjectedMemoryFactRecord[];
  historicalChanges: ProjectedTerminalMemory[];
}
