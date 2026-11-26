import { sha256Fingerprint } from '../handoff-draft';
import type {
  EvidenceAssessment, EvidenceBindingIssue, EvidenceRelation, EvidenceRelationBasis,
  MemoryEvidence, ProjectMemoryFact,
} from './memory-types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const relations = new Set<EvidenceRelation>(['supports', 'contradicts', 'context_only', 'insufficient', 'unverified']);

interface EvidenceMessage {
  role: string;
  timestamp?: string;
  content: string;
}

export interface EvidenceRevision {
  projectId: string;
  sessionId: string;
  version: number;
  fingerprint: string;
  content: string;
  sourceIdentity: NonNullable<MemoryEvidence['sourceIdentity']>;
}

export type IndexedEvidenceRevision = EvidenceRevision & { messages: Map<string, EvidenceMessage> };

export type EvidenceScope = {
  projectId: string;
  sourceProjectId?: string;
};

export function indexEvidenceMessages(content: string): Map<string, EvidenceMessage> {
  const messages = new Map<string, EvidenceMessage>();
  let offset = 0;
  let wrapped = false;
  let first = true;
  while (offset < content.length) {
    const end = content.indexOf('\n', offset);
    const line = content.slice(offset, end < 0 ? content.length : end).replace(/\r$/, '');
    offset = end < 0 ? content.length : end + 1;
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { throw new Error('A project history entry contains invalid JSON.'); }
    if (!isRecord(record)) throw new Error('A project history entry contains an invalid record.');
    if (first) wrapped = record.type === 'threadpack_session';
    first = false;
    if (wrapped && (record.type === 'threadpack_session' || record.type === 'threadpack_event')) continue;
    const message = wrapped && record.type === 'threadpack_message' ? record.message : record;
    if (!isRecord(message) || typeof message.id !== 'string' || typeof message.content !== 'string'
      || typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
      throw new Error('A project history entry contains an invalid message record.');
    }
    if (messages.has(message.id)) throw new Error('A project history entry contains duplicate message IDs.');
    messages.set(message.id, { role: message.role, content: message.content,
      ...(typeof message.timestamp === 'string' ? { timestamp: message.timestamp } : {}) });
  }
  return messages;
}

export async function prepareEvidenceRevision(revision: EvidenceRevision): Promise<IndexedEvidenceRevision> {
  if (!revision.projectId || !revision.sessionId || !Number.isSafeInteger(revision.version) || revision.version < 1
    || await sha256Fingerprint(revision.content) !== revision.fingerprint) {
    throw new Error('A project history entry failed its integrity check.');
  }
  return { ...revision, messages: indexEvidenceMessages(revision.content) };
}

function messageDigest(message: EvidenceMessage, revision: IndexedEvidenceRevision, messageId: string,
  fingerprintVersion: number, sourceProjectId: string) {
  if (fingerprintVersion === 2) {
    return sha256Fingerprint(JSON.stringify([
      'threadpack-message-v2', sourceProjectId, revision.sessionId, revision.version,
      messageId, message.role, message.timestamp ?? '', message.content,
    ]));
  }
  if (fingerprintVersion === 1) {
    return sha256Fingerprint([message.role, message.timestamp ?? '', message.content].join('\0'));
  }
  return Promise.resolve('');
}

function quoteMatchesRange(content: string, quote: string, range: NonNullable<MemoryEvidence['quoteByteRange']>) {
  const { start, end } = range;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start
    || end - start !== encoder.encode(quote).length) return false;
  const bytes = encoder.encode(content);
  if (end > bytes.length) return false;
  try { return decoder.decode(bytes.subarray(start, end)) === quote; }
  catch (cause) {
    if (cause instanceof TypeError) return false;
    throw cause;
  }
}

function firstQuoteRange(content: string, quote: string): { start: number; end: number } | undefined {
  const index = content.indexOf(quote);
  if (index < 0) return undefined;
  const start = encoder.encode(content.slice(0, index)).length;
  const end = start + encoder.encode(quote).length;
  return quoteMatchesRange(content, quote, { start, end }) ? { start, end } : undefined;
}

function bindingResult(evidence: MemoryEvidence, bindingStatus: EvidenceAssessment['bindingStatus'],
  bindingIssue?: EvidenceBindingIssue): MemoryEvidence & EvidenceAssessment {
  return {
    ...evidence, bindingStatus, bindingIssue,
    relation: 'unverified', relationBasis: 'none',
  };
}

export function invalidEvidenceBinding(evidence: MemoryEvidence, bindingIssue: EvidenceBindingIssue): MemoryEvidence & EvidenceAssessment {
  return bindingResult(evidence, 'invalid', bindingIssue);
}

export function canAttestEvidenceRelation(evidence: MemoryEvidence & Partial<EvidenceAssessment>): boolean {
  return evidence.bindingStatus === 'source_matched'
    || (['repository', 'test'].includes(evidence.kind) && evidence.verification === 'user-recorded'
      && typeof evidence.commit === 'string' && !!evidence.commit && !!evidence.quote.trim());
}

