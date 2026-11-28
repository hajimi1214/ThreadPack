import type { SourcePlatform } from '../core';
import { searchPattern } from '../preview';
import { sha256Fingerprint } from '../handoff-draft';
import type { EvidenceAssessment, EvidenceKind, EvidenceRelation, MemoryCategory, MemoryEvidence, MemoryEvidenceInput, MemoryOrigin, MemoryStatus, MemoryStatusChange, ProjectMemoryFact, ProjectMemoryInput, ProjectTaskClaim, ProjectTaskClaimAction, ProjectTaskClaimEvent, ProjectUpdateAction, ProjectUpdateAuditEntry, ProjectUpdateProposal, ProjectUpdateStatus, ProjectUpdateStatusChange, TaskState } from './memory-types';
import {
  assessEvidenceBinding, bindNewConversationEvidence, canAttestEvidenceRelation, createEvidenceRelationEvent, invalidEvidenceBinding,
  indexEvidenceMessages, validateEvidenceRelation,
} from './evidence-binding';
import type { EvidenceScope, IndexedEvidenceRevision } from './evidence-binding';
import type { EvidenceBindingIssue, LocalProjectSigningKey, ProjectTrustState, StoredProjectTrustEvent, TrustedProjectAnchor } from './memory-types';
import { canReviewMemoryStatusTransition, isTerminalMemoryStatus, normalizeMemoryClaimText } from './memory-lifecycle';
import { assertTrustChainContainsHead, createRecoveryBundle, generateSigningIdentity, isPublicSigningKeyJwk, keyIdForPublicKey, publicKeyFingerprint, signTrustEvent, unlockRecoveryBundle, verifyTrustEventChain, TRUST_CHAIN_ORIGIN, TRUST_EVENT_SCHEMA } from './trust-crypto';
import type { LocalSigningIdentity, RecoveryBundle, SignedTrustEvent, TrustEventPayload, TrustChainVerification } from './trust-crypto';
import { MAX_PROJECT_SESSION_BYTES, MAX_SHARED_PROJECT_BACKUP_BYTES, utf8ByteLength } from './limits';
import {
  backupRecordCountsMatch, createProjectBackupMigration, digestProjectBackupRecord,
  emptyBackupRecordCounts, extendProjectBackupRecordChain, incrementBackupRecordCount,
  PROJECT_BACKUP_CHAIN_SEED, PROJECT_BACKUP_MANIFEST_VERSION, PROJECT_BACKUP_VERSION,
  validateProjectBackupManifest, validateProjectBackupMigration,
} from './backup-format';
import type { ProjectBackupMigrationRecord } from './backup-format';

const DATABASE_NAME = 'threadpack-project-library';
const DATABASE_VERSION = 7;
const RESTORE_STALE_AFTER = 24 * 60 * 60 * 1000;
const UPDATE_REVIEW_STALE_AFTER = 5 * 60 * 1000;
const encoder = new TextEncoder();

export interface ProjectRecord {
  id: string;
  name: string;
  summary: string;
  importantNotes: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  restoringSince?: number;
  migrationHistory?: ProjectBackupMigrationRecord[];
}

export interface SharedProjectFileHandle extends FileSystemFileHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface SharedProjectBackupRecord {
  projectId: string;
  handle: SharedProjectFileHandle;
  inboxHandle?: SharedProjectFileHandle;
  inboxReadOffset?: number;
  syncedAt: number;
  syncedProjectUpdatedAt: number;
}

export interface SharedProjectBackupStatus {
  connected: boolean;
  state: 'disconnected' | 'current' | 'out-of-date' | 'permission-required' | 'error';
  filename?: string;
  syncedAt?: number;
  inboxConnected?: boolean;
  inboxFilename?: string;
  pendingUpdates?: number;
}

export interface ProjectUpdateImportResult {
  imported: number;
  pending: number;
  changed: boolean;
}

export interface ProjectSessionInput {
  title: string;
  sourceName: string;
  platform: SourcePlatform;
  sourceId?: string;
  format: string;
  messageCount: number;
  content: string;
}

export interface ProjectSessionRecord {
  key: string;
  projectId: string;
  id: string;
  sessionKey: string;
  title: string;
  sourceName: string;
  platform: SourcePlatform;
  sourceId?: string;
  format: string;
  messageCount: number;
  fingerprint: string;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSessionSummary extends ProjectSessionRecord {
  matchedText: boolean;
}

interface RevisionRecord {
  key: [string, string, number];
  projectId: string;
  sessionId: string;
  version: number;
  fingerprint: string;
  content: string;
  title: string;
  platform: SourcePlatform;
  sourceId?: string;
  format: string;
  messageCount: number;
  sourceName: string;
  createdAt: number;
}

export interface ProjectRevisionSummary {
  version: number;
  fingerprint: string;
  sourceName: string;
  createdAt: number;
  current: boolean;
}

export interface ProjectImportResult {
  projectId: string;
  sessionId: string;
  version: number;
  duplicate: boolean;
}

export interface ProjectSessionContent {
  summary: ProjectSessionRecord;
  version: number;
  sourceName: string;
  content: string;
}

const platformNames: SourcePlatform[] = ['chatgpt', 'codex', 'claude', 'claude-code', 'openai', 'generic', 'text', 'threadpack', 'unknown'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const sessionRecordKey = (projectId: string, sessionKey: string) => [projectId, sessionKey] as [string, string];

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The local project database request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('The local project database transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('The local project database transaction failed.'));
  });
}

let databasePromise: Promise<IDBDatabase> | undefined;
const sharedBackupWrites = new Map<string, Promise<SharedProjectBackupStatus>>();

function touchProject(project: ProjectRecord, timestamp = Date.now()): void {
  project.updatedAt = Math.max(timestamp, project.updatedAt + 1);
}

const MEMORY_CATEGORIES: MemoryCategory[] = ['goal', 'decision', 'preference', 'constraint', 'task', 'risk', 'open-question'];
const MEMORY_STATUSES: MemoryStatus[] = ['proposed', 'confirmed', 'needs-review', 'rejected', 'superseded', 'expired', 'revoked'];
const EVIDENCE_KINDS: EvidenceKind[] = ['conversation', 'repository', 'test', 'user'];
const TASK_STATES: TaskState[] = ['not-started', 'in-progress', 'done', 'blocked', 'unclear'];

function proposalSnapshot(proposal: Pick<ProjectUpdateProposal, 'category' | 'topic' | 'statement' | 'taskState' | 'sessionId' | 'sessionVersion' | 'messageId' | 'taskId' | 'claimId' | 'evidenceReference' | 'evidenceQuote'>): ProjectUpdateAuditEntry['snapshot'] {
  return { category: proposal.category, topic: proposal.topic, statement: proposal.statement,
    ...(proposal.taskState ? { taskState: proposal.taskState } : {}),
    evidenceReference: proposal.evidenceReference, evidenceQuote: proposal.evidenceQuote,
    ...(proposal.sessionId ? { sessionId: proposal.sessionId } : {}),
    ...(proposal.sessionVersion !== undefined ? { sessionVersion: proposal.sessionVersion } : {}),
    ...(proposal.messageId ? { messageId: proposal.messageId } : {}),
    ...(proposal.taskId ? { taskId: proposal.taskId } : {}),
    ...(proposal.claimId ? { claimId: proposal.claimId } : {}),
  };
}

function appendProposalAudit(proposal: ProjectUpdateProposal, action: ProjectUpdateAction, actor: ProjectUpdateAuditEntry['actor'], changedAt: number): void {
  proposal.auditHistory.push({ action, actor, ...(actor === 'mcp-client' ? { clientClaim: proposal.client } : {}),
    status: proposal.status, changedAt, snapshot: proposalSnapshot(proposal) });
}

async function revokeAcceptedProposals(transaction: IDBTransaction, projectId: string, factId: string, changedAt: number): Promise<void> {
  const updates = transaction.objectStore('updates');
  const proposals = await idbRequest<ProjectUpdateProposal[]>(updates.index('projectId').getAll(IDBKeyRange.only(projectId)));
  for (const proposal of proposals) {
    if (proposal.acceptedFactId !== factId || proposal.status !== 'accepted') continue;
    proposal.status = 'revoked';
    proposal.reviewedAt = changedAt;
    proposal.statusHistory.push({ status: 'revoked', changedAt });
    appendProposalAudit(proposal, 'revoked', 'user', changedAt);
    updates.put(proposal);
  }
}

function appendStatusChange(
  fact: ProjectMemoryFact, status: MemoryStatus, changedAt: number,
  event?: SignedTrustEvent,
): void {
  const history = fact.statusHistory ?? [{ status: fact.status, changedAt: fact.createdAt }];
  if (history.at(-1)?.status === status) {
    fact.statusHistory = history;
    return;
  }
  if (history.length >= 10_000) throw new Error('This fact reached the supported lifecycle-history limit. Preserve its history and create a linked new fact.');
  fact.statusHistory = [...history, { status, changedAt, ...(event ? {
    trustEventId: event.id, trustEventHash: event.eventHash, trustKeyId: event.actorKeyId,
  } : {}) }];
}

function readStatusHistory(value: unknown, status: MemoryStatus, createdAt: number): MemoryStatusChange[] {
  if (value === undefined) return [{ status, changedAt: createdAt }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) throw new Error('The project backup contains an invalid memory status history.');
  const history = value.map(item => {
    if (!isRecord(item) || !MEMORY_STATUSES.includes(item.status as MemoryStatus) || !Number.isSafeInteger(item.changedAt)) {
      throw new Error('The project backup contains an invalid memory status history.');
    }
    if (item.trustEventId !== undefined && (typeof item.trustEventId !== 'string' || !item.trustEventId || item.trustEventId.length > 200)
      || item.trustEventHash !== undefined && (typeof item.trustEventHash !== 'string' || !/^[a-f0-9]{64}$/i.test(item.trustEventHash))
      || item.trustKeyId !== undefined && (typeof item.trustKeyId !== 'string' || !item.trustKeyId || item.trustKeyId.length > 100)) {
      throw new Error('The project backup contains invalid memory status authentication metadata.');
    }
    return {
      status: item.status as MemoryStatus, changedAt: item.changedAt as number,
      ...(typeof item.trustEventId === 'string' ? { trustEventId: item.trustEventId } : {}),
      ...(typeof item.trustEventHash === 'string' ? { trustEventHash: item.trustEventHash } : {}),
      ...(typeof item.trustKeyId === 'string' ? { trustKeyId: item.trustKeyId } : {}),
    };
  });
  if (history[0]!.changedAt < createdAt || history.at(-1)!.status !== status) {
    throw new Error('The project backup contains an inconsistent memory status history.');
  }
  for (let index = 1; index < history.length; index++) {
    if (history[index]!.changedAt < history[index - 1]!.changedAt || history[index]!.status === history[index - 1]!.status) {
      throw new Error('The project backup contains an inconsistent memory status history.');
    }
  }
  return history;
}

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Local project storage is unavailable in this browser.'));
  if (!databasePromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'key' });
          sessions.createIndex('projectId', 'projectId');
          sessions.createIndex('projectSessionKey', ['projectId', 'sessionKey'], { unique: true });
          sessions.createIndex('projectUpdatedAt', ['projectId', 'updatedAt']);
        }
        if (!db.objectStoreNames.contains('revisions')) {
          const revisions = db.createObjectStore('revisions', { keyPath: 'key' });
          revisions.createIndex('projectId', 'projectId');
          revisions.createIndex('projectSession', ['projectId', 'sessionId']);
        }
        if (!db.objectStoreNames.contains('memory')) {
          const memory = db.createObjectStore('memory', { keyPath: 'key' });
          memory.createIndex('projectId', 'projectId');
          memory.createIndex('projectTopic', ['projectId', 'category', 'normalizedTopic']);
        }
        if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('updates')) {
          const updates = db.createObjectStore('updates', { keyPath: 'key' });
          updates.createIndex('projectId', 'projectId');
          updates.createIndex('projectStatus', ['projectId', 'status']);
        }
        if (!db.objectStoreNames.contains('claims')) {
          const claims = db.createObjectStore('claims', { keyPath: 'key' });
          claims.createIndex('projectId', 'projectId');
          claims.createIndex('projectClaim', ['projectId', 'claimId']);
          claims.createIndex('projectTask', ['projectId', 'taskId']);
        }
        if (!db.objectStoreNames.contains('projectTrust')) {
          const projectTrust = db.createObjectStore('projectTrust', { keyPath: 'projectId' });
          projectTrust.createIndex('sourceProjectId', 'sourceProjectId');
        }
        if (!db.objectStoreNames.contains('deviceKeys')) {
          const deviceKeys = db.createObjectStore('deviceKeys', { keyPath: 'key' });
          deviceKeys.createIndex('projectId', 'projectId');
        }
        if (!db.objectStoreNames.contains('trustEvents')) {
          const trustEvents = db.createObjectStore('trustEvents', { keyPath: 'key' });
          trustEvents.createIndex('projectId', 'projectId');
        }
        if (!db.objectStoreNames.contains('trustAnchors')) {
          const anchors = db.createObjectStore('trustAnchors', { keyPath: 'key' });
          anchors.createIndex('sourceProjectId', 'sourceProjectId');
        }
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open local project storage.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Local project storage is being upgraded in another tab. Close older ThreadPack tabs and retry.'));
      };
    });
    databasePromise = opening.catch(error => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

async function withTransaction<T>(stores: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await database();
  const transaction = db.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await run(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction may already have completed. */ }
    await done.catch(() => {});
    throw error;
  }
}

async function removeProjectRows(transaction: IDBTransaction, projectId: string): Promise<void> {
  const projects = transaction.objectStore('projects');
  const sessions = transaction.objectStore('sessions');
  const revisions = transaction.objectStore('revisions');
  const memory = transaction.objectStore('memory');
  const shared = transaction.objectStore('shared');
  const updates = transaction.objectStore('updates');
  const claims = transaction.objectStore('claims');
  const projectTrust = transaction.objectStore('projectTrust');
  const deviceKeys = transaction.objectStore('deviceKeys');
  const trustEvents = transaction.objectStore('trustEvents');
  const trustAnchors = transaction.objectStore('trustAnchors');
  const [sessionKeys, revisionKeys, memoryKeys, deviceKeyKeys, trustEventKeys] = await Promise.all([
    idbRequest(sessions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(revisions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(memory.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(deviceKeys.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(trustEvents.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
  ]);
  for (const key of sessionKeys) sessions.delete(key);
  for (const key of revisionKeys) revisions.delete(key);
  for (const key of memoryKeys) memory.delete(key);
  for (const key of deviceKeyKeys) deviceKeys.delete(key);
  for (const key of trustEventKeys) trustEvents.delete(key);
  const trustState = await idbRequest<ProjectTrustState | undefined>(projectTrust.get(projectId));
  if (trustState) {
    const trustSourceProjectId = trustState.sourceProjectId ?? projectId;
    const anchorKey: [string, string] = [trustSourceProjectId, trustSourceProjectId];
    const anchor = await idbRequest<TrustedProjectAnchor | undefined>(trustAnchors.get(anchorKey));
    if (anchor?.projectId === projectId) { anchor.deletedAt = Date.now(); trustAnchors.put(anchor); }
  }
  projectTrust.delete(projectId); // Retain a minimal deleted-project anchor to reject stale backup replays.
  shared.delete(projectId);
  const updateKeys = await idbRequest(updates.index('projectId').getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of updateKeys) updates.delete(key);
  const claimKeys = await idbRequest(claims.index('projectId').getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of claimKeys) claims.delete(key);
  projects.delete(projectId);
}

async function cleanAbandonedRestores(): Promise<void> {
  const cutoff = Date.now() - RESTORE_STALE_AFTER;
  await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims', 'projectTrust', 'deviceKeys', 'trustEvents', 'trustAnchors'], 'readwrite', async transaction => {
    const projects = await idbRequest<ProjectRecord[]>(transaction.objectStore('projects').getAll());
    for (const project of projects) {
      if (project.restoringSince && project.restoringSince < cutoff) await removeProjectRows(transaction, project.id);
    }
  });
}

export interface ProjectTrustSummary {
  state?: ProjectTrustState;
  events: SignedTrustEvent[];
  verification?: TrustChainVerification;
  trusted: boolean;
  deviceKeyAvailable: boolean;
  readyForConfirmations: boolean;
  issue?: string;
  anchor?: TrustedProjectAnchor;
}

type TrustEventDraft = Omit<TrustEventPayload, 'schema' | 'projectId' | 'id' | 'sequence' | 'previousEventHash' | 'actorKeyId'>;
interface TrustFactMutation {
  factId: string;
  expectedUpdatedAt: number;
  expectedRevision: number;
  apply: (fact: ProjectMemoryFact, event: SignedTrustEvent, changedAt: number) => void;
}

function isUsableLocalSigningKey(value: LocalProjectSigningKey | undefined, expectedKeyId: string): value is LocalProjectSigningKey {
  return !!value && value.keyId === expectedKeyId && typeof CryptoKey !== 'undefined'
    && value.privateKey instanceof CryptoKey && value.privateKey.type === 'private' && value.privateKey.algorithm.name === 'ECDSA'
    && (value.privateKey.algorithm as EcKeyAlgorithm).namedCurve === 'P-256'
    && value.privateKey.extractable === false && value.privateKey.usages.includes('sign');
}

function trustedPublicKeySet(state: ProjectTrustState): Record<string, JsonWebKey> {
  return { [state.rootKeyId]: state.rootPublicKeyJwk, [state.recoveryKeyId]: state.recoveryPublicKeyJwk };
}

export async function getProjectTrustSummary(projectId: string): Promise<ProjectTrustSummary> {
  const snapshot = await withTransaction(['projectTrust', 'trustEvents', 'trustAnchors', 'deviceKeys'], 'readonly', async transaction => {
    const state = await idbRequest<ProjectTrustState | undefined>(transaction.objectStore('projectTrust').get(projectId));
    const events = state ? await idbRequest<StoredProjectTrustEvent[]>(transaction.objectStore('trustEvents').index('projectId').getAll(IDBKeyRange.only(projectId))) : [];
    const sourceProjectId = state?.sourceProjectId ?? projectId;
    const anchors = state ? await idbRequest<TrustedProjectAnchor[]>(transaction.objectStore('trustAnchors').index('sourceProjectId')
      .getAll(IDBKeyRange.only(sourceProjectId))) : [];
    const deviceKey = state ? await idbRequest<LocalProjectSigningKey | undefined>(transaction.objectStore('deviceKeys').get([projectId, state.activeKeyId])) : undefined;
    return { state, events: events.map(record => record.event).sort((first, second) => first.sequence - second.sequence), anchors, deviceKey };
  });
  if (!snapshot.state) return { events: [], trusted: false, deviceKeyAvailable: false, readyForConfirmations: false };
  if (snapshot.events.some(event => event.projectId !== snapshot.state!.sourceProjectId)) {
    return { state: snapshot.state, events: snapshot.events, trusted: false, deviceKeyAvailable: !!snapshot.deviceKey, readyForConfirmations: false,
      issue: 'Project trust history contains a cross-project event.' };
  }
  let verification: TrustChainVerification;
  try { verification = await verifyTrustEventChain(snapshot.events, trustedPublicKeySet(snapshot.state)); }
  catch (error) {
    return { state: snapshot.state, events: snapshot.events, trusted: false, deviceKeyAvailable: !!snapshot.deviceKey, readyForConfirmations: false,
      issue: error instanceof Error ? error.message : 'Project trust history could not be verified.' };
  }
  if (verification.head.sequence !== snapshot.state.sequence || verification.head.eventHash !== snapshot.state.headHash
    || snapshot.state.sequence !== snapshot.events.length || !verification.activeKeyIds.includes(snapshot.state.activeKeyId)) {
    return { state: snapshot.state, events: snapshot.events, trusted: false, deviceKeyAvailable: !!snapshot.deviceKey, readyForConfirmations: false,
      issue: 'Project trust state does not match its signed event chain.' };
  }
  const anchor = snapshot.anchors.find(item => item.sourceProjectId === (snapshot.state!.sourceProjectId ?? projectId));
  if (anchor && snapshot.state.trustStatus === 'trusted-local' && anchor.deletedAt === undefined) {
    if (anchor.rootKeyId !== snapshot.state.rootKeyId || anchor.recoveryKeyId !== snapshot.state.recoveryKeyId
      || anchor.rootPublicKeyFingerprint !== await publicKeyFingerprint(snapshot.state.rootPublicKeyJwk)
      || anchor.recoveryPublicKeyFingerprint !== await publicKeyFingerprint(snapshot.state.recoveryPublicKeyJwk)) {
      return { state: snapshot.state, events: snapshot.events, trusted: false, deviceKeyAvailable: !!snapshot.deviceKey, readyForConfirmations: false,
        issue: 'Project trust root differs from the locally pinned identity.' };
    }
    try { assertTrustChainContainsHead({ sequence: anchor.sequence, eventHash: anchor.headHash }, snapshot.events); }
    catch (error) {
      return { state: snapshot.state, events: snapshot.events, trusted: false, deviceKeyAvailable: !!snapshot.deviceKey, readyForConfirmations: false,
        issue: error instanceof Error ? error.message : 'Project trust history rollback detected.' };
    }
  }
  const anchorOwnedByThisProject = anchor?.projectId === projectId;
  const trusted = snapshot.state.trustStatus === 'trusted-local' && anchorOwnedByThisProject;
  const anchorIssue = snapshot.state.trustStatus === 'trusted-local' && anchor && !anchorOwnedByThisProject
    ? 'active-trust-anchor-owned-by-another-local-project' : undefined;
  const deviceKeyAvailable = isUsableLocalSigningKey(snapshot.deviceKey, snapshot.state.activeKeyId);
  const issue = anchorIssue ?? (trusted && !deviceKeyAvailable ? 'active-local-signing-key-missing' : undefined);
  return { state: snapshot.state, events: snapshot.events, verification, trusted, deviceKeyAvailable, issue, ...(anchor ? { anchor } : {}),
    readyForConfirmations: trusted && deviceKeyAvailable && !!snapshot.state.recoveryAcknowledgedAt };
}

export async function createProjectTrustIdentity(projectId: string, recoveryPassphrase: string): Promise<{ state: ProjectTrustState; recoveryBundle: RecoveryBundle }> {
  const deviceIdentity = await generateSigningIdentity();
  const recovery = await createRecoveryBundle(recoveryPassphrase, deviceIdentity.publicKeyJwk);
  const rootPublicKeyFingerprint = await publicKeyFingerprint(deviceIdentity.publicKeyJwk);
  const recoveryPublicKeyFingerprint = await publicKeyFingerprint(recovery.recoveryIdentity.publicKeyJwk);
  const now = Date.now();
  const state: ProjectTrustState = {
    projectId, sourceProjectId: projectId, trustStatus: 'trusted-local', rootKeyId: deviceIdentity.keyId, rootPublicKeyJwk: deviceIdentity.publicKeyJwk,
    recoveryKeyId: recovery.recoveryIdentity.keyId, recoveryPublicKeyJwk: recovery.recoveryIdentity.publicKeyJwk,
    recoveryBundle: recovery.bundle, activeKeyId: deviceIdentity.keyId, sequence: 0, headHash: TRUST_CHAIN_ORIGIN, createdAt: now, updatedAt: now,
  };
  await withTransaction(['projects', 'projectTrust', 'deviceKeys', 'trustAnchors'], 'readwrite', async transaction => {
    const project = await idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId));
    const existing = await idbRequest<ProjectTrustState | undefined>(transaction.objectStore('projectTrust').get(projectId));
    if (!project || project.restoringSince) throw new Error('This project is unavailable.');
    if (existing) throw new Error('This project already has a trust identity. Use key recovery or rotation instead.');
    transaction.objectStore('projectTrust').add(state);
    const existingAnchor = await idbRequest<TrustedProjectAnchor | undefined>(transaction.objectStore('trustAnchors').get([projectId, projectId]));
    if (existingAnchor) throw new Error('A trust anchor already exists for this project identity. Use its recovery kit instead of creating a new identity.');
    transaction.objectStore('trustAnchors').add({
      key: [projectId, projectId], projectId, sourceProjectId: projectId, rootKeyId: state.rootKeyId,
      rootPublicKeyFingerprint,
      recoveryKeyId: state.recoveryKeyId, recoveryPublicKeyFingerprint,
      sequence: 0, headHash: TRUST_CHAIN_ORIGIN, updatedAt: now,
    } satisfies TrustedProjectAnchor);
    transaction.objectStore('deviceKeys').add({ key: [projectId, deviceIdentity.keyId], projectId,
      keyId: deviceIdentity.keyId, publicKeyJwk: deviceIdentity.publicKeyJwk, privateKey: deviceIdentity.privateKey,
      createdAt: now } satisfies LocalProjectSigningKey);
    touchProject(project, now);
    transaction.objectStore('projects').put(project);
  });
  return { state, recoveryBundle: recovery.bundle };
}

export async function acknowledgeProjectRecoveryBundle(projectId: string, expectedFingerprint: string): Promise<ProjectTrustState> {
  const before = await withTransaction(['projects', 'projectTrust'], 'readonly', async transaction => {
    const project = await idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId));
    const state = await idbRequest<ProjectTrustState | undefined>(transaction.objectStore('projectTrust').get(projectId));
    if (!project || project.restoringSince || !state) throw new Error('This project has no local trust identity.');
    return { project, state };
  });
  const fingerprint = await publicKeyFingerprint(before.state.recoveryPublicKeyJwk);
  if (fingerprint !== expectedFingerprint) throw new Error('Recovery key fingerprint changed. Re-open the recovery kit and try again.');
  return withTransaction(['projects', 'projectTrust'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const trust = transaction.objectStore('projectTrust');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const state = await idbRequest<ProjectTrustState | undefined>(trust.get(projectId));
    if (!project || project.restoringSince || !state || state.updatedAt !== before.state.updatedAt) {
      throw new Error('Project trust state changed during recovery-kit review. Reopen it and try again.');
    }
    state.recoveryAcknowledgedAt = Date.now();
    state.updatedAt = state.recoveryAcknowledgedAt;
    trust.put(state);
    touchProject(project, state.updatedAt);
    projects.put(project);
    return state;
  });
}

