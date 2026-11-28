import type { ConfirmationTrustStatus, LifecycleTrustStatus, MemoryEvidence, MemoryProjectionFilters, MemoryStatus, ProjectMemoryDelta, ProjectMemoryFact, ProjectMemoryProjectionIndex, ProjectedMemoryFactRecord, ProjectedTerminalMemory } from './memory-types';
import { effectiveMemoryStatus, isTerminalMemoryStatus } from './memory-lifecycle';

export const PROJECT_MEMORY_PROJECTION_VERSION = 1 as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ProjectedMemoryEvidence extends MemoryEvidence {
  bindingStatus: NonNullable<MemoryEvidence['bindingStatus']>;
  relation: NonNullable<MemoryEvidence['relation']>;
  relationBasis: NonNullable<MemoryEvidence['relationBasis']>;
  trust: 'untrusted-evidence';
}

export interface ProjectedMemoryFact extends Omit<ProjectMemoryFact, 'evidence' | 'statusHistory'> {
  statusHistory: NonNullable<ProjectMemoryFact['statusHistory']>;
  evidence: ProjectedMemoryEvidence[];
  confirmationTrust: ConfirmationTrustStatus;
  lifecycleTrust: LifecycleTrustStatus;
  trust: string;
  storedStatus?: MemoryStatus;
  projectionWarnings: string[];
}

export interface ProjectMemoryProjection {
  projectionVersion: typeof PROJECT_MEMORY_PROJECTION_VERSION;
  projectId: string;
  asOf: number;
  stateKey: string;
  currentFacts: ProjectedMemoryFact[];
  terminalHistory: ProjectedMemoryFact[];
  statusCounts: Record<MemoryStatus, number>;
  conflictingFactIds: string[];
}

export function serializeProjectedMemoryFact(fact: ProjectedMemoryFact): ProjectedMemoryFactRecord {
  return {
    id: fact.id, category: fact.category, topic: fact.topic, statement: fact.statement,
    trust: fact.trust, origin: fact.origin, status: fact.status,
    lifecycleTrust: fact.lifecycleTrust, confirmationTrust: fact.confirmationTrust,
    ...(fact.storedStatus ? { storedStatus: fact.storedStatus } : {}),
    projectionWarnings: fact.projectionWarnings,
    statusHistory: fact.statusHistory, taskState: fact.taskState, revision: fact.revision,
    createdAt: fact.createdAt, updatedAt: fact.updatedAt,
    expiresAt: fact.expiresAt, expiredAt: fact.expiredAt, reconsiders: fact.reconsiders,
    confirmationEventId: fact.confirmationEventId, confirmationProjectId: fact.confirmationProjectId,
    confirmationVersion: fact.confirmationVersion, confirmationRevocationEventId: fact.confirmationRevocationEventId,
    conflictsWith: fact.conflictsWith, supersedes: fact.supersedes, supersededBy: fact.supersededBy,
    evidence: fact.evidence.map(evidence => ({
      id: evidence.id, kind: evidence.kind, reference: evidence.reference, quote: evidence.quote,
      ...(evidence.sessionId ? { sessionId: evidence.sessionId } : {}), ...(evidence.version !== undefined ? { version: evidence.version } : {}),
      ...(evidence.messageId ? { messageId: evidence.messageId } : {}), ...(evidence.messageFingerprint ? { messageFingerprint: evidence.messageFingerprint } : {}),
      ...(evidence.messageFingerprintVersion ? { messageFingerprintVersion: evidence.messageFingerprintVersion } : {}),
      ...(evidence.projectId ? { projectId: evidence.projectId } : {}), ...(evidence.revisionFingerprint ? { revisionFingerprint: evidence.revisionFingerprint } : {}),
      ...(evidence.sourceProjectId ? { sourceProjectId: evidence.sourceProjectId } : {}),
      ...(evidence.sourceIdentity ? { sourceIdentity: evidence.sourceIdentity } : {}), ...(evidence.quoteFingerprint ? { quoteFingerprint: evidence.quoteFingerprint } : {}),
      ...(evidence.quoteByteRange ? { quoteByteRange: evidence.quoteByteRange } : {}), ...(evidence.proposalId ? { proposalId: evidence.proposalId } : {}),
      ...(evidence.relationHistory ? { relationHistory: evidence.relationHistory } : {}),
      ...(evidence.legacyRelationHistory ? { legacyRelationHistory: evidence.legacyRelationHistory } : {}),
      ...(evidence.commit ? { commit: evidence.commit } : {}), ...(evidence.command ? { command: evidence.command } : {}),
      recordedAt: evidence.recordedAt, verification: evidence.verification,
      bindingStatus: evidence.bindingStatus, ...(evidence.bindingIssue ? { bindingIssue: evidence.bindingIssue } : {}),
      relation: evidence.relation, relationBasis: evidence.relationBasis, trust: 'untrusted-evidence' as const,
    })),
  };
}