export async function assessEvidenceBinding(
  evidence: MemoryEvidence, scope: EvidenceScope, revision?: IndexedEvidenceRevision,
): Promise<MemoryEvidence & EvidenceAssessment> {
  if (evidence.kind !== 'conversation') {
    return bindingResult(evidence, evidence.bindingStatus === 'invalid' ? 'invalid' : 'unverified', evidence.bindingIssue);
  }
  if (!scope.projectId) return bindingResult(evidence, 'unverified', 'missing_project_scope');
  const sourceCopyMapping = !!scope.sourceProjectId && scope.sourceProjectId !== scope.projectId
    && evidence.projectId === scope.sourceProjectId;
  if (evidence.projectId !== undefined && evidence.projectId !== scope.projectId && !sourceCopyMapping) {
    return bindingResult(evidence, 'invalid', 'project_mismatch');
  }
  if (evidence.projectId === undefined && evidence.sourceProjectId !== undefined
    && evidence.sourceProjectId !== (scope.sourceProjectId ?? scope.projectId)) {
    return bindingResult(evidence, 'invalid', 'project_mismatch');
  }
  if (!evidence.sessionId || !Number.isSafeInteger(evidence.version) || evidence.version! < 1
    || !evidence.messageId || !evidence.quote.trim() || !evidence.messageFingerprint) {
    return bindingResult(evidence, 'unverified', 'missing_binding');
  }
  if (!revision) return bindingResult(evidence, 'unverified', 'missing_revision');
  if (revision.projectId !== scope.projectId || evidence.sessionId !== revision.sessionId
    || evidence.version !== revision.version
    || evidence.revisionFingerprint !== undefined && evidence.revisionFingerprint !== revision.fingerprint) {
    return bindingResult(evidence, 'invalid', 'revision_mismatch');
  }
  if (evidence.messageFingerprintVersion === 2 && (!evidence.projectId || !evidence.sourceProjectId
    || !evidence.revisionFingerprint || !evidence.quoteFingerprint || !evidence.quoteByteRange)) {
    return bindingResult(evidence, 'unverified', 'missing_binding');
  }
  const source = evidence.sourceIdentity;
  if (source && (source.platform !== undefined && source.platform !== revision.sourceIdentity.platform
    || source.sourceName !== undefined && source.sourceName !== revision.sourceIdentity.sourceName
    || source.sourceId !== undefined && source.sourceId !== revision.sourceIdentity.sourceId)) {
    return bindingResult(evidence, 'invalid', 'source_mismatch');
  }
  const message = revision.messages.get(evidence.messageId);
  if (!message) return bindingResult(evidence, 'invalid', 'missing_message');

  const sourceProjectId = evidence.sourceProjectId ?? evidence.projectId ?? scope.sourceProjectId ?? scope.projectId;
  const fingerprintVersion = evidence.messageFingerprintVersion ?? 1;
  if (await messageDigest(message, revision, evidence.messageId, fingerprintVersion, sourceProjectId) !== evidence.messageFingerprint) {
    return bindingResult(evidence, 'invalid', 'message_fingerprint_mismatch');
  }
  if (!message.content.includes(evidence.quote)) return bindingResult(evidence, 'invalid', 'quote_mismatch');
  const quoteFingerprint = await sha256Fingerprint(evidence.quote);
  if (evidence.quoteFingerprint !== undefined && evidence.quoteFingerprint !== quoteFingerprint) {
    return bindingResult(evidence, 'invalid', 'quote_fingerprint_mismatch');
  }
  if (evidence.quoteByteRange && !quoteMatchesRange(message.content, evidence.quote, evidence.quoteByteRange)) {
    return bindingResult(evidence, 'invalid', 'quote_range_mismatch');
  }
  if (fingerprintVersion === 1) {
    const matchingMessages = [...revision.messages.entries()].filter(([, candidate]) =>
      candidate.role === message.role && candidate.timestamp === message.timestamp && candidate.content === message.content);
    if (matchingMessages.length !== 1) return bindingResult(evidence, 'unverified', 'missing_binding');
  }
  return {
    ...evidence, projectId: scope.projectId, sourceProjectId,
    revisionFingerprint: revision.fingerprint, sourceIdentity: revision.sourceIdentity,
    quoteFingerprint, quoteByteRange: evidence.quoteByteRange ?? firstQuoteRange(message.content, evidence.quote),
    bindingStatus: 'source_matched', bindingIssue: undefined,
    relation: evidence.relation ?? 'unverified', relationBasis: evidence.relationBasis ?? 'none',
  };
}

function claimDigest(fact: Pick<ProjectMemoryFact, 'id' | 'projectId' | 'category' | 'topic' | 'statement' | 'taskState'>) {
  return sha256Fingerprint(JSON.stringify([
    'threadpack-claim-v1', fact.projectId, fact.id, fact.category, fact.topic, fact.statement, fact.taskState ?? null,
  ]));
}