async function appendProjectTrustEvent(
  projectId: string,
  draft: TrustEventDraft,
  options: { signer?: LocalSigningIdentity; replacementIdentity?: LocalSigningIdentity; discardReplacedPrivateKey?: boolean; trustAfterRecovery?: boolean;
    factMutation?: TrustFactMutation } = {},
): Promise<SignedTrustEvent> {
  const before = await getProjectTrustSummary(projectId);
  const state = before.state;
  if (!state) throw new Error('Set up this project trust identity before confirming memory.');
  const signer = options.signer ?? await withTransaction(['deviceKeys'], 'readonly', async transaction => {
    const record = await idbRequest<LocalProjectSigningKey | undefined>(transaction.objectStore('deviceKeys').get([projectId, state.activeKeyId]));
    if (!isUsableLocalSigningKey(record, state.activeKeyId)) throw new Error('This device signing key is unavailable. Use the recovery bundle to re-trust this device.');
    return { keyId: record.keyId, publicKeyJwk: record.publicKeyJwk, privateKey: record.privateKey };
  });
  const recoveryAuthorized = options.trustAfterRecovery && signer.keyId === state.recoveryKeyId
    && (state.trustStatus === 'untrusted-import' || state.trustStatus === 'trusted-local' && !before.deviceKeyAvailable);
  if (options.trustAfterRecovery && !recoveryAuthorized) {
    throw new Error('Recovery authorization is valid only for restoring a missing device key or re-trusting an imported project.');
  }
  if (!options.trustAfterRecovery && (state.trustStatus !== 'trusted-local' || !state.recoveryAcknowledgedAt || !before.deviceKeyAvailable)) {
    throw new Error('The active local signing key or recovery acknowledgement is unavailable. Restore device trust before signing.');
  }
  if (!before.verification?.activeKeyIds.includes(signer.keyId)) {
    throw new Error('The signing key is not authorized for this project trust operation.');
  }
  if (signer.keyId === state.recoveryKeyId
    && await publicKeyFingerprint(signer.publicKeyJwk) !== await publicKeyFingerprint(state.recoveryPublicKeyJwk)) {
    throw new Error('The recovery signing key does not match this project recovery identity.');
  }
  const rootPublicKeyFingerprint = await publicKeyFingerprint(state.rootPublicKeyJwk);
  const recoveryPublicKeyFingerprint = await publicKeyFingerprint(state.recoveryPublicKeyJwk);
  const previousTimestamp = before.events.at(-1)?.changedAt ?? 0;
  const event = await signTrustEvent({ ...draft, changedAt: Math.max(draft.changedAt, previousTimestamp),
    schema: TRUST_EVENT_SCHEMA, projectId: state.sourceProjectId ?? projectId, id: makeId(),
    sequence: state.sequence + 1, previousEventHash: state.headHash, actorKeyId: signer.keyId }, signer);
  const changedAt = Date.now();
  await withTransaction(['projects', 'projectTrust', 'deviceKeys', 'trustEvents', 'trustAnchors', ...(options.factMutation ? ['memory'] : [])], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const trustStore = transaction.objectStore('projectTrust');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const current = await idbRequest<ProjectTrustState | undefined>(trustStore.get(projectId));
    if (!project || project.restoringSince || !current) throw new Error('This project trust state is unavailable.');
    if (current.trustStatus !== state.trustStatus) throw new Error('Project trust state changed during signing. Reload and retry the operation.');
    if (current.sequence !== state.sequence || current.headHash !== state.headHash
      || current.activeKeyId !== state.activeKeyId || current.trustStatus !== state.trustStatus || current.sourceProjectId !== state.sourceProjectId) {
      throw new Error('Project trust history changed during signing. Reload and retry the confirmation.');
    }
    transaction.objectStore('trustEvents').add({ key: [projectId, event.sequence], projectId, sequence: event.sequence, event } satisfies StoredProjectTrustEvent);
    const localKeys = transaction.objectStore('deviceKeys');
    if (options.replacementIdentity) {
      const identity = options.replacementIdentity;
      localKeys.add({ key: [projectId, identity.keyId], projectId, keyId: identity.keyId,
        publicKeyJwk: identity.publicKeyJwk, privateKey: identity.privateKey, createdAt: changedAt } satisfies LocalProjectSigningKey);
      if (options.discardReplacedPrivateKey) localKeys.delete([projectId, current.activeKeyId]);
      current.activeKeyId = identity.keyId;
    }
    const revokedKeyId = event.eventType === 'identity.key-revoked' ? event.details?.keyId
      : event.eventType === 'identity.device-retrusted' ? event.details?.revokeKeyId : undefined;
    if (typeof revokedKeyId === 'string') localKeys.delete([projectId, revokedKeyId]);
    current.sequence = event.sequence;
    current.headHash = event.eventHash;
    current.updatedAt = changedAt;
    if (options.trustAfterRecovery) { current.trustStatus = 'trusted-local'; current.recoveryAcknowledgedAt = changedAt; }
    trustStore.put(current);
    const anchors = transaction.objectStore('trustAnchors');
    const trustSourceProjectId = current.sourceProjectId ?? projectId;
    const anchorKey: [string, string] = [trustSourceProjectId, trustSourceProjectId];
    const localAnchor = await idbRequest<TrustedProjectAnchor | undefined>(anchors.get(anchorKey));
    if (localAnchor && localAnchor.projectId !== projectId && current.trustStatus !== 'untrusted-import'
      && !(options.trustAfterRecovery && localAnchor.deletedAt !== undefined)) {
      throw new Error('This trust event does not belong to the locally anchored project identity. Anchor project=' + localAnchor.projectId + ', target=' + projectId + ', status=' + current.trustStatus + ', deleted=' + String(localAnchor.deletedAt) + ', recovery=' + String(options.trustAfterRecovery));
    }
    if (!localAnchor) {
      if (!options.trustAfterRecovery) throw new Error('This project has no local trust anchor. Use the recovery kit to establish one.');
      anchors.add({ key: anchorKey, projectId,
        sourceProjectId: current.sourceProjectId ?? projectId,
        rootKeyId: current.rootKeyId, rootPublicKeyFingerprint,
        recoveryKeyId: current.recoveryKeyId, recoveryPublicKeyFingerprint,
        sequence: event.sequence, headHash: event.eventHash, updatedAt: changedAt } satisfies TrustedProjectAnchor);
    } else {
      if (localAnchor.sequence !== (before.anchor?.sequence ?? 0) || localAnchor.headHash !== (before.anchor?.headHash ?? TRUST_CHAIN_ORIGIN)
        || localAnchor.rootKeyId !== current.rootKeyId || localAnchor.recoveryKeyId !== current.recoveryKeyId) {
        throw new Error('Locally pinned trust state changed during the trust event.');
      }
      assertTrustChainContainsHead({ sequence: localAnchor.sequence, eventHash: localAnchor.headHash }, before.events);
      localAnchor.projectId = projectId;
      localAnchor.sequence = event.sequence;
      localAnchor.headHash = event.eventHash;
      localAnchor.updatedAt = changedAt;
      delete localAnchor.deletedAt;
      anchors.put(localAnchor);
    }
    if (options.factMutation) {
      const memory = transaction.objectStore('memory');
      const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(projectId + String.fromCharCode(0) + options.factMutation.factId));
      if (!fact || fact.updatedAt !== options.factMutation.expectedUpdatedAt
        || (fact.revision ?? 1) !== options.factMutation.expectedRevision) {
        throw new Error('Project fact changed before its signed trust event could be committed. Reopen the fact and try again.');
      }
      options.factMutation.apply(fact, event, changedAt);
      memory.put(fact);
    }
    touchProject(project, changedAt);
    projects.put(project);
  });
  return event;
}

export async function rotateProjectTrustKey(projectId: string): Promise<{ event: SignedTrustEvent; keyId: string }> {
  const current = await getProjectTrustSummary(projectId);
  if (!current.state || !current.readyForConfirmations) throw new Error('The local trust identity is not ready for key rotation.');
  const identity = await generateSigningIdentity();
  const event = await appendProjectTrustEvent(projectId, {
    eventType: 'identity.key-rotated', subjectId: identity.keyId,
    subjectFingerprint: await publicKeyFingerprint(identity.publicKeyJwk), subjectVersion: 1,
    evidenceFingerprints: [], changedAt: Date.now(),
    details: { keyId: identity.keyId, publicKeyJwk: identity.publicKeyJwk },
  }, { replacementIdentity: identity, discardReplacedPrivateKey: true });
  return { event, keyId: identity.keyId };
}

export async function revokeProjectTrustKey(projectId: string, keyId: string): Promise<SignedTrustEvent> {
  const summary = await getProjectTrustSummary(projectId);
  if (!summary.state || !summary.verification?.activeKeyIds.includes(keyId)
    || keyId === summary.state.activeKeyId || keyId === summary.state.recoveryKeyId) {
    throw new Error('Select a trusted inactive device key to revoke. The recovery key must remain available for device recovery.');
  }
  return appendProjectTrustEvent(projectId, {
    eventType: 'identity.key-revoked', subjectId: keyId, subjectFingerprint: await sha256Fingerprint(keyId),
    subjectVersion: summary.state.sequence + 1, evidenceFingerprints: [], changedAt: Date.now(), details: { keyId },
  });
}

export async function retrustProjectDevice(
  projectId: string, bundle: RecoveryBundle, passphrase: string, expectedRecoveryFingerprint: string,
): Promise<{ event: SignedTrustEvent; keyId: string }> {
  const summary = await getProjectTrustSummary(projectId);
  const canRestoreMissingDeviceKey = summary.state?.trustStatus === 'trusted-local' && !summary.deviceKeyAvailable;
  if (!summary.state || summary.state.trustStatus !== 'untrusted-import' && !canRestoreMissingDeviceKey
    || expectedRecoveryFingerprint !== await publicKeyFingerprint(summary.state.recoveryPublicKeyJwk)) {
    throw new Error('Confirm the recovery-key fingerprint shown by the trusted project owner before re-trusting this device.');
  }
  const sourceProjectId = summary.state.sourceProjectId ?? projectId;
  const existingAnchors = await withTransaction(['trustAnchors'], 'readonly', transaction =>
    idbRequest<TrustedProjectAnchor[]>(transaction.objectStore('trustAnchors').index('sourceProjectId').getAll(IDBKeyRange.only(sourceProjectId))));
  if (existingAnchors.some(item => item.projectId !== projectId && item.deletedAt === undefined)) {
    throw new Error('This project identity is already trusted by another local project. Continue from that project to avoid a second signing history.');
  }
  for (const anchor of existingAnchors) {
    if (anchor.rootKeyId !== summary.state.rootKeyId || anchor.recoveryKeyId !== summary.state.recoveryKeyId
      || anchor.rootPublicKeyFingerprint !== await publicKeyFingerprint(summary.state.rootPublicKeyJwk)
      || anchor.recoveryPublicKeyFingerprint !== await publicKeyFingerprint(summary.state.recoveryPublicKeyJwk)) {
      throw new Error('Imported trust identity does not match the locally trusted project anchor.');
    }
    assertTrustChainContainsHead({ sequence: anchor.sequence, eventHash: anchor.headHash }, summary.events);
  }
  const unlocked = await unlockRecoveryBundle(bundle, passphrase);
  if (unlocked.keyId !== summary.state.recoveryKeyId
    || unlocked.authorizedRootKeyId !== summary.state.rootKeyId
    || unlocked.authorizedRootPublicKeyFingerprint !== await publicKeyFingerprint(summary.state.rootPublicKeyJwk)
    || bundle.authorizedRootKeyId !== summary.state.rootKeyId
    || await publicKeyFingerprint(bundle.publicKeyJwk) !== await publicKeyFingerprint(summary.state.recoveryPublicKeyJwk)) {
    throw new Error('Recovery bundle does not match the project trust anchor.');
  }
  const identity = await generateSigningIdentity();
  const revokeKeyId = summary.verification?.activeKeyIds.includes(summary.state.activeKeyId) ? summary.state.activeKeyId : undefined;
  const event = await appendProjectTrustEvent(projectId, {
    eventType: 'identity.device-retrusted', subjectId: identity.keyId,
    subjectFingerprint: await publicKeyFingerprint(identity.publicKeyJwk), subjectVersion: summary.state.sequence + 1,
    evidenceFingerprints: [], changedAt: Date.now(), details: {
      keyId: identity.keyId, publicKeyJwk: identity.publicKeyJwk, ...(revokeKeyId ? { revokeKeyId } : {}),
    },
  }, { signer: unlocked, replacementIdentity: identity, discardReplacedPrivateKey: true, trustAfterRecovery: true });
  return { event, keyId: identity.keyId };
}

function normalizeName(name: string): string {
  if (typeof name !== 'string') throw new Error('Enter a project name.');
  const value = name.trim();
  if (!value || value.length > 100) throw new Error('Project names must contain 1 to 100 characters.');
  return value;
}

function validateSessionInput(input: ProjectSessionInput): void {
  if (!input || typeof input !== 'object' || typeof input.content !== 'string'
    || utf8ByteLength(input.content) > MAX_PROJECT_SESSION_BYTES
    || typeof input.title !== 'string' || input.title.length > 2000
    || typeof input.sourceName !== 'string' || input.sourceName.length > 1000
    || typeof input.format !== 'string' || input.format.length > 200
    || !platformNames.includes(input.platform)
    || input.sourceId !== undefined && (typeof input.sourceId !== 'string' || input.sourceId.length > 2000)
    || !Number.isSafeInteger(input.messageCount) || input.messageCount < 0) {
    throw new Error('This session cannot be stored in the project library.');
  }
  if (inspectSnapshot(input.content).messageCount !== input.messageCount) {
    throw new Error('The saved session failed its structure check. Nothing was added to the project.');
  }
}

function inspectSnapshot(content: string): { messageCount: number; title?: string; platform?: SourcePlatform; sourceId?: string } {
  let messageCount = 0;
  let recordIndex = 0;
  let threadpack = false;
  let title: string | undefined;
  let platform: SourcePlatform | undefined;
  let sourceId: string | undefined;
  let activeBranchMessageIds: string[] | undefined;
  const messageIds = new Set<string>();
  let offset = 0;
  while (offset < content.length) {
    const end = content.indexOf('\n', offset);
    const line = content.slice(offset, end < 0 ? content.length : end).replace(/\r$/, '');
    offset = end < 0 ? content.length : end + 1;
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { throw new Error('A project history entry contains invalid JSON.'); }
    if (!isRecord(record)) throw new Error('A project history entry contains an invalid record.');
    if (recordIndex === 0 && record.type === 'threadpack_session') {
      if (record.version !== 2 || typeof record.title !== 'string' || typeof record.source !== 'string'
        || !Array.isArray(record.branches) || typeof record.activeBranchId !== 'string') {
        throw new Error('A project history entry has an unsupported session header.');
      }
      if (record.branches.length) {
        const activeBranch = record.branches.find(branch => isRecord(branch) && branch.id === record.activeBranchId);
        if (!isRecord(activeBranch) || !Array.isArray(activeBranch.messageIds)
          || activeBranch.messageIds.some(id => typeof id !== 'string')) {
          throw new Error('A project history entry has an invalid active branch.');
        }
        activeBranchMessageIds = activeBranch.messageIds as string[];
      }
      threadpack = true;
      title = record.title;
      if (isRecord(record.provenance)) {
        if (platformNames.includes(record.provenance.platform as SourcePlatform)) platform = record.provenance.platform as SourcePlatform;
        if (typeof record.provenance.sourceId === 'string') sourceId = record.provenance.sourceId;
      }
    } else if (threadpack) {
      if (record.type === 'threadpack_message' && isRecord(record.message)
        && typeof record.message.id === 'string' && typeof record.message.content === 'string'
        && ['system', 'user', 'assistant', 'tool'].includes(record.message.role as string)) {
        if (messageIds.has(record.message.id)) throw new Error('A project history entry contains duplicate message IDs.');
        messageIds.add(record.message.id);
        messageCount++;
      } else if (record.type !== 'threadpack_event' || !isRecord(record.event)
        || typeof record.event.type !== 'string' || typeof record.event.content !== 'string') {
        throw new Error('A project history entry contains an invalid session record.');
      }
    } else if (typeof record.id === 'string' && typeof record.content === 'string'
      && ['system', 'user', 'assistant', 'tool'].includes(record.role as string)) {
      if (messageIds.has(record.id)) throw new Error('A project history entry contains duplicate message IDs.');
      messageIds.add(record.id);
      messageCount++;
      const provenance = record.provenance;
      if (isRecord(provenance)) {
        if (!title && typeof provenance.conversationTitle === 'string') title = provenance.conversationTitle;
        if (!platform && platformNames.includes(provenance.platform as SourcePlatform)) platform = provenance.platform as SourcePlatform;
        if (!sourceId && typeof provenance.conversationSourceId === 'string') sourceId = provenance.conversationSourceId;
      }
    } else throw new Error('A project history entry contains an invalid message record.');
    recordIndex++;
  }
  if (!recordIndex) throw new Error('A project history entry is empty.');
  const selectedMessageCount = activeBranchMessageIds?.length ?? messageCount;
  if (activeBranchMessageIds && (activeBranchMessageIds.some(id => !messageIds.has(id))
    || new Set(activeBranchMessageIds).size !== activeBranchMessageIds.length)) {
    throw new Error('A project history entry has an incomplete active branch.');
  }
  return { messageCount: selectedMessageCount, title, platform, sourceId };
}

async function storeSession(projectId: string, input: ProjectSessionInput, fingerprint: string, sessionKey: string): Promise<ProjectImportResult> {
  return withTransaction(['projects', 'sessions', 'revisions'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const sessions = transaction.objectStore('sessions');
    const revisions = transaction.objectStore('revisions');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    if (!project || project.restoringSince) throw new Error('This project is unavailable. Refresh the project list and retry.');
    const previous = await idbRequest<ProjectSessionRecord | undefined>(sessions.index('projectSessionKey').get(sessionRecordKey(projectId, sessionKey)));
    const now = Date.now();
    if (previous?.fingerprint === fingerprint) {
      previous.title = input.title;
      previous.sourceName = input.sourceName;
      previous.platform = input.platform;
      previous.format = input.format;
      previous.messageCount = input.messageCount;
      if (input.sourceId) previous.sourceId = input.sourceId;
      else delete previous.sourceId;
      previous.updatedAt = now;
      sessions.put(previous);
      const currentRevision = await idbRequest<RevisionRecord | undefined>(
        revisions.get([projectId, previous.id, previous.currentVersion]));
      if (!currentRevision || currentRevision.fingerprint !== fingerprint) {
        throw new Error('The current project revision is unavailable. No import changes were saved.');
      }
      currentRevision.title = input.title;
      currentRevision.sourceName = input.sourceName;
      currentRevision.platform = input.platform;
      currentRevision.format = input.format;
      currentRevision.messageCount = input.messageCount;
      if (input.sourceId) currentRevision.sourceId = input.sourceId;
      else delete currentRevision.sourceId;
      revisions.put(currentRevision);
      touchProject(project, now);
      projects.put(project);
      return { projectId, sessionId: previous.id, version: previous.currentVersion, duplicate: true };
    }
    const sessionId = previous?.id ?? makeId();
    const version = (previous?.currentVersion ?? 0) + 1;
    const session: ProjectSessionRecord = {
      key: `${projectId}\0${sessionId}`, projectId, id: sessionId, sessionKey,
      title: input.title, sourceName: input.sourceName, platform: input.platform,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}), format: input.format,
      messageCount: input.messageCount, fingerprint, currentVersion: version,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    const revision: RevisionRecord = {
      key: [projectId, sessionId, version], projectId, sessionId, version,
      fingerprint, content: input.content, title: input.title, platform: input.platform,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}), format: input.format, messageCount: input.messageCount,
      sourceName: input.sourceName, createdAt: now,
    };
    revisions.put(revision);
    sessions.put(session);
    touchProject(project, now);
    projects.put(project);
    return { projectId, sessionId, version, duplicate: false };
  });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  await cleanAbandonedRestores();
  return withTransaction(['projects'], 'readonly', async transaction =>
    (await idbRequest<ProjectRecord[]>(transaction.objectStore('projects').getAll()))
      .filter(project => !project.restoringSince && project.archivedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function listArchivedProjects(): Promise<ProjectRecord[]> {
  await cleanAbandonedRestores();
  return withTransaction(['projects'], 'readonly', async transaction =>
    (await idbRequest<ProjectRecord[]>(transaction.objectStore('projects').getAll()))
      .filter(project => !project.restoringSince && Number.isSafeInteger(project.archivedAt))
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)));
}