export function serializeProjectedTerminalHistory(facts: ProjectedMemoryFact[]): ProjectedTerminalMemory[] {
  return facts.map(fact => ({
    id: fact.id, category: fact.category, topic: fact.topic, statement: fact.statement,
    origin: fact.origin, status: fact.status as ProjectedTerminalMemory['status'], trust: 'historical-only', lifecycleTrust: fact.lifecycleTrust,
    statusHistory: fact.statusHistory, supersedes: fact.supersedes, supersededBy: fact.supersededBy,
    expiresAt: fact.expiresAt, expiredAt: fact.expiredAt, reconsiders: fact.reconsiders,
    confirmationEventId: fact.confirmationEventId, confirmationRevocationEventId: fact.confirmationRevocationEventId,
  }));
}

function projectedFactRecordKey(fact: ProjectedMemoryFact): string {
  return projectionStateKey(JSON.stringify(serializeProjectedMemoryFact(fact)));
}

export function createProjectMemoryProjectionIndex(projection: ProjectMemoryProjection): ProjectMemoryProjectionIndex {
  if (!projection.projectId) throw new Error('A project identity is required for a projection baseline.');
  const allFacts = [...projection.currentFacts, ...projection.terminalHistory];
  const facts = Object.create(null) as ProjectMemoryProjectionIndex['facts'];
  for (const fact of allFacts) facts[fact.id] = { recordKey: projectedFactRecordKey(fact), status: fact.status };
  return { projectionVersion: projection.projectionVersion, projectId: projection.projectId, stateKey: projection.stateKey, facts };
}

export function parseProjectMemoryProjectionIndex(value: unknown): ProjectMemoryProjectionIndex {
  if (!isRecord(value) || value.projectionVersion !== PROJECT_MEMORY_PROJECTION_VERSION
    || typeof value.projectId !== 'string' || !value.projectId || value.projectId.length > 200
    || typeof value.stateKey !== 'string' || !/^pm1-[a-f0-9]{32}$/.test(value.stateKey)
    || !isRecord(value.facts) || Object.keys(value.facts).length > 100_000) {
    throw new Error('The projection baseline file is invalid or uses an unsupported version.');
  }
  const facts = Object.create(null) as ProjectMemoryProjectionIndex['facts'];
  for (const [id, row] of Object.entries(value.facts)) {
    if (!id || id.length > 200 || !isRecord(row) || typeof row.recordKey !== 'string'
      || !/^pm1-[a-f0-9]{32}$/.test(row.recordKey) || !statuses.includes(row.status as MemoryStatus)) {
      throw new Error('The projection baseline contains an invalid fact index.');
    }
    facts[id] = { recordKey: row.recordKey, status: row.status as MemoryStatus };
  }
  return { projectionVersion: PROJECT_MEMORY_PROJECTION_VERSION, projectId: value.projectId, stateKey: value.stateKey, facts };
}

export function parseProjectMemoryProjectionBaseline(value: unknown): ProjectMemoryProjectionIndex {
  if (!isRecord(value) || value.format !== 'threadpack-memory-projection-baseline' || value.version !== PROJECT_MEMORY_PROJECTION_VERSION
    || !Number.isSafeInteger(value.createdAt)) {
    throw new Error('The projection baseline file is unsupported.');
  }
  return parseProjectMemoryProjectionIndex(value.index);
}