async function evidenceDigest(evidence: MemoryEvidence) {
  return sha256Fingerprint(JSON.stringify([
    'threadpack-evidence-link-v1', evidence.id, evidence.kind, evidence.reference, evidence.verification,
    evidence.commit ?? null, evidence.command ?? null, evidence.projectId ?? null,
    evidence.sourceProjectId ?? evidence.projectId ?? null, evidence.sessionId ?? null, evidence.version ?? null,
    evidence.revisionFingerprint ?? null, evidence.messageId ?? null, evidence.messageFingerprint ?? null,
    evidence.quoteFingerprint ?? await sha256Fingerprint(evidence.quote), evidence.quoteByteRange ?? null,
    evidence.sourceIdentity ?? null,
  ]));
}

export async function createEvidenceRelationEvent(
  fact: ProjectMemoryFact, evidence: MemoryEvidence, relation: EvidenceRelation,
  operationId: string, changedAt: number,
) {
  const relationBasis: EvidenceRelationBasis = relation === 'unverified' ? 'none' : 'user_attestation';
  return {
    id: operationId, operationId, actor: 'user' as const, relation, relationBasis, changedAt,
    claimFingerprint: await claimDigest(fact), evidenceFingerprint: await evidenceDigest(evidence),
  };
}

export async function validateEvidenceRelation(
  fact: ProjectMemoryFact, evidence: MemoryEvidence,
  binding: EvidenceAssessment, allowLocalAttestation = true,
): Promise<MemoryEvidence & EvidenceAssessment> {
  const effective = { ...evidence, ...binding, relationHistory: evidence.relationHistory };
  const invalid = () => ({ ...effective, relation: 'unverified' as const, relationBasis: 'none' as const,
    ...(evidence.relation === 'unverified' || evidence.relation === undefined ? {} : { bindingIssue: 'relation_mismatch' as const }) });
  if (!allowLocalAttestation || !canAttestEvidenceRelation({ ...evidence, ...binding })
    || !relations.has(evidence.relation ?? 'unverified')) return invalid();
  if (!Array.isArray(evidence.relationHistory) || !evidence.relationHistory.length) {
    return evidence.relation === undefined || evidence.relation === 'unverified'
      ? { ...effective, relation: 'unverified', relationBasis: 'none' } : invalid();
  }
  if (!['user_attestation', 'independent_verification'].includes(evidence.relationBasis ?? '')) return invalid();
  // Independent verification is not implemented in this phase. Never infer it from an imported field.
  if (evidence.relationBasis === 'independent_verification') return invalid();
  const currentClaimFingerprint = await claimDigest(fact);
  const currentEvidenceFingerprint = await evidenceDigest(effective);
  let previousTime = -1;
  const operationIds = new Set<string>();
  for (const event of evidence.relationHistory) {
    if (!event || typeof event.id !== 'string' || !event.id || event.operationId !== event.id || event.actor !== 'user'
      || operationIds.has(event.operationId)
      || !relations.has(event.relation) || !['user_attestation', 'none'].includes(event.relationBasis)
      || !Number.isSafeInteger(event.changedAt) || event.changedAt < previousTime
      || !/^[a-f0-9]{64}$/.test(event.claimFingerprint) || !/^[a-f0-9]{64}$/.test(event.evidenceFingerprint)
      || event.relation === 'unverified' && event.relationBasis !== 'none'
      || event.relation !== 'unverified' && event.relationBasis !== 'user_attestation') return invalid();
    previousTime = event.changedAt;
    operationIds.add(event.operationId);
  }
  const latest = evidence.relationHistory.at(-1)!;
  if (latest.relation !== evidence.relation || latest.relationBasis !== evidence.relationBasis
    || latest.claimFingerprint !== currentClaimFingerprint || latest.evidenceFingerprint !== currentEvidenceFingerprint) return invalid();
  return { ...effective, bindingIssue: undefined };
}

export async function bindNewConversationEvidence(
  evidence: MemoryEvidence, revision: IndexedEvidenceRevision, sourceProjectId = revision.projectId,
) {
  const messageId = evidence.messageId;
  const message = messageId ? revision.messages.get(messageId) : undefined;
  if (!messageId || !message) throw new Error('The selected evidence message is unavailable in that saved version.');
  let quote = evidence.quote.trim() || message.content.slice(0, 600);
  if (!evidence.quote.trim() && quote.length < message.content.length) quote = quote.replace(/[\uD800-\uDBFF]$/, '');
  const quoteByteRange = firstQuoteRange(message.content, quote);
  if (!quoteByteRange) throw new Error('The evidence excerpt does not match a safe UTF-8 range in the selected message.');
  const bound = await assessEvidenceBinding({
    ...evidence, quote, messageFingerprintVersion: 2,
    messageFingerprint: await messageDigest(message, revision, messageId, 2, sourceProjectId),
    projectId: revision.projectId, sourceProjectId, revisionFingerprint: revision.fingerprint,
    sourceIdentity: revision.sourceIdentity, quoteFingerprint: await sha256Fingerprint(quote), quoteByteRange,
    bindingStatus: 'source_matched', relation: 'unverified', relationBasis: 'none',
  }, { projectId: revision.projectId, sourceProjectId }, revision);
  if (bound.bindingStatus !== 'source_matched') {
    throw new Error('The evidence excerpt does not match the selected message.');
  }
  return bound;
}