export async function createProject(name: string): Promise<ProjectRecord> {
  const project: ProjectRecord = {
    id: makeId(), name: normalizeName(name), summary: '', importantNotes: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await withTransaction(['projects'], 'readwrite', async transaction => {
    transaction.objectStore('projects').add(project);
  });
  return project;
}

export async function archiveProject(projectId: string): Promise<ProjectRecord> {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 200) throw new Error('This project is unavailable.');
  return withTransaction(['projects'], 'readwrite', async transaction => {
    const store = transaction.objectStore('projects');
    const project = await idbRequest<ProjectRecord | undefined>(store.get(projectId));
    if (!project || project.restoringSince || project.archivedAt !== undefined) throw new Error('This project is unavailable.');
    project.archivedAt = Date.now();
    touchProject(project);
    store.put(project);
    return project;
  });
}

export async function restoreArchivedProject(projectId: string): Promise<ProjectRecord> {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 200) throw new Error('This project is unavailable.');
  return withTransaction(['projects'], 'readwrite', async transaction => {
    const store = transaction.objectStore('projects');
    const project = await idbRequest<ProjectRecord | undefined>(store.get(projectId));
    if (!project || project.restoringSince || !Number.isSafeInteger(project.archivedAt)) throw new Error('This archived project is unavailable.');
    delete project.archivedAt;
    touchProject(project);
    store.put(project);
    return project;
  });
}

export async function updateProject(projectId: string, changes: Partial<Pick<ProjectRecord, 'name' | 'summary' | 'importantNotes'>>): Promise<ProjectRecord> {
  if (typeof projectId !== 'string' || projectId.length > 200 || !isRecord(changes)) throw new Error('This project is unavailable.');
  const next = { ...changes };
  if ('name' in next) next.name = normalizeName(next.name!);
  if ('summary' in next && (typeof next.summary !== 'string' || next.summary.length > 10000)) throw new Error('Project status must be 10,000 characters or fewer.');
  if ('importantNotes' in next && (typeof next.importantNotes !== 'string' || next.importantNotes.length > 20000)) throw new Error('Important notes must be 20,000 characters or fewer.');
  return withTransaction(['projects'], 'readwrite', async transaction => {
    const store = transaction.objectStore('projects');
    const project = await idbRequest<ProjectRecord | undefined>(store.get(projectId));
    if (!project || project.restoringSince) throw new Error('This project is unavailable.');
    Object.assign(project, next);
    touchProject(project);
    store.put(project);
    return project;
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims', 'projectTrust', 'deviceKeys', 'trustEvents', 'trustAnchors'], 'readwrite', transaction => removeProjectRows(transaction, projectId));
}

export async function saveProjectSession(projectId: string, input: ProjectSessionInput): Promise<ProjectImportResult> {
  validateSessionInput(input);
  const fingerprint = await sha256Fingerprint(input.content);
  const sessionKey = input.sourceId
    ? `source:${input.platform}:${input.sourceId}`
    : `content:${fingerprint}`;
  return storeSession(projectId, input, fingerprint, sessionKey);
}

export async function listProjectSessions(projectId: string, query = ''): Promise<{ sessions: ProjectSessionSummary[]; total: number }> {
  if (typeof projectId !== 'string' || projectId.length > 200 || typeof query !== 'string' || query.length > 1000) throw new Error('A valid project search is required.');
  const pattern = searchPattern(query.trim());
  return withTransaction(['sessions', 'revisions'], 'readonly', transaction => new Promise((resolve, reject) => {
    const results: ProjectSessionSummary[] = [];
    let total = 0;
    const sessions = transaction.objectStore('sessions');
    const revisions = transaction.objectStore('revisions');
    const cursorRequest = sessions.index('projectUpdatedAt').openCursor(IDBKeyRange.bound([projectId, 0], [projectId, Number.MAX_SAFE_INTEGER]), 'prev');
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Could not read project sessions.'));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) { resolve({ sessions: results, total }); return; }
      const session = cursor.value as ProjectSessionRecord;
      const titleMatch = !pattern || pattern.test(`${session.title}\n${session.sourceName}\n${session.platform}`);
      const addMatch = (matchedText: boolean) => {
        if (titleMatch || matchedText) {
          total++;
          if (results.length < 100) results.push({ ...session, matchedText });
        }
        cursor.continue();
      };
      if (!pattern || titleMatch) { addMatch(false); return; }
      const historyCursor = revisions.index('projectSession').openCursor(IDBKeyRange.only([projectId, session.id]));
      historyCursor.onerror = () => reject(historyCursor.error ?? new Error('Could not read project history.'));
      historyCursor.onsuccess = () => {
        const revision = historyCursor.result?.value as RevisionRecord | undefined;
        if (!revision || pattern.test(revision.content)) { addMatch(!!revision); return; }
        historyCursor.result!.continue();
      };
    };
  }));
}

export async function listProjectSessionStates(projectId: string): Promise<{ id: string; title: string; currentVersion: number }[]> {
  return withTransaction(['sessions'], 'readonly', async transaction => {
    const sessions = await idbRequest<ProjectSessionRecord[]>(transaction.objectStore('sessions').index('projectId')
      .getAll(IDBKeyRange.only(projectId)));
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, currentVersion }) => ({ id, title, currentVersion }));
  });
}

export async function getProjectSession(projectId: string, sessionId: string, version?: number): Promise<ProjectSessionContent> {
  return withTransaction(['sessions', 'revisions'], 'readonly', async transaction => {
    const session = await idbRequest<ProjectSessionRecord | undefined>(transaction.objectStore('sessions').get(`${projectId}\0${sessionId}`));
    if (!session || session.projectId !== projectId) throw new Error('This saved conversation is unavailable.');
    const selectedVersion = version ?? session.currentVersion;
    const revision = await idbRequest<RevisionRecord | undefined>(transaction.objectStore('revisions').get([projectId, sessionId, selectedVersion]));
    if (!revision || revision.fingerprint !== await sha256Fingerprint(revision.content)) throw new Error('This project history entry failed its integrity check.');
    const snapshot = inspectSnapshot(revision.content);
    if (snapshot.messageCount !== (revision.messageCount ?? session.messageCount) || selectedVersion === session.currentVersion
      && (revision.fingerprint !== session.fingerprint
        || revision.title !== undefined && revision.title !== session.title
        || revision.platform !== undefined && revision.platform !== session.platform
        || revision.messageCount !== undefined && revision.messageCount !== session.messageCount
        || revision.sourceName !== undefined && revision.sourceName !== session.sourceName)) {
      throw new Error('This project history entry failed its structure check.');
    }
    return { summary: session, version: selectedVersion, sourceName: revision.sourceName ?? session.sourceName, content: revision.content };
  });
}

export async function listProjectRevisions(projectId: string, sessionId: string): Promise<ProjectRevisionSummary[]> {
  return withTransaction(['sessions', 'revisions'], 'readonly', async transaction => {
    const session = await idbRequest<ProjectSessionRecord | undefined>(transaction.objectStore('sessions').get(`${projectId}\0${sessionId}`));
    if (!session || session.projectId !== projectId) throw new Error('This saved conversation is unavailable.');
    const revisions = await idbRequest<RevisionRecord[]>(transaction.objectStore('revisions').index('projectSession')
      .getAll(IDBKeyRange.only([projectId, sessionId])));
    return revisions.sort((a, b) => b.version - a.version).map(revision => ({
      version: revision.version, fingerprint: revision.fingerprint, sourceName: revision.sourceName,
      createdAt: revision.createdAt, current: revision.version === session.currentVersion,
    }));
  });
}

export async function restoreProjectRevision(projectId: string, sessionId: string, version: number): Promise<ProjectImportResult> {
  const checked = await getProjectSession(projectId, sessionId, version);
  const checkedFingerprint = await sha256Fingerprint(checked.content);
  const checkedSnapshot = inspectSnapshot(checked.content);
  return withTransaction(['projects', 'sessions', 'revisions'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const sessions = transaction.objectStore('sessions');
    const revisions = transaction.objectStore('revisions');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const session = await idbRequest<ProjectSessionRecord | undefined>(sessions.get(`${projectId}\0${sessionId}`));
    const selected = await idbRequest<RevisionRecord | undefined>(revisions.get([projectId, sessionId, version]));
    if (!project || project.restoringSince || !session || !selected || selected.fingerprint !== checkedFingerprint
      || selected.messageCount !== checkedSnapshot.messageCount) throw new Error('This history entry is unavailable or changed.');
    if (session.fingerprint === selected.fingerprint) return { projectId, sessionId, version: session.currentVersion, duplicate: true };
    const nextVersion = session.currentVersion + 1;
    const now = Date.now();
    revisions.add({ ...selected, key: [projectId, sessionId, nextVersion], version: nextVersion, createdAt: now });
    Object.assign(session, {
      currentVersion: nextVersion, fingerprint: selected.fingerprint, sourceName: selected.sourceName,
      title: selected.title, platform: selected.platform, sourceId: selected.sourceId, format: selected.format,
      messageCount: selected.messageCount, updatedAt: now,
    });
    sessions.put(session);
    touchProject(project, now);
    projects.put(project);
    return { projectId, sessionId, version: nextVersion, duplicate: false };
  });
}

