import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Clock3, FileJson, FolderPlus, LoaderCircle, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import type { TranslationKey } from '../i18n';
import type { Lang } from '../i18n';
import {
  createProject, deleteProject, exportProjectBackup, getProjectSession, listProjectRevisions,
  listProjects, listProjectSessions, restoreProjectBackup, restoreProjectRevision, saveProjectSession, updateProject,
} from './store';
import type { ProjectRecord, ProjectRevisionSummary, ProjectSessionInput, ProjectSessionSummary } from './store';

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
  const backupInput = useRef<HTMLInputElement>(null);
  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);

  async function refreshProjects(preferredId = selectedProjectId) {
    const next = await listProjects();
    setProjects(next);
    const nextId = next.some(project => project.id === preferredId) ? preferredId : next[0]?.id ?? '';
    setSelectedProjectId(nextId);
    setProjectReload(value => value + 1);
  }

  useEffect(() => {
    let active = true;
    void listProjects().then(value => { if (active) { setProjects(value); setSelectedProjectId(value[0]?.id ?? ''); } })
      .catch(value => { if (active) setError(value instanceof Error ? value.message : t.projectStorageError); });
    return () => { active = false; };
  }, [t.projectStorageError]);

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
        if (active) { setSessions(result.sessions); setSessionTotal(result.total); setError(''); }
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
      setProjects(current => current.map(item => item.id === project.id ? project : item));
      notify(t.projectDetailsSaved);
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
        {confirmDelete && <div className="project-confirm"><span>{t.projectDeleteConfirm}</span><button className="button danger small" disabled={!!busy} onClick={removeSelectedProject}>{t.projectDelete}</button><button className="button secondary small" onClick={() => setConfirmDelete(false)}>{t.cancel}</button></div>}
        <div className="project-fields"><label><span>{t.projectName}</span><input value={projectName} maxLength={100} onChange={event => setProjectName(event.target.value)} /></label><label><span>{t.projectStatus}</span><textarea value={summary} maxLength={10000} rows={2} onChange={event => setSummary(event.target.value)} /></label><label><span>{t.projectImportantNotes}</span><textarea value={importantNotes} maxLength={20000} rows={3} onChange={event => setImportantNotes(event.target.value)} /></label><button className="button secondary small" disabled={!!busy} onClick={saveDetails}>{t.projectSaveDetails}</button></div>
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