export function createProjectMemoryDelta(
  previous: ProjectMemoryProjectionIndex,
  current: ProjectMemoryProjection,
): ProjectMemoryDelta {
  if (previous.projectionVersion !== current.projectionVersion) throw new Error('The baseline projection version is incompatible.');
  if (!previous.projectId || previous.projectId !== current.projectId) throw new Error('The baseline belongs to another project.');
  const previousFacts = previous.facts;
  const currentFacts = [...current.currentFacts, ...current.terminalHistory];
  const currentById = new Map(currentFacts.map(fact => [fact.id, fact]));
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const terminalizedIds: string[] = [];
  const changedIds = new Set<string>();
  for (const fact of currentFacts) {
    const old = previousFacts[fact.id];
    if (!old) {
      if (isTerminalMemoryStatus(fact.status)) terminalizedIds.push(fact.id);
      else addedIds.push(fact.id);
      changedIds.add(fact.id);
      continue;
    }
    if (old.recordKey === projectedFactRecordKey(fact)) continue;
    if (!isTerminalMemoryStatus(old.status) && isTerminalMemoryStatus(fact.status)) terminalizedIds.push(fact.id);
    else updatedIds.push(fact.id);
    changedIds.add(fact.id);
  }
  const removedIds = Object.keys(previousFacts).filter(id => !currentById.has(id)).sort();
  const relatedConflictIds = new Set<string>();
  const currentIds = new Set(current.currentFacts.map(fact => fact.id));
  for (const fact of currentFacts) if (changedIds.has(fact.id)) {
    for (const conflictId of fact.conflictsWith) {
      if (currentIds.has(conflictId) && !changedIds.has(conflictId)) relatedConflictIds.add(conflictId);
    }
  }
  for (const fact of currentFacts) {
    if (currentIds.has(fact.id) && !changedIds.has(fact.id) && fact.conflictsWith.some(id => changedIds.has(id))) relatedConflictIds.add(fact.id);
  }
  const changedFactIds = new Set([...changedIds, ...relatedConflictIds]);
  const changedFacts: ProjectedMemoryFactRecord[] = current.currentFacts
    .filter(fact => changedFactIds.has(fact.id)).map(serializeProjectedMemoryFact);
  const historicalChanges = serializeProjectedTerminalHistory(current.terminalHistory.filter(fact => changedIds.has(fact.id)));
  return {
    projectionVersion: current.projectionVersion, fromStateKey: previous.stateKey, toStateKey: current.stateKey,
    baselineTrust: 'unverified-client-supplied', asOf: current.asOf, addedIds: addedIds.sort(), updatedIds: updatedIds.sort(),
    terminalizedIds: terminalizedIds.sort(), removedIds, relatedConflictIds: [...relatedConflictIds].sort(),
    filtersApplied: {}, omittedChangedCount: 0, omittedRemovedCount: 0,
    changedFacts, historicalChanges,
  };
}

const statuses: MemoryStatus[] = ['proposed', 'confirmed', 'needs-review', 'rejected', 'superseded', 'expired', 'revoked'];

