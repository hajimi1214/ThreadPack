import type { SourcePlatform } from '../core';
import { searchPattern } from '../preview';
import { sha256Fingerprint } from '../handoff-draft';
import type { EvidenceKind, MemoryCategory, MemoryEvidence, MemoryEvidenceInput, MemoryOrigin, MemoryStatus, MemoryStatusChange, ProjectMemoryFact, ProjectMemoryInput, TaskState } from './memory-types';
import { MAX_PROJECT_SESSION_BYTES } from './limits';

const DATABASE_NAME = 'threadpack-project-library';
const DATABASE_VERSION = 2;
const RESTORE_STALE_AFTER = 24 * 60 * 60 * 1000;
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

const MEMORY_CATEGORIES: MemoryCategory[] = ['goal', 'decision', 'constraint', 'task', 'risk', 'open-question'];
const MEMORY_STATUSES: MemoryStatus[] = ['proposed', 'confirmed', 'needs-review', 'rejected', 'superseded'];
const EVIDENCE_KINDS: EvidenceKind[] = ['conversation', 'repository', 'test', 'user'];
const TASK_STATES: TaskState[] = ['not-started', 'in-progress', 'done', 'blocked', 'unclear'];

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
  const [sessionKeys, revisionKeys, memoryKeys] = await Promise.all([
    idbRequest(sessions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(revisions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(memory.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
  ]);
  for (const key of sessionKeys) sessions.delete(key);
  for (const key of revisionKeys) revisions.delete(key);
  for (const key of memoryKeys) memory.delete(key);
  projects.delete(projectId);
}

async function cleanAbandonedRestores(): Promise<void> {
  const cutoff = Date.now() - RESTORE_STALE_AFTER;
  await withTransaction(['projects', 'sessions', 'revisions', 'memory'], 'readwrite', async transaction => {
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
    || encoder.encode(input.content).byteLength > MAX_PROJECT_SESSION_BYTES
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
      project.updatedAt = now;
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
    project.updatedAt = now;
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
    Object.assign(project, next, { updatedAt: Date.now() });
    store.put(project);
    return project;
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await withTransaction(['projects', 'sessions', 'revisions', 'memory'], 'readwrite', transaction => removeProjectRows(transaction, projectId));
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
    project.updatedAt = now;
    projects.put(project);
    return { projectId, sessionId, version: nextVersion, duplicate: false };
  });
}

function normalizeMemoryTopic(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function findSnapshotMessage(content: string, messageId: string): { id: string; role: string; timestamp?: string; content: string } | null {
  let offset = 0;
  while (offset < content.length) {
    const end = content.indexOf('\n', offset);
    const line = content.slice(offset, end < 0 ? content.length : end).replace(/\r$/, '');
    offset = end < 0 ? content.length : end + 1;
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { throw new Error('The cited project history contains invalid JSON.'); }
    if (!isRecord(record)) continue;
    const message = record.type === 'threadpack_message' && isRecord(record.message) ? record.message : record;
    if (message.id !== messageId || typeof message.content !== 'string' || typeof message.role !== 'string') continue;
    return { id: messageId, role: message.role, content: message.content,
      ...(typeof message.timestamp === 'string' ? { timestamp: message.timestamp } : {}) };
  }
  return null;
}

async function prepareMemoryEvidence(projectId: string, input: MemoryEvidenceInput): Promise<MemoryEvidence> {
  if (!input || !EVIDENCE_KINDS.includes(input.kind) || typeof input.reference !== 'string' || input.reference.length > 1000
    || typeof input.quote !== 'undefined' && (typeof input.quote !== 'string' || input.quote.length > 1000)) {
    throw new Error('A memory evidence entry is invalid.');
  }
  const recordedAt = Date.now();
  if (input.kind === 'conversation') {
    if (typeof input.sessionId !== 'string' || typeof input.messageId !== 'string'
      || !Number.isSafeInteger(input.version) || (input.version as number) < 1) throw new Error('Select a saved conversation message as evidence.');
    const saved = await getProjectSession(projectId, input.sessionId, input.version);
    const message = findSnapshotMessage(saved.content, input.messageId);
    if (!message) throw new Error('The selected evidence message is unavailable in that saved version.');
    const quote = input.quote?.trim() || message.content.slice(0, 600);
    if (!quote || quote.length > 1000 || !message.content.includes(quote)) throw new Error('The evidence excerpt does not match the selected message.');
    return {
      id: makeId(), kind: input.kind,
      reference: `${saved.summary.title} · v${saved.version} · ${message.id}`,
      quote, sessionId: input.sessionId, version: input.version, messageId: input.messageId,
      messageFingerprint: await sha256Fingerprint(`${message.role}\0${message.timestamp ?? ''}\0${message.content}`),
      recordedAt, verification: 'source-matched',
    };
  }
  if (input.kind === 'user') return {
    id: makeId(), kind: input.kind, reference: input.reference || 'No source attached', quote: '', recordedAt,
    verification: 'unattached',
  };
  const commit = input.commit?.trim();
  if (!input.reference.trim() || !commit || !/^[a-f0-9]{7,64}$/i.test(commit) || !input.quote?.trim()) {
    throw new Error('Repository and test evidence need a commit ID and an exact excerpt or result.');
  }
  if (input.kind === 'test' && !input.command?.trim()) throw new Error('Test evidence needs the command that was run.');
  return {
    id: makeId(), kind: input.kind, reference: input.reference, quote: input.quote.trim(), commit,
    ...(input.command ? { command: input.command.trim().slice(0, 500) } : {}), recordedAt,
    verification: 'user-recorded',
  };
}

export async function listProjectMemory(projectId: string): Promise<ProjectMemoryFact[]> {
  if (typeof projectId !== 'string' || projectId.length > 200) throw new Error('This project is unavailable.');
  return withTransaction(['memory'], 'readonly', async transaction =>
    (await idbRequest<ProjectMemoryFact[]>(transaction.objectStore('memory').index('projectId').getAll(IDBKeyRange.only(projectId))))
      .sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function createProjectMemoryFact(projectId: string, input: ProjectMemoryInput): Promise<ProjectMemoryFact> {
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
  if (input.origin === 'ai' && evidence.some(item => item.verification !== 'source-matched')) {
    throw new Error('Every AI suggestion must cite selected conversation evidence.');
  }
  const id = makeId();
  return withTransaction(['projects', 'memory'], 'readwrite', async transaction => {
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
        project.updatedAt = now;
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
        project.updatedAt = now;
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
    project.updatedAt = now;
    projects.put(project);
    return fact;
  });
}

export async function updateProjectMemoryStatus(projectId: string, factId: string, status: 'confirmed' | 'needs-review' | 'rejected'): Promise<ProjectMemoryFact> {
  if (!MEMORY_STATUSES.includes(status)) throw new Error('Choose a valid memory review state.');
  return withTransaction(['projects', 'memory'], 'readwrite', async transaction => {
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
    memory.put(fact);
    project.updatedAt = fact.updatedAt;
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
  let revisionCount = 0;
  for (const session of sessions) revisionCount += session.currentVersion;
  yield JSON.stringify({ type: 'threadpack_project', version: 2, createdAt: Date.now(), project: {
    name: project.name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt, updatedAt: project.updatedAt,
  }, sessionCount: sessions.length, revisionCount, factCount: facts.length }) + '\n';
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
  version: 1 | 2;
  project: Omit<ProjectRecord, 'id' | 'restoringSince'>;
  sessionCount: number;
  revisionCount: number;
  factCount: number;
}

function validateBackupHeader(value: Record<string, unknown>): ProjectBackupHeader {
  const project = value.project;
  if (value.type !== 'threadpack_project' || value.version !== 1 && value.version !== 2 || !isRecord(project)
    || !Number.isSafeInteger(value.createdAt)
    || typeof project.name !== 'string' || typeof project.summary !== 'string' || typeof project.importantNotes !== 'string'
    || !Number.isSafeInteger(project.createdAt) || !Number.isSafeInteger(project.updatedAt)
    || typeof value.sessionCount !== 'number' || !Number.isSafeInteger(value.sessionCount) || value.sessionCount < 0
    || typeof value.revisionCount !== 'number' || !Number.isSafeInteger(value.revisionCount) || value.revisionCount < 0
    || value.sessionCount > value.revisionCount || value.revisionCount > 1_000_000
    || value.version === 2 && (!Number.isSafeInteger(value.factCount) || (value.factCount as number) < 0 || (value.factCount as number) > 100_000)) {
    throw new Error('This project backup has an unsupported or invalid header.');
  }
  const name = normalizeName(project.name);
  if (project.summary.length > 10000 || project.importantNotes.length > 20000) throw new Error('The project backup contains oversized project notes.');
  return {
    project: { name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt as number, updatedAt: project.updatedAt as number },
    version: value.version,
    sessionCount: value.sessionCount, revisionCount: value.revisionCount,
    factCount: value.version === 2 ? value.factCount as number : 0,
  };
}

async function memoryBackupFingerprint(data: Omit<ProjectMemoryFact, 'key' | 'projectId'>): Promise<string> {
  return sha256Fingerprint(JSON.stringify(data));
}

async function validateBackupMemory(value: unknown, projectId: string, factIds: Set<string>): Promise<ProjectMemoryFact> {
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
  for (const candidate of value.evidence) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 200
      || !EVIDENCE_KINDS.includes(candidate.kind as EvidenceKind)
      || typeof candidate.reference !== 'string' || candidate.reference.length > 1000
      || typeof candidate.quote !== 'string' || candidate.quote.length > 1000
      || !Number.isSafeInteger(candidate.recordedAt)
      || !['source-matched', 'user-recorded', 'unattached'].includes(candidate.verification as string)) {
      throw new Error('The project backup contains invalid memory evidence.');
    }
    if (candidate.kind === 'conversation') {
      if (candidate.verification !== 'source-matched' || typeof candidate.sessionId !== 'string'
        || !Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1
        || typeof candidate.messageId !== 'string' || typeof candidate.messageFingerprint !== 'string'
        || !candidate.quote.trim()
        || !/^[a-f0-9]{64}$/.test(candidate.messageFingerprint)) throw new Error('The project backup contains invalid conversation evidence.');
      const saved = await getProjectSession(projectId, candidate.sessionId, candidate.version as number);
      const message = findSnapshotMessage(saved.content, candidate.messageId);
      if (!message || !message.content.includes(candidate.quote)
        || await sha256Fingerprint(`${message.role}\0${message.timestamp ?? ''}\0${message.content}`) !== candidate.messageFingerprint) {
        throw new Error('A memory citation does not match its saved conversation.');
      }
    } else if (candidate.kind === 'user') {
      if (candidate.verification !== 'unattached') throw new Error('The project backup contains invalid user evidence.');
    } else if (candidate.verification !== 'user-recorded' || typeof candidate.commit !== 'string'
      || !/^[a-f0-9]{7,64}$/i.test(candidate.commit) || !candidate.quote.trim()
      || candidate.kind === 'test' && (typeof candidate.command !== 'string' || !candidate.command.trim())) {
      throw new Error('The project backup contains invalid repository or test evidence.');
    }
    evidence.push({
      id: candidate.id, kind: candidate.kind as EvidenceKind, reference: candidate.reference,
      quote: candidate.quote, recordedAt: candidate.recordedAt as number,
      verification: candidate.verification as MemoryEvidence['verification'],
      ...(typeof candidate.sessionId === 'string' ? { sessionId: candidate.sessionId } : {}),
      ...(typeof candidate.version === 'number' ? { version: candidate.version } : {}),
      ...(typeof candidate.messageId === 'string' ? { messageId: candidate.messageId } : {}),
      ...(typeof candidate.messageFingerprint === 'string' ? { messageFingerprint: candidate.messageFingerprint } : {}),
      ...(typeof candidate.commit === 'string' ? { commit: candidate.commit } : {}),
      ...(typeof candidate.command === 'string' ? { command: candidate.command } : {}),
    });
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
  if (encoder.encode(value.content).byteLength > MAX_PROJECT_SESSION_BYTES || await sha256Fingerprint(value.content) !== value.fingerprint) {
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
  const facts: ProjectMemoryFact[] = [];
  const factIds = new Set<string>();
  try {
    const first = await iterator.next();
    if (first.done) throw new Error('The project backup is empty.');
    header = validateBackupHeader(parseBackupLine(first.value));
    project = { id: makeId(), ...header.project, updatedAt: Date.now(), restoringSince: Date.now() };
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
        if (header.version !== 2 || !isRecord(record.data) || typeof record.fingerprint !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.fingerprint) || facts.length >= header.factCount) {
          throw new Error('The project backup contains unexpected memory records.');
        }
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        seenMemory = true;
        const fingerprint = await memoryBackupFingerprint(record.data as Omit<ProjectMemoryFact, 'key' | 'projectId'>);
        if (fingerprint !== record.fingerprint) throw new Error('A project memory record failed its integrity check.');
        facts.push(await validateBackupMemory(record.data, project.id, factIds));
      } else throw new Error('The project backup contains an unknown record type.');
    }
    if (activeSession && expectedVersion <= activeSession.currentVersion
      || sessionCount !== header.sessionCount || revisionCount !== header.revisionCount || facts.length !== header.factCount) {
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
    if (facts.length) await withTransaction(['memory'], 'readwrite', async transaction => {
      const memory = transaction.objectStore('memory');
      for (const fact of facts) memory.add(fact);
    });
    const completed = { ...project, restoringSince: undefined, updatedAt: Date.now() };
    delete completed.restoringSince;
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').put(completed); });
    return completed;
  } catch (error) {
    if (project) await withTransaction(['projects', 'sessions', 'revisions', 'memory'], 'readwrite', transaction => removeProjectRows(transaction, project!.id)).catch(() => {});
    throw error;
  } finally { await iterator.return(undefined).catch(() => {}); }
}
