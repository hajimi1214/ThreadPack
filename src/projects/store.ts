import type { SourcePlatform } from '../core';
import { searchPattern } from '../preview';
import { sha256Fingerprint } from '../handoff-draft';
import type { EvidenceKind, EvidenceRelation, MemoryCategory, MemoryEvidence, MemoryEvidenceInput, MemoryOrigin, MemoryStatus, MemoryStatusChange, ProjectMemoryFact, ProjectMemoryInput, ProjectTaskClaim, ProjectTaskClaimAction, ProjectTaskClaimEvent, ProjectUpdateAction, ProjectUpdateAuditEntry, ProjectUpdateProposal, ProjectUpdateStatus, ProjectUpdateStatusChange, TaskState } from './memory-types';
import {
  assessEvidenceBinding, bindNewConversationEvidence, canAttestEvidenceRelation, createEvidenceRelationEvent, invalidEvidenceBinding,
  indexEvidenceMessages, validateEvidenceRelation,
} from './evidence-binding';
import type { EvidenceScope, IndexedEvidenceRevision } from './evidence-binding';
import type { EvidenceBindingIssue } from './memory-types';
import { MAX_PROJECT_SESSION_BYTES, MAX_SHARED_PROJECT_BACKUP_BYTES, utf8ByteLength } from './limits';

const DATABASE_NAME = 'threadpack-project-library';
const DATABASE_VERSION = 5;
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
  restoringSince?: number;
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

const MEMORY_CATEGORIES: MemoryCategory[] = ['goal', 'decision', 'constraint', 'task', 'risk', 'open-question'];
const MEMORY_STATUSES: MemoryStatus[] = ['proposed', 'confirmed', 'needs-review', 'rejected', 'superseded'];
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

function appendStatusChange(fact: ProjectMemoryFact, status: MemoryStatus, changedAt: number): void {
  const history = fact.statusHistory ?? [{ status: fact.status, changedAt: fact.createdAt }];
  if (history.at(-1)?.status === status) {
    fact.statusHistory = history;
    return;
  }
  fact.statusHistory = [...history, { status, changedAt }];
}