function projectionStateKey(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0x85ebca6b;
  let fourth = 0xc2b2ae35;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    third = Math.imul(third ^ code, 0x27d4eb2f);
    fourth = Math.imul(fourth ^ code, 0x165667b1);
  }
  return `pm1-${[first, second, third, fourth].map(part => (part >>> 0).toString(16).padStart(8, '0')).join('')}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function projectEvidence(evidence: MemoryEvidence): ProjectedMemoryEvidence {
  const bindingStatus = evidence.bindingStatus
    ?? (evidence.verification === 'source-matched' ? 'source_matched' : 'unverified');
  const relation = bindingStatus === 'source_matched' ? evidence.relation ?? 'unverified' : 'unverified';
  const relationBasis = relation === 'unverified' ? 'none' : evidence.relationBasis ?? 'none';
  return { ...evidence, bindingStatus, relation, relationBasis, trust: 'untrusted-evidence' };
}

function projectedTrust(fact: ProjectedMemoryFact): string {
  if (fact.projectionWarnings.includes('ai-origin-claimed-confirmed')) return 'ai-confirmation-untrusted';
  if (fact.status === 'confirmed' && fact.confirmationTrust === 'authenticated') return 'user-confirmed-by-locally-trusted-key';
  if (fact.status === 'confirmed' && fact.confirmationTrust === 'invalid') return 'invalid-confirmation-signature';
  if (fact.status === 'confirmed' && fact.confirmationTrust === 'revoked') return 'confirmation-revoked';
  if (fact.status === 'confirmed') return 'legacy-confirmed-claim-unverified';
  if (fact.status === 'rejected') return fact.lifecycleTrust === 'authenticated' ? 'user-rejected-by-locally-trusted-key' : 'unverified-rejection-status';
  if (fact.status === 'revoked') return fact.lifecycleTrust === 'authenticated' ? 'user-revoked-by-locally-trusted-key' : 'unverified-revocation-status';
  if (fact.status === 'expired') return 'expired-history-only';
  if (fact.status === 'superseded') return 'superseded-history-only';
  if (fact.origin === 'ai' && fact.status === 'proposed') return 'ai-proposal';
  return 'user-review-pending';
}

function projectFact(fact: ProjectMemoryFact, asOf: number): ProjectedMemoryFact {
  const status = effectiveMemoryStatus(fact.status, fact.expiresAt, asOf);
  const expired = status === 'expired' && fact.status !== 'expired';
  const legacyAIConfirmation = fact.origin === 'ai' && status === 'confirmed'
    && !(fact.confirmationTrust === 'authenticated' && !!fact.confirmationEventId);
  const projectedStatus: MemoryStatus = legacyAIConfirmation ? 'needs-review' : status;
  const projectionWarnings = legacyAIConfirmation ? ['ai-origin-claimed-confirmed'] : [];
  const statusHistory = [...(fact.statusHistory ?? [{ status: fact.status, changedAt: fact.createdAt }])];
  if (expired && statusHistory.at(-1)?.status !== 'expired') {
    statusHistory.push({ status: 'expired', changedAt: Math.max(fact.expiresAt ?? asOf, statusHistory.at(-1)?.changedAt ?? fact.createdAt) });
  }
  const projected: ProjectedMemoryFact = {
    ...fact,
    ...(legacyAIConfirmation ? { storedStatus: fact.status } : {}),
    status: projectedStatus,
    statusHistory,
    evidence: fact.evidence.map(projectEvidence),
    confirmationTrust: legacyAIConfirmation ? 'invalid' : fact.confirmationTrust ?? (status === 'confirmed' ? 'legacy-unverified' : 'inactive'),
    lifecycleTrust: expired ? 'inactive' : fact.lifecycleTrust ?? (isTerminalMemoryStatus(status) ? 'legacy-unverified' : 'inactive'),
    ...(expired ? { expiredAt: fact.expiresAt } : {}),
    projectionWarnings,
    trust: '',
  };
  projected.trust = projectedTrust(projected);
  return projected;
}

export function createProjectMemoryProjection(facts: ProjectMemoryFact[], asOf = Date.now(), projectId?: string): ProjectMemoryProjection {
  if (!Number.isSafeInteger(asOf) || asOf < 0) throw new Error('Projection time must be a nonnegative integer timestamp.');
  const resolvedProjectId = projectId ?? facts[0]?.projectId ?? '';
  if (facts.some(fact => fact.projectId !== resolvedProjectId)) throw new Error('A project memory projection cannot mix project records.');
  const projectedFacts = facts.map(fact => projectFact(fact, asOf));
  const currentFacts = projectedFacts.filter(fact => !isTerminalMemoryStatus(fact.status));
  const terminalHistory = projectedFacts.filter(fact => isTerminalMemoryStatus(fact.status))
    .sort((first, second) => second.updatedAt - first.updatedAt || first.id.localeCompare(second.id));
  const statusCounts = Object.fromEntries(statuses.map(status => [status, projectedFacts.filter(fact => fact.status === status).length])) as Record<MemoryStatus, number>;
  const conflictingFactIds = currentFacts.filter(fact => fact.conflictsWith.length > 0 || fact.status === 'needs-review')
    .map(fact => fact.id).sort();
  const state = canonicalJson({ projectionVersion: PROJECT_MEMORY_PROJECTION_VERSION, projectId: resolvedProjectId,
    statusCounts, conflictingFactIds, facts: projectedFacts.slice().sort((first, second) => first.id.localeCompare(second.id))
      .map(serializeProjectedMemoryFact) });
  const stateKey = projectionStateKey(state);
  return { projectionVersion: PROJECT_MEMORY_PROJECTION_VERSION, projectId: resolvedProjectId, asOf, stateKey, currentFacts, terminalHistory, statusCounts, conflictingFactIds };
}

export function filterProjectedMemoryFacts(facts: ProjectedMemoryFact[], filters: MemoryProjectionFilters = {}): ProjectedMemoryFact[] {
  const categories = ['goal', 'decision', 'preference', 'constraint', 'task', 'risk', 'open-question'];
  const filterStatuses = [...statuses, 'active', 'terminal'];
  if (filters.category !== undefined && !categories.includes(filters.category)) throw new Error('The memory category filter is invalid.');
  if (filters.status !== undefined && !filterStatuses.includes(filters.status)) throw new Error('The memory status filter is invalid.');
  if (filters.trust !== undefined && !['all', 'authenticated', 'unverified', 'ai-proposal'].includes(filters.trust)) {
    throw new Error('The memory trust filter is invalid.');
  }
  if (filters.sourceSessionId !== undefined && (!filters.sourceSessionId || filters.sourceSessionId.length > 200)) {
    throw new Error('The source session filter is invalid.');
  }
  if (filters.sourceVersion !== undefined && (!Number.isSafeInteger(filters.sourceVersion) || filters.sourceVersion < 1)) {
    throw new Error('The source version filter is invalid.');
  }
  if (filters.sourceKind !== undefined && !['conversation', 'repository', 'test', 'user'].includes(filters.sourceKind)) {
    throw new Error('The evidence source kind filter is invalid.');
  }
  if (filters.sourceReference !== undefined && (typeof filters.sourceReference !== 'string' || filters.sourceReference.length > 1000)) {
    throw new Error('The evidence source reference filter is invalid.');
  }
  if (filters.updatedAfter !== undefined && (!Number.isSafeInteger(filters.updatedAfter) || filters.updatedAfter < 0)) {
    throw new Error('The update-time filter is invalid.');
  }
  if (filters.factId !== undefined && (!filters.factId || filters.factId.length > 200)) throw new Error('The fact ID filter is invalid.');

  const sourceReference = filters.sourceReference?.toLocaleLowerCase();
  const hasSourceFilter = filters.sourceSessionId || filters.sourceVersion !== undefined || filters.sourceKind || sourceReference;
  return facts.filter(fact => {
    if (filters.category && fact.category !== filters.category) return false;
    if (filters.factId && fact.id !== filters.factId) return false;
    if (filters.status === 'terminal' && !isTerminalMemoryStatus(fact.status)) return false;
    if (filters.status === 'active' && isTerminalMemoryStatus(fact.status)) return false;
    if (filters.status && filters.status !== 'terminal' && filters.status !== 'active' && fact.status !== filters.status) return false;
    if (hasSourceFilter && !fact.evidence.some(item =>
      (!filters.sourceSessionId || item.sessionId === filters.sourceSessionId)
      && (filters.sourceVersion === undefined || item.version === filters.sourceVersion)
      && (!filters.sourceKind || item.kind === filters.sourceKind)
      && (!sourceReference || item.reference.toLocaleLowerCase().includes(sourceReference)))) return false;
    if (filters.updatedAfter !== undefined && fact.updatedAt < filters.updatedAfter) return false;
    const authenticated = fact.status === 'confirmed' && fact.confirmationTrust === 'authenticated'
      || isTerminalMemoryStatus(fact.status) && fact.lifecycleTrust === 'authenticated';
    if (filters.trust === 'authenticated' && !authenticated) return false;
    if (filters.trust === 'ai-proposal' && fact.trust !== 'ai-proposal') return false;
    if (filters.trust === 'unverified' && authenticated) return false;
    return true;
  });
}
