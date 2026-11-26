import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Check, Clock3, FileJson, FolderPlus, Inbox, Link2, LoaderCircle, RefreshCw, Search, ShieldCheck, Trash2, Unlink, Upload, X } from 'lucide-react';
import type { TranslationKey } from '../i18n';
import type { Lang } from '../i18n';
import {
  connectSharedProjectBackup, connectSharedProjectInbox, createProject, deleteProject, disconnectSharedProjectBackup, exportProjectBackup,
  getProjectSession, getSharedProjectBackupStatus, listProjectRevisions, listProjects, listProjectSessions,
  importSharedProjectUpdates, listProjectTaskClaims, listProjectUpdateProposals, reconnectSharedProjectBackup, recoverStaleProjectUpdateReviews, reviewProjectUpdateProposal,
  editProjectUpdateProposal, revokeAcceptedProjectUpdate, restoreProjectBackup, restoreProjectRevision,
  saveProjectSession, syncSharedProjectBackup, updateProject,
} from './store';
import type { ProjectRecord, ProjectRevisionSummary, ProjectSessionInput, ProjectSessionSummary, SharedProjectBackupStatus, SharedProjectFileHandle } from './store';
import type { ProjectTaskClaim, ProjectUpdateProposal } from './memory-types';
import ProjectMemoryPanel from './ProjectMemoryPanel';

interface ActiveSession { conversationId: string; title: string; messageCount: number }
interface Props {
  activeSession: ActiveSession | null;
  t: Record<TranslationKey, string>;
  lang: Lang;
  close: () => void;
  readActiveSession: (conversationId: string) => Promise<ProjectSessionInput>;
  openSession: (content: string, filename: string) => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
}