function readStatusHistory(value: unknown, status: MemoryStatus, createdAt: number): MemoryStatusChange[] {
  if (value === undefined) return [{ status, changedAt: createdAt }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('The project backup contains an invalid memory status history.');
  const history = value.map(item => {
    if (!isRecord(item) || !MEMORY_STATUSES.includes(item.status as MemoryStatus) || !Number.isSafeInteger(item.changedAt)) {
      throw new Error('The project backup contains an invalid memory status history.');
    }
    return { status: item.status as MemoryStatus, changedAt: item.changedAt as number };
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
  const [sessionKeys, revisionKeys, memoryKeys] = await Promise.all([
    idbRequest(sessions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(revisions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(memory.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
  ]);
  for (const key of sessionKeys) sessions.delete(key);
  for (const key of revisionKeys) revisions.delete(key);
  for (const key of memoryKeys) memory.delete(key);
  shared.delete(projectId);
  const updateKeys = await idbRequest(updates.index('projectId').getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of updateKeys) updates.delete(key);
  const claimKeys = await idbRequest(claims.index('projectId').getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of claimKeys) claims.delete(key);
  projects.delete(projectId);
}

async function cleanAbandonedRestores(): Promise<void> {
  const cutoff = Date.now() - RESTORE_STALE_AFTER;
  await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims'], 'readwrite', async transaction => {
    const projects = await idbRequest<ProjectRecord[]>(transaction.objectStore('projects').getAll());
    for (const project of projects) {
      if (project.restoringSince && project.restoringSince < cutoff) await removeProjectRows(transaction, project.id);
    }
  });
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
      .filter(project => !project.restoringSince)
      .sort((a, b) => b.updatedAt - a.updatedAt));
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
  await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims'], 'readwrite', transaction => removeProjectRows(transaction, projectId));
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

function evidenceReader(scope: EvidenceScope, allowLocalAttestation = true) {
  // Keep one revision index while reading adjacent citations without retaining every session's history.
  let cached: { key: string; revision?: IndexedEvidenceRevision } | undefined;
  return async (evidence: MemoryEvidence, fact: ProjectMemoryFact) => {
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
    return validateEvidenceRelation(fact, evidence, binding, allowLocalAttestation);
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

export async function listProjectMemory(projectId: string): Promise<ProjectMemoryFact[]> {
  if (typeof projectId !== 'string' || projectId.length > 200) throw new Error('This project is unavailable.');
  const facts = await withTransaction(['memory'], 'readonly', transaction =>
    idbRequest<ProjectMemoryFact[]>(transaction.objectStore('memory').index('projectId').getAll(IDBKeyRange.only(projectId))));
  const assess = evidenceReader({ projectId, sourceProjectId: projectId });
  for (const fact of facts) {
    const evidence: MemoryEvidence[] = [];
    for (const citation of fact.evidence) evidence.push(await assess(citation, fact));
    fact.evidence = evidence;
  }
  return facts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateProjectMemoryEvidenceRelation(
  projectId: string, factId: string, evidenceId: string, relation: EvidenceRelation,
): Promise<ProjectMemoryFact> {
  if (!['supports', 'contradicts', 'context_only', 'insufficient', 'unverified'].includes(relation)) {
    throw new Error('Choose a valid evidence relationship.');
  }
  const before = await withTransaction(['projects', 'memory'], 'readonly', async transaction => {
    const project = await idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(transaction.objectStore('memory').get(`${projectId}\0${factId}`));
    if (!project || project.restoringSince || !fact || fact.status === 'rejected' || fact.status === 'superseded') {
      throw new Error('This project memory entry is unavailable for evidence review.');
    }
    const evidence = fact.evidence.find(item => item.id === evidenceId);
    if (!evidence) throw new Error('This evidence entry is unavailable.');
    return { project, fact, evidence: { ...evidence } };
  });
  const assessed = await evidenceReader({ projectId, sourceProjectId: projectId })(before.evidence, before.fact);
  if (relation !== 'unverified' && !canAttestEvidenceRelation(assessed)) {
    throw new Error('This evidence source is unavailable for a user relationship review.');
  }
  const changedAt = Date.now();
  const resetInvalidHistory = assessed.bindingIssue === 'relation_mismatch';
  const event = await createEvidenceRelationEvent(before.fact, assessed, relation, makeId(), changedAt);
  return withTransaction(['projects', 'memory'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${factId}`));
    if (!project || project.restoringSince || !fact || fact.updatedAt !== before.fact.updatedAt
      || fact.status === 'rejected' || fact.status === 'superseded') {
      throw new Error('This project memory entry changed during evidence review. Reopen it and try again.');
    }
    const evidence = fact.evidence.find(item => item.id === evidenceId);
    if (!evidence || JSON.stringify(evidence) !== JSON.stringify(before.evidence)) {
      throw new Error('This evidence entry changed during review. Reopen it and try again.');
    }
    Object.assign(evidence, assessed, {
      relation: event.relation, relationBasis: event.relationBasis,
      relationHistory: [...(resetInvalidHistory ? [] : evidence.relationHistory ?? []), event],
      ...(resetInvalidHistory || evidence.legacyRelationHistory?.length
        ? { legacyRelationHistory: [...(evidence.legacyRelationHistory ?? []), ...(resetInvalidHistory ? evidence.relationHistory ?? [] : [])] }
        : {}),
    });
    fact.updatedAt = changedAt;
    memory.put(fact);
    touchProject(project, changedAt);
    projects.put(project);
    return fact;
  });
}

async function createProjectMemoryFactInternal(projectId: string, input: ProjectMemoryInput): Promise<ProjectMemoryFact> {
  if (!input || !MEMORY_CATEGORIES.includes(input.category) || !['user', 'ai'].includes(input.origin)
    || !MEMORY_STATUSES.includes(input.status) || typeof input.topic !== 'string' || !input.topic.trim()
    || input.topic.length > 160 || typeof input.statement !== 'string' || !input.statement.trim()
    || input.statement.length > 4000 || !Array.isArray(input.evidence) || input.evidence.length > 5
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
      statement: input.statement.trim(), origin: input.origin, status: input.status,
      statusHistory: [{ status: input.status, changedAt: now }],
      ...(input.category === 'task' ? { taskState: input.taskState ?? 'unclear' } : {}),
      evidence, conflictsWith: [], createdAt: now, updatedAt: now,
    };
    let matching: ProjectMemoryFact[] = [];
    if (input.supersedes) {
      if (typeof input.supersedes !== 'string' || input.supersedes.length > 200) throw new Error('The fact to supersede is invalid.');
      const previous = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${input.supersedes}`));
      if (!previous || previous.status === 'rejected' || previous.status === 'superseded') throw new Error('The selected previous fact is unavailable.');
      previous.status = 'superseded';
      appendStatusChange(previous, 'superseded', now);
      previous.supersededBy = fact.id;
      previous.updatedAt = now;
      await revokeAcceptedProposals(transaction, projectId, previous.id, now);
      fact.supersedes = previous.id;
      for (const otherId of previous.conflictsWith) {
        const other = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${otherId}`));
        if (other) {
          other.conflictsWith = other.conflictsWith.filter(id => id !== previous.id);
          if (!other.conflictsWith.length && other.status === 'needs-review' && other.reviewStateBeforeConflict) {
            const restoredStatus = other.reviewStateBeforeConflict;
            other.status = restoredStatus;
            appendStatusChange(other, restoredStatus, now);
            delete other.reviewStateBeforeConflict;
          }
          other.updatedAt = now;
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
        && previous.status !== 'rejected' && previous.status !== 'superseded'
        && previous.statement.trim().normalize('NFKC').toLocaleLowerCase() === fact.statement.normalize('NFKC').toLocaleLowerCase()
        && previous.taskState === fact.taskState);
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
        sameUserFact.updatedAt = now;
        memory.put(sameUserFact);
        touchProject(project, now);
        projects.put(project);
        return sameUserFact;
      }
      const duplicateAIFact = input.origin === 'ai' && matching.find(previous => previous.status !== 'rejected'
        && previous.status !== 'superseded'
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
        memory.put(duplicateAIFact);
        touchProject(project, now);
        projects.put(project);
        return duplicateAIFact;
      }
    }
    const conflicts = matching.filter(previous => previous.id !== input.supersedes
      && previous.status !== 'rejected' && previous.status !== 'superseded'
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
        memory.put(previous);
      }
    }
    memory.add(fact);
    touchProject(project, now);
    projects.put(project);
    return fact;
  });
}

export async function createProjectMemoryFact(projectId: string, input: ProjectMemoryInput): Promise<ProjectMemoryFact> {
  return createProjectMemoryFactInternal(projectId, input);
}

export async function updateProjectMemoryStatus(projectId: string, factId: string, status: 'confirmed' | 'needs-review' | 'rejected'): Promise<ProjectMemoryFact> {
  if (!MEMORY_STATUSES.includes(status)) throw new Error('Choose a valid memory review state.');
  return withTransaction(['projects', 'memory', 'updates'], 'readwrite', async transaction => {
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${factId}`));
    if (!project || project.restoringSince || !fact) throw new Error('This project memory entry is unavailable.');
    if (fact.status === 'rejected' || fact.status === 'superseded') throw new Error('Rejected or superseded entries are read-only.');
    if (status === 'confirmed' && fact.conflictsWith.length) throw new Error('Resolve the listed conflicts before confirming this fact.');
    const now = Date.now();
    if (status === 'rejected') {
      for (const conflictId of fact.conflictsWith) {
        const conflict = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${conflictId}`));
        if (conflict) {
          conflict.conflictsWith = conflict.conflictsWith.filter(id => id !== fact.id);
          if (!conflict.conflictsWith.length && conflict.status === 'needs-review' && conflict.reviewStateBeforeConflict) {
            const restoredStatus = conflict.reviewStateBeforeConflict;
            conflict.status = restoredStatus;
            appendStatusChange(conflict, restoredStatus, now);
            delete conflict.reviewStateBeforeConflict;
          }
          conflict.updatedAt = now;
          memory.put(conflict);
        }
      }
      fact.conflictsWith = [];
      delete fact.reviewStateBeforeConflict;
    }
    fact.status = status;
    appendStatusChange(fact, status, now);
    fact.updatedAt = now;
    if (status === 'rejected') await revokeAcceptedProposals(transaction, projectId, fact.id, now);
    memory.put(fact);
    touchProject(project, fact.updatedAt);
    projects.put(project);
    return fact;
  });
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
  let revisionCount = 0;
  for (const session of sessions) revisionCount += session.currentVersion;
  yield JSON.stringify({ type: 'threadpack_project', version: 7, projectId, createdAt: Date.now(), project: {
    name: project.name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt, updatedAt: project.updatedAt,
  }, sessionCount: sessions.length, revisionCount, factCount: facts.length, updateCount: updates.length, claimCount: claims.length }) + '\n';
  for (const session of sessions) {
    yield JSON.stringify({ type: 'session', data: {
      id: session.id, sessionKey: session.sessionKey, title: session.title, sourceName: session.sourceName,
      platform: session.platform, ...(session.sourceId ? { sourceId: session.sourceId } : {}), format: session.format,
      messageCount: session.messageCount, fingerprint: session.fingerprint, currentVersion: session.currentVersion,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
    } }) + '\n';
    for (let version = 1; version <= session.currentVersion; version++) {
      const revision = await withTransaction(['revisions'], 'readonly', async transaction =>
        idbRequest<RevisionRecord | undefined>(transaction.objectStore('revisions').get([projectId, session.id, version])));
      if (!revision) throw new Error('Project history is incomplete. The backup was canceled.');
      yield JSON.stringify({ type: 'revision', data: {
        sessionId: session.id, version: revision.version, fingerprint: revision.fingerprint,
        content: revision.content, title: revision.title, platform: revision.platform,
        ...(revision.sourceId ? { sourceId: revision.sourceId } : {}), format: revision.format,
        messageCount: revision.messageCount, sourceName: revision.sourceName, createdAt: revision.createdAt,
      } }) + '\n';
    }
  }
  for (const fact of facts) {
    const { key: _key, projectId: _projectId, ...data } = fact;
    yield JSON.stringify({ type: 'memory', fingerprint: await memoryBackupFingerprint(data), data }) + '\n';
  }
  for (const update of updates) {
    const { key: _key, reviewingSince: _reviewingSince, ...record } = update;
    const exportRecord = { ...record, projectId };
    let data = exportRecord;
    if (exportRecord.status === 'reviewing') {
      const acceptedFact = facts.find(fact => matchesAcceptedProposalFact(fact, exportRecord));
      const status = !acceptedFact ? 'pending' : acceptedFact.status === 'rejected' || acceptedFact.status === 'superseded' ? 'revoked' : 'accepted';
      const changedAt = Math.max(Date.now(), exportRecord.statusHistory.at(-1)?.changedAt ?? 0);
      const action = status === 'pending' ? 'review-reopened' : status;
      data = { ...exportRecord, status, ...(acceptedFact ? { acceptedFactId: acceptedFact.id } : {}),
        statusHistory: [...exportRecord.statusHistory, { status, changedAt }],
        auditHistory: [...exportRecord.auditHistory, { action, actor: 'user', status, changedAt, snapshot: proposalSnapshot(exportRecord) }],
      };
    }
    yield JSON.stringify({ type: 'update', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data }) + '\n';
  }
  for (const claim of claims) {
    const { key: _key, ...record } = claim;
    const data = { ...record, projectId };
    yield JSON.stringify({ type: 'claim', fingerprint: await sha256Fingerprint(JSON.stringify(data)), data }) + '\n';
  }
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
    : acceptedFact.status === 'rejected' || acceptedFact.status === 'superseded' ? 'revoked' : 'accepted';
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
      const acceptedFact = await createProjectMemoryFactInternal(projectId, {
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
  const now = Date.now();
  await withTransaction(['updates', 'projects', 'memory'], 'readwrite', async transaction => {
    const updates = transaction.objectStore('updates');
    const projects = transaction.objectStore('projects');
    const memory = transaction.objectStore('memory');
    const current = await idbRequest<ProjectUpdateProposal | undefined>(updates.get(`${projectId}\0${proposalId}`));
    if (!current || current.status !== 'accepted' || !current.acceptedFactId) throw new Error('This accepted project update cannot be revoked.');
    const project = await idbRequest<ProjectRecord | undefined>(projects.get(projectId));
    const fact = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${current.acceptedFactId}`));
    if (!project || project.restoringSince || !fact || fact.status === 'rejected' || fact.status === 'superseded') throw new Error('The accepted project fact is unavailable for revocation.');
    current.status = 'reviewing';
    current.reviewingSince = now;
    current.statusHistory.push({ status: 'reviewing', changedAt: now });
    appendProposalAudit(current, 'review-started', 'user', now);
    fact.status = 'rejected';
    appendStatusChange(fact, 'rejected', now);
    fact.updatedAt = now;
    if (fact.conflictsWith.length) {
      for (const conflictId of fact.conflictsWith) {
        const conflict = await idbRequest<ProjectMemoryFact | undefined>(memory.get(`${projectId}\0${conflictId}`));
        if (conflict) {
          conflict.conflictsWith = conflict.conflictsWith.filter(id => id !== fact.id);
          if (!conflict.conflictsWith.length && conflict.status === 'needs-review' && conflict.reviewStateBeforeConflict) {
            const restoredStatus = conflict.reviewStateBeforeConflict;
            conflict.status = restoredStatus;
            appendStatusChange(conflict, restoredStatus, now);
            delete conflict.reviewStateBeforeConflict;
          }
          conflict.updatedAt = now;
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
      return publicSharedStatus(afterWrite, synced);
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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  projectId?: string;
  project: Omit<ProjectRecord, 'id' | 'restoringSince'>;
  sessionCount: number;
  revisionCount: number;
  factCount: number;
  updateCount: number;
  claimCount: number;
}

function validateBackupHeader(value: Record<string, unknown>): ProjectBackupHeader {
  const project = value.project;
  if (value.type !== 'threadpack_project' || value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6 && value.version !== 7 || !isRecord(project)
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
    || value.version === 7 && (!Number.isSafeInteger(value.claimCount) || (value.claimCount as number) < 0 || (value.claimCount as number) > 1_000_000)
    || value.version < 7 && value.claimCount !== undefined && value.claimCount !== 0) {
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
    claimCount: value.version === 7 ? value.claimCount as number : 0,
  };
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
    || value.taskState !== undefined && !TASK_STATES.includes(value.taskState as TaskState)
    || value.category !== 'task' && value.taskState !== undefined
    || value.statusHistory !== undefined && (!Array.isArray(value.statusHistory) || value.statusHistory.length < 1 || value.statusHistory.length > 100)
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
    ...(typeof value.taskState === 'string' ? { taskState: value.taskState as TaskState } : {}),
    ...(value.reviewStateBeforeConflict === 'confirmed' || value.reviewStateBeforeConflict === 'proposed'
      ? { reviewStateBeforeConflict: value.reviewStateBeforeConflict } : {}),
    ...(typeof value.supersedes === 'string' ? { supersedes: value.supersedes } : {}),
    ...(typeof value.supersededBy === 'string' ? { supersededBy: value.supersededBy } : {}),
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
  const facts: ProjectMemoryFact[] = [];
  const factIds = new Set<string>();
  const updates: ProjectUpdateProposal[] = [];
  const updateIds = new Set<string>();
  const claims: ProjectTaskClaimEvent[] = [];
  const claimIds = new Set<string>();
  let assess: ReturnType<typeof evidenceReader> | undefined;
  try {
    const first = await iterator.next();
    if (first.done) throw new Error('The project backup is empty.');
    header = validateBackupHeader(parseBackupLine(first.value));
    project = { id: makeId(), ...header.project, updatedAt: Date.now(), restoringSince: Date.now() };
    assess = evidenceReader({ projectId: project.id, sourceProjectId: header.projectId }, false);
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').add(project!); });
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const record = parseBackupLine(next.value);
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
        if (header.version !== 7 || !isRecord(record.data) || typeof record.fingerprint !== 'string'
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
      } else throw new Error('The project backup contains an unknown record type.');
    }
    if (activeSession && expectedVersion <= activeSession.currentVersion
      || sessionCount !== header.sessionCount || revisionCount !== header.revisionCount || facts.length !== header.factCount
      || updates.length !== header.updateCount || claims.length !== header.claimCount) {
      throw new Error('The project backup is incomplete.');
    }
    const factsById = new Map(facts.map(fact => [fact.id, fact]));
    for (const fact of facts) {
      if (fact.conflictsWith.some(id => !factsById.get(id)?.conflictsWith.includes(fact.id))
        || fact.supersedes && factsById.get(fact.supersedes)?.supersededBy !== fact.id
        || fact.supersededBy && factsById.get(fact.supersededBy)?.supersedes !== fact.id) {
        throw new Error('The project backup contains inconsistent memory relationships.');
      }
    }
    for (const update of updates) if (update.status === 'accepted' || update.status === 'revoked') {
      const fact = update.acceptedFactId ? factsById.get(update.acceptedFactId) : undefined;
      if (!fact || update.status === 'revoked' && fact.status !== 'rejected' && fact.status !== 'superseded'
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
    if (facts.length || updates.length || claims.length) await withTransaction(['memory', 'updates', 'claims'], 'readwrite', async transaction => {
      const memory = transaction.objectStore('memory');
      for (const fact of facts) memory.add(fact);
      const updateStore = transaction.objectStore('updates');
      for (const update of updates) updateStore.add(update);
      const claimStore = transaction.objectStore('claims');
      for (const claim of claims) claimStore.add(claim);
    });
    const completed = { ...project, restoringSince: undefined, updatedAt: Date.now() };
    delete completed.restoringSince;
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').put(completed); });
    return completed;
  } catch (error) {
    if (project) await withTransaction(['projects', 'sessions', 'revisions', 'memory', 'shared', 'updates', 'claims'], 'readwrite', transaction => removeProjectRows(transaction, project!.id)).catch(() => {});
    throw error;
  } finally { await iterator.return(undefined).catch(() => {}); }
}