function normalizeMemoryTopic(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

class InvalidEvidenceRevisionError extends Error {
  constructor(readonly bindingIssue: Extract<EvidenceBindingIssue, 'revision_integrity' | 'revision_structure' | 'revision_content_invalid'>) {
    super('The saved evidence revision is invalid.');
    this.name = 'InvalidEvidenceRevisionError';
  }
}

async function readEvidenceRevision(projectId: string, sessionId: string, version: number) {
  const { session, revision } = await withTransaction(['sessions', 'revisions'], 'readonly', async transaction => {
    const [session, revision] = await Promise.all([
      idbRequest<ProjectSessionRecord | undefined>(transaction.objectStore('sessions').get(`${projectId}\0${sessionId}`)),
      idbRequest<RevisionRecord | undefined>(transaction.objectStore('revisions').get([projectId, sessionId, version])),
    ]);
    return { session, revision };
  });
  if (!session || session.projectId !== projectId || !revision) return undefined;
  if (typeof revision.content !== 'string' || !/^[a-f0-9]{64}$/.test(revision.fingerprint)
    || revision.fingerprint !== await sha256Fingerprint(revision.content)) {
    throw new InvalidEvidenceRevisionError('revision_integrity');
  }
  let snapshot: ReturnType<typeof inspectSnapshot>;
  try { snapshot = inspectSnapshot(revision.content); }
  catch { throw new InvalidEvidenceRevisionError('revision_content_invalid'); }
  if (snapshot.messageCount !== (revision.messageCount ?? session.messageCount)
    || version === session.currentVersion && (revision.fingerprint !== session.fingerprint
      || revision.title !== undefined && revision.title !== session.title
      || revision.platform !== undefined && revision.platform !== session.platform
      || revision.messageCount !== undefined && revision.messageCount !== session.messageCount
      || revision.sourceName !== undefined && revision.sourceName !== session.sourceName)) {
    throw new InvalidEvidenceRevisionError('revision_structure');
  }
  try {
    return { projectId, sessionId, version, fingerprint: revision.fingerprint, content: revision.content,
      sourceIdentity: { platform: revision.platform, sourceName: revision.sourceName, sourceId: revision.sourceId },
      messages: indexEvidenceMessages(revision.content) };
  } catch {
    throw new InvalidEvidenceRevisionError('revision_content_invalid');
  }
}

function evidenceReader(scope: EvidenceScope, allowLocalAttestation = true): (evidence: MemoryEvidence, fact: ProjectMemoryFact) => Promise<MemoryEvidence & EvidenceAssessment> {
  let cached: { key: string; revision?: IndexedEvidenceRevision } | undefined;
  let trust: Promise<ProjectTrustSummary> | undefined;
  return async (evidence: MemoryEvidence, fact: ProjectMemoryFact): Promise<MemoryEvidence & EvidenceAssessment> => {
    let revision: IndexedEvidenceRevision | undefined;
    if (evidence.kind === 'conversation' && evidence.sessionId && Number.isSafeInteger(evidence.version)) {
      const key = JSON.stringify([evidence.sessionId, evidence.version]);
      if (cached?.key !== key) {
        try { cached = { key, revision: await readEvidenceRevision(scope.projectId, evidence.sessionId, evidence.version!) }; }
        catch (error) {
          if (error instanceof InvalidEvidenceRevisionError) return invalidEvidenceBinding(evidence, error.bindingIssue);
          throw error;
        }
      }
      revision = cached.revision;
    }
    const binding = await assessEvidenceBinding(evidence, scope, revision);
    const assessed = await validateEvidenceRelation(fact, evidence, binding, allowLocalAttestation);
    if (!allowLocalAttestation || assessed.relationBasis !== 'user_attestation') return assessed;
    const relationEvent = assessed.relationHistory?.at(-1);
    if (!relationEvent?.trustEventId || !relationEvent.trustEventHash || !relationEvent.trustKeyId) {
      return { ...assessed, relation: 'unverified', relationBasis: 'none', bindingIssue: 'relation_mismatch' };
    }
    trust ??= getProjectTrustSummary(scope.projectId);
    const summary = await trust;
    const signed = summary.events.find(event => event.id === relationEvent.trustEventId);
    if (!summary.trusted || !signed || signed.eventHash !== relationEvent.trustEventHash
      || signed.actorKeyId !== relationEvent.trustKeyId || signed.eventType !== 'evidence.relation-attested'
      || signed.details?.relationEventId !== relationEvent.id || signed.details?.evidenceId !== evidence.id
      || signed.details?.relation !== relationEvent.relation || signed.subjectId !== fact.id
      || signed.subjectVersion !== fact.revision || signed.subjectFingerprint !== (await factConfirmationMaterial(fact)).subjectFingerprint) {
      return { ...assessed, relation: 'unverified', relationBasis: 'none', bindingIssue: 'relation_mismatch' };
    }
    return assessed;
  };
}

async function prepareMemoryEvidence(projectId: string, input: MemoryEvidenceInput): Promise<MemoryEvidence> {
  if (!input || !EVIDENCE_KINDS.includes(input.kind) || typeof input.reference !== 'string' || input.reference.length > 1000
    || typeof input.quote !== 'undefined' && (typeof input.quote !== 'string' || input.quote.length > 1000)
    || input.proposalId !== undefined && (input.kind !== 'conversation' || typeof input.proposalId !== 'string' || !input.proposalId || input.proposalId.length > 200)) {
    throw new Error('A memory evidence entry is invalid.');
  }
  const recordedAt = Date.now();
  if (input.kind === 'conversation') {
    if (typeof input.sessionId !== 'string' || typeof input.messageId !== 'string'
      || !Number.isSafeInteger(input.version) || (input.version as number) < 1) throw new Error('Select a saved conversation message as evidence.');
    const revision = await readEvidenceRevision(projectId, input.sessionId, input.version!);
    if (!revision) throw new Error('The selected evidence message is unavailable in that saved version.');
    const session = await withTransaction(['sessions'], 'readonly', transaction =>
      idbRequest<ProjectSessionRecord | undefined>(transaction.objectStore('sessions').get(`${projectId}\0${input.sessionId}`)));
    if (!session) throw new Error('This saved conversation is unavailable.');
    return bindNewConversationEvidence({
      id: makeId(), kind: input.kind,
      reference: `${session.title} · v${input.version} · ${input.messageId}`,
      quote: input.quote?.trim() ?? '', projectId, sourceProjectId: projectId, sessionId: input.sessionId, version: input.version, messageId: input.messageId,
      ...(input.proposalId ? { proposalId: input.proposalId } : {}),
      recordedAt, verification: 'source-matched',
    }, revision);
  }
  if (input.kind === 'user') return {
    id: makeId(), kind: input.kind, reference: input.reference || 'No source attached', quote: '', recordedAt,
    verification: 'unattached', bindingStatus: 'unverified', relation: 'unverified', relationBasis: 'none',
  };
  const commit = input.commit?.trim();
  if (!input.reference.trim() || !commit || !/^[a-f0-9]{7,64}$/i.test(commit) || !input.quote?.trim()) {
    throw new Error('Repository and test evidence need a commit ID and an exact excerpt or result.');
  }
  if (input.kind === 'test' && !input.command?.trim()) throw new Error('Test evidence needs the command that was run.');
  return {
    id: makeId(), kind: input.kind, reference: input.reference, quote: input.quote.trim(), commit,
    ...(input.command ? { command: input.command.trim().slice(0, 500) } : {}), recordedAt,
    verification: 'user-recorded', bindingStatus: 'unverified', relation: 'unverified', relationBasis: 'none',
  };
}

async function factConfirmationTrust(fact: ProjectMemoryFact, trust: ProjectTrustSummary): Promise<ProjectMemoryFact['confirmationTrust']> {
  if (!fact.confirmationEventId) return fact.status === 'confirmed' ? 'legacy-unverified' : 'inactive';
  if (trust.issue && trust.issue !== 'active-local-signing-key-missing') return 'invalid';
  if (!trust.trusted || !trust.verification) return fact.status === 'confirmed' ? 'legacy-unverified' : 'inactive';
  const confirmation = trust.events.find(event => event.id === fact.confirmationEventId);
  const confirmationHasLifecycleBinding = confirmation?.details?.toStatus !== undefined
    || confirmation?.details?.lifecycleRevision !== undefined || confirmation?.details?.lifecycleProjectId !== undefined;
  if (!confirmation || confirmation.eventType !== 'claim.confirmed' || confirmation.subjectId !== fact.id
    || confirmation.details?.confirmationVersion !== fact.confirmationVersion
    || confirmationHasLifecycleBinding && (confirmation.details?.toStatus !== 'confirmed'
      || confirmation.details?.lifecycleRevision !== confirmation.subjectVersion
      || confirmation.details?.lifecycleProjectId !== (fact.confirmationProjectId ?? fact.projectId))
    ) return 'invalid';
  const revocation = fact.confirmationRevocationEventId
    ? trust.events.find(event => event.id === fact.confirmationRevocationEventId)
    : trust.events.find(event => event.eventType === 'claim.confirmation-revoked'
      && event.details?.confirmationEventId === confirmation.id);
  if (revocation) {
    const revocationHasLifecycleBinding = revocation.details?.toStatus !== undefined
      || revocation.details?.lifecycleRevision !== undefined || revocation.details?.lifecycleProjectId !== undefined;
    if (revocation.eventType !== 'claim.confirmation-revoked' || revocation.subjectId !== confirmation.subjectId
      || revocation.subjectVersion !== confirmation.subjectVersion || revocation.subjectFingerprint !== confirmation.subjectFingerprint
      || revocation.details?.confirmationEventId !== confirmation.id
      || JSON.stringify([...revocation.evidenceFingerprints].sort()) !== JSON.stringify([...confirmation.evidenceFingerprints].sort())
      || fact.confirmationRevocationEventId !== undefined && fact.confirmationRevocationEventId !== revocation.id
      || revocationHasLifecycleBinding && (revocation.details?.toStatus !== fact.status
        || revocation.details?.lifecycleRevision !== fact.revision
        || revocation.details?.lifecycleProjectId !== (fact.lifecycleProjectId ?? fact.projectId)
        || fact.statusHistory?.at(-1)?.trustEventId !== revocation.id
        || fact.statusHistory?.at(-1)?.trustEventHash !== revocation.eventHash
        || fact.statusHistory?.at(-1)?.trustKeyId !== revocation.actorKeyId)) return 'invalid';
    return 'revoked';
  }
  if (fact.status !== 'confirmed') return 'inactive';
  if (confirmation.subjectVersion !== fact.revision) return 'invalid';
  if (confirmation.details?.expiresAt !== undefined && confirmation.details.expiresAt !== (fact.expiresAt ?? null)
    || fact.expiresAt !== undefined && confirmation.details?.expiresAt !== fact.expiresAt) return 'invalid';
  const material = await factConfirmationMaterial(fact);
  if (confirmation.subjectFingerprint !== material.subjectFingerprint
    || JSON.stringify([...confirmation.evidenceFingerprints].sort()) !== JSON.stringify(material.evidenceFingerprints)) return 'invalid';
  return 'authenticated';
}

async function factLifecycleTrust(fact: ProjectMemoryFact, trust: ProjectTrustSummary): Promise<ProjectMemoryFact['lifecycleTrust']> {
  if (!isTerminalMemoryStatus(fact.status)) return 'inactive';
  const transition = fact.statusHistory?.at(-1);
  if (!transition || transition.status !== fact.status || !transition.trustEventId) return 'legacy-unverified';
  if (trust.issue && trust.issue !== 'active-local-signing-key-missing') return 'invalid';
  if (!trust.trusted || !trust.verification) return 'legacy-unverified';
  const event = trust.events.find(item => item.id === transition.trustEventId);
  if (!event || event.eventHash !== transition.trustEventHash || event.actorKeyId !== transition.trustKeyId
    || event.subjectId !== fact.id) return 'invalid';

  const revocationReason = fact.status === 'rejected' ? 'rejected'
    : fact.status === 'revoked' ? 'revoked'
      : fact.status === 'expired' ? 'expired' : fact.status === 'superseded' ? 'superseded' : undefined;
  if (event.eventType === 'claim.confirmation-revoked') {
    if (!revocationReason || fact.confirmationRevocationEventId !== event.id
      || event.details?.reason !== revocationReason || fact.confirmationTrust !== 'revoked'
      || event.details?.toStatus !== fact.status || event.details?.lifecycleRevision !== fact.revision
      || event.details?.lifecycleProjectId !== (fact.lifecycleProjectId ?? fact.projectId)
      || event.actorKeyId !== transition.trustKeyId) return 'invalid';
    return 'authenticated';
  }
  const expectedEventType = fact.status === 'rejected' ? 'claim.rejected'
    : fact.status === 'revoked' ? 'claim.revoked'
      : fact.status === 'expired' ? 'claim.expired'
        : fact.status === 'superseded' ? 'claim.superseded' : undefined;
  const expectedReason = fact.status === 'rejected' ? 'user-rejected'
    : fact.status === 'revoked' ? 'user-revoked'
      : fact.status === 'expired' ? 'expires-at-reached'
        : fact.status === 'superseded' ? 'replaced-by-new-fact' : undefined;
  if (!expectedEventType || event.eventType !== expectedEventType
    || event.details?.toStatus !== fact.status || event.details?.reason !== expectedReason
    || event.details?.fromStatus !== fact.statusHistory?.at(-2)?.status
    || event.details?.lifecycleRevision !== fact.revision
    || event.details?.lifecycleProjectId !== (fact.lifecycleProjectId ?? fact.projectId)
    || event.subjectVersion !== fact.revision) return 'invalid';
  const material = await factLifecycleMaterial(fact);
  if (event.subjectFingerprint !== material.subjectFingerprint
    || JSON.stringify([...event.evidenceFingerprints].sort()) !== JSON.stringify(material.evidenceFingerprints)) return 'invalid';
  return 'authenticated';
}

async function expireProjectMemoryFacts(projectId: string, observedAt = Date.now()): Promise<void> {
  const changes = await withTransaction(['projects', 'memory', 'updates'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    if (!project || project.restoringSince) return [];
    const facts = await idbRequest<ProjectMemoryFact[]>(memory.index('projectId').getAll(IDBKeyRange.only(projectId)));
    const expired: { before: ProjectMemoryFact; after: ProjectMemoryFact }[] = [];
    for (const fact of facts) {
      if (isTerminalMemoryStatus(fact.status) || fact.expiresAt === undefined || fact.expiresAt > observedAt) continue;
      const before = { ...fact, evidence: fact.evidence.map(item => ({ ...item })) };
      const changedAt = Math.max(observedAt, fact.updatedAt + 1);
      fact.status = 'expired';
      fact.expiredAt = fact.expiresAt;
      appendStatusChange(fact, 'expired', changedAt);
      fact.conflictsWith = [];
      delete fact.reviewStateBeforeConflict;
      fact.updatedAt = changedAt;
      fact.revision = (fact.revision ?? 0) + 1;
      for (const conflictId of before.conflictsWith) {
        const other = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${conflictId}`));
        if (!other) continue;
        other.conflictsWith = other.conflictsWith.filter(id => id !== fact.id);
        if (!other.conflictsWith.length && other.status === 'needs-review' && other.reviewStateBeforeConflict) {
          const restoredStatus = other.reviewStateBeforeConflict === 'proposed' ? 'proposed' : 'needs-review';
          other.status = restoredStatus;
          appendStatusChange(other, restoredStatus, changedAt);
          delete other.reviewStateBeforeConflict;
        }
        other.updatedAt = changedAt;
        other.revision = (other.revision ?? 0) + 1;
        memory.put(other);
      }
      await revokeAcceptedProposals(transaction, projectId, fact.id, changedAt);
      memory.put(fact);
      expired.push({ before, after: { ...fact, evidence: fact.evidence.map(item => ({ ...item })) } });
    }
    if (expired.length) {
      touchProject(project, observedAt);
      projects.put(project);
    }
    return expired;
  });
  if (!changes.length) return;
  const trust = await getProjectTrustSummary(projectId);
  if (!trust.readyForConfirmations) return;
  for (const change of changes) {
    if (change.before.status === 'confirmed' && change.before.confirmationEventId) {
      await recordFactConfirmationRevocation(projectId, change.before, change.after, 'expired');
    } else {
      await recordFactLifecycleEvent(projectId, change.after, 'claim.expired', 'expires-at-reached');
    }
  }
}

export async function listProjectMemory(projectId: string): Promise<ProjectMemoryFact[]> {
  if (typeof projectId !== 'string' || projectId.length > 200) throw new Error('This project is unavailable.');
  await expireProjectMemoryFacts(projectId);
  const facts = await withTransaction(['memory'], 'readonly', transaction =>
    idbRequest<ProjectMemoryFact[]>(transaction.objectStore('memory').index('projectId').getAll(IDBKeyRange.only(projectId))));
  const trust = await getProjectTrustSummary(projectId);
  const assess = evidenceReader({ projectId, sourceProjectId: projectId });
  for (const fact of facts) {
    const evidence: MemoryEvidence[] = [];
    for (const citation of fact.evidence) evidence.push(await assess(citation, fact));
    fact.evidence = evidence;
    fact.confirmationTrust = await factConfirmationTrust(fact, trust);
    fact.lifecycleTrust = await factLifecycleTrust(fact, trust);
  }
  return facts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateProjectMemoryEvidenceRelation(
  projectId: string, factId: string, evidenceId: string, relation: EvidenceRelation,
): Promise<ProjectMemoryFact> {
  await expireProjectMemoryFacts(projectId);
  if (!['supports', 'contradicts', 'context_only', 'insufficient', 'unverified'].includes(relation)) {
    throw new Error('Choose a valid evidence relationship.');
  }
  const before = await withTransaction(['projects', 'memory'], 'readonly', async transaction => {
    const project = await idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(projectId + String.fromCharCode(0) + factId));
    if (!project || project.restoringSince || !fact || isTerminalMemoryStatus(fact.status)) {
      throw new Error('This project memory entry is unavailable for evidence review.');
    }
    const evidence = fact.evidence.find(item => item.id === evidenceId);
    if (!evidence) throw new Error('This evidence entry is unavailable.');
    return { fact, evidence: { ...evidence } };
  });
  const assessed = await evidenceReader({ projectId, sourceProjectId: projectId })(before.evidence, before.fact);
  if (relation !== 'unverified' && !canAttestEvidenceRelation(assessed)) {
    throw new Error('This evidence source is unavailable for a user relationship review.');
  }
  const trust = await getProjectTrustSummary(projectId);
  const revokeConfirmation = await factConfirmationTrust(before.fact, trust) === 'authenticated';
  if (revokeConfirmation) await ensureProjectTrustReady(projectId);
  const changedAt = Date.now();
  const resetInvalidHistory = assessed.bindingIssue === 'relation_mismatch';
  const relationEvent = await createEvidenceRelationEvent(before.fact, assessed, relation, makeId(), changedAt);
  const previousWasAttested = assessed.relationBasis === 'user_attestation';
  const signedRelationChange = relation !== 'unverified' || previousWasAttested;
  const nextRevision = (before.fact.revision ?? 1) + 1;
  const applyRelationChange = (fact: ProjectMemoryFact, signedEvent?: SignedTrustEvent) => {
    const evidence = fact.evidence.find(item => item.id === evidenceId);
    if (!evidence || JSON.stringify(evidence) !== JSON.stringify(before.evidence)) {
      throw new Error('This evidence entry changed during review. Reopen it and try again.');
    }
    if (revokeConfirmation) {
      appendStatusChange(fact, 'needs-review', changedAt);
      fact.status = 'needs-review';
    }
    Object.assign(evidence, assessed, {
      relation: relationEvent.relation, relationBasis: relationEvent.relationBasis,
      relationHistory: [...(resetInvalidHistory ? [] : evidence.relationHistory ?? []), {
        ...relationEvent,
        ...(signedEvent ? { trustEventId: signedEvent.id, trustEventHash: signedEvent.eventHash, trustKeyId: signedEvent.actorKeyId } : {}),
      }],
      ...(resetInvalidHistory || evidence.legacyRelationHistory?.length
        ? { legacyRelationHistory: [...(evidence.legacyRelationHistory ?? []), ...(resetInvalidHistory ? evidence.relationHistory ?? [] : [])] }
        : {}),
    });
    fact.updatedAt = changedAt;
    fact.revision = nextRevision;
  };
  if (signedRelationChange) {
    await ensureProjectTrustReady(projectId);
    const projectedEvidence: MemoryEvidence[] = before.fact.evidence.map(item => item.id === evidenceId
      ? { ...assessed, relation, relationBasis: relationEvent.relationBasis } : item);
    const projectedFact = { ...before.fact, evidence: projectedEvidence, revision: nextRevision,
      ...(revokeConfirmation ? { status: 'needs-review' as const } : {}) };
    const material = await factConfirmationMaterial(projectedFact);
    await appendProjectTrustEvent(projectId, {
      eventType: relation === 'unverified' ? 'evidence.relation-revoked' : 'evidence.relation-attested',
      subjectId: before.fact.id, subjectFingerprint: material.subjectFingerprint, subjectVersion: nextRevision,
      evidenceFingerprints: material.evidenceFingerprints, changedAt,
      details: { evidenceId, relation, relationBasis: relationEvent.relationBasis, relationEventId: relationEvent.id },
    }, { factMutation: {
      factId, expectedUpdatedAt: before.fact.updatedAt, expectedRevision: before.fact.revision ?? 1,
      apply(fact, signedEvent) { applyRelationChange(fact, signedEvent); },
    } });
  } else {
    await withTransaction(['projects', 'memory'], 'readwrite', async transaction => {
      const projects = transaction.objectStore('projects');
      const memory = transaction.objectStore('memory');
      const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
      const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(projectId + String.fromCharCode(0) + factId));
      if (!project || project.restoringSince || !fact || fact.updatedAt !== before.fact.updatedAt
        || fact.revision !== before.fact.revision || isTerminalMemoryStatus(fact.status)) {
        throw new Error('This project memory entry changed during evidence review. Reopen it and try again.');
      }
      applyRelationChange(fact);
      memory.put(fact);
      touchProject(project, changedAt);
      projects.put(project);
    });
  }
  const current = await withTransaction(['memory'], 'readonly', transaction =>
    idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(projectId + String.fromCharCode(0) + factId)));
  if (!current) throw new Error('The project fact disappeared during evidence review.');
  if (revokeConfirmation) return recordFactConfirmationRevocation(projectId, before.fact, current, 'needs-review');
  return (await listProjectMemory(projectId)).find(item => item.id === factId) ?? current;
}

async function createProjectMemoryFactInternal(projectId: string, input: ProjectMemoryInput): Promise<ProjectMemoryFact> {
  if (!input || !MEMORY_CATEGORIES.includes(input.category) || !['user', 'ai'].includes(input.origin)
    || !MEMORY_STATUSES.includes(input.status) || typeof input.topic !== 'string' || !input.topic.trim()
    || input.topic.length > 160 || typeof input.statement !== 'string' || !input.statement.trim()
    || input.statement.length > 4000 || !Array.isArray(input.evidence) || input.evidence.length > 5
    || input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())
    || input.reconsiders !== undefined && (typeof input.reconsiders !== 'string' || !input.reconsiders || input.reconsiders.length > 200)
    || input.taskState !== undefined && !TASK_STATES.includes(input.taskState)
    || input.category !== 'task' && input.taskState !== undefined) {
    throw new Error('Enter a category, topic, statement, and up to five evidence entries.');
  }
  if (input.origin === 'ai' && (input.status !== 'proposed' || !input.evidence.length || input.evidence.some(item => item.kind !== 'conversation'))) {
    throw new Error('AI-extracted facts must remain proposed and cite selected conversation messages.');
  }
  if (input.origin === 'user' && !['confirmed', 'needs-review'].includes(input.status)) {
    throw new Error('User-authored facts must be confirmed or marked for review.');
  }
  if (input.reconsiders && (input.origin !== 'user' || input.status !== 'needs-review' || input.supersedes)) {
    throw new Error('Only a user-authored review candidate can reconsider a prior terminal record.');
  }
  if (input.expiresAt !== undefined && input.expiresAt <= Date.now()) throw new Error('A new fact expiration must be in the future.');
  const topic = input.topic.trim();
  const normalizedTopic = normalizeMemoryTopic(topic);
  const evidenceInputs = input.evidence.length ? input.evidence : [{ kind: 'user' as const, reference: 'No source attached' }];
  const evidence = await Promise.all(evidenceInputs.map(item => prepareMemoryEvidence(projectId, item)));
  if (input.origin === 'ai' && evidence.some(item => item.bindingStatus !== 'source_matched')) {
    throw new Error('Every AI suggestion must cite selected conversation evidence.');
  }
  const id = makeId();
  return withTransaction(['projects', 'memory', 'updates'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    if (!project || project.restoringSince) throw new Error('This project is unavailable.');
    const now = Date.now();
    const fact: ProjectMemoryFact = {
      key: `${projectId}\0${id}`, id, projectId, category: input.category, topic, normalizedTopic,
      statement: input.statement.trim(), revision: 1, origin: input.origin, status: input.status,
      statusHistory: [{ status: input.status, changedAt: now }],
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.reconsiders ? { reconsiders: input.reconsiders } : {}),
      ...(input.category === 'task' ? { taskState: input.taskState ?? 'unclear' } : {}),
      evidence, conflictsWith: [], createdAt: now, updatedAt: now,
    };
    let matching: ProjectMemoryFact[] = [];
    const projectFacts = await idbRequest<ProjectMemoryFact[]>(memory.index('projectId').getAll(IDBKeyRange.only(projectId)));
    let reconsideredFact: ProjectMemoryFact | undefined;
    if (input.reconsiders) {
      reconsideredFact = projectFacts.find(previous => previous.id === input.reconsiders);
      if (!reconsideredFact || !isTerminalMemoryStatus(reconsideredFact.status)) {
        throw new Error('The selected historical fact is not available for reconsideration.');
      }
    }
    const normalizedClaim = normalizeMemoryClaimText(fact.statement);
    const explicitlyReconsidersThisClaim = !!reconsideredFact
      && normalizeMemoryClaimText(reconsideredFact.statement) === normalizedClaim
      && (reconsideredFact.taskState ?? 'unclear') === (fact.taskState ?? 'unclear');
    const blockedDuplicate = !explicitlyReconsidersThisClaim && projectFacts.find(previous => isTerminalMemoryStatus(previous.status)
      && normalizeMemoryClaimText(previous.statement) === normalizedClaim
      && (previous.taskState ?? 'unclear') === (fact.taskState ?? 'unclear'));
    if (blockedDuplicate) {
      throw new Error(`This claim has a rejected or inactive terminal record in this project. Review that record or explicitly reconsider it (${blockedDuplicate.id}).`);
    }
    if (input.supersedes) {
      if (typeof input.supersedes !== 'string' || input.supersedes.length > 200) throw new Error('The fact to supersede is invalid.');
      const previous = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${input.supersedes}`));
      if (!previous || isTerminalMemoryStatus(previous.status)) throw new Error('The selected previous fact is unavailable.');
      previous.status = 'superseded';
      appendStatusChange(previous, 'superseded', now);
      previous.supersededBy = fact.id;
      previous.updatedAt = now;
      previous.revision = (previous.revision ?? 1) + 1;
      await revokeAcceptedProposals(transaction, projectId, previous.id, now);
      fact.supersedes = previous.id;
      for (const otherId of previous.conflictsWith) {
        const other = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${otherId}`));
        if (other) {
          other.conflictsWith = other.conflictsWith.filter(id => id !== previous.id);
          if (!other.conflictsWith.length && other.status === 'needs-review' && other.reviewStateBeforeConflict) {
            const restoredStatus = other.reviewStateBeforeConflict === 'proposed' ? 'proposed' : 'needs-review';
            other.status = restoredStatus;
            appendStatusChange(other, restoredStatus, now);
            delete other.reviewStateBeforeConflict;
          }
          other.updatedAt = now;
          other.revision = (other.revision ?? 1) + 1;
          memory.put(other);
        }
      }
      previous.conflictsWith = [];
      memory.put(previous);
      matching = await idbRequest<ProjectMemoryFact[]>(memory.index('projectTopic').getAll(
        IDBKeyRange.only([projectId, fact.category, fact.normalizedTopic])));
    } else {
      matching = await idbRequest<ProjectMemoryFact[]>(memory.index('projectTopic').getAll(
        IDBKeyRange.only([projectId, fact.category, fact.normalizedTopic])));
      const sameUserFact = input.origin === 'user' && matching.find(previous => previous.origin === 'user'
        && !isTerminalMemoryStatus(previous.status)
        && previous.statement.trim().normalize('NFKC').toLocaleLowerCase() === fact.statement.normalize('NFKC').toLocaleLowerCase()
        && previous.taskState === fact.taskState && previous.reconsiders === fact.reconsiders);
      if (sameUserFact) {
        if (input.status === 'confirmed' && sameUserFact.conflictsWith.length) throw new Error('Resolve the listed conflicts before confirming this fact.');
        const evidenceKey = (item: MemoryEvidence) => item.kind === 'conversation'
          ? `${item.kind}\0${item.sessionId}\0${item.version}\0${item.messageId}\0${item.messageFingerprint}`
          : `${item.kind}\0${item.reference}\0${item.commit ?? ''}\0${item.command ?? ''}\0${item.quote}`;
        const knownEvidence = new Set(sameUserFact.evidence.map(evidenceKey));
        const additions = evidence.filter(item => !knownEvidence.has(evidenceKey(item)));
        if (sameUserFact.evidence.length + additions.length > 20) throw new Error('A memory fact can hold at most 20 evidence entries.');
        sameUserFact.evidence.push(...additions);
        if (sameUserFact.status !== input.status) appendStatusChange(sameUserFact, input.status, now);
        sameUserFact.status = input.status;
        if (input.expiresAt !== undefined && sameUserFact.expiresAt !== input.expiresAt) {
          sameUserFact.expiresAt = input.expiresAt;
          delete sameUserFact.expiredAt;
        }
        sameUserFact.updatedAt = now;
        sameUserFact.revision = (sameUserFact.revision ?? 1) + 1;
        memory.put(sameUserFact);
        touchProject(project, now);
        projects.put(project);
        return sameUserFact;
      }
      const duplicateAIFact = input.origin === 'ai' && matching.find(previous => !isTerminalMemoryStatus(previous.status)
        && previous.statement.trim().normalize('NFKC').toLocaleLowerCase() === fact.statement.normalize('NFKC').toLocaleLowerCase()
        && previous.taskState === fact.taskState);
      if (duplicateAIFact) {
        const evidenceKey = (item: MemoryEvidence) => item.kind === 'conversation'
          ? `${item.kind}\0${item.sessionId}\0${item.version}\0${item.messageId}\0${item.messageFingerprint}`
          : `${item.kind}\0${item.reference}\0${item.commit ?? ''}\0${item.command ?? ''}\0${item.quote}`;
        const knownEvidence = new Set(duplicateAIFact.evidence.map(evidenceKey));
        const additions = evidence.filter(item => !knownEvidence.has(evidenceKey(item)));
        if (duplicateAIFact.evidence.length + additions.length > 20) throw new Error('A memory fact can hold at most 20 evidence entries.');
        duplicateAIFact.evidence.push(...additions);
        duplicateAIFact.updatedAt = now;
        duplicateAIFact.revision = (duplicateAIFact.revision ?? 1) + 1;
        memory.put(duplicateAIFact);
        touchProject(project, now);
        projects.put(project);
        return duplicateAIFact;
      }
    }
    const conflicts = matching.filter(previous => previous.id !== input.supersedes
      && !isTerminalMemoryStatus(previous.status)
      && (previous.statement.trim().normalize('NFKC').toLocaleLowerCase() !== fact.statement.normalize('NFKC').toLocaleLowerCase()
        || fact.category === 'task' && previous.taskState !== fact.taskState));
    if (conflicts.length) {
      if (fact.origin === 'user') {
        if (fact.status === 'confirmed') fact.reviewStateBeforeConflict = 'confirmed';
        if (fact.status !== 'needs-review') appendStatusChange(fact, 'needs-review', now);
        fact.status = 'needs-review';
      }
      fact.conflictsWith = conflicts.map(previous => previous.id);
      for (const previous of conflicts) {
        if (previous.status !== 'needs-review') previous.reviewStateBeforeConflict = previous.status === 'proposed' ? 'proposed' : 'confirmed';
        if (previous.status !== 'needs-review') appendStatusChange(previous, 'needs-review', now);
        previous.status = 'needs-review';
        previous.conflictsWith = [...new Set([...previous.conflictsWith, fact.id])];
        previous.updatedAt = now;
        previous.revision = (previous.revision ?? 0) + 1;
        memory.put(previous);
      }
    }
    memory.add(fact);
    touchProject(project, now);
    projects.put(project);
    return fact;
  });
}

async function factConfirmationMaterial(fact: ProjectMemoryFact): Promise<{ subjectFingerprint: string; evidenceFingerprints: string[] }> {
  const evidenceFingerprints = await Promise.all(fact.evidence.map(async evidence => sha256Fingerprint(JSON.stringify([
    'threadpack-confirmation-evidence-v1', evidence.id, evidence.kind, evidence.reference, evidence.quote,
    fact.confirmationProjectId ?? fact.projectId,
    evidence.sourceProjectId ?? evidence.projectId ?? fact.confirmationProjectId ?? fact.projectId,
    evidence.sessionId ?? null, evidence.version ?? null, evidence.messageId ?? null,
    evidence.messageFingerprint ?? null, evidence.revisionFingerprint ?? null, evidence.quoteFingerprint ?? null,
    evidence.quoteByteRange ?? null, evidence.bindingStatus ?? 'unverified', evidence.relation ?? 'unverified',
    evidence.relationBasis ?? 'none', evidence.commit ?? null, evidence.command ?? null,
  ]))));
  evidenceFingerprints.sort();
  const subjectFingerprint = await sha256Fingerprint(JSON.stringify([
    'threadpack-confirmed-claim-v1', fact.confirmationProjectId ?? fact.projectId, fact.id, fact.revision ?? 1, fact.category, fact.normalizedTopic,
    fact.topic, fact.statement, fact.taskState ?? null, fact.origin, fact.status, evidenceFingerprints,
  ]));
  return { subjectFingerprint, evidenceFingerprints };
}

async function factLifecycleMaterial(fact: ProjectMemoryFact): Promise<{ subjectFingerprint: string; evidenceFingerprints: string[] }> {
  const lifecycleProjectId = fact.lifecycleProjectId ?? fact.confirmationProjectId ?? fact.projectId;
  const confirmedMaterial = await factConfirmationMaterial({ ...fact, confirmationProjectId: lifecycleProjectId });
  const subjectFingerprint = await sha256Fingerprint(JSON.stringify([
    'threadpack-fact-lifecycle-v1', lifecycleProjectId, confirmedMaterial.subjectFingerprint, fact.status,
    fact.expiresAt ?? null, fact.expiredAt ?? null, fact.supersedes ?? null, fact.reconsiders ?? null,
  ]));
  return { subjectFingerprint, evidenceFingerprints: confirmedMaterial.evidenceFingerprints };
}

async function ensureProjectTrustReady(projectId: string): Promise<void> {
  const trust = await getProjectTrustSummary(projectId);
  if (!trust.state) throw new Error('Set up a local trust identity and recovery kit before confirming project facts.');
  if (!trust.trusted) throw new Error('This project identity is not trusted on this device. Restore trust with its recovery kit.');
  if (!trust.state.recoveryAcknowledgedAt) throw new Error('Download and acknowledge the encrypted recovery kit before adding trusted project history.');
}

async function recordFactConfirmation(projectId: string, fact: ProjectMemoryFact): Promise<ProjectMemoryFact> {
  if (fact.status !== 'confirmed') return fact;
  await ensureProjectTrustReady(projectId);
  const confirmationVersion = (fact.confirmationVersion ?? 0) + 1;
  const trust = await getProjectTrustSummary(projectId);
  if (!trust.state) throw new Error('Set up a local trust identity before confirming project facts.');
  const candidate = { ...fact, confirmationProjectId: trust.state.sourceProjectId ?? fact.projectId, confirmationVersion };
  const material = await factConfirmationMaterial(candidate);
  await appendProjectTrustEvent(projectId, {
    eventType: 'claim.confirmed', subjectId: fact.id, subjectFingerprint: material.subjectFingerprint,
    subjectVersion: candidate.revision ?? 1, evidenceFingerprints: material.evidenceFingerprints, changedAt: Date.now(),
    details: {
      confirmationVersion, expiresAt: candidate.expiresAt ?? null, toStatus: 'confirmed',
      lifecycleRevision: candidate.revision ?? 1, lifecycleProjectId: candidate.confirmationProjectId,
    },
  }, { factMutation: {
    factId: fact.id, expectedUpdatedAt: fact.updatedAt, expectedRevision: fact.revision ?? 1,
    apply(current, event, changedAt) {
      current.confirmationVersion = confirmationVersion;
      current.confirmationProjectId = candidate.confirmationProjectId;
      current.confirmationEventId = event.id;
      delete current.confirmationRevocationEventId;
      current.confirmationTrust = 'authenticated';
      current.updatedAt = changedAt;
    },
  } });
  const confirmed = (await listProjectMemory(projectId)).find(item => item.id === fact.id);
  if (!confirmed) throw new Error('The signed confirmation completed but its project fact is unavailable.');
  return confirmed;
}

async function recordFactLifecycleEvent(
  projectId: string, fact: ProjectMemoryFact,
  eventType: 'claim.rejected' | 'claim.revoked' | 'claim.expired' | 'claim.superseded',
  reason: 'user-rejected' | 'user-revoked' | 'expires-at-reached' | 'replaced-by-new-fact',
): Promise<ProjectMemoryFact> {
  const trust = await getProjectTrustSummary(projectId);
  if (!trust.readyForConfirmations) return fact;
  const lifecycleProjectId = trust.state?.sourceProjectId ?? projectId;
  const signedFact = { ...fact, lifecycleProjectId };
  const material = await factLifecycleMaterial(signedFact);
  const previousStatus = fact.statusHistory?.at(-2)?.status ?? fact.status;
  await appendProjectTrustEvent(projectId, {
    eventType, subjectId: fact.id, subjectFingerprint: material.subjectFingerprint,
    subjectVersion: fact.revision ?? 1, evidenceFingerprints: material.evidenceFingerprints,
    changedAt: Date.now(), details: {
      fromStatus: previousStatus, toStatus: fact.status, reason,
      lifecycleRevision: fact.revision ?? 1, lifecycleProjectId,
      ...(fact.expiresAt !== undefined ? { expiresAt: fact.expiresAt } : {}),
    },
  }, { factMutation: {
    factId: fact.id, expectedUpdatedAt: fact.updatedAt, expectedRevision: fact.revision ?? 1,
    apply(current, event, changedAt) {
      const statusChange = current.statusHistory?.at(-1);
      if (!statusChange || statusChange.status !== current.status || statusChange.status !== fact.status) {
        throw new Error('The project fact lifecycle changed before its signed event could be committed.');
      }
      statusChange.trustEventId = event.id;
      statusChange.trustEventHash = event.eventHash;
      statusChange.trustKeyId = event.actorKeyId;
      current.lifecycleProjectId = lifecycleProjectId;
      current.updatedAt = changedAt;
    },
  } });
  return (await listProjectMemory(projectId)).find(item => item.id === fact.id) ?? fact;
}

async function recordFactConfirmationRevocation(
  projectId: string, before: ProjectMemoryFact, current: ProjectMemoryFact,
  reason: 'needs-review' | 'rejected' | 'revoked' | 'expired' | 'superseded' | 'superseded-by-new-confirmation',
): Promise<ProjectMemoryFact> {
  if (!before.confirmationEventId || before.status !== 'confirmed') return current;
  await ensureProjectTrustReady(projectId);
  const material = await factConfirmationMaterial(before);
  const trust = await getProjectTrustSummary(projectId);
  const lifecycleProjectId = trust.state?.sourceProjectId ?? projectId;
  await appendProjectTrustEvent(projectId, {
    eventType: 'claim.confirmation-revoked', subjectId: before.id, subjectFingerprint: material.subjectFingerprint,
    subjectVersion: before.revision ?? 1, evidenceFingerprints: material.evidenceFingerprints,
    changedAt: Date.now(), details: {
      confirmationEventId: before.confirmationEventId, reason, fromStatus: before.status,
      toStatus: current.status, lifecycleRevision: current.revision ?? 1, lifecycleProjectId,
    },
  }, { factMutation: {
    factId: before.id, expectedUpdatedAt: current.updatedAt, expectedRevision: current.revision ?? 1,
    apply(fact, event, changedAt) {
      fact.confirmationRevocationEventId = event.id;
      fact.confirmationTrust = 'revoked';
      const statusChange = fact.statusHistory?.at(-1);
      if (statusChange && statusChange.status === fact.status) {
        statusChange.trustEventId = event.id;
        statusChange.trustEventHash = event.eventHash;
        statusChange.trustKeyId = event.actorKeyId;
      }
      fact.lifecycleProjectId = lifecycleProjectId;
      fact.updatedAt = changedAt;
    },
  } });
  const revoked = (await listProjectMemory(projectId)).find(item => item.id === before.id);
  if (!revoked) throw new Error('The signed confirmation revocation completed but its project fact is unavailable.');
  return revoked;
}

export async function createProjectMemoryFact(projectId: string, input: ProjectMemoryInput): Promise<ProjectMemoryFact> {
  if (input.status === 'confirmed') await ensureProjectTrustReady(projectId);
  const beforeFacts = await listProjectMemory(projectId);
  const fact = await createProjectMemoryFactInternal(projectId, input);
  const afterFacts = await listProjectMemory(projectId);
  const currentFacts = new Map(afterFacts.map(item => [item.id, item]));
  const hasPriorAuthenticatedFact = beforeFacts.some(previous =>
    previous.status === 'confirmed' && previous.confirmationTrust === 'authenticated' && !!previous.confirmationEventId);
  const canSignLifecycle = !hasPriorAuthenticatedFact || (await getProjectTrustSummary(projectId)).readyForConfirmations;
  for (const previous of beforeFacts) {
    const current = currentFacts.get(previous.id);
    if (!current) continue;
    const changed = current.revision !== previous.revision;
    if (current.status === 'superseded' && changed) {
      if (previous.status === 'confirmed' && previous.confirmationTrust === 'authenticated' && previous.confirmationEventId) {
        if (canSignLifecycle) await recordFactConfirmationRevocation(projectId, previous, current, 'superseded');
      } else {
        await recordFactLifecycleEvent(projectId, current, 'claim.superseded', 'replaced-by-new-fact');
      }
    } else if (previous.status === 'confirmed' && previous.confirmationTrust === 'authenticated'
      && previous.confirmationEventId && (current.status !== 'confirmed' || changed)) {
      if (!canSignLifecycle) continue;
      const reason = current.status === 'confirmed' ? 'superseded-by-new-confirmation'
        : current.status === 'superseded' ? 'superseded' : current.status === 'rejected' ? 'rejected' : 'needs-review';
      await recordFactConfirmationRevocation(projectId, previous, current, reason);
    }
  }
  if (input.status === 'confirmed' && fact.status === 'confirmed') return recordFactConfirmation(projectId, fact);
  return (await listProjectMemory(projectId)).find(item => item.id === fact.id) ?? fact;
}

async function updateProjectMemoryStatusInternal(
  projectId: string, factId: string, status: 'confirmed' | 'needs-review' | 'rejected' | 'revoked',
): Promise<ProjectMemoryFact> {
  if (!MEMORY_STATUSES.includes(status)) throw new Error('Choose a valid memory review state.');
  return withTransaction(['projects', 'memory', 'updates'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${factId}`));
    if (!project || project.restoringSince || !fact) throw new Error('This project memory entry is unavailable.');
    if (isTerminalMemoryStatus(fact.status)) throw new Error('Rejected, superseded, expired, or revoked entries are read-only.');
    if (!canReviewMemoryStatusTransition(fact.status, status)) throw new Error(`The fact cannot transition from ${fact.status} to ${status}.`);
    if (status === 'confirmed' && fact.conflictsWith.length) throw new Error('Resolve the listed conflicts before confirming this fact.');
    const now = Date.now();
    if (status === 'rejected' || status === 'revoked') {
      for (const conflictId of fact.conflictsWith) {
        const conflict = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${conflictId}`));
        if (conflict) {
          conflict.conflictsWith = conflict.conflictsWith.filter(id => id !== fact.id);
          if (!conflict.conflictsWith.length && conflict.status === 'needs-review' && conflict.reviewStateBeforeConflict) {
            const restoredStatus = conflict.reviewStateBeforeConflict === 'proposed' ? 'proposed' : 'needs-review';
            conflict.status = restoredStatus;
            appendStatusChange(conflict, restoredStatus, now);
            delete conflict.reviewStateBeforeConflict;
          }
          conflict.updatedAt = now;
          conflict.revision = (conflict.revision ?? 1) + 1;
          memory.put(conflict);
        }
      }
      fact.conflictsWith = [];
      delete fact.reviewStateBeforeConflict;
    }
    fact.status = status;
    appendStatusChange(fact, status, now);
    fact.updatedAt = now;
    fact.revision = (fact.revision ?? 0) + 1;
    if (status === 'rejected' || status === 'revoked') await revokeAcceptedProposals(transaction, projectId, fact.id, now);
    memory.put(fact);
    touchProject(project, fact.updatedAt);
    projects.put(project);
    return fact;
  });
}

export async function updateProjectMemoryStatus(
  projectId: string, factId: string, status: 'confirmed' | 'needs-review' | 'rejected' | 'revoked',
): Promise<ProjectMemoryFact> {
  await expireProjectMemoryFacts(projectId);
  const before = await withTransaction(['memory'], 'readonly', async transaction =>
    idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(projectId + String.fromCharCode(0) + factId)));
  if (!before) throw new Error('This project memory entry is unavailable.');
  if (status === 'confirmed') await ensureProjectTrustReady(projectId);
  const trust = status === 'confirmed' ? undefined : await getProjectTrustSummary(projectId);
  const priorConfirmationTrust = trust ? await factConfirmationTrust(before, trust) : undefined;
  const shouldRevokeSignedConfirmation = status !== 'confirmed' && before.confirmationEventId
    && before.status === 'confirmed' && priorConfirmationTrust === 'authenticated';
  const canSignRevocation = shouldRevokeSignedConfirmation && !!trust?.readyForConfirmations;
  const updated = await updateProjectMemoryStatusInternal(projectId, factId, status);
  if (status === 'confirmed' && updated.status === 'confirmed') return recordFactConfirmation(projectId, updated);
  if (shouldRevokeSignedConfirmation && canSignRevocation) return recordFactConfirmationRevocation(projectId, before, updated, status);
  if (status === 'rejected') return recordFactLifecycleEvent(projectId, updated, 'claim.rejected', 'user-rejected');
  if (status === 'revoked') return recordFactLifecycleEvent(projectId, updated, 'claim.revoked', 'user-revoked');
  return (await listProjectMemory(projectId)).find(item => item.id === factId) ?? updated;
}


async function* backupLines(projectId: string): AsyncGenerator<string> {
  const project = await withTransaction(['projects'], 'readonly', async transaction =>
    idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
  if (!project || project.restoringSince) throw new Error('This project is unavailable.');
  const sessions = await withTransaction(['sessions'], 'readonly', async transaction =>
    idbRequest<ProjectSessionRecord[]>(transaction.objectStore('sessions').index('projectId').getAll(IDBKeyRange.only(projectId))));
  const facts = await listProjectMemory(projectId);
  const updates = await listProjectUpdateProposals(projectId);
  const claims = await withTransaction(['claims'], 'readonly', async transaction =>
    idbRequest<ProjectTaskClaimEvent[]>(transaction.objectStore('claims').index('projectId').getAll(IDBKeyRange.only(projectId))));
  claims.sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id));
  const trust = await getProjectTrustSummary(projectId);
  if (trust.issue) throw new Error('Project trust history failed integrity validation. Resolve the trust diagnostic before exporting a backup.');
  const trustState = trust.state ? { ...trust.state, trustStatus: 'untrusted-import' as const, recoveryAcknowledgedAt: undefined } : undefined;
  const trustEvents = trust.events;
  const migrations = project.migrationHistory ?? [];
  migrations.sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id));
  let revisionCount = 0;
  for (const session of sessions) revisionCount += session.currentVersion;
  let recordChain = PROJECT_BACKUP_CHAIN_SEED;
  const recordCounts = emptyBackupRecordCounts();
  let recordCount = 0;
  const emitRecord = async (record: Record<string, unknown>): Promise<string> => {
    recordChain = await extendProjectBackupRecordChain(recordChain, await digestProjectBackupRecord(record));
    recordCount++;
    if (record.type !== 'threadpack_project') incrementBackupRecordCount(recordCounts, record.type as string);
    return `${JSON.stringify(record)}\n`;
  };
  yield await emitRecord({ type: 'threadpack_project', version: PROJECT_BACKUP_VERSION, projectId, createdAt: Date.now(), project: {
    name: project.name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt, updatedAt: project.updatedAt,
  }, sessionCount: sessions.length, revisionCount, factCount: facts.length, updateCount: updates.length, claimCount: claims.length,
    trustStateCount: trustState ? 1 : 0, trustEventCount: trustEvents.length, migrationCount: migrations.length });
  for (const session of sessions) {
    yield await emitRecord({ type: 'session', data: {
      id: session.id, sessionKey: session.sessionKey, title: session.title, sourceName: session.sourceName,
      platform: session.platform, ...(session.sourceId ? { sourceId: session.sourceId } : {}), format: session.format,
      messageCount: session.messageCount, fingerprint: session.fingerprint, currentVersion: session.currentVersion,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
    } });
    for (let version = 1; version <= session.currentVersion; version++) {
      const revision = await withTransaction(['revisions'], 'readonly', async transaction =>
        idbRequest<RevisionRecord | undefined>(transaction.objectStore('revisions').get([projectId, session.id, version])));
      if (!revision) throw new Error('Project history is incomplete. The backup was canceled.');
      yield await emitRecord({ type: 'revision', data: {
        sessionId: session.id, version: revision.version, fingerprint: revision.fingerprint,
        content: revision.content, title: revision.title, platform: revision.platform,
        ...(revision.sourceId ? { sourceId: revision.sourceId } : {}), format: revision.format,
        messageCount: revision.messageCount, sourceName: revision.sourceName, createdAt: revision.createdAt,
      } });
    }
  }
  for (const fact of facts) {
    const { key: _key, projectId: _projectId, confirmationTrust: _confirmationTrust, lifecycleTrust: _lifecycleTrust, ...data } = fact;
    yield await emitRecord({ type: 'memory', fingerprint: await memoryBackupFingerprint(data), data });
  }
  for (const update of updates) {
    const { key: _key, reviewingSince: _reviewingSince, ...record } = update;
    const exportRecord = { ...record, projectId };
    let data = exportRecord;
    if (exportRecord.status === 'reviewing') {
      const acceptedFact = facts.find(fact => matchesAcceptedProposalFact(fact, exportRecord));
      const status = !acceptedFact ? 'pending' : isTerminalMemoryStatus(acceptedFact.status) ? 'revoked' : 'accepted';
      const changedAt = Math.max(Date.now(), exportRecord.statusHistory.at(-1)?.changedAt ?? 0);
      const action = status === 'pending' ? 'review-reopened' : status;
      data = { ...exportRecord, status, ...(acceptedFact ? { acceptedFactId: acceptedFact.id } : {}),
        statusHistory: [...exportRecord.statusHistory, { status, changedAt }],
        auditHistory: [...exportRecord.auditHistory, { action, actor: 'user', status, changedAt, snapshot: proposalSnapshot(exportRecord) }],
      };
    }
    yield await emitRecord({ type: 'update', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data });
  }
  for (const claim of claims) {
    const { key: _key, ...record } = claim;
    const data = { ...record, projectId };
    yield await emitRecord({ type: 'claim', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data });
  }
  if (trustState) {
    yield await emitRecord({ type: 'trust_state', fingerprint: await sha256Fingerprint(JSON.stringify(trustState)), data: trustState });
  }
  for (const event of trustEvents) {
    const data = { projectId, sequence: event.sequence, event };
    yield await emitRecord({ type: 'trust_event', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data });
  }
  for (const migration of migrations) {
    const { key: _key, ...data } = migration;
    yield await emitRecord({ type: 'migration', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data });
  }
  yield `${JSON.stringify({ type: 'manifest', version: PROJECT_BACKUP_MANIFEST_VERSION, recordCount,
    recordChainHash: recordChain, recordCounts })}\n`;
}

export async function exportProjectBackup(projectId: string): Promise<Blob> {
  const iterator = backupLines(projectId);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(undefined); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson;charset=utf-8' } }).blob();
}

async function sharedProjectStatus(projectId: string): Promise<{ project: ProjectRecord | undefined; shared: SharedProjectBackupRecord | undefined }> {
  return withTransaction(['projects', 'shared'], 'readonly', async transaction => {
    const [project, shared] = await Promise.all([
      idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)),
      idbRequest<SharedProjectBackupRecord | undefined>(transaction.objectStore('shared').get(projectId)),
    ]);
    return { project, shared };
  });
}

function validUpdateProposal(value: unknown, projectId: string): ProjectUpdateProposal | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || value.projectId !== projectId || typeof value.client !== 'string' || !value.client.trim() || value.client.length > 200
    || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200
    || !MEMORY_CATEGORIES.includes(value.category as MemoryCategory) || typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 160
    || value.taskState !== undefined && !TASK_STATES.includes(value.taskState as TaskState)
    || value.category !== 'task' && value.taskState !== undefined
    || value.category === 'task' && ['in-progress', 'done', 'blocked'].includes(value.taskState as string) && (!value.taskId || !value.claimId)
    || typeof value.statement !== 'string' || !value.statement.trim() || value.statement.length > 4000
    || typeof value.evidenceReference !== 'string' || value.evidenceReference.length > 1000
    || typeof value.evidenceQuote !== 'string' || value.evidenceQuote.length > 1000
    || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 200
    || !Number.isSafeInteger(value.sessionVersion) || (value.sessionVersion as number) < 1
    || typeof value.messageId !== 'string' || !value.messageId || value.messageId.length > 500
    || value.sourceProjectId !== undefined && (typeof value.sourceProjectId !== 'string' || !value.sourceProjectId || value.sourceProjectId.length > 200)
    || value.messageFingerprint !== undefined && (typeof value.messageFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.messageFingerprint))
    || value.messageFingerprintVersion !== undefined && value.messageFingerprintVersion !== 2
    || value.revisionFingerprint !== undefined && (typeof value.revisionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.revisionFingerprint))
    || value.quoteFingerprint !== undefined && (typeof value.quoteFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.quoteFingerprint))
    || value.quoteByteRange !== undefined && (!isRecord(value.quoteByteRange) || !Number.isSafeInteger(value.quoteByteRange.start)
      || !Number.isSafeInteger(value.quoteByteRange.end) || (value.quoteByteRange.start as number) < 0
      || (value.quoteByteRange.end as number) <= (value.quoteByteRange.start as number))
    || value.taskId !== undefined && (typeof value.taskId !== 'string' || !value.taskId || value.taskId.length > 200 || typeof value.claimId !== 'string' || !value.claimId || value.category !== 'task')
    || value.claimId !== undefined && (typeof value.claimId !== 'string' || !value.claimId || value.claimId.length > 200 || typeof value.taskId !== 'string')
    || !Number.isSafeInteger(value.createdAt)) return null;
  const proposal: ProjectUpdateProposal = {
    key: `${projectId}\0${value.id}`, id: value.id, projectId, client: value.client.trim(),
    idempotencyKey: value.idempotencyKey,
    sessionId: value.sessionId, sessionVersion: value.sessionVersion as number, messageId: value.messageId,
    ...(typeof value.sourceProjectId === 'string' ? { sourceProjectId: value.sourceProjectId } : {}),
    ...(typeof value.messageFingerprint === 'string' ? { messageFingerprint: value.messageFingerprint } : {}),
    ...(value.messageFingerprintVersion === 2 ? { messageFingerprintVersion: 2 as const } : {}),
    ...(typeof value.revisionFingerprint === 'string' ? { revisionFingerprint: value.revisionFingerprint } : {}),
    ...(typeof value.quoteFingerprint === 'string' ? { quoteFingerprint: value.quoteFingerprint } : {}),
    ...(isRecord(value.quoteByteRange) ? { quoteByteRange: { start: value.quoteByteRange.start as number, end: value.quoteByteRange.end as number } } : {}),
    ...(isRecord(value.sourceIdentity) ? { sourceIdentity: {
      ...(typeof value.sourceIdentity.platform === 'string' ? { platform: value.sourceIdentity.platform } : {}),
      ...(typeof value.sourceIdentity.sourceName === 'string' ? { sourceName: value.sourceIdentity.sourceName } : {}),
      ...(typeof value.sourceIdentity.sourceId === 'string' ? { sourceId: value.sourceIdentity.sourceId } : {}),
    } } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.claimId === 'string' ? { claimId: value.claimId } : {}),
    category: value.category as MemoryCategory, topic: value.topic.trim(), statement: value.statement.trim(),
    ...(typeof value.taskState === 'string' ? { taskState: value.taskState as TaskState } : {}),
    evidenceReference: value.evidenceReference, evidenceQuote: value.evidenceQuote,
    status: 'pending', statusHistory: [{ status: 'pending', changedAt: value.createdAt as number }], auditHistory: [], createdAt: value.createdAt as number,
  };
  appendProposalAudit(proposal, 'submitted', 'mcp-client', value.createdAt as number);
  return proposal;
}

function validateTaskClaimEvent(value: unknown, projectId: string): ProjectTaskClaimEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || value.projectId !== projectId || typeof value.claimId !== 'string' || !value.claimId || value.claimId.length > 200
    || typeof value.taskId !== 'string' || !value.taskId || value.taskId.length > 200
    || typeof value.client !== 'string' || !value.client.trim() || value.client.length > 200
    || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200
    || !['claimed', 'renewed', 'released'].includes(value.action as string)
    || !Number.isSafeInteger(value.createdAt)
    || value.action === 'released' && value.expiresAt !== undefined
    || value.action !== 'released' && (!Number.isSafeInteger(value.leaseSeconds) || (value.leaseSeconds as number) < 60 || (value.leaseSeconds as number) > 900
      || !Number.isSafeInteger(value.expiresAt)
      || (value.expiresAt as number) <= (value.createdAt as number)
      || value.expiresAt !== (value.createdAt as number) + (value.leaseSeconds as number) * 1000)) {
    throw new Error('The shared inbox contains an invalid task coordination event.');
  }
  return {
    key: `${projectId}\0${value.id}`, id: value.id, projectId, claimId: value.claimId, taskId: value.taskId,
    client: value.client.trim(), idempotencyKey: value.idempotencyKey,
    action: value.action as ProjectTaskClaimAction, createdAt: value.createdAt as number,
    ...(typeof value.leaseSeconds === 'number' ? { leaseSeconds: value.leaseSeconds } : {}),
    ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}),
  };
}

function latestTaskClaimEvents(events: ProjectTaskClaimEvent[]): Map<string, ProjectTaskClaimEvent> {
  const latest = new Map<string, ProjectTaskClaimEvent>();
  for (const event of [...events].sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id))) {
    latest.set(event.claimId, event);
  }
  return latest;
}

function taskClaimHeldAt(events: ProjectTaskClaimEvent[], claimId: string, taskId: string, client: string, timestamp: number): boolean {
  const event = [...events]
    .filter(candidate => candidate.claimId === claimId && candidate.createdAt <= timestamp)
    .sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id)).at(-1);
  return !!event && event.taskId === taskId && event.client === client && event.action !== 'released'
    && (event.expiresAt ?? 0) > timestamp;
}

function validateTaskClaimTransition(event: ProjectTaskClaimEvent, events: ProjectTaskClaimEvent[], now: number): void {
  const latest = latestTaskClaimEvents(events);
  if (event.action === 'claimed') {
    const activeForTask = [...latest.values()].find(previous => previous.taskId === event.taskId
      && previous.action !== 'released' && (previous.expiresAt ?? 0) > now);
    if (activeForTask) throw new Error('This task is already claimed by another client.');
    return;
  }
  const current = latest.get(event.claimId);
  if (!current || current.taskId !== event.taskId || current.client !== event.client || current.action === 'released') {
    throw new Error('This task claim is unavailable to the requesting client.');
  }
  if (event.action === 'renewed' && (current.expiresAt ?? 0) <= now) {
    throw new Error('This task claim has expired. Claim the task again before renewing it.');
  }
}

export async function listProjectTaskClaims(projectId: string): Promise<ProjectTaskClaim[]> {
  await expireProjectMemoryFacts(projectId);
  const [events, facts] = await withTransaction(['claims', 'memory'], 'readonly', async transaction => Promise.all([
    idbRequest<ProjectTaskClaimEvent[]>(transaction.objectStore('claims').index('projectId').getAll(IDBKeyRange.only(projectId))),
    idbRequest<ProjectMemoryFact[]>(transaction.objectStore('memory').index('projectId').getAll(IDBKeyRange.only(projectId))),
  ]));
  const tasks = new Map(facts.filter(fact => fact.category === 'task').map(fact => [fact.id, fact]));
  const now = Date.now();
  const latest = latestTaskClaimEvents(events);
  return events
    .sort((first, second) => second.createdAt - first.createdAt || second.id.localeCompare(first.id))
    .slice(0, 100)
    .map(event => ({
      projectId, claimId: event.claimId, taskId: event.taskId, client: event.client, action: event.action,
      active: latest.get(event.claimId)?.id === event.id && event.action !== 'released' && (event.expiresAt ?? 0) > now
        && tasks.get(event.taskId)?.status === 'confirmed' && !tasks.get(event.taskId)?.conflictsWith.length
        && tasks.get(event.taskId)?.taskState !== 'done' && tasks.get(event.taskId)?.taskState !== 'blocked',
      claimedAt: event.createdAt, ...(typeof event.leaseSeconds === 'number' ? { leaseSeconds: event.leaseSeconds } : {}),
      ...(typeof event.expiresAt === 'number' ? { expiresAt: event.expiresAt } : {}),
      ...(event.action === 'released' ? { releasedAt: event.createdAt } : {}),
      ...(tasks.get(event.taskId) ? { taskTopic: tasks.get(event.taskId)!.topic, taskStatement: tasks.get(event.taskId)!.statement } : {}),
    }));
}

function matchesAcceptedProposalFact(fact: ProjectMemoryFact,
  proposal: Pick<ProjectUpdateProposal, 'id' | 'sessionId' | 'sessionVersion' | 'messageId' | 'evidenceQuote'>): boolean {
  return fact.evidence.some(evidence => evidence.proposalId === proposal.id
    && evidence.kind === 'conversation' && evidence.sessionId === proposal.sessionId
    && evidence.version === proposal.sessionVersion && evidence.messageId === proposal.messageId
    && evidence.quote === proposal.evidenceQuote);
}

function recoverInterruptedProposal(proposal: ProjectUpdateProposal, facts: ProjectMemoryFact[], changedAt: number): void {
  const acceptedFact = facts.find(fact => matchesAcceptedProposalFact(fact, proposal));
  proposal.status = !acceptedFact ? 'pending'
    : isTerminalMemoryStatus(acceptedFact.status) ? 'revoked' : 'accepted';
  if (acceptedFact) proposal.acceptedFactId = acceptedFact.id;
  delete proposal.reviewingSince;
  proposal.reviewedAt = acceptedFact ? changedAt : undefined;
  proposal.statusHistory.push({ status: proposal.status, changedAt });
  appendProposalAudit(proposal, acceptedFact ? proposal.status === 'revoked' ? 'revoked' : 'accepted' : 'review-reopened', 'user', changedAt);
}

function sameUpdateSubmission(existing: ProjectUpdateProposal, candidate: ProjectUpdateProposal): boolean {
  const submitted = existing.auditHistory[0]?.snapshot;
  return existing.id === candidate.id && existing.projectId === candidate.projectId
    && existing.client === candidate.client && existing.idempotencyKey === candidate.idempotencyKey
    && existing.sourceProjectId === candidate.sourceProjectId && existing.messageFingerprint === candidate.messageFingerprint
    && existing.messageFingerprintVersion === candidate.messageFingerprintVersion
    && existing.revisionFingerprint === candidate.revisionFingerprint && existing.quoteFingerprint === candidate.quoteFingerprint
    && JSON.stringify(existing.quoteByteRange) === JSON.stringify(candidate.quoteByteRange)
    && JSON.stringify(existing.sourceIdentity) === JSON.stringify(candidate.sourceIdentity)
    && !!submitted && submitted.category === candidate.category && submitted.topic === candidate.topic
    && submitted.statement === candidate.statement && submitted.taskState === candidate.taskState
    && submitted.evidenceReference === candidate.evidenceReference && submitted.evidenceQuote === candidate.evidenceQuote
    && submitted.sessionId === candidate.sessionId && submitted.sessionVersion === candidate.sessionVersion
    && submitted.messageId === candidate.messageId && submitted.taskId === candidate.taskId && submitted.claimId === candidate.claimId;
}

async function readSharedInbox(handle: SharedProjectFileHandle, offset = 0): Promise<{ text: string; nextOffset: number }> {
  if (await handle.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('The update inbox permission is required.');
  const file = await handle.getFile();
  if (file.size > MAX_SHARED_PROJECT_BACKUP_BYTES) throw new Error('The update inbox exceeds the 256 MiB limit.');
  const start = file.size < offset ? 0 : offset;
  const appended = await file.slice(start).text();
  const completeLength = appended.lastIndexOf('\n') + 1;
  const completeText = appended.slice(0, completeLength);
  return { text: completeText, nextOffset: start + utf8ByteLength(completeText) };
}

export async function recoverStaleProjectUpdateReviews(projectId: string, changedAt = Date.now()): Promise<boolean> {
  const candidates = await withTransaction(['updates'], 'readonly', async transaction =>
    idbRequest<ProjectUpdateProposal[]>(transaction.objectStore('updates').index('projectId').getAll(IDBKeyRange.only(projectId))));
  if (!candidates.some(proposal => proposal.status === 'reviewing'
    && (proposal.reviewingSince ?? 0) < changedAt - UPDATE_REVIEW_STALE_AFTER)) return false;
  return withTransaction(['updates', 'projects', 'memory'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const existing = await idbRequest<ProjectUpdateProposal[]>(updates.index('projectId').getAll(IDBKeyRange.only(projectId)));
    const stale = existing.filter(proposal => proposal.status === 'reviewing'
      && (proposal.reviewingSince ?? 0) < changedAt - UPDATE_REVIEW_STALE_AFTER);
    if (!stale.length) return false;
    const facts = await idbRequest<ProjectMemoryFact[]>(memory.index('projectId').getAll(IDBKeyRange.only(projectId)));
    for (const proposal of stale) {
      recoverInterruptedProposal(proposal, facts, changedAt);
      updates.put(proposal);
    }
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    if (project && !project.restoringSince) { touchProject(project, changedAt); projects.put(project); }
    return true;
  });
}

export async function listProjectUpdateProposals(projectId: string): Promise<ProjectUpdateProposal[]> {
  return withTransaction(['updates'], 'readonly', async transaction =>
    (await idbRequest<ProjectUpdateProposal[]>(transaction.objectStore('updates').index('projectId').getAll(IDBKeyRange.only(projectId))))
      .sort((first, second) => second.createdAt - first.createdAt));
}

export async function importSharedProjectUpdates(projectId: string): Promise<ProjectUpdateImportResult> {
  await expireProjectMemoryFacts(projectId);
  const { project, shared } = await sharedProjectStatus(projectId);
  if (!project || !shared?.inboxHandle) return { imported: 0, pending: 0, changed: false };
  const inbox = await readSharedInbox(shared.inboxHandle, shared.inboxReadOffset ?? 0);
  const candidates: ProjectUpdateProposal[] = [];
  const taskClaimCandidates: ProjectTaskClaimEvent[] = [];
  for (const line of inbox.text.split(/\r?\n/).filter(Boolean)) {
    if (utf8ByteLength(line) > 64 * 1024) throw new Error('The update inbox contains an oversized record.');
    let value: unknown;
    try { value = JSON.parse(line) as unknown; }
    catch { throw new Error('The update inbox contains invalid JSON.'); }
    if (!isRecord(value) || value.version !== 1) {
      throw new Error('The update inbox contains an unsupported record.');
    }
    if (value.type === 'threadpack_update') {
      const proposal = validUpdateProposal(value.proposal, projectId);
      if (!proposal || typeof value.fingerprint !== 'string'
        || await sha256Fingerprint(JSON.stringify(value.proposal)) !== value.fingerprint) {
        throw new Error('The update inbox candidate failed validation.');
      }
      const expectedId = `mcp-${(await sha256Fingerprint(JSON.stringify([projectId, proposal.client, proposal.idempotencyKey]))).slice(0, 40)}`;
      if (proposal.id !== expectedId) throw new Error('The update inbox candidate identity is invalid.');
      const revision = await readEvidenceRevision(projectId, proposal.sessionId!, proposal.sessionVersion!);
      if (!revision) throw new Error('The update inbox candidate revision is unavailable.');
      const sourceProjectId = proposal.sourceProjectId ?? projectId;
      const binding = proposal.messageFingerprint
        ? await assessEvidenceBinding({ id: proposal.id, kind: 'conversation', reference: proposal.evidenceReference,
          quote: proposal.evidenceQuote, projectId, sourceProjectId, sessionId: proposal.sessionId,
          version: proposal.sessionVersion, messageId: proposal.messageId, messageFingerprint: proposal.messageFingerprint,
          messageFingerprintVersion: proposal.messageFingerprintVersion, revisionFingerprint: proposal.revisionFingerprint,
          quoteFingerprint: proposal.quoteFingerprint, quoteByteRange: proposal.quoteByteRange,
          sourceIdentity: proposal.sourceIdentity,
          recordedAt: proposal.createdAt, verification: 'source-matched' },
        { projectId, sourceProjectId }, revision)
        : await bindNewConversationEvidence({ id: proposal.id, kind: 'conversation', reference: proposal.evidenceReference,
          quote: proposal.evidenceQuote, projectId, sourceProjectId, sessionId: proposal.sessionId,
          version: proposal.sessionVersion, messageId: proposal.messageId,
          recordedAt: proposal.createdAt, verification: 'source-matched' }, revision, sourceProjectId);
      if (binding.bindingStatus !== 'source_matched') throw new Error('The update inbox candidate failed strict evidence binding.');
      Object.assign(proposal, {
        projectId, sourceProjectId, messageFingerprint: binding.messageFingerprint, messageFingerprintVersion: binding.messageFingerprintVersion,
        revisionFingerprint: binding.revisionFingerprint, quoteFingerprint: binding.quoteFingerprint,
        quoteByteRange: binding.quoteByteRange, sourceIdentity: binding.sourceIdentity,
      });
      candidates.push(proposal);
    } else if (value.type === 'threadpack_task_claim') {
      const event = validateTaskClaimEvent(value.event, projectId);
      if (typeof value.fingerprint !== 'string'
        || await sha256Fingerprint(JSON.stringify(value.event)) !== value.fingerprint) {
        throw new Error('A task coordination event failed its integrity check.');
      }
      const expectedId = `claim-event-${(await sha256Fingerprint(JSON.stringify([projectId, event.client, event.idempotencyKey]))).slice(0, 40)}`;
      if (event.id !== expectedId) throw new Error('A task coordination event has an invalid identity.');
      taskClaimCandidates.push(event);
    } else {
      throw new Error('The update inbox contains an unsupported record.');
    }
  }
  let imported = 0;
  const staleReviewsReopened = await recoverStaleProjectUpdateReviews(projectId);
  const now = Date.now();
  await withTransaction(['updates', 'claims', 'projects', 'shared', 'memory'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const claims = transaction.objectStore('claims');
    const projects = transaction.objectStore('projects');
    const [existingClaims, facts] = await Promise.all([
      idbRequest<ProjectTaskClaimEvent[]>(claims.index('projectId').getAll(IDBKeyRange.only(projectId))),
      idbRequest<ProjectMemoryFact[]>(transaction.objectStore('memory').index('projectId').getAll(IDBKeyRange.only(projectId))),
    ]);
    const claimEvents = [...existingClaims];
    const factsById = new Map(facts.map(fact => [fact.id, fact]));
    for (const event of taskClaimCandidates) {
      const existing = await idbRequest<ProjectTaskClaimEvent | undefined>(claims.get(event.key));
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('A task claim idempotency key was reused for different content.');
        continue;
      }
      const task = factsById.get(event.taskId);
      if (!task || task.category !== 'task') throw new Error('A task claim refers to an unknown project task.');
      if (event.action !== 'released' && (task.status !== 'confirmed' || task.conflictsWith.length
        || task.taskState === 'done' || task.taskState === 'blocked')) {
        throw new Error('Only confirmed, conflict-free, unfinished tasks can be claimed.');
      }
      validateTaskClaimTransition(event, claimEvents, now);
      claims.add(event);
      claimEvents.push(event);
      imported++;
    }
    const latestClaims = latestTaskClaimEvents(claimEvents);
    for (const proposal of candidates) {
      if (proposal.taskId) {
        const task = factsById.get(proposal.taskId);
        const claim = proposal.claimId ? latestClaims.get(proposal.claimId) : undefined;
        if (proposal.category !== 'task' || !task || task.category !== 'task' || task.status !== 'confirmed'
          || task.conflictsWith.length || !claim || !taskClaimHeldAt(claimEvents, proposal.claimId!, proposal.taskId, proposal.client, proposal.createdAt)) {
          throw new Error('The task result candidate is not bound to an active matching task claim.');
        }
      }
      const existing = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(proposal.key));
      if (!existing) { updates.add(proposal); imported++; }
      else if (!sameUpdateSubmission(existing, proposal)) {
        throw new Error('An idempotency key was reused for a different candidate update.');
      }
    }
    const sharedStore = transaction.objectStore('shared');
    const currentShared = await idbRequest<SharedProjectBackupRecord | undefined>(sharedStore.get(projectId));
    if (currentShared?.inboxHandle) {
      currentShared.inboxReadOffset = Math.max(currentShared.inboxReadOffset ?? 0, inbox.nextOffset);
      sharedStore.put(currentShared);
    }
    if (imported || staleReviewsReopened) {
      const currentProject = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
      if (currentProject && !currentProject.restoringSince) { touchProject(currentProject, now); projects.put(currentProject); }
    }
  });
  const pending = (await listProjectUpdateProposals(projectId)).filter(proposal => proposal.status === 'pending').length;
  return { imported, pending, changed: imported > 0 || staleReviewsReopened };
}

export async function connectSharedProjectInbox(projectId: string, handle: SharedProjectFileHandle): Promise<ProjectUpdateImportResult> {
  if (!handle || typeof handle.getFile !== 'function' || typeof handle.queryPermission !== 'function') throw new Error('Choose a browser-supported update inbox file.');
  const project = await withTransaction(['projects'], 'readonly', transaction => idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
  if (!project || project.restoringSince) throw new Error('This project is unavailable.');
  const { shared: currentShared } = await sharedProjectStatus(projectId);
  if (!currentShared) throw new Error('Connect the shared project file before connecting its update inbox.');
  if (await handle.isSameEntry(currentShared.handle)) throw new Error('Choose a separate file for candidate updates.');
  if (await handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Read permission is required for the candidate update inbox.');
  await withTransaction(['shared'], 'readwrite', async transaction => {
    const shared = await idbRequest<SharedProjectBackupRecord | undefined>(transaction.objectStore('shared').get(projectId));
    if (!shared) throw new Error('Connect the shared project file before connecting its update inbox.');
    shared.inboxHandle = handle;
    shared.inboxReadOffset = 0;
    transaction.objectStore('shared').put(shared);
  });
  return importSharedProjectUpdates(projectId);
}

export async function reviewProjectUpdateProposal(projectId: string, proposalId: string, decision: 'accepted' | 'rejected'): Promise<MemoryStatus | undefined> {
  await expireProjectMemoryFacts(projectId);
  const now = Date.now();
  const proposal = await withTransaction(['updates'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(`${projectId}\0${proposalId}`));
    if (!current || current.status !== 'pending') throw new Error('This project update is already being reviewed or has been closed.');
    current.status = 'reviewing';
    current.reviewingSince = now;
    current.statusHistory.push({ status: 'reviewing', changedAt: now });
    appendProposalAudit(current, 'review-started', 'user', now);
    updates.put(current);
    return current;
  });
  try {
    let acceptedFactStatus: MemoryStatus | undefined;
    let acceptedFactId: string | undefined;
    if (decision === 'accepted') {
      const acceptedFact = await createProjectMemoryFact(projectId, {
        category: proposal.category, topic: proposal.topic, statement: proposal.statement, taskState: proposal.taskState,
        origin: 'user', status: 'confirmed',
        evidence: [{ kind: 'conversation', reference: `MCP candidate · ${proposal.client} · ${proposal.id}`,
          sessionId: proposal.sessionId, version: proposal.sessionVersion, messageId: proposal.messageId,
          proposalId: proposal.id, quote: proposal.evidenceQuote }],
      });
      acceptedFactStatus = acceptedFact.status;
      acceptedFactId = acceptedFact.id;
      await withTransaction(['updates'], 'readwrite', async transaction => {
        const updates = transaction.objectStore('updates');
        const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(proposal.key));
        if (!current || current.status !== 'reviewing' || current.reviewingSince !== now) throw new Error('This project update changed during review.');
        current.acceptedFactId = acceptedFact.id;
        updates.put(current);
      });
    }
    await withTransaction(['updates', 'projects'], 'readwrite', async transaction => {
      const updates = transaction.objectStore('updates');
      const projects = transaction.objectStore('projects');
      const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(proposal.key));
      if (!current || current.status !== 'reviewing' || current.reviewingSince !== now) throw new Error('This project update changed during review.');
      current.status = decision;
      current.reviewedAt = Date.now();
      if (acceptedFactId) current.acceptedFactId = acceptedFactId;
      delete current.reviewingSince;
      current.statusHistory.push({ status: decision, changedAt: current.reviewedAt });
      appendProposalAudit(current, decision, 'user', current.reviewedAt);
      updates.put(current);
      const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
      if (project && !project.restoringSince) { touchProject(project, current.reviewedAt); projects.put(project); }
    });
    return acceptedFactStatus;
  } catch (error) {
    await withTransaction(['updates', 'projects', 'memory'], 'readwrite', async transaction => {
      const updates = transaction.objectStore('updates');
      const projects = transaction.objectStore('projects');
      const memory = transaction.objectStore('memory');
      const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(proposal.key));
      if (current?.status === 'reviewing' && current.reviewingSince === now) {
        const reopenedAt = Date.now();
        const facts = await idbRequest<ProjectMemoryFact[]>(memory.index('projectId').getAll(IDBKeyRange.only(projectId)));
        recoverInterruptedProposal(current, facts, reopenedAt);
        updates.put(current);
        const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
        if (project && !project.restoringSince) { touchProject(project, reopenedAt); projects.put(project); }
      }
    }).catch(() => {});
    throw error;
  }
}

export async function editProjectUpdateProposal(projectId: string, proposalId: string, input: Pick<ProjectUpdateProposal, 'category' | 'topic' | 'statement' | 'taskState' | 'evidenceReference' | 'evidenceQuote'>): Promise<void> {
  if (!MEMORY_CATEGORIES.includes(input.category) || !input.topic.trim() || input.topic.length > 160
    || !input.statement.trim() || input.statement.length > 4000
    || input.taskState !== undefined && !TASK_STATES.includes(input.taskState)
    || input.category !== 'task' && input.taskState !== undefined
    || input.evidenceReference.length > 1000 || !input.evidenceQuote.trim() || input.evidenceQuote.length > 1000) throw new Error('The edited project update is invalid.');
  const beforeEdit = await withTransaction(['updates'], 'readonly', async transaction =>
    idbRequest<ProjectUpdateProposal | undefined>(transaction.objectStore('updates').get(`${projectId}\0${proposalId}`)));
  if (!beforeEdit || beforeEdit.status !== 'pending') throw new Error('Only a pending project update can be edited.');
  const evidenceBinding = await prepareMemoryEvidence(projectId, { kind: 'conversation', reference: input.evidenceReference,
    sessionId: beforeEdit.sessionId, version: beforeEdit.sessionVersion, messageId: beforeEdit.messageId, quote: input.evidenceQuote });
  await withTransaction(['updates', 'projects'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const projects = transaction.objectStore('projects');
    const proposal = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(`${projectId}\0${proposalId}`));
    if (!proposal || proposal.status !== 'pending') throw new Error('Only a pending project update can be edited.');
    Object.assign(proposal, {
      category: input.category, topic: input.topic.trim(), statement: input.statement.trim(),
      taskState: input.taskState, evidenceReference: input.evidenceReference.trim(), evidenceQuote: input.evidenceQuote.trim(),
      sourceProjectId: evidenceBinding.sourceProjectId, messageFingerprint: evidenceBinding.messageFingerprint,
      messageFingerprintVersion: evidenceBinding.messageFingerprintVersion, revisionFingerprint: evidenceBinding.revisionFingerprint,
      quoteFingerprint: evidenceBinding.quoteFingerprint, quoteByteRange: evidenceBinding.quoteByteRange,
      sourceIdentity: evidenceBinding.sourceIdentity,
    });
    if (input.taskState === undefined) delete proposal.taskState;
    if (input.category !== 'task') { delete proposal.taskId; delete proposal.claimId; }
    const now = Date.now();
    appendProposalAudit(proposal, 'edited', 'user', now);
    updates.put(proposal);
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    if (project && !project.restoringSince) { touchProject(project, now); projects.put(project); }
  });
}

export async function revokeAcceptedProjectUpdate(projectId: string, proposalId: string): Promise<void> {
  await expireProjectMemoryFacts(projectId);
  const before = await withTransaction(['updates', 'memory'], 'readonly', async transaction => {
    const proposal = await idbRequest<ProjectUpdateProposal | undefined>(transaction.objectStore('updates').get(projectId + String.fromCharCode(0) + proposalId));
    if (!proposal || proposal.status !== 'accepted' || !proposal.acceptedFactId) throw new Error('This accepted project update cannot be revoked.');
    const fact = await idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(projectId + String.fromCharCode(0) + proposal.acceptedFactId));
    if (!fact || isTerminalMemoryStatus(fact.status)) throw new Error('The accepted project fact is unavailable for revocation.');
    return fact;
  });
  const trust = await getProjectTrustSummary(projectId);
  const hasAuthenticatedConfirmation = await factConfirmationTrust(before, trust) === 'authenticated';
  const canSignRevocation = hasAuthenticatedConfirmation && trust.readyForConfirmations;
  const now = Date.now();
  await withTransaction(['updates', 'projects', 'memory'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(projectId + String.fromCharCode(0) + proposalId));
    if (!current || current.status !== 'accepted' || !current.acceptedFactId) throw new Error('This accepted project update cannot be revoked.');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(projectId + String.fromCharCode(0) + current.acceptedFactId));
    if (!project || project.restoringSince || !fact || fact.updatedAt !== before.updatedAt
      || isTerminalMemoryStatus(fact.status)) throw new Error('The accepted project fact changed or is unavailable for revocation.');
    current.status = 'reviewing';
    current.reviewingSince = now;
    current.statusHistory.push({ status: 'reviewing', changedAt: now });
    appendProposalAudit(current, 'review-started', 'user', now);
    fact.status = 'revoked';
    appendStatusChange(fact, 'revoked', now);
    fact.updatedAt = now;
    fact.revision = (fact.revision ?? 1) + 1;
    if (fact.conflictsWith.length) {
      for (const conflictId of fact.conflictsWith) {
        const conflict = await idbRequest<ProjectMemoryFact | undefined>(memory.get(projectId + String.fromCharCode(0) + conflictId));
        if (conflict) {
          conflict.conflictsWith = conflict.conflictsWith.filter(id => id !== fact.id);
          if (!conflict.conflictsWith.length && conflict.status === 'needs-review' && conflict.reviewStateBeforeConflict) {
            const restoredStatus = conflict.reviewStateBeforeConflict === 'proposed' ? 'proposed' : 'needs-review';
            conflict.status = restoredStatus;
            appendStatusChange(conflict, restoredStatus, now);
            delete conflict.reviewStateBeforeConflict;
          }
          conflict.updatedAt = now;
          conflict.revision = (conflict.revision ?? 1) + 1;
          memory.put(conflict);
        }
      }
      fact.conflictsWith = [];
      delete fact.reviewStateBeforeConflict;
    }
    memory.put(fact);
    touchProject(project, now);
    projects.put(project);
    updates.put(current);
    current.status = 'revoked';
    current.reviewedAt = now;
    delete current.reviewingSince;
    current.statusHistory.push({ status: 'revoked', changedAt: now });
    appendProposalAudit(current, 'revoked', 'user', now);
    updates.put(current);
  });
  const current = await withTransaction(['memory'], 'readonly', transaction =>
    idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(projectId + String.fromCharCode(0) + before.id)));
  if (current && canSignRevocation) await recordFactConfirmationRevocation(projectId, before, current, 'revoked');
  else if (current) await recordFactLifecycleEvent(projectId, current, 'claim.revoked', 'user-revoked');
}
function publicSharedStatus(project: ProjectRecord | undefined, shared: SharedProjectBackupRecord | undefined,
  state?: SharedProjectBackupStatus['state']): SharedProjectBackupStatus {
  if (!project || !shared) return { connected: false, state: 'disconnected' };
  return {
    connected: true,
    state: state ?? (shared.syncedProjectUpdatedAt >= project.updatedAt ? 'current' : 'out-of-date'),
    filename: shared.handle.name,
    syncedAt: shared.syncedAt || undefined,
    inboxConnected: !!shared.inboxHandle,
    inboxFilename: shared.inboxHandle?.name,
  };
}

export async function getSharedProjectBackupStatus(projectId: string): Promise<SharedProjectBackupStatus> {
  const { project, shared } = await sharedProjectStatus(projectId);
  if (!project || !shared) return { connected: false, state: 'disconnected' };
  try {
    const permission = await shared.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return publicSharedStatus(project, shared, 'permission-required');
    if (shared.inboxHandle && await shared.inboxHandle.queryPermission({ mode: 'read' }) !== 'granted') {
      return publicSharedStatus(project, shared, 'permission-required');
    }
    return publicSharedStatus(project, shared);
  } catch { return publicSharedStatus(project, shared, 'error'); }
}

async function syncSharedProjectBackupOnce(projectId: string): Promise<SharedProjectBackupStatus> {
  const { project, shared } = await sharedProjectStatus(projectId);
  if (!project || project.restoringSince || !shared) return { connected: false, state: 'disconnected' };
  try {
    if (await shared.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      return publicSharedStatus(project, shared, 'permission-required');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await withTransaction(['projects'], 'readonly', transaction =>
        idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
      if (!before || before.restoringSince) return { connected: false, state: 'disconnected' };
      const backup = await exportProjectBackup(projectId);
      const afterExport = await withTransaction(['projects'], 'readonly', transaction =>
        idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
      if (!afterExport || afterExport.updatedAt !== before.updatedAt) continue;
      if (backup.size > MAX_SHARED_PROJECT_BACKUP_BYTES) return publicSharedStatus(afterExport, shared, 'error');
      const writable = await shared.handle.createWritable();
      try {
        await writable.write(backup);
        await writable.close();
      } catch {
        await writable.abort().catch(() => {});
        throw new Error('The shared project file could not be updated.');
      }
      const afterWrite = await withTransaction(['projects'], 'readonly', transaction =>
        idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
      if (!afterWrite || afterWrite.updatedAt !== before.updatedAt) continue;
      const synced = { ...shared, syncedAt: Date.now(), syncedProjectUpdatedAt: afterWrite.updatedAt };
      await withTransaction(['shared'], 'readwrite', async transaction => {
        transaction.objectStore('shared').put(synced);
      });
      const latestProject = await withTransaction(['projects'], 'readonly', transaction =>
        idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
      if (!latestProject || latestProject.restoringSince) return { connected: false, state: 'disconnected' };
      if (latestProject.updatedAt !== synced.syncedProjectUpdatedAt) continue;
      return publicSharedStatus(latestProject, synced);
    }
    return publicSharedStatus(await withTransaction(['projects'], 'readonly', transaction =>
      idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId))), shared, 'out-of-date');
  } catch { return publicSharedStatus(project, shared, 'error'); }
}

export function syncSharedProjectBackup(projectId: string): Promise<SharedProjectBackupStatus> {
  const previous = sharedBackupWrites.get(projectId) ?? Promise.resolve<SharedProjectBackupStatus>({ connected: false, state: 'disconnected' });
  const current = previous.catch(() => ({ connected: false, state: 'error' as const }))
    .then(() => syncSharedProjectBackupOnce(projectId))
    .catch(() => ({ connected: true, state: 'error' as const }));
  sharedBackupWrites.set(projectId, current);
  const release = () => { if (sharedBackupWrites.get(projectId) === current) sharedBackupWrites.delete(projectId); };
  void current.then(release, release);
  return current;
}

export async function connectSharedProjectBackup(projectId: string, handle: SharedProjectFileHandle): Promise<SharedProjectBackupStatus> {
  if (!handle || typeof handle.createWritable !== 'function' || typeof handle.queryPermission !== 'function') {
    throw new Error('Choose a browser-supported local project file.');
  }
  const project = await withTransaction(['projects'], 'readonly', transaction =>
    idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
  if (!project || project.restoringSince) throw new Error('This project is unavailable.');
  if ((await handle.getFile()).size > 0) throw new Error('Choose a new, empty file for live project sharing. Existing backup files are never replaced during connection.');
  await withTransaction(['shared'], 'readwrite', async transaction => {
    transaction.objectStore('shared').put({ projectId, handle, syncedAt: 0, syncedProjectUpdatedAt: 0 } satisfies SharedProjectBackupRecord);
  });
  const status = await syncSharedProjectBackup(projectId);
  if (status.state === 'error') throw new Error('The selected project file could not be initialized.');
  return status;
}

export async function reconnectSharedProjectBackup(projectId: string): Promise<SharedProjectBackupStatus> {
  const { shared } = await sharedProjectStatus(projectId);
  if (!shared) return { connected: false, state: 'disconnected' };
  try {
    let permission = await shared.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await shared.handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return getSharedProjectBackupStatus(projectId);
    return syncSharedProjectBackup(projectId);
  } catch { return getSharedProjectBackupStatus(projectId); }
}

export async function disconnectSharedProjectBackup(projectId: string): Promise<void> {
  await withTransaction(['shared'], 'readwrite', async transaction => {
    transaction.objectStore('shared').delete(projectId);
  });
}

function readBackupLines(file: Blob): AsyncGenerator<string> {
  return (async function* () {
    if (!file.stream) throw new Error('This browser cannot read project backups.');
    const reader = file.stream().getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/, '');
          if (line) yield line;
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
        if (pending.length > MAX_PROJECT_SESSION_BYTES * 2) throw new Error('A project backup record exceeds the supported size.');
      }
      pending += decoder.decode();
      if (pending.trim()) yield pending.replace(/\r$/, '');
    } finally { reader.releaseLock(); }
  })();
}

function parseBackupLine(line: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error('The project backup contains invalid JSON.'); }
  if (!isRecord(value)) throw new Error('The project backup contains an invalid record.');
  return value;
}

interface ProjectBackupHeader {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  projectId?: string;
  project: Omit<ProjectRecord, 'id' | 'restoringSince'>;
  sessionCount: number;
  revisionCount: number;
  factCount: number;
  updateCount: number;
  claimCount: number;
  trustStateCount: number;
  trustEventCount: number;
  migrationCount: number;
}

function validateBackupHeader(value: Record<string, unknown>): ProjectBackupHeader {
  const project = value.project;
  if (value.type !== 'threadpack_project' || value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6 && value.version !== 7 && value.version !== 8 && value.version !== PROJECT_BACKUP_VERSION || !isRecord(project)
    || !Number.isSafeInteger(value.createdAt)
    || value.projectId !== undefined && (typeof value.projectId !== 'string' || !value.projectId || value.projectId.length > 200)
    || typeof project.name !== 'string' || typeof project.summary !== 'string' || typeof project.importantNotes !== 'string'
    || !Number.isSafeInteger(project.createdAt) || !Number.isSafeInteger(project.updatedAt)
    || typeof value.sessionCount !== 'number' || !Number.isSafeInteger(value.sessionCount) || value.sessionCount < 0
    || typeof value.revisionCount !== 'number' || !Number.isSafeInteger(value.revisionCount) || value.revisionCount < 0
    || value.sessionCount > value.revisionCount || value.revisionCount > 1_000_000
    || value.version >= 2 && (!Number.isSafeInteger(value.factCount) || (value.factCount as number) < 0 || (value.factCount as number) > 100_000)
    || value.version >= 6 && (!Number.isSafeInteger(value.updateCount) || (value.updateCount as number) < 0 || (value.updateCount as number) > 1_000_000)
    || value.version < 6 && value.updateCount !== undefined && value.updateCount !== 0
    || value.version >= 7 && (!Number.isSafeInteger(value.claimCount) || (value.claimCount as number) < 0 || (value.claimCount as number) > 1_000_000)
    || value.version >= 8 && (!Number.isSafeInteger(value.trustStateCount) || (value.trustStateCount as number) < 0 || (value.trustStateCount as number) > 1
      || !Number.isSafeInteger(value.trustEventCount) || (value.trustEventCount as number) < 0 || (value.trustEventCount as number) > 1_000_000)
    || value.version === PROJECT_BACKUP_VERSION && (!Number.isSafeInteger(value.migrationCount) || (value.migrationCount as number) < 0 || (value.migrationCount as number) > 1_000_000 || typeof value.projectId !== 'string')
    || value.version < PROJECT_BACKUP_VERSION && value.migrationCount !== undefined && value.migrationCount !== 0
    || value.version < 7 && value.claimCount !== undefined && value.claimCount !== 0
    || value.version < 8 && (value.trustStateCount !== undefined && value.trustStateCount !== 0 || value.trustEventCount !== undefined && value.trustEventCount !== 0)) {
    throw new Error('This project backup has an unsupported or invalid header.');
  }
  const name = normalizeName(project.name);
  if (project.summary.length > 10000 || project.importantNotes.length > 20000) throw new Error('The project backup contains oversized project notes.');
  return {
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    project: { name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt as number, updatedAt: project.updatedAt as number },
    version: value.version,
    sessionCount: value.sessionCount, revisionCount: value.revisionCount,
    factCount: value.version >= 2 ? value.factCount as number : 0,
    updateCount: value.version >= 6 ? value.updateCount as number : 0,
    claimCount: value.version >= 7 ? value.claimCount as number : 0,
    trustStateCount: value.version >= 8 ? value.trustStateCount as number : 0,
    trustEventCount: value.version >= 8 ? value.trustEventCount as number : 0,
    migrationCount: value.version === PROJECT_BACKUP_VERSION ? value.migrationCount as number : 0,
  };
}

async function validateBackupTrustState(value: unknown, localProjectId: string, sourceProjectId: string): Promise<ProjectTrustState> {
  if (!isRecord(value) || value.projectId !== sourceProjectId
    || value.sourceProjectId !== undefined && (typeof value.sourceProjectId !== 'string' || !value.sourceProjectId || value.sourceProjectId.length > 200)
    || typeof value.rootKeyId !== 'string'
    || !isRecord(value.rootPublicKeyJwk) || typeof value.recoveryKeyId !== 'string' || !isRecord(value.recoveryPublicKeyJwk)
    || !isRecord(value.recoveryBundle) || typeof value.activeKeyId !== 'string'
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || typeof value.headHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.headHash)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) {
    throw new Error('The project backup contains invalid trust identity metadata.');
  }
  const rootPublicKeyJwk = value.rootPublicKeyJwk as JsonWebKey;
  const recoveryPublicKeyJwk = value.recoveryPublicKeyJwk as JsonWebKey;
  const recoveryBundle = value.recoveryBundle as unknown as RecoveryBundle;
  if (!isPublicSigningKeyJwk(rootPublicKeyJwk) || !isPublicSigningKeyJwk(recoveryPublicKeyJwk)
    || !isPublicSigningKeyJwk(recoveryBundle.publicKeyJwk) || !Number.isSafeInteger(recoveryBundle.iterations)
    || recoveryBundle.iterations < 100_000 || recoveryBundle.iterations > 1_000_000
    || typeof recoveryBundle.salt !== 'string' || typeof recoveryBundle.iv !== 'string' || typeof recoveryBundle.ciphertext !== 'string'
    || recoveryBundle.ciphertext.length > 100_000
    || await keyIdForPublicKey(rootPublicKeyJwk) !== value.rootKeyId
    || await keyIdForPublicKey(recoveryPublicKeyJwk) !== value.recoveryKeyId
    || recoveryBundle.schema !== 'threadpack.recovery.v1' || recoveryBundle.keyId !== value.recoveryKeyId
    || recoveryBundle.algorithm !== 'ECDSA-P256-SHA256' || recoveryBundle.kdf !== 'PBKDF2-SHA-256'
    || recoveryBundle.authorizedRootKeyId !== value.rootKeyId
    || await publicKeyFingerprint(recoveryBundle.authorizedRootPublicKeyJwk) !== await publicKeyFingerprint(rootPublicKeyJwk)
    || await publicKeyFingerprint(recoveryBundle.publicKeyJwk) !== await publicKeyFingerprint(recoveryPublicKeyJwk)
    || await publicKeyFingerprint(recoveryPublicKeyJwk) !== recoveryBundle.publicKeyFingerprint) {
    throw new Error('The project backup trust identity keys or recovery bundle do not match.');
  }
  const trustSourceProjectId = typeof value.sourceProjectId === 'string' ? value.sourceProjectId : sourceProjectId;
  const state: ProjectTrustState = {
    projectId: localProjectId, sourceProjectId: trustSourceProjectId, trustStatus: 'untrusted-import',
    rootKeyId: value.rootKeyId, rootPublicKeyJwk, recoveryKeyId: value.recoveryKeyId, recoveryPublicKeyJwk, recoveryBundle,
    activeKeyId: value.activeKeyId, sequence: value.sequence as number, headHash: value.headHash,
    createdAt: value.createdAt as number, updatedAt: value.updatedAt as number,
  };
  return state;
}

async function memoryBackupFingerprint(data: Omit<ProjectMemoryFact, 'key' | 'projectId'>): Promise<string> {
  return sha256Fingerprint(JSON.stringify(data));
}

async function validateBackupMemory(value: unknown, projectId: string, factIds: Set<string>, assess: ReturnType<typeof evidenceReader>): Promise<ProjectMemoryFact> {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || !MEMORY_CATEGORIES.includes(value.category as MemoryCategory)
    || !['user', 'ai'].includes(value.origin as string) || !MEMORY_STATUSES.includes(value.status as MemoryStatus)
    || typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 160
    || value.normalizedTopic !== normalizeMemoryTopic(value.topic)
    || typeof value.statement !== 'string' || !value.statement.trim() || value.statement.length > 4000
    || value.revision !== undefined && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1)
    || value.confirmationEventId !== undefined && (typeof value.confirmationEventId !== 'string' || !value.confirmationEventId || value.confirmationEventId.length > 200)
    || value.confirmationProjectId !== undefined && (typeof value.confirmationProjectId !== 'string' || !value.confirmationProjectId || value.confirmationProjectId.length > 200)
    || value.confirmationVersion !== undefined && (!Number.isSafeInteger(value.confirmationVersion) || (value.confirmationVersion as number) < 1)
    || value.confirmationRevocationEventId !== undefined && (typeof value.confirmationRevocationEventId !== 'string' || !value.confirmationRevocationEventId || value.confirmationRevocationEventId.length > 200)
    || value.lifecycleProjectId !== undefined && (typeof value.lifecycleProjectId !== 'string' || !value.lifecycleProjectId || value.lifecycleProjectId.length > 200)
    || value.expiresAt !== undefined && (!Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) < (value.createdAt as number))
    || value.expiredAt !== undefined && (!Number.isSafeInteger(value.expiredAt) || (value.expiredAt as number) < (value.createdAt as number))
    || value.status === 'expired' && value.expiresAt === undefined
    || value.reconsiders !== undefined && (typeof value.reconsiders !== 'string' || !value.reconsiders || value.reconsiders.length > 200 || value.reconsiders === value.id)
    || value.taskState !== undefined && !TASK_STATES.includes(value.taskState as TaskState)
    || value.category !== 'task' && value.taskState !== undefined
    || value.statusHistory !== undefined && (!Array.isArray(value.statusHistory) || value.statusHistory.length < 1 || value.statusHistory.length > 10_000)
    || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 20
    || !Array.isArray(value.conflictsWith) || value.conflictsWith.some(id => typeof id !== 'string' || id.length > 200)
    || value.supersedes !== undefined && (typeof value.supersedes !== 'string' || value.supersedes.length > 200)
    || value.supersededBy !== undefined && (typeof value.supersededBy !== 'string' || value.supersededBy.length > 200)
    || value.reviewStateBeforeConflict !== undefined && !['confirmed', 'proposed'].includes(value.reviewStateBeforeConflict as string)
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) {
    throw new Error('The project backup contains an invalid memory record.');
  }
  const id = value.id;
  if (factIds.has(id)) throw new Error('The project backup contains duplicate memory IDs.');
  factIds.add(id);
  const evidence: MemoryEvidence[] = [];
  const claim = { id, projectId, category: value.category as MemoryCategory, topic: value.topic as string,
    statement: value.statement as string, ...(typeof value.taskState === 'string' ? { taskState: value.taskState as TaskState } : {}) };
  for (const candidate of value.evidence) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 200
      || !EVIDENCE_KINDS.includes(candidate.kind as EvidenceKind)
      || typeof candidate.reference !== 'string' || candidate.reference.length > 1000
      || typeof candidate.quote !== 'string' || candidate.quote.length > 1000
      || candidate.proposalId !== undefined && (candidate.kind !== 'conversation' || typeof candidate.proposalId !== 'string' || !candidate.proposalId || candidate.proposalId.length > 200)
      || !Number.isSafeInteger(candidate.recordedAt)
      || !['source-matched', 'user-recorded', 'unattached'].includes(candidate.verification as string)) {
      throw new Error('The project backup contains invalid memory evidence.');
    }
    if (candidate.kind === 'user' && candidate.verification !== 'unattached') {
      throw new Error('The project backup contains invalid user evidence.');
    }
    if ((candidate.kind === 'repository' || candidate.kind === 'test') && (candidate.verification !== 'user-recorded'
      || typeof candidate.commit !== 'string' || !/^[a-f0-9]{7,64}$/i.test(candidate.commit) || !candidate.quote.trim()
      || candidate.kind === 'test' && (typeof candidate.command !== 'string' || !candidate.command.trim()))) {
      throw new Error('The project backup contains invalid repository or test evidence.');
    }
    evidence.push(await assess(candidate as unknown as MemoryEvidence, claim as ProjectMemoryFact));
  }
  const normalizedTopic = normalizeMemoryTopic(value.topic);
  const statusHistory = readStatusHistory(value.statusHistory, value.status as MemoryStatus, value.createdAt as number);
  return {
    key: `${projectId}\0${id}`, id, projectId, category: value.category as MemoryCategory,
    topic: value.topic, normalizedTopic, statement: value.statement, origin: value.origin as MemoryOrigin,
    status: value.status as MemoryStatus, statusHistory, evidence, conflictsWith: [...value.conflictsWith as string[]],
    revision: Number.isSafeInteger(value.revision) ? value.revision as number : Math.max(1, statusHistory.length),
    ...(typeof value.confirmationEventId === 'string' ? { confirmationEventId: value.confirmationEventId } : {}),
    ...(typeof value.confirmationProjectId === 'string' ? { confirmationProjectId: value.confirmationProjectId } : {}),
    ...(typeof value.confirmationVersion === 'number' ? { confirmationVersion: value.confirmationVersion } : {}),
    ...(typeof value.confirmationRevocationEventId === 'string' ? { confirmationRevocationEventId: value.confirmationRevocationEventId } : {}),
    ...(typeof value.lifecycleProjectId === 'string' ? { lifecycleProjectId: value.lifecycleProjectId } : {}),
    confirmationTrust: value.status === 'confirmed' ? 'legacy-unverified' : 'inactive',
    lifecycleTrust: isTerminalMemoryStatus(value.status as MemoryStatus) ? 'legacy-unverified' : 'inactive',
    ...(typeof value.taskState === 'string' ? { taskState: value.taskState as TaskState } : {}),
    ...(value.reviewStateBeforeConflict === 'confirmed' || value.reviewStateBeforeConflict === 'proposed'
      ? { reviewStateBeforeConflict: value.reviewStateBeforeConflict } : {}),
    ...(typeof value.supersedes === 'string' ? { supersedes: value.supersedes } : {}),
    ...(typeof value.supersededBy === 'string' ? { supersededBy: value.supersededBy } : {}),
    ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.expiredAt === 'number' ? { expiredAt: value.expiredAt } : {}),
    ...(typeof value.reconsiders === 'string' ? { reconsiders: value.reconsiders } : {}),
    createdAt: value.createdAt as number, updatedAt: value.updatedAt as number,
  };
}

function validateBackupUpdate(value: unknown, projectId: string, sourceProjectId: string, ids: Set<string>): ProjectUpdateProposal {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || value.projectId !== sourceProjectId || typeof value.client !== 'string' || !value.client.trim() || value.client.length > 200
    || !MEMORY_CATEGORIES.includes(value.category as MemoryCategory) || typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 160
    || typeof value.statement !== 'string' || !value.statement.trim() || value.statement.length > 4000
    || typeof value.evidenceReference !== 'string' || value.evidenceReference.length > 1000
    || typeof value.evidenceQuote !== 'string' || value.evidenceQuote.length > 1000
    || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 200
    || !Number.isSafeInteger(value.sessionVersion) || (value.sessionVersion as number) < 1
    || typeof value.messageId !== 'string' || !value.messageId || value.messageId.length > 500
    || value.sourceProjectId !== undefined && (typeof value.sourceProjectId !== 'string' || !value.sourceProjectId || value.sourceProjectId.length > 200)
    || value.messageFingerprint !== undefined && (typeof value.messageFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.messageFingerprint))
    || value.messageFingerprintVersion !== undefined && value.messageFingerprintVersion !== 2
    || value.revisionFingerprint !== undefined && (typeof value.revisionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.revisionFingerprint))
    || value.quoteFingerprint !== undefined && (typeof value.quoteFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.quoteFingerprint))
    || value.quoteByteRange !== undefined && (!isRecord(value.quoteByteRange) || !Number.isSafeInteger(value.quoteByteRange.start)
      || !Number.isSafeInteger(value.quoteByteRange.end) || (value.quoteByteRange.start as number) < 0
      || (value.quoteByteRange.end as number) <= (value.quoteByteRange.start as number))
    || !['pending', 'reviewing', 'accepted', 'rejected', 'revoked'].includes(value.status as string)
    || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey || value.idempotencyKey.length > 200
    || !Array.isArray(value.statusHistory) || value.statusHistory.length < 1 || value.statusHistory.length > 100
    || !Array.isArray(value.auditHistory) || value.auditHistory.length < 1 || value.auditHistory.length > 200
    || value.acceptedFactId !== undefined && (typeof value.acceptedFactId !== 'string' || !value.acceptedFactId || value.acceptedFactId.length > 200)
    || !Number.isSafeInteger(value.createdAt) || value.reviewedAt !== undefined && !Number.isSafeInteger(value.reviewedAt)) {
    throw new Error('The project backup contains an invalid candidate update.');
  }
  const statusHistory = value.statusHistory.map(change => {
    if (!isRecord(change) || !['pending', 'reviewing', 'accepted', 'rejected', 'revoked'].includes(change.status as string)
      || !Number.isSafeInteger(change.changedAt)) throw new Error('The project backup contains invalid update status history.');
    return { status: change.status as ProjectUpdateStatus, changedAt: change.changedAt as number } satisfies ProjectUpdateStatusChange;
  });
  if (statusHistory.at(-1)?.status !== value.status || statusHistory.some((change, index) => index > 0 && change.changedAt < statusHistory[index - 1]!.changedAt)) {
    throw new Error('The project backup contains inconsistent update status history.');
  }
  const auditHistory = value.auditHistory.map(entry => {
    if (!isRecord(entry) || !['submitted', 'review-started', 'edited', 'accepted', 'rejected', 'revoked', 'review-reopened'].includes(entry.action as string)
      || !['mcp-client', 'user'].includes(entry.actor as string) || !['pending', 'reviewing', 'accepted', 'rejected', 'revoked'].includes(entry.status as string)
      || !Number.isSafeInteger(entry.changedAt) || !isRecord(entry.snapshot)
      || !MEMORY_CATEGORIES.includes(entry.snapshot.category as MemoryCategory) || typeof entry.snapshot.topic !== 'string'
      || typeof entry.snapshot.statement !== 'string' || typeof entry.snapshot.evidenceReference !== 'string' || typeof entry.snapshot.evidenceQuote !== 'string'
      || typeof entry.snapshot.sessionId !== 'string' || !Number.isSafeInteger(entry.snapshot.sessionVersion)
      || typeof entry.snapshot.messageId !== 'string'
      || entry.snapshot.taskId !== undefined && (typeof entry.snapshot.taskId !== 'string' || !entry.snapshot.taskId || entry.snapshot.taskId.length > 200)
      || entry.snapshot.claimId !== undefined && (typeof entry.snapshot.claimId !== 'string' || !entry.snapshot.claimId || entry.snapshot.claimId.length > 200 || typeof entry.snapshot.taskId !== 'string')
      || entry.snapshot.taskState !== undefined && !TASK_STATES.includes(entry.snapshot.taskState as TaskState)) {
      throw new Error('The project backup contains invalid candidate update audit history.');
    }
    return { action: entry.action as ProjectUpdateAuditEntry['action'], actor: entry.actor as ProjectUpdateAuditEntry['actor'],
      ...(typeof entry.clientClaim === 'string' ? { clientClaim: entry.clientClaim } : {}), status: entry.status as ProjectUpdateStatus,
      changedAt: entry.changedAt as number, snapshot: entry.snapshot as ProjectUpdateAuditEntry['snapshot'] };
  });
  if (auditHistory.at(-1)?.status !== (value.status === 'reviewing' ? 'reviewing' : value.status)) {
    throw new Error('The project backup contains inconsistent candidate update audit history.');
  }
  if (auditHistory[0]!.action !== 'submitted' || auditHistory[0]!.actor !== 'mcp-client'
    || auditHistory[0]!.status !== 'pending' || auditHistory[0]!.clientClaim !== value.client
    || auditHistory.some((entry, index) => index > 0 && (entry.changedAt < auditHistory[index - 1]!.changedAt || entry.actor !== 'user'))) {
    throw new Error('The project backup contains inconsistent candidate update provenance.');
  }
  const stateChanges = auditHistory.filter(entry => entry.action !== 'edited');
  if (stateChanges.length !== statusHistory.length || stateChanges.some((entry, index) =>
    entry.status !== statusHistory[index]!.status || entry.changedAt !== statusHistory[index]!.changedAt)) {
    throw new Error('The project backup candidate update audit does not match its status history.');
  }
  const id = value.id;
  if (ids.has(id)) throw new Error('The project backup contains duplicate candidate update IDs.');
  ids.add(id);
  return {
    key: `${projectId}\0${id}`, id, projectId, client: value.client, category: value.category as MemoryCategory,
    sessionId: value.sessionId as string, sessionVersion: value.sessionVersion as number, messageId: value.messageId as string,
    ...(typeof value.sourceProjectId === 'string' ? { sourceProjectId: value.sourceProjectId } : {}),
    ...(typeof value.messageFingerprint === 'string' ? { messageFingerprint: value.messageFingerprint } : {}),
    ...(value.messageFingerprintVersion === 2 ? { messageFingerprintVersion: 2 as const } : {}),
    ...(typeof value.revisionFingerprint === 'string' ? { revisionFingerprint: value.revisionFingerprint } : {}),
    ...(typeof value.quoteFingerprint === 'string' ? { quoteFingerprint: value.quoteFingerprint } : {}),
    ...(isRecord(value.quoteByteRange) ? { quoteByteRange: { start: value.quoteByteRange.start as number, end: value.quoteByteRange.end as number } } : {}),
    ...(isRecord(value.sourceIdentity) ? { sourceIdentity: {
      ...(typeof value.sourceIdentity.platform === 'string' ? { platform: value.sourceIdentity.platform } : {}),
      ...(typeof value.sourceIdentity.sourceName === 'string' ? { sourceName: value.sourceIdentity.sourceName } : {}),
      ...(typeof value.sourceIdentity.sourceId === 'string' ? { sourceId: value.sourceIdentity.sourceId } : {}),
    } } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.claimId === 'string' ? { claimId: value.claimId } : {}),
    topic: value.topic, statement: value.statement, evidenceReference: value.evidenceReference, evidenceQuote: value.evidenceQuote,
    ...(typeof value.taskState === 'string' ? { taskState: value.taskState as TaskState } : {}),
    idempotencyKey: value.idempotencyKey as string, status: value.status as ProjectUpdateProposal['status'], statusHistory, auditHistory,
    ...(typeof value.acceptedFactId === 'string' ? { acceptedFactId: value.acceptedFactId } : {}), createdAt: value.createdAt as number,
    ...(typeof value.reviewedAt === 'number' ? { reviewedAt: value.reviewedAt } : {}),
    ...(typeof value.reviewNote === 'string' ? { reviewNote: value.reviewNote } : {}),
  };
}

function validateBackupSession(value: unknown, projectId: string): ProjectSessionRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200
    || typeof value.sessionKey !== 'string' || !value.sessionKey || value.sessionKey.length > 3000
    || typeof value.title !== 'string' || value.title.length > 2000
    || typeof value.sourceName !== 'string' || value.sourceName.length > 1000
    || !platformNames.includes(value.platform as SourcePlatform)
    || value.sourceId !== undefined && (typeof value.sourceId !== 'string' || value.sourceId.length > 2000)
    || typeof value.format !== 'string' || value.format.length > 200
    || !Number.isSafeInteger(value.messageCount) || (value.messageCount as number) < 0
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !Number.isSafeInteger(value.currentVersion) || (value.currentVersion as number) < 1 || (value.currentVersion as number) > 100000
    || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) {
    throw new Error('The project backup contains invalid session metadata.');
  }
  return {
    key: `${projectId}\0${value.id}`, projectId, id: value.id, sessionKey: value.sessionKey,
    title: value.title, sourceName: value.sourceName, platform: value.platform as SourcePlatform,
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}), format: value.format,
    messageCount: value.messageCount as number, fingerprint: value.fingerprint,
    currentVersion: value.currentVersion as number, createdAt: value.createdAt as number, updatedAt: value.updatedAt as number,
  };
}

async function writeRestoredRevision(projectId: string, session: ProjectSessionRecord, value: unknown, expectedVersion: number): Promise<void> {
  if (!isRecord(value) || value.sessionId !== session.id || value.version !== expectedVersion
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.content !== 'string' || typeof value.title !== 'string' || value.title.length > 2000
    || !platformNames.includes(value.platform as SourcePlatform)
    || value.sourceId !== undefined && (typeof value.sourceId !== 'string' || value.sourceId.length > 2000)
    || typeof value.format !== 'string' || value.format.length > 200
    || !Number.isSafeInteger(value.messageCount) || (value.messageCount as number) < 0
    || typeof value.sourceName !== 'string' || value.sourceName.length > 1000
    || !Number.isSafeInteger(value.createdAt)) throw new Error('The project backup contains invalid history.');
  if (utf8ByteLength(value.content) > MAX_PROJECT_SESSION_BYTES || await sha256Fingerprint(value.content) !== value.fingerprint) {
    throw new Error('A project history entry failed its integrity check.');
  }
  const snapshot = inspectSnapshot(value.content);
  if (snapshot.messageCount !== value.messageCount) {
    throw new Error('A project history entry failed its structure check.');
  }
  if (expectedVersion === session.currentVersion
    && (session.fingerprint !== value.fingerprint || session.title !== value.title || session.platform !== value.platform
      || session.sourceId !== value.sourceId || session.format !== value.format || session.messageCount !== value.messageCount
      || session.sourceName !== value.sourceName)) throw new Error('The project backup current revision does not match its session.');
  const db = await database();
  const transaction = db.transaction(['projects', 'sessions', 'revisions'], 'readwrite');
  const done = transactionDone(transaction);
  const revisions = transaction.objectStore('revisions');
  revisions.add({ key: [projectId, session.id, expectedVersion], projectId, sessionId: session.id,
    version: expectedVersion, fingerprint: value.fingerprint, content: value.content,
    title: value.title as string, platform: value.platform as SourcePlatform,
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}), format: value.format as string,
    messageCount: value.messageCount as number, sourceName: value.sourceName, createdAt: value.createdAt });
  try { await done; } catch (error) { throw error; }
}

export async function restoreProjectBackup(file: Blob): Promise<ProjectRecord> {
  const iterator = readBackupLines(file);
  let project: ProjectRecord | undefined;
  let header: ReturnType<typeof validateBackupHeader> | undefined;
  let activeSession: ProjectSessionRecord | undefined;
  let expectedVersion = 1;
  let sessionCount = 0;
  let revisionCount = 0;
  let seenMemory = false;
  let seenUpdates = false;
  let seenClaims = false;
  let seenTrustState = false;
  let seenManifest = false;
  let seenMigration = false;
  let sourceChain = PROJECT_BACKUP_CHAIN_SEED;
  let sourceRecordCount = 0;
  const sourceRecordCounts = emptyBackupRecordCounts();
  const trustEvents: StoredProjectTrustEvent[] = [];
  let trustState: ProjectTrustState | undefined;
  const facts: ProjectMemoryFact[] = [];
  const factIds = new Set<string>();
  const updates: ProjectUpdateProposal[] = [];
  const updateIds = new Set<string>();
  const claims: ProjectTaskClaimEvent[] = [];
  const claimIds = new Set<string>();
  const migrationEvents: ProjectBackupMigrationRecord[] = [];
  const migrationIds = new Set<string>();
  let assess: ReturnType<typeof evidenceReader> | undefined;
  try {
    const first = await iterator.next();
    if (first.done) throw new Error('The project backup is empty.');
    const headerRecord = parseBackupLine(first.value);
    header = validateBackupHeader(headerRecord);
    sourceChain = await extendProjectBackupRecordChain(sourceChain, await digestProjectBackupRecord(headerRecord));
    sourceRecordCount = 1;
    project = { id: makeId(), ...header.project, updatedAt: Date.now(), restoringSince: Date.now() };
    assess = evidenceReader({ projectId: project.id, sourceProjectId: header.projectId }, false);
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').add(project!); });
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const record = parseBackupLine(next.value);
      if (seenManifest) throw new Error('The project backup contains records after its manifest.');
      if (seenMigration && record.type !== 'migration' && record.type !== 'manifest') {
        throw new Error('The project backup contains data records after its migration history.');
      }
      if (record.type === 'manifest') {
        if (header.version !== PROJECT_BACKUP_VERSION) throw new Error('A legacy project backup cannot contain a v9 manifest.');
        const manifest = validateProjectBackupManifest(record);
        if (manifest.recordCount !== sourceRecordCount || manifest.recordChainHash !== sourceChain
          || !backupRecordCountsMatch(manifest.recordCounts, sourceRecordCounts)) {
          throw new Error('The project backup manifest does not match the validated records.');
        }
        seenManifest = true;
        continue;
      }
      if (record.type === 'session') {
        if (seenMemory) throw new Error('The project backup puts session records after memory records.');
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        if (sessionCount >= header.sessionCount) throw new Error('The project backup contains extra sessions.');
        activeSession = validateBackupSession(record.data, project.id);
        expectedVersion = 1;
        await withTransaction(['sessions'], 'readwrite', async transaction => { transaction.objectStore('sessions').add(activeSession!); });
        sessionCount++;
      } else if (record.type === 'revision') {
        if (seenMemory) throw new Error('The project backup puts history records after memory records.');
        if (!activeSession || expectedVersion > activeSession.currentVersion || revisionCount >= header.revisionCount) {
          throw new Error('The project backup contains unexpected history records.');
        }
        await writeRestoredRevision(project.id, activeSession, record.data, expectedVersion);
        const revisionData = record.data as Record<string, unknown>;
        if (expectedVersion === activeSession.currentVersion
          && (activeSession.fingerprint !== revisionData.fingerprint || activeSession.messageCount !== revisionData.messageCount)) {
          throw new Error('The project backup current revision does not match its session.');
        }
        expectedVersion++;
        revisionCount++;
      } else if (record.type === 'memory') {
        if (header.version < 2 || seenUpdates || seenClaims || !isRecord(record.data) || typeof record.fingerprint !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.fingerprint) || facts.length >= header.factCount) {
          throw new Error('The project backup contains unexpected memory records.');
        }
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        seenMemory = true;
        const fingerprint = await memoryBackupFingerprint(record.data as Omit<ProjectMemoryFact, 'key' | 'projectId'>);
        if (fingerprint !== record.fingerprint) throw new Error('A project memory record failed its integrity check.');
        facts.push(await validateBackupMemory(record.data, project.id, factIds, assess));
      } else if (record.type === 'update') {
        if (header.version < 6 || seenClaims || !isRecord(record.data) || typeof record.fingerprint !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.fingerprint) || updates.length >= header.updateCount) {
          throw new Error('The project backup contains an unexpected candidate update.');
        }
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        seenMemory = true;
        seenUpdates = true;
        if (await sha256Fingerprint(JSON.stringify(record.data)) !== record.fingerprint) throw new Error('A candidate update failed its integrity check.');
        const proposal = validateBackupUpdate(record.data, project.id, header.projectId ?? project.id, updateIds);
        const revision = await readEvidenceRevision(project.id, proposal.sessionId!, proposal.sessionVersion!);
        if (!revision) throw new Error('A candidate update cites a missing revision.');
        const sourceProjectId = proposal.sourceProjectId ?? header.projectId ?? project.id;
        const binding = proposal.messageFingerprint
          ? await assessEvidenceBinding({ id: proposal.id, kind: 'conversation', reference: proposal.evidenceReference,
            quote: proposal.evidenceQuote, projectId: project.id, sourceProjectId, sessionId: proposal.sessionId,
            version: proposal.sessionVersion, messageId: proposal.messageId, messageFingerprint: proposal.messageFingerprint,
            messageFingerprintVersion: proposal.messageFingerprintVersion, revisionFingerprint: proposal.revisionFingerprint,
            quoteFingerprint: proposal.quoteFingerprint, quoteByteRange: proposal.quoteByteRange,
            sourceIdentity: proposal.sourceIdentity, recordedAt: proposal.createdAt, verification: 'source-matched' },
          { projectId: project.id, sourceProjectId }, revision)
          : await bindNewConversationEvidence({ id: proposal.id, kind: 'conversation', reference: proposal.evidenceReference,
            quote: proposal.evidenceQuote, projectId: project.id, sourceProjectId, sessionId: proposal.sessionId,
            version: proposal.sessionVersion, messageId: proposal.messageId, recordedAt: proposal.createdAt,
            verification: 'source-matched' }, revision, sourceProjectId);
        if (binding.bindingStatus !== 'source_matched') throw new Error('A candidate update failed strict evidence binding.');
        Object.assign(proposal, { projectId: project.id, sourceProjectId,
          messageFingerprint: binding.messageFingerprint, messageFingerprintVersion: binding.messageFingerprintVersion,
          revisionFingerprint: binding.revisionFingerprint, quoteFingerprint: binding.quoteFingerprint,
          quoteByteRange: binding.quoteByteRange, sourceIdentity: binding.sourceIdentity });
        updates.push(proposal);
      } else if (record.type === 'claim') {
        if (header.version < 7 || !isRecord(record.data) || typeof record.fingerprint !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.fingerprint) || claims.length >= header.claimCount
          || await sha256Fingerprint(JSON.stringify(record.data)) !== record.fingerprint) {
          throw new Error('The project backup contains an invalid task claim event.');
        }
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        seenMemory = true;
        seenUpdates = true;
        seenClaims = true;
        const sourceProjectId = header.projectId ?? project.id;
        const claim = validateTaskClaimEvent(record.data, sourceProjectId);
        if (claimIds.has(claim.id)) throw new Error('The project backup contains duplicate task claim events.');
        claimIds.add(claim.id);
        claims.push({ ...claim, key: `${project.id}\0${claim.id}`, projectId: project.id });
      } else if (record.type === 'trust_state') {
        if (header.version < 8 || seenTrustState || trustEvents.length || !isRecord(record.data)
          || typeof record.fingerprint !== 'string' || await sha256Fingerprint(JSON.stringify(record.data)) !== record.fingerprint
          || !header.projectId || header.trustStateCount !== 1) {
          throw new Error('The project backup contains an invalid trust-state record.');
        }
        trustState = await validateBackupTrustState(record.data, project.id, header.projectId);
        seenTrustState = true;
      } else if (record.type === 'trust_event') {
        if (header.version < 8 || !trustState || !isRecord(record.data) || typeof record.fingerprint !== 'string'
          || await sha256Fingerprint(JSON.stringify(record.data)) !== record.fingerprint
          || record.data.projectId !== header.projectId
          || !Number.isSafeInteger(record.data.sequence) || !isRecord(record.data.event)
          || record.data.sequence !== trustEvents.length + 1 || record.data.event.sequence !== record.data.sequence) {
          throw new Error('The project backup contains an invalid signed trust event.');
        }
        trustEvents.push({ key: [project.id, record.data.sequence as number], projectId: project.id,
          sequence: record.data.sequence as number, event: record.data.event as unknown as SignedTrustEvent });
      } else if (record.type === 'migration') {
        if (header.version !== PROJECT_BACKUP_VERSION || !header.projectId || !isRecord(record.data)
          || typeof record.fingerprint !== 'string' || await sha256Fingerprint(JSON.stringify(record.data)) !== record.fingerprint
          || migrationEvents.length >= header.migrationCount) {
          throw new Error('The project backup contains an invalid migration record.');
        }
        const migration = await validateProjectBackupMigration(record.data, header.projectId);
        if (migrationIds.has(migration.id)) throw new Error('The project backup contains duplicate migration records.');
        migrationIds.add(migration.id);
        migrationEvents.push({ ...migration, projectId: project.id, key: [project.id, migration.id] });
        seenMigration = true;
      } else throw new Error('The project backup contains an unknown record type.');
      sourceChain = await extendProjectBackupRecordChain(sourceChain, await digestProjectBackupRecord(record));
      sourceRecordCount++;
      incrementBackupRecordCount(sourceRecordCounts, record.type);
    }
    if (activeSession && expectedVersion <= activeSession.currentVersion
      || sessionCount !== header.sessionCount || revisionCount !== header.revisionCount || facts.length !== header.factCount
      || updates.length !== header.updateCount || claims.length !== header.claimCount
      || trustEvents.length !== header.trustEventCount || (trustState ? 1 : 0) !== header.trustStateCount
      || migrationEvents.length !== header.migrationCount || header.version === PROJECT_BACKUP_VERSION && !seenManifest) {
      throw new Error('The project backup is incomplete.');
    }
    if (trustState) {
      const verification = await verifyTrustEventChain(trustEvents.map(record => record.event), trustedPublicKeySet(trustState));
      if (verification.head.sequence !== trustState.sequence || verification.head.eventHash !== trustState.headHash
        || verification.head.sequence !== trustEvents.length || !verification.activeKeyIds.includes(trustState.activeKeyId)) {
        throw new Error('The project backup trust chain does not match its saved trust state.');
      }
    }
    const factsById = new Map(facts.map(fact => [fact.id, fact]));
    for (const fact of facts) {
      if (fact.conflictsWith.some(id => !factsById.get(id)?.conflictsWith.includes(fact.id))
        || fact.supersedes && factsById.get(fact.supersedes)?.supersededBy !== fact.id
        || fact.supersededBy && factsById.get(fact.supersededBy)?.supersedes !== fact.id
        || fact.reconsiders && (!factsById.get(fact.reconsiders)
          || !isTerminalMemoryStatus(factsById.get(fact.reconsiders)!.status))) {
        throw new Error('The project backup contains inconsistent memory relationships.');
      }
    }
    for (const update of updates) if (update.status === 'accepted' || update.status === 'revoked') {
      const fact = update.acceptedFactId ? factsById.get(update.acceptedFactId) : undefined;
      if (!fact || update.status === 'revoked' && !['rejected', 'superseded', 'expired', 'revoked'].includes(fact.status)
        || update.status === 'accepted' && !['confirmed', 'needs-review'].includes(fact.status)) {
        throw new Error('A candidate update status does not match its project fact.');
      }
    }
    const claimHistory: ProjectTaskClaimEvent[] = [];
    for (const claim of claims) {
      const task = factsById.get(claim.taskId);
      if (!task || task.category !== 'task') throw new Error('A task claim refers to an unknown project task.');
      validateTaskClaimTransition(claim, claimHistory, claim.createdAt);
      claimHistory.push(claim);
    }
    for (const update of updates) if (update.taskId) {
      const task = factsById.get(update.taskId);
      if (!task || task.category !== 'task' || !update.claimId
        || !taskClaimHeldAt(claimHistory, update.claimId, update.taskId, update.client, update.createdAt)) {
        throw new Error('A task result update does not match its recorded task claim.');
      }
    }
    const activeClaims = [...latestTaskClaimEvents(claims).values()].filter(claim => claim.action !== 'released' && (claim.expiresAt ?? 0) > Date.now());
    if (activeClaims.some((claim, index) => activeClaims.slice(index + 1).some(other => other.taskId === claim.taskId))) {
      throw new Error('The project backup contains multiple active claims for one task.');
    }
    const migration = await createProjectBackupMigration(project.id, header.projectId, header.version,
      sourceChain, header.version === PROJECT_BACKUP_VERSION ? 'manifest-verified' : 'record-validated',
      sourceRecordCounts, Date.now());
    if (migrationIds.has(migration.id)) throw new Error('The project backup migration would duplicate a prior migration event.');
    migrationEvents.push({ ...migration, key: [project.id, migration.id] });
    await withTransaction(['memory', 'updates', 'claims'], 'readwrite', async transaction => {
      const memory = transaction.objectStore('memory');
      for (const fact of facts) memory.add(fact);
      const updateStore = transaction.objectStore('updates');
      for (const update of updates) updateStore.add(update);
      const claimStore = transaction.objectStore('claims');
      for (const claim of claims) claimStore.add(claim);
    });
    if (trustState) await withTransaction(['projectTrust', 'trustEvents'], 'readwrite', async transaction => {
      transaction.objectStore('projectTrust').add(trustState!);
      const trustStore = transaction.objectStore('trustEvents');
      for (const event of trustEvents) trustStore.add(event);
    });
    const completed = { ...project, migrationHistory: migrationEvents, restoringSince: undefined, updatedAt: Date.now() };
    delete completed.restoringSince;
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').put(completed); });
    return completed;
  } catch (error) {
    if (project) {
      try {
        await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims', 'projectTrust', 'deviceKeys', 'trustEvents', 'trustAnchors'],
          'readwrite', transaction => removeProjectRows(transaction, project!.id));
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Project restore failed and its staging data could not be fully removed.');
      }
    }
    throw error;
  } finally { await iterator.return(undefined).catch(() => {}); }
}