export default function ProjectLibrary({ activeSession, t, lang, close, readActiveSession, openSession, notify }: Props) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectReload, setProjectReload] = useState(0);
  const [sessions, setSessions] = useState<ProjectSessionSummary[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [summary, setSummary] = useState('');
  const [importantNotes, setImportantNotes] = useState('');
  const [historySessionId, setHistorySessionId] = useState('');
  const [history, setHistory] = useState<ProjectRevisionSummary[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sharedStatus, setSharedStatus] = useState<SharedProjectBackupStatus>({ connected: false, state: 'disconnected' });
  const [proposals, setProposals] = useState<ProjectUpdateProposal[]>([]);
  const [taskClaims, setTaskClaims] = useState<ProjectTaskClaim[]>([]);
  const [editingProposalId, setEditingProposalId] = useState('');
  const [editingProposalTopic, setEditingProposalTopic] = useState('');
  const [editingProposalStatement, setEditingProposalStatement] = useState('');
  const [editingProposalCategory, setEditingProposalCategory] = useState<ProjectUpdateProposal['category']>('decision');
  const [editingProposalTaskState, setEditingProposalTaskState] = useState<ProjectUpdateProposal['taskState']>('unclear');
  const [editingProposalEvidence, setEditingProposalEvidence] = useState('');
  const [editingProposalQuote, setEditingProposalQuote] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);
  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);
  function supportsLocalFilePicker(pickerName: 'showSaveFilePicker' | 'showOpenFilePicker') {
    const pickerWindow = window as Window & { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
    const handleConstructor = (globalThis as typeof globalThis & {
      FileSystemFileHandle?: { prototype?: Record<string, unknown> };
    }).FileSystemFileHandle;
    const handlePrototype = handleConstructor?.prototype;
    return window.isSecureContext && typeof pickerWindow[pickerName] === 'function'
      && typeof handlePrototype?.getFile === 'function'
      && typeof handlePrototype.createWritable === 'function'
      && typeof handlePrototype.queryPermission === 'function'
      && typeof handlePrototype.requestPermission === 'function';
  }
  const sharedFileAvailable = supportsLocalFilePicker('showSaveFilePicker');
  const inboxFileAvailable = supportsLocalFilePicker('showOpenFilePicker');

  async function refreshProjects(preferredId = selectedProjectId) {
    const next = await listProjects();
    setProjects(next);
    const nextId = next.some(project => project.id === preferredId) ? preferredId : next[0]?.id ?? '';
    setSelectedProjectId(nextId);
    setProjectReload(value => value + 1);
    setSharedStatus(nextId ? await syncSharedProjectBackup(nextId) : { connected: false, state: 'disconnected' });
  }

  async function refreshProjectMetadata(projectId: string) {
    const next = await listProjects();
    setProjects(next);
    if (next.some(project => project.id === projectId)) setSelectedProjectId(projectId);
    setProjectReload(value => value + 1);
    setSharedStatus(await syncSharedProjectBackup(projectId));
  }

  useEffect(() => {
    let active = true;
    void listProjects().then(value => { if (active) { setProjects(value); setSelectedProjectId(value[0]?.id ?? ''); } })
      .catch(value => { if (active) setError(value instanceof Error ? value.message : t.projectStorageError); });
    return () => { active = false; };
  }, [t.projectStorageError]);

  useEffect(() => {
    if (!selectedProjectId) { setSharedStatus({ connected: false, state: 'disconnected' }); return; }
    let active = true;
    void getSharedProjectBackupStatus(selectedProjectId).then(async current => {
      let latest = current.connected && current.state === 'out-of-date'
        ? await syncSharedProjectBackup(selectedProjectId) : current;
      const recovered = await recoverStaleProjectUpdateReviews(selectedProjectId);
      if (recovered) {
        if (current.connected) latest = await syncSharedProjectBackup(selectedProjectId);
        const [nextProjects, nextProposals] = await Promise.all([
          listProjects(), listProjectUpdateProposals(selectedProjectId),
        ]);
        if (active) { setProjects(nextProjects); setProposals(nextProposals); }
      }
      if (active) setSharedStatus(latest);
    }).catch(() => { if (active) setSharedStatus({ connected: true, state: 'error' }); });
    return () => { active = false; };
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) { setProposals([]); return; }
    let active = true;
    const load = async () => {
      const result = sharedStatus.inboxConnected
        ? await importSharedProjectUpdates(selectedProjectId)
        : { imported: 0, pending: 0, changed: false };
      const next = await listProjectUpdateProposals(selectedProjectId);
      const nextTaskClaims = await listProjectTaskClaims(selectedProjectId);
      if (active) {
        setProposals(next);
        setTaskClaims(nextTaskClaims);
        if (result.changed) {
          const status = await syncSharedProjectBackup(selectedProjectId);
          setSharedStatus(status);
          setProjects(await listProjects());
        }
      }
    };
    void load().catch(value => { if (active) setError(value instanceof Error ? value.message : t.projectStorageError); });
    const timer = sharedStatus.inboxConnected ? window.setInterval(() => { void load().catch(() => {}); }, 2000) : undefined;
    return () => { active = false; if (timer !== undefined) window.clearInterval(timer); };
  }, [selectedProjectId, sharedStatus.inboxConnected, projectReload, t.projectStorageError]);

  useEffect(() => {
    if (!selectedProject) { setProjectName(''); setSummary(''); setImportantNotes(''); return; }
    setProjectName(selectedProject.name);
    setSummary(selectedProject.summary);
    setImportantNotes(selectedProject.importantNotes);
    setConfirmDelete(false);
    setHistorySessionId('');
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) { setSessions([]); setSessionTotal(0); return; }
    let active = true;
    const timer = setTimeout(() => {
      void listProjectSessions(selectedProjectId, query).then(result => {
        if (active) { setSessions(result.sessions); setSessionTotal(result.total); }
      }).catch(value => { if (active) setError(value instanceof Error ? value.message : t.projectStorageError); });
    }, query ? 180 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [selectedProjectId, query, projectReload, t.projectStorageError]);

  useEffect(() => {
    if (!selectedProjectId || !historySessionId) { setHistory([]); return; }
    let active = true;
    void listProjectRevisions(selectedProjectId, historySessionId).then(value => { if (active) setHistory(value); })
      .catch(value => { if (active) setError(value instanceof Error ? value.message : t.projectStorageError); });
    return () => { active = false; };
  }, [selectedProjectId, historySessionId, projectReload, t.projectStorageError]);

  async function run(action: string, operation: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(action); setError('');
    try { await operation(); }
    catch (value) { setError(value instanceof Error ? value.message : t.projectStorageError); }
    finally { setBusy(''); }
  }

  function create() {
    void run('create', async () => {
      const project = await createProject(newName);
      setNewName('');
      await refreshProjects(project.id);
      notify(t.projectCreated);
    });
  }

  function saveDetails() {
    if (!selectedProject) return;
    void run('details', async () => {
      const project = await updateProject(selectedProject.id, { name: projectName, summary, importantNotes });
      await refreshProjectMetadata(project.id);
      notify(t.projectDetailsSaved);
    });
  }

  function connectSharedFile() {
    if (!selectedProject) return;
    const picker = (window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker;
    if (!supportsLocalFilePicker('showSaveFilePicker') || !picker) {
      setError(t.projectSharedUnsupported);
      return;
    }
    const projectId = selectedProject.id;
    const suggestedName = `threadpack-shared-${projectId.slice(0, 8)}.jsonl`;
    void run('shared-connect', async () => {
      const handle = await picker.call(window, { suggestedName, types: [{ description: 'ThreadPack project state', accept: { 'application/x-ndjson': ['.jsonl'] } }] });
      const status = await connectSharedProjectBackup(projectId, handle as SharedProjectFileHandle);
      setSharedStatus(status);
      if (status.state !== 'current') setError(t.projectSharedFailed);
      else notify(t.projectSharedCurrent);
    });
  }

  function reconnectSharedFile() {
    if (!selectedProject) return;
    void run('shared-reconnect', async () => {
      const status = await reconnectSharedProjectBackup(selectedProject.id);
      setSharedStatus(status);
      if (status.state !== 'current') setError(status.state === 'permission-required' ? t.projectSharedPermission : t.projectSharedFailed);
      else notify(t.projectSharedCurrent);
    });
  }

  function disconnectSharedFile() {
    if (!selectedProject) return;
    void run('shared-disconnect', async () => {
      await disconnectSharedProjectBackup(selectedProject.id);
      setSharedStatus({ connected: false, state: 'disconnected' });
      notify(t.projectSharedDisconnected);
    });
  }

  function connectUpdateInbox() {
    if (!selectedProject) return;
    const picker = (window as Window & {
      showOpenFilePicker?: (options: { multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
    }).showOpenFilePicker;
    if (!supportsLocalFilePicker('showOpenFilePicker') || !picker) { setError(t.projectSharedUnsupported); return; }
    void run('inbox-connect', async () => {
      const [handle] = await picker.call(window, { multiple: false, types: [{ description: 'ThreadPack update inbox', accept: { 'application/x-ndjson': ['.jsonl'] } }] });
      if (!handle) return;
      const result = await connectSharedProjectInbox(selectedProject.id, handle as SharedProjectFileHandle);
      setSharedStatus(current => ({ ...current, inboxConnected: true, inboxFilename: handle.name, pendingUpdates: result.pending }));
      setProposals(await listProjectUpdateProposals(selectedProject.id));
      setTaskClaims(await listProjectTaskClaims(selectedProject.id));
      await refreshProjectMetadata(selectedProject.id);
    });
  }

  function reviewProposal(proposal: ProjectUpdateProposal, decision: 'accepted' | 'rejected') {
    if (!selectedProject) return;
    void run('proposal-review', async () => {
      const factStatus = await reviewProjectUpdateProposal(selectedProject.id, proposal.id, decision);
      setProposals(await listProjectUpdateProposals(selectedProject.id));
      setTaskClaims(await listProjectTaskClaims(selectedProject.id));
      await refreshProjectMetadata(selectedProject.id);
      notify(decision === 'accepted'
        ? factStatus === 'confirmed' ? t.projectUpdateAccepted : t.projectUpdateAcceptedConflict
        : t.projectUpdateRejected);
    });
  }

  function beginProposalEdit(proposal: ProjectUpdateProposal) {
    setEditingProposalId(proposal.id);
    setEditingProposalTopic(proposal.topic);
    setEditingProposalStatement(proposal.statement);
    setEditingProposalCategory(proposal.category);
    setEditingProposalTaskState(proposal.taskState ?? 'unclear');
    setEditingProposalEvidence(proposal.evidenceReference);
    setEditingProposalQuote(proposal.evidenceQuote);
  }

  function saveProposalEdit(proposal: ProjectUpdateProposal) {
    if (!selectedProject) return;
    void run('proposal-edit', async () => {
      await editProjectUpdateProposal(selectedProject.id, proposal.id, {
        category: editingProposalCategory, topic: editingProposalTopic, statement: editingProposalStatement,
        ...(editingProposalCategory === 'task' ? { taskState: editingProposalTaskState } : {}),
        evidenceReference: editingProposalEvidence, evidenceQuote: editingProposalQuote,
      });
      setEditingProposalId('');
      setProposals(await listProjectUpdateProposals(selectedProject.id));
    });
  }

  function revokeProposal(proposal: ProjectUpdateProposal) {
    if (!selectedProject) return;
    void run('proposal-revoke', async () => {
      await revokeAcceptedProjectUpdate(selectedProject.id, proposal.id);
      setProposals(await listProjectUpdateProposals(selectedProject.id));
      setTaskClaims(await listProjectTaskClaims(selectedProject.id));
      await refreshProjectMetadata(selectedProject.id);
      notify(t.projectUpdateRevoked);
    });
  }

  function checkUpdateInbox() {
    if (!selectedProject) return;
    void run('inbox-check', async () => {
      const result = await importSharedProjectUpdates(selectedProject.id);
      setProposals(await listProjectUpdateProposals(selectedProject.id));
      setTaskClaims(await listProjectTaskClaims(selectedProject.id));
      await refreshProjectMetadata(selectedProject.id);
      if (!result.imported) notify(t.projectUpdateNoNewUpdates);
    });
  }

  function saveSession() {
    if (!activeSession || !selectedProject) return;
    void run('save-session', async () => {
      const snapshot = await readActiveSession(activeSession.conversationId);
      const result = await saveProjectSession(selectedProject.id, snapshot);
      await refreshProjects(selectedProject.id);
      notify(result.duplicate ? t.projectDuplicate : t.projectSessionSaved);
    });
  }

  function openSavedSession(sessionId: string, version?: number) {
    if (!selectedProject) return;
    void run('open-session', async () => {
      const saved = await getProjectSession(selectedProject.id, sessionId, version);
      close();
      openSession(saved.content, 'threadpack-session.jsonl');
    });
  }

  function restoreRevision(sessionId: string, version: number) {
    if (!selectedProject) return;
    void run('restore-revision', async () => {
      await restoreProjectRevision(selectedProject.id, sessionId, version);
      await refreshProjects(selectedProject.id);
      notify(t.projectRevisionRestored);
    });
  }

  function removeSelectedProject() {
    if (!selectedProject) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    void run('delete-project', async () => {
      await deleteProject(selectedProject.id);
      setConfirmDelete(false);
      await refreshProjects('');
      notify(t.projectDeleted);
    });
  }

  function downloadBackup() {
    if (!selectedProject) return;
    void run('backup', async () => {
      const blob = await exportProjectBackup(selectedProject.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `threadpack-project-${selectedProject.id.slice(0, 8)}.jsonl`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify(t.projectBackupExported);
    });
  }

  function restoreBackup(file: File | undefined) {
    if (!file) return;
    void run('backup-import', async () => {
      const restored = await restoreProjectBackup(file);
      await refreshProjects(restored.id);
      notify(t.projectBackupRestored);
    }).finally(() => { if (backupInput.current) backupInput.current.value = ''; });
  }

  const formatDate = (value: number) => dateFormatter.format(new Date(value));

  return <div className="project-library">
    <div className="dialog-eyebrow"><Archive size={17} />{t.projects}</div>
    <div className="project-library-heading"><div><h2>{t.projectsTitle}</h2><p className="dialog-subtitle">{t.projectsHint}</p></div><button className="button secondary small" disabled={!!busy} onClick={() => backupInput.current?.click()}><Upload size={14} />{t.projectBackupImport}</button></div>
    <input ref={backupInput} className="file-input" type="file" accept=".jsonl,application/x-ndjson,application/json" aria-label={t.projectBackupImport} onChange={event => restoreBackup(event.target.files?.[0])} />
    {error && <p className="project-error" role="alert">{error}</p>}
    <div className="project-create-row"><label><span>{t.projectName}</span><input value={newName} maxLength={100} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && newName.trim()) create(); }} /></label><button className="button primary small" disabled={!!busy || !newName.trim()} onClick={create}><FolderPlus size={14} />{t.projectCreate}</button></div>
    <div className="project-library-grid">
      <section className="project-list" aria-label={t.projects}>
        {!projects.length && <p className="project-empty">{t.projectEmpty}</p>}
        {projects.map(project => <button key={project.id} className={`project-list-item ${selectedProjectId === project.id ? 'active' : ''}`} aria-pressed={selectedProjectId === project.id} onClick={() => setSelectedProjectId(project.id)}><strong>{project.name}</strong><small>{formatDate(project.updatedAt)}</small></button>)}
      </section>
      {selectedProject && <section className="project-detail">
        <div className="project-detail-heading"><div><h3>{selectedProject.name}</h3><small>{t.projectUpdated} · {formatDate(selectedProject.updatedAt)}</small></div><button className="icon-button muted" aria-label={t.projectBackupExport} title={t.projectBackupExport} disabled={!!busy} onClick={downloadBackup}><ArrowDownToLine size={16} /></button><button className="icon-button muted" aria-label={t.projectDelete} title={t.projectDelete} disabled={!!busy} onClick={removeSelectedProject}><Trash2 size={16} /></button></div>
        <div className="project-shared-state" aria-label={t.projectSharedConnect}>
          <div><strong><Link2 size={13} />{t.projectSharedConnect}</strong><small>{sharedStatus.connected
            ? sharedStatus.state === 'current' ? t.projectSharedCurrent : sharedStatus.state === 'out-of-date' ? t.projectSharedOutOfDate : sharedStatus.state === 'permission-required' ? t.projectSharedPermission : t.projectSharedFailed
            : sharedFileAvailable ? t.projectSharedHint : t.projectSharedUnsupported}</small>{sharedStatus.filename && <small>{sharedStatus.filename}</small>}</div>
          {sharedStatus.connected
            ? <><button className="button secondary small" disabled={!!busy || sharedStatus.state === 'current'} onClick={reconnectSharedFile}><RefreshCw size={13} />{t.projectSharedReconnect}</button><button className="icon-button muted" aria-label={t.projectSharedDisconnect} title={t.projectSharedDisconnect} disabled={!!busy} onClick={disconnectSharedFile}><Unlink size={14} /></button></>
            : <button className="button secondary small" disabled={!!busy || !sharedFileAvailable} onClick={connectSharedFile}><Link2 size={13} />{t.projectSharedConnect}</button>}
        </div>
        <div className="project-shared-state project-update-inbox" aria-label={t.projectUpdateInbox}>
          <div><strong><Inbox size={13} />{t.projectUpdateInbox}</strong><small>{sharedStatus.inboxConnected ? `${sharedStatus.inboxFilename ?? ''} · ${proposals.filter(proposal => proposal.status === 'pending').length} ${t.projectUpdatePending}` : t.projectUpdateInboxHint}</small></div>
          {sharedStatus.inboxConnected && <button className="button secondary small" disabled={!!busy} onClick={checkUpdateInbox}><RefreshCw size={13} />{t.projectUpdateCheck}</button>}<button className="button secondary small" disabled={!!busy || !sharedStatus.connected || !sharedFileAvailable || !inboxFileAvailable} onClick={connectUpdateInbox}><Inbox size={13} />{t.projectUpdateConnect}</button>
        </div>
        {!!taskClaims.length && <section className="project-update-list" aria-label={t.projectTaskCoordination}>
          <h4>{t.projectTaskCoordination}</h4>
          {taskClaims.map((claim, index) => <article className="project-update-item" key={`${claim.claimId}-${claim.action}-${claim.claimedAt}-${index}`}>
            <div><strong>{claim.taskTopic ?? claim.taskId}</strong><p>{claim.taskStatement ?? claim.taskId}</p>
              <small>{claim.active ? t.projectTaskClaimActive : claim.action === 'released' ? t.projectTaskClaimReleased : t.projectTaskClaimExpired}
                {' · '}{t.projectUpdateClientClaim} · {claim.client} · {formatDate(claim.claimedAt)}
                {claim.expiresAt ? ` · ${t.projectTaskClaimExpires} ${formatDate(claim.expiresAt)}` : ''}</small>
            </div>
          </article>)}
        </section>}
        {proposals.some(proposal => proposal.status === 'pending') && <section className="project-update-list" aria-label={t.projectUpdateInbox}>
          <h4>{t.projectUpdateReview}</h4>
          {proposals.filter(proposal => proposal.status === 'pending').map(proposal => <article className="project-update-item" key={proposal.id}>
            <div>
              {editingProposalId === proposal.id ? <div className="project-update-edit">
                <label><span>{t.memoryCategory}</span><select value={editingProposalCategory} onChange={event => setEditingProposalCategory(event.target.value as ProjectUpdateProposal['category'])}>{['goal', 'decision', 'constraint', 'task', 'risk', 'open-question'].map(category => <option key={category} value={category}>{category}</option>)}</select></label>
                <label><span>{t.projectUpdateTopic}</span><input maxLength={160} value={editingProposalTopic} onChange={event => setEditingProposalTopic(event.target.value)} /></label>
                <label><span>{t.projectUpdateStatement}</span><textarea maxLength={4000} value={editingProposalStatement} onChange={event => setEditingProposalStatement(event.target.value)} /></label>
                {editingProposalCategory === 'task' && <label><span>{t.memoryTaskProgress}</span><select value={editingProposalTaskState} onChange={event => setEditingProposalTaskState(event.target.value as NonNullable<ProjectUpdateProposal['taskState']>)}>{[['not-started', t.memoryTaskNotStarted], ['in-progress', t.memoryTaskInProgress], ['done', t.memoryTaskDone], ['blocked', t.memoryTaskBlocked], ['unclear', t.memoryTaskUnclear]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
                <small>{t.memorySession}: {sessions.find(session => session.id === proposal.sessionId)?.title ?? proposal.sessionId} · v{proposal.sessionVersion} · {proposal.messageId}</small>
                <label><span>{t.projectUpdateEvidence}</span><input maxLength={1000} value={editingProposalEvidence} onChange={event => setEditingProposalEvidence(event.target.value)} /></label>
                <label><span>{t.projectUpdateEvidence}</span><textarea maxLength={1000} value={editingProposalQuote} onChange={event => setEditingProposalQuote(event.target.value)} /></label>
                <button className="button secondary small" disabled={!!busy} onClick={() => saveProposalEdit(proposal)}>{t.projectUpdateSaveEdit}</button>
              </div> : <>
                <strong>{proposal.topic}</strong>
                <small>{t.projectUpdateClientClaim} · {proposal.client} · {formatDate(proposal.createdAt)}</small>
                {proposal.taskId && proposal.claimId && <small>{t.projectTaskClaimLink} · {proposal.taskId} · {proposal.claimId}</small>}
                <p>{proposal.statement}</p>
                <small>{proposal.evidenceReference || t.projectUpdateNoEvidence}</small>
                {proposal.evidenceQuote && <blockquote>{proposal.evidenceQuote}</blockquote>}
              </>}
            </div>
            <div>
              <button className="text-button" disabled={!!busy} onClick={() => reviewProposal(proposal, 'accepted')}><Check size={12} />{t.projectUpdateAccept}</button>
              <button className="text-button" disabled={!!busy} onClick={() => beginProposalEdit(proposal)}>{t.projectUpdateEdit}</button>
              <button className="text-button danger-text" disabled={!!busy} onClick={() => reviewProposal(proposal, 'rejected')}><X size={12} />{t.projectUpdateReject}</button>
            </div>
          </article>)}
        </section>}
        {proposals.some(proposal => proposal.status !== 'pending' && proposal.status !== 'reviewing') && <section className="project-update-list" aria-label={t.projectUpdateHistory}>
          <h4>{t.projectUpdateHistory}</h4>
          {proposals.filter(proposal => proposal.status !== 'pending' && proposal.status !== 'reviewing').map(proposal => <article className="project-update-item" key={proposal.id}>
            <div><strong>{proposal.topic} · {proposal.status}</strong><small>{t.projectUpdateClientClaim} · {proposal.client} · {formatDate(proposal.createdAt)}</small>
              {proposal.taskId && proposal.claimId && <small>{t.projectTaskClaimLink} · {proposal.taskId} · {proposal.claimId}</small>}<p>{proposal.statement}</p>
              <ol className="project-update-audit">{proposal.auditHistory.map((entry, index) => <li key={`${proposal.id}-${index}`}><small>{entry.action === 'submitted' ? t.projectUpdateSubmitted : entry.action === 'review-started' ? t.projectUpdateReviewStarted : entry.action === 'edited' ? t.projectUpdateEdited : entry.action === 'accepted' ? t.projectUpdateAccept : entry.action === 'rejected' ? t.projectUpdateReject : entry.action === 'revoked' ? t.projectUpdateRevocation : t.projectUpdateReopened} · {entry.actor === 'user' ? t.projectUpdateActorUser : `${t.projectUpdateActorClient}: ${entry.clientClaim ?? proposal.client}`} · {formatDate(entry.changedAt)}</small><p>{entry.snapshot.topic}: {entry.snapshot.statement}</p></li>)}</ol>
            </div>{proposal.status === 'accepted' && <button className="text-button danger-text" disabled={!!busy} onClick={() => revokeProposal(proposal)}>{t.projectUpdateRevoke}</button>}
          </article>)}
        </section>}
        {confirmDelete && <div className="project-confirm"><span>{t.projectDeleteConfirm}</span><button className="button danger small" disabled={!!busy} onClick={removeSelectedProject}>{t.projectDelete}</button><button className="button secondary small" onClick={() => setConfirmDelete(false)}>{t.cancel}</button></div>}
        <div className="project-fields"><label><span>{t.projectName}</span><input value={projectName} maxLength={100} onChange={event => setProjectName(event.target.value)} /></label><label><span>{t.projectStatus}</span><textarea value={summary} maxLength={10000} rows={2} onChange={event => setSummary(event.target.value)} /></label><label><span>{t.projectImportantNotes}</span><textarea value={importantNotes} maxLength={20000} rows={3} onChange={event => setImportantNotes(event.target.value)} /></label><button className="button secondary small" disabled={!!busy} onClick={saveDetails}>{t.projectSaveDetails}</button></div>
        <ProjectMemoryPanel key={selectedProject.id} project={selectedProject} reloadKey={projectReload} sessions={sessions} t={t} notify={notify} onChanged={() => refreshProjectMetadata(selectedProject.id)} />
        <div className="project-sessions-heading"><h3>{t.projectSessions} <span>{sessionTotal}</span></h3><label className="project-search"><Search size={14} /><input type="search" maxLength={1000} value={query} aria-label={t.projectSearch} placeholder={t.projectSearch} onChange={event => setQuery(event.target.value)} /></label></div>
        {activeSession && <button className="button primary small project-save-session" disabled={!!busy} onClick={saveSession}><Archive size={14} />{t.projectSaveSession}<span>{activeSession.title}</span></button>}
        {!sessions.length && <p className="project-empty">{query ? t.projectNoMatches : t.projectNoSessions}</p>}
        <div className="project-session-list">{sessions.map(session => <article key={session.id} className="project-session-item"><div className="project-session-copy"><strong>{session.title || session.sourceName}</strong><small>{session.platform} · {session.messageCount.toLocaleString()} · {t.projectVersion} {session.currentVersion} · {formatDate(session.updatedAt)}</small>{session.matchedText && <small>{t.projectTextMatch}</small>}</div><button className="button secondary small" disabled={!!busy} onClick={() => openSavedSession(session.id)}>{t.projectOpenSession}</button><button className="icon-button muted" aria-label={t.projectHistory} title={t.projectHistory} disabled={!!busy} onClick={() => setHistorySessionId(historySessionId === session.id ? '' : session.id)}><Clock3 size={15} /></button></article>)}</div>
        {sessionTotal > sessions.length && <p className="project-list-limit">{t.projectListLimit.replace('{shown}', String(sessions.length)).replace('{total}', String(sessionTotal))}</p>}
        {historySessionId && <div className="project-history" aria-label={t.projectHistory}><h4>{t.projectHistory}</h4>{history.map(revision => <div className="project-history-item" key={revision.version}><span>{t.projectVersion} {revision.version} · {formatDate(revision.createdAt)}{revision.current ? ` · ${t.projectCurrent}` : ''}</span><button className="text-button" disabled={!!busy} onClick={() => openSavedSession(historySessionId, revision.version)}>{t.projectOpenSession}</button>{!revision.current && <button className="text-button" disabled={!!busy} onClick={() => restoreRevision(historySessionId, revision.version)}>{t.projectRestoreRevision}</button>}</div>)}</div>}
      </section>}
    </div>
    <p className="project-library-footnote"><FileJson size={14} />{t.projectLocalPrivacy}</p>
    <p className="project-library-footnote project-backup-warning"><ShieldCheck size={14} />{t.projectBackupSensitive}</p>
    {busy && <span className="project-busy" role="status"><LoaderCircle size={15} className="spin" />{t.projectWorking}</span>}
  </div>;
}
