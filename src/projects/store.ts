import type { SourcePlatform } from '../core';
import { searchPattern } from '../preview';
import { sha256Fingerprint } from '../handoff-draft';

const DATABASE_NAME = 'threadpack-project-library';
const DATABASE_VERSION = 1;
const RESTORE_STALE_AFTER = 24 * 60 * 60 * 1000;
const MAX_REVISION_BYTES = 200 * 1024 * 1024;
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

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Local project storage is unavailable in this browser.'));
  if (!databasePromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        const sessions = db.createObjectStore('sessions', { keyPath: 'key' });
        sessions.createIndex('projectId', 'projectId');
        sessions.createIndex('projectSessionKey', ['projectId', 'sessionKey'], { unique: true });
        sessions.createIndex('projectUpdatedAt', ['projectId', 'updatedAt']);
        const revisions = db.createObjectStore('revisions', { keyPath: 'key' });
        revisions.createIndex('projectId', 'projectId');
        revisions.createIndex('projectSession', ['projectId', 'sessionId']);
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
  const [sessionKeys, revisionKeys] = await Promise.all([
    idbRequest(sessions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
    idbRequest(revisions.index('projectId').getAllKeys(IDBKeyRange.only(projectId))),
  ]);
  for (const key of sessionKeys) sessions.delete(key);
  for (const key of revisionKeys) revisions.delete(key);
  projects.delete(projectId);
}

async function cleanAbandonedRestores(): Promise<void> {
  const cutoff = Date.now() - RESTORE_STALE_AFTER;
  await withTransaction(['projects', 'sessions', 'revisions'], 'readwrite', async transaction => {
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
    || encoder.encode(input.content).byteLength > MAX_REVISION_BYTES
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
      previous.updatedAt = now;
      sessions.put(previous);
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
  await withTransaction(['projects', 'sessions', 'revisions'], 'readwrite', transaction => removeProjectRows(transaction, projectId));
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

export async function getProjectSession(projectId: string, sessionId: string, version?: number): Promise<ProjectSessionContent> {
  return withTransaction(['sessions', 'revisions'], 'readonly', async transaction => {
    const session = await idbRequest<ProjectSessionRecord | undefined>(transaction.objectStore('sessions').get(`${projectId}\0${sessionId}`));
    if (!session || session.projectId !== projectId) throw new Error('This saved conversation is unavailable.');
    const selectedVersion = version ?? session.currentVersion;
    const revision = await idbRequest<RevisionRecord | undefined>(transaction.objectStore('revisions').get([projectId, sessionId, selectedVersion]));
    if (!revision || revision.fingerprint !== await sha256Fingerprint(revision.content)) throw new Error('This project history entry failed its integrity check.');
    const snapshot = inspectSnapshot(revision.content);
    if (snapshot.messageCount !== revision.messageCount || selectedVersion === session.currentVersion
      && (revision.fingerprint !== session.fingerprint || revision.title !== session.title || revision.platform !== session.platform
        || revision.messageCount !== session.messageCount || revision.sourceName !== session.sourceName)) {
      throw new Error('This project history entry failed its structure check.');
    }
    return { summary: session, version: selectedVersion, sourceName: revision.sourceName, content: revision.content };
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

async function* backupLines(projectId: string): AsyncGenerator<string> {
  const project = await withTransaction(['projects'], 'readonly', async transaction =>
    idbRequest<ProjectRecord | undefined>(transaction.objectStore('projects').get(projectId)));
  if (!project || project.restoringSince) throw new Error('This project is unavailable.');
  const sessions = await withTransaction(['sessions'], 'readonly', async transaction =>
    idbRequest<ProjectSessionRecord[]>(transaction.objectStore('sessions').index('projectId').getAll(IDBKeyRange.only(projectId))));
  let revisionCount = 0;
  for (const session of sessions) revisionCount += session.currentVersion;
  yield JSON.stringify({ type: 'threadpack_project', version: 1, createdAt: Date.now(), project: {
    name: project.name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt, updatedAt: project.updatedAt,
  }, sessionCount: sessions.length, revisionCount }) + '\n';
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
        if (pending.length > MAX_REVISION_BYTES * 2) throw new Error('A project backup record exceeds the supported size.');
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

function validateBackupHeader(value: Record<string, unknown>): { project: Omit<ProjectRecord, 'id' | 'restoringSince'>; sessionCount: number; revisionCount: number } {
  const project = value.project;
  if (value.type !== 'threadpack_project' || value.version !== 1 || !isRecord(project)
    || !Number.isSafeInteger(value.createdAt)
    || typeof project.name !== 'string' || typeof project.summary !== 'string' || typeof project.importantNotes !== 'string'
    || !Number.isSafeInteger(project.createdAt) || !Number.isSafeInteger(project.updatedAt)
    || typeof value.sessionCount !== 'number' || !Number.isSafeInteger(value.sessionCount) || value.sessionCount < 0
    || typeof value.revisionCount !== 'number' || !Number.isSafeInteger(value.revisionCount) || value.revisionCount < 0
    || value.sessionCount > value.revisionCount || value.revisionCount > 1_000_000) {
    throw new Error('This project backup has an unsupported or invalid header.');
  }
  const name = normalizeName(project.name);
  if (project.summary.length > 10000 || project.importantNotes.length > 20000) throw new Error('The project backup contains oversized project notes.');
  return {
    project: { name, summary: project.summary, importantNotes: project.importantNotes, createdAt: project.createdAt as number, updatedAt: project.updatedAt as number },
    sessionCount: value.sessionCount, revisionCount: value.revisionCount,
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
  if (encoder.encode(value.content).byteLength > MAX_REVISION_BYTES || await sha256Fingerprint(value.content) !== value.fingerprint) {
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
        if (activeSession && expectedVersion <= activeSession.currentVersion) throw new Error('The project backup has an incomplete conversation history.');
        if (sessionCount >= header.sessionCount) throw new Error('The project backup contains extra sessions.');
        activeSession = validateBackupSession(record.data, project.id);
        expectedVersion = 1;
        await withTransaction(['sessions'], 'readwrite', async transaction => { transaction.objectStore('sessions').add(activeSession!); });
        sessionCount++;
      } else if (record.type === 'revision') {
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
      } else throw new Error('The project backup contains an unknown record type.');
    }
    if (activeSession && expectedVersion <= activeSession.currentVersion
      || sessionCount !== header.sessionCount || revisionCount !== header.revisionCount) {
      throw new Error('The project backup is incomplete.');
    }
    const completed = { ...project, restoringSince: undefined, updatedAt: Date.now() };
    delete completed.restoringSince;
    await withTransaction(['projects'], 'readwrite', async transaction => { transaction.objectStore('projects').put(completed); });
    return completed;
  } catch (error) {
    if (project) await withTransaction(['projects', 'sessions', 'revisions'], 'readwrite', transaction => removeProjectRows(transaction, project!.id)).catch(() => {});
    throw error;
  } finally { await iterator.return(undefined).catch(() => {}); }
}
