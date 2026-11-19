import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Copy, FileJson, FileText, HelpCircle, ImageMinus, Layers, LoaderCircle, LockKeyhole, Mail, Package, Pin, RotateCcw, Search, ShieldCheck, Sparkles, Terminal, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ProcessorWorker from './processing.worker?worker&inline';
import { buildHandoff, buildJsonl, buildTranscript, cleanConversation, DEFAULT_OPTIONS } from './core';
import type { CleanOptions, CleanResult, Conversation, Role } from './core';
import { createDemo } from './demo';
import { dictionary } from './i18n';
import type { Lang, TranslationKey } from './i18n';

interface ArchiveInfo {
  format: string; warnings: string[]; sourceBytes: number;
  conversations: { id: string; title: string; source: string; messageCount: number }[];
}
interface Processed { original: Conversation; originalSizes: Record<string, number>; result: CleanResult }
interface Notes { goal: string; decisions: string; constraints: string; nextSteps: string }
const emptyNotes: Notes = { goal: '', decisions: '', constraints: '', nextSteps: '' };
const MAX_BYTES = 100 * 1024 * 1024;
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(2)} MiB`;
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

function Toggle({ title, hint, icon: Icon, checked, onChange }: { title: string; hint: string; icon: LucideIcon; checked: boolean; onChange: () => void }) {
  return <button className={`toggle-row ${checked ? 'enabled' : ''}`} role="switch" aria-checked={checked} aria-label={title} onClick={onChange}>
    <span className="toggle-icon"><Icon size={17} strokeWidth={1.65} /></span>
    <span className="toggle-copy"><strong>{title}</strong><small>{hint}</small></span>
    <span className="switch"><span /></span>
  </button>;
}

function Dialog({ children, close, label }: { children: ReactNode; close: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, textarea, input, select')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, select, a[href]') ?? [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={label}>
      <button className="icon-button dialog-close" aria-label={label === '使用说明' ? '关闭' : 'Close'} onClick={close}><X size={20} /></button>{children}
    </div>
  </div>;
}

function MessageCard({ message, index, size, pinned, onPin, changes, t }: {
  message: Conversation['messages'][number]; index: number; size: number; pinned: boolean; onPin: () => void;
  changes: CleanResult['changes']; t: Record<TranslationKey, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const safePreview = message.content.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, '[Embedded image payload · hidden in preview]');
  const limit = expanded ? 12000 : 1100;
  const content = safePreview.length > limit ? `${safePreview.slice(0, limit)}\n…` : safePreview;
  const changeCount = changes.filter(c => c.messageId === message.id).reduce((n, c) => n + c.count, 0);
  const RoleIcon = message.role === 'tool' ? Terminal : message.role === 'assistant' ? Sparkles : message.role === 'system' ? ShieldCheck : null;
  return <article className={`message-card role-${message.role} ${pinned ? 'is-pinned' : ''}`}>
    <div className="message-heading">
      <div className="message-role"><span className="role-avatar">{RoleIcon ? <RoleIcon size={13} /> : <span>U</span>}</span><strong>{t[message.role]}</strong><span className="message-index">{String(index + 1).padStart(2, '0')}</span></div>
      <div className="message-meta">{changeCount > 0 && <span className="changed-dot" title={`${changeCount} changes`}>−{changeCount}</span>}<span>{bytes(size)}</span><button className={`pin-button ${pinned ? 'active' : ''}`} aria-label={pinned ? t.unpin : t.pin} aria-pressed={pinned} onClick={onPin} title={pinned ? t.unpin : t.pin}><Pin size={14} /></button></div>
    </div>
    <pre className="message-content">{content || '—'}</pre>
    {safePreview.length > 1100 && <button className="text-button expand-button" onClick={() => setExpanded(!expanded)}>{expanded ? t.collapse : t.expand}<ChevronDown size={13} className={expanded ? 'rotate' : ''} /></button>}
  </article>;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem('threadpack-language') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; } });
  const t = dictionary(lang);
  const [view, setView] = useState<'workbench' | 'handoff'>('workbench');
  const [dialog, setDialog] = useState<'help' | 'paste' | 'export' | null>(null);
  const [archive, setArchive] = useState<ArchiveInfo | null>(null);
  const [selected, setSelected] = useState('');
  const [processed, setProcessed] = useState<Processed | null>(null);
  const [filename, setFilename] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<CleanOptions>({ ...DEFAULT_OPTIONS });
  const [mode, setMode] = useState<'cleaned' | 'original'>('cleaned');
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pins, setPins] = useState<string[]>([]);
  const [notes, setNotes] = useState<Notes>(emptyNotes);
  const [recent, setRecent] = useState(8);
  const [budget, setBudget] = useState(12000);
  const [pasteText, setPasteText] = useState('');
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const pending = useRef(new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>());
  const importGeneration = useRef(0);
  const currentConversation = archive?.conversations.find(c => c.id === selected);

  const request = useCallback(<T,>(message: Record<string, unknown>): Promise<T> => {
    if (!worker.current) {
      worker.current = new ProcessorWorker();
      worker.current.onmessage = event => {
        const entry = pending.current.get(event.data.id);
        if (!entry) return;
        pending.current.delete(event.data.id);
        if (event.data.error) entry.reject(new Error(event.data.error)); else entry.resolve(event.data.data);
      };
      worker.current.onerror = () => {
        for (const entry of pending.current.values()) entry.reject(new Error('The local worker stopped. Try a smaller file.'));
        pending.current.clear(); worker.current?.terminate(); worker.current = null;
      };
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++requestId.current;
      pending.current.set(id, { resolve: value => resolve(value as T), reject });
      worker.current!.postMessage({ ...message, id });
    });
  }, []);

  const stopWorker = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    for (const entry of pending.current.values()) entry.reject(new Error('Cancelled'));
    pending.current.clear();
  }, []);
  useEffect(() => stopWorker, [stopWorker]);
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; try { localStorage.setItem('threadpack-language', lang); } catch { /* Optional preference only. */ } }, [lang]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { setPage(0); }, [filter, query, selected, mode]);

  useEffect(() => {
    if (!archive || !selected) return;
    let active = true;
    setBusy(true);
    request<Processed>({ type: 'clean', conversationId: selected, options }).then(data => {
      if (active) { setProcessed(data); setBusy(false); }
    }).catch(err => { if (active && err.message !== 'Cancelled') { setError(err.message); setBusy(false); } });
    return () => { active = false; };
  }, [archive, selected, options, request]);

  async function openText(text: string, name: string, isDemo = false, readGeneration?: number) {
    const generation = readGeneration ?? ++importGeneration.current;
    if (generation !== importGeneration.current) return;
    if (byteLength(text) > MAX_BYTES) { setError(t.tooLarge); setImporting(false); return; }
    setImporting(true); setError('');
    try {
      const result = await request<ArchiveInfo>({ type: 'parse', text, filename: name });
      if (generation !== importGeneration.current) return;
      if (!result.conversations.length) throw new Error(t.noConversation);
      setArchive(result); setSelected(result.conversations[0].id); setProcessed(null);
      setFilename(name); setDemo(isDemo); setPins([]); setQuery(''); setFilter('all'); setMode('cleaned'); setNotes(emptyNotes); setView('workbench'); setDialog(null); setPasteText('');
    } catch (err) { if (generation === importGeneration.current) setError(err instanceof Error ? err.message : t.errorTitle); }
    finally { if (generation === importGeneration.current) setImporting(false); }
  }
  async function openFile(file: File) {
    const generation = ++importGeneration.current;
    if (file.size > MAX_BYTES) { setError(t.tooLarge); setImporting(false); return; }
    setImporting(true); setError('');
    try {
      const text = await file.text();
      if (generation !== importGeneration.current) return;
      await openText(text, file.name, false, generation);
    } catch {
      if (generation === importGeneration.current) { setError(t.errorTitle); setImporting(false); }
    }
  }
  function clear() {
    ++importGeneration.current; stopWorker(); setArchive(null); setProcessed(null); setSelected(''); setFilename(''); setPins([]); setNotes(emptyNotes); setQuery(''); setPasteText(''); setError(''); setBusy(false); setImporting(false); setDemo(false); setView('workbench'); setToast(t.cleared);
  }
  function selectConversation(id: string) { setSelected(id); setPins([]); setNotes(emptyNotes); setProcessed(null); setError(''); }
  function toggle(key: keyof CleanOptions) { setOptions(previous => ({ ...previous, [key]: !previous[key] })); }
  function togglePin(id: string) { setPins(previous => previous.includes(id) ? previous.filter(p => p !== id) : [...previous, id]); }

  const handoffText = useMemo(() => {
    if (!processed) return '';
    const keys = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
    // Scan notes together for stable aliases, with a separate namespace from the transcript.
    const cleanedNotes = cleanConversation({ id: 'notes', title: '', source: 'notes', messages: keys.map(key => ({ id: key, role: 'user' as const, content: notes[key] })) }, { ...options, trimToolOutputs: false, deduplicate: false });
    const safeNotes = Object.fromEntries(cleanedNotes.conversation.messages.map(m => [m.id, m.content.replace(/\[(SECRET|EMAIL)_(\d+)\]/g, '[NOTE_$1_$2]')])) as unknown as Notes;
    return buildHandoff(processed.result.conversation, { ...safeNotes, pinnedIds: pins, recentCount: recent, maxCharacters: budget });
  }, [processed, notes, pins, recent, budget, options]);

  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500); setToast(t.downloaded);
  }
  function exportFile(format: 'markdown' | 'jsonl' | 'report') {
    if (!processed || busy || importing) return;
    const c = processed.result.conversation;
    if (format === 'markdown') download(buildTranscript(c), 'threadpack-transcript.md', 'text/markdown;charset=utf-8');
    else if (format === 'jsonl') download(buildJsonl(c), 'threadpack-transcript.jsonl', 'application/x-ndjson;charset=utf-8');
    else download(JSON.stringify({ tool: 'ThreadPack', version: '1.0.0', format: archive?.format, messageCount: c.messages.length, stats: processed.result.stats, options, scope: 'UTF-8 normalized message text; excludes source metadata. No message text or file paths are included in this report.' }, null, 2), 'threadpack-report.json', 'application/json;charset=utf-8');
    setDialog(null);
  }
  async function copyHandoff() {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(handoffText); setToast(t.copied); }
    catch { setToast(t.clipboardError); }
  }

  const messages = processed ? (mode === 'cleaned' ? processed.result.conversation.messages : processed.original.messages) : [];
  const visible = messages.map((message, index) => ({ message, index })).filter(({ message }) => (filter === 'all' || message.role === filter) && (!query || message.content.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const pageCount = Math.max(1, Math.ceil(visible.length / 30));
  const safePage = Math.min(page, pageCount - 1);
  const stats = processed?.result.stats;
  const reduction = stats && stats.beforeBytes ? Math.max(0, 100 * (1 - stats.afterBytes / stats.beforeBytes)) : 0;
  const working = busy || importing;
  const changeRows: { key: 'imagesRemoved' | 'outputsTrimmed' | 'duplicatesRemoved' | 'secretsRedacted' | 'emailsRedacted'; icon: LucideIcon }[] = [
    { key: 'imagesRemoved', icon: ImageMinus }, { key: 'outputsTrimmed', icon: Terminal }, { key: 'duplicatesRemoved', icon: Copy }, { key: 'secretsRedacted', icon: ShieldCheck }, { key: 'emailsRedacted', icon: Mail },
  ];

  return <div className="app-shell" onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) void openFile(e.dataTransfer.files[0]); }}>
    <header className="site-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('workbench'); }} aria-label="ThreadPack"><span className="brand-icon"><Package size={21} strokeWidth={1.7} /></span><span>Thread<span className="brand-light">Pack</span><span className="version">v1.0</span></span></a>
      <nav className="main-nav" aria-label={lang === 'zh' ? '主导航' : 'Main navigation'}>
        <button className={view === 'workbench' ? 'selected' : ''} onClick={() => setView('workbench')}>{t.workbench}</button>
        <button className={view === 'handoff' ? 'selected' : ''} onClick={() => setView('handoff')} disabled={!processed}>{t.handoff}{pins.length > 0 && <span className="nav-count">{pins.length}</span>}</button>
      </nav>
      <div className="header-actions"><button className="help-button" onClick={() => setDialog('help')}><HelpCircle size={15} /><span>{t.help}</span></button><span className="header-divider" /><button className="language-button" aria-label="Switch language / 切换语言" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{lang === 'en' ? '中文' : 'EN'}</button></div>
    </header>

    <main className={archive ? 'loaded' : ''}>
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span />{t.heroLabel}</div><h1>{view === 'handoff' ? t.handoffTitle : t.heroTitle.split('\n').map((line, i) => <span key={line}>{line}{i === 0 && <br />}</span>)}</h1><p>{view === 'handoff' ? t.handoffSub : t.heroDescription}</p></div>
        <div className="hero-art" aria-hidden="true"><div className="art-grid" /><div className="art-page back"><span /><span /><span /><span /><span /></div><div className="art-page front"><span className="art-mini"><Package size={17} />THREADPACK</span><i /><i /><i /><div className="art-line"><Check size={13} /><span /></div><div className="art-line"><Check size={13} /><span /></div><b>ready for what’s next <ArrowUpRight size={15} /></b></div><div className="art-chip"><ShieldCheck size={14} /> 100% local</div><span className="art-star">✳</span></div>
      </section>

      <div className="privacy-strip"><span><LockKeyhole size={13} /><strong>{t.local}</strong></span><span className="privacy-formats">{t.supported}</span></div>

      {error && <div className="error-banner" role="alert"><div><strong>{t.errorTitle}</strong><p>{error}</p></div><button className="icon-button" aria-label={t.close} onClick={() => setError('')}><X size={17} /></button></div>}

      <section className={`import-panel ${archive ? 'has-file' : ''}`}>
        <input ref={input} type="file" accept=".jsonl,.ndjson,.json,.md,.txt,.log" aria-label={t.import} className="file-input" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
        {!archive ? <><button className="drop-target" disabled={importing} onClick={() => input.current?.click()}><span className="upload-icon"><Upload size={23} strokeWidth={1.6} /></span><span><strong>{t.drop}</strong><small>{t.dropHint}</small></span></button><div className="import-alternatives"><button className="button secondary" disabled={importing} onClick={() => void openText(createDemo(), 'checkout-session.jsonl', true)}><Sparkles size={15} />{t.demo}</button><button className="text-button" onClick={() => setDialog('paste')}><Clipboard size={14} />{t.paste}</button></div></> : <><div className="file-summary"><span className="file-icon"><FileText size={23} strokeWidth={1.5} /></span><div className="file-details"><div className="overline">{t.fileLabel}{demo && <span className="demo-badge">{t.demoBadge}</span>}</div><strong title={filename}>{filename}</strong><small>{archive.format} <span>·</span> {bytes(archive.sourceBytes)}</small></div></div><div className="file-controls">{archive.conversations.length > 1 && <div className="select-wrap"><select aria-label={t.conversations} value={selected} onChange={e => selectConversation(e.target.value)}>{archive.conversations.map((c, i) => <option key={c.id} value={c.id}>{i + 1}. {c.title.slice(0, 100)}</option>)}</select><ChevronDown size={14} /></div>}<button className="button secondary small" onClick={() => input.current?.click()}><Upload size={14} />{t.changeFile}</button><button className="icon-button muted" aria-label={t.clear} title={t.clear} onClick={clear}><Trash2 size={16} /></button></div></>}
      </section>

      {importing && <div className="import-loading" role="status"><LoaderCircle size={19} className="spin" />{t.processing}</div>}

      {archive?.warnings.length ? <details className="warnings"><summary>{t.warnings} <span>{archive.warnings.length}</span></summary><ul>{archive.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details> : null}

      {archive && <section className="metrics" aria-label={t.payloadHint}>
        <div className="metric"><div className="metric-title">{t.sourceSize}<FileText size={14} /></div><strong>{stats ? bytes(stats.beforeBytes) : '—'}</strong><small>{t.payloadHint}</small></div>
        <div className="metric"><div className="metric-title">{t.cleanSize}<Package size={14} /></div><strong>{stats ? bytes(stats.afterBytes) : '—'}</strong><div className="mini-bars" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} className={stats && i < Math.max(1, Math.ceil(24 * stats.afterBytes / Math.max(stats.beforeBytes, stats.afterBytes, 1))) ? 'filled' : ''} />)}</div></div>
        <div className="metric metric-saved"><div className="metric-title">{t.saved}<ArrowDownToLine size={14} /></div><strong>{stats ? reduction.toFixed(1) : '—'}<span>%</span></strong><small>{stats ? `${bytes(stats.removedBytes)} ${lang === 'zh' ? '已减去' : 'removed'}` : '—'}</small></div>
        <div className="metric"><div className="metric-title">{t.messages}<Layers size={14} /></div><strong>{currentConversation?.messageCount.toLocaleString() ?? '—'}</strong><small>{pins.length} {t.pinned}</small></div>
      </section>}

      {archive && view === 'workbench' && <div className="workspace-grid">
        <aside className="recipe-panel panel"><div className="panel-heading"><div><h2>{t.recipe}</h2><p>{t.recipeSub}</p></div><button className="icon-button muted" title={t.reset} aria-label={t.reset} onClick={() => setOptions({ ...DEFAULT_OPTIONS })}><RotateCcw size={15} /></button></div>
          <div className="recipe-controls"><Toggle title={t.stripImages} hint={t.stripImagesHint} icon={ImageMinus} checked={options.stripImages} onChange={() => toggle('stripImages')} /><Toggle title={t.trimTools} hint={t.trimToolsHint} icon={Terminal} checked={options.trimToolOutputs} onChange={() => toggle('trimToolOutputs')} />
            {options.trimToolOutputs && <div className="range-control"><div><label htmlFor="tool-limit">{t.toolLimit}</label><output htmlFor="tool-limit">{options.toolLimit.toLocaleString()}</output></div><input id="tool-limit" type="range" min="500" max="12000" step="500" value={options.toolLimit} onChange={e => setOptions(o => ({ ...o, toolLimit: Number(e.target.value) }))} /><div className="range-labels"><span>500</span><span>12,000</span></div></div>}
            <Toggle title={t.dedup} hint={t.dedupHint} icon={Copy} checked={options.deduplicate} onChange={() => toggle('deduplicate')} /><div className="recipe-divider" /><Toggle title={t.redact} hint={t.redactHint} icon={ShieldCheck} checked={options.redact} onChange={() => toggle('redact')} /><Toggle title={t.emails} hint={t.emailsHint} icon={Mail} checked={options.redactEmails} onChange={() => toggle('redactEmails')} />
          </div>
          <div className="privacy-card"><ShieldCheck size={21} strokeWidth={1.4} /><strong>{t.privacyTitle}</strong><p>{t.privacyDescription}</p><span>{t.reviewNote}</span></div>
        </aside>
        <section className="preview-panel panel"><div className="panel-heading preview-heading"><div><h2>{t.preview}<span className="count-badge">{currentConversation?.messageCount ?? 0}</span></h2><p>{t.previewSub}</p></div><div className="segmented" aria-label={t.preview}><button aria-pressed={mode === 'cleaned'} className={mode === 'cleaned' ? 'active' : ''} onClick={() => setMode('cleaned')}>{t.cleaned}</button><button aria-pressed={mode === 'original'} className={mode === 'original' ? 'active' : ''} onClick={() => setMode('original')}>{t.original}</button></div></div>
          <div className="preview-toolbar"><div className="role-filter">{(['all', 'user', 'assistant', 'tool'] as const).map(role => <button key={role} aria-pressed={filter === role} className={filter === role ? 'active' : ''} onClick={() => setFilter(role)}>{t[role]}</button>)}</div><label className="search-box"><Search size={14} /><input type="search" value={query} placeholder={t.search} aria-label={t.search} onChange={e => setQuery(e.target.value)} /></label></div>
          {mode === 'original' && <div className="original-warning"><LockKeyhole size={14} />{t.originalWarning}</div>}
          <div className={`messages-list ${working ? 'processing' : ''}`} aria-busy={working}>
            {working && <div className="processing-overlay" role="status"><span><LoaderCircle size={17} className="spin" />{t.processing}</span></div>}
            {processed && !visible.length && <p className="no-results">{t.noResults}</p>}
            {visible.slice(safePage * 30, safePage * 30 + 30).map(({ message, index }) => <MessageCard key={`${selected}-${mode}-${message.id}`} message={message} index={index} size={mode === 'original' ? processed?.originalSizes[message.id] ?? 0 : byteLength(message.content)} pinned={pins.includes(message.id)} onPin={() => togglePin(message.id)} changes={mode === 'cleaned' ? processed?.result.changes ?? [] : []} t={t} />)}
          </div>
          {pageCount > 1 && <div className="pagination"><button className="text-button" disabled={safePage === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} />{t.prev}</button><span>{safePage + 1} / {pageCount}</span><button className="text-button" disabled={safePage === pageCount - 1} onClick={() => setPage(p => p + 1)}>{t.next}<ChevronRight size={15} /></button></div>}
          <div className="changes-panel"><div className="overline">{t.changes}</div><div className="changes-list">{changeRows.filter(row => row.key !== 'emailsRedacted' || options.redactEmails).map(({ key, icon: Icon }) => <span key={key} className={stats?.[key] ? 'has-changes' : ''}><Icon size={13} /><strong>{stats?.[key] ?? 0}</strong>{t[key]}</span>)}</div></div>
        </section>
      </div>}

      {archive && view === 'handoff' && processed && <div className="handoff-grid"><section className="notes-panel panel"><div className="panel-heading"><div><h2>{t.notes}</h2><p>{pins.length} {t.pinned}</p></div><Pin size={17} /></div><div className="notes-body">{(['goal', 'decisions', 'constraints', 'nextSteps'] as const).map(key => <label className="note-field" key={key}><span>{t[key]}</span><textarea value={notes[key]} maxLength={12000} placeholder={t[`${key}Hint`]} rows={key === 'goal' ? 2 : 3} onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))} /></label>)}<div className="handoff-settings"><label>{t.recent}<select value={recent} onChange={e => setRecent(Number(e.target.value))}>{[0, 4, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select></label><label>{t.budget}<select value={budget} onChange={e => setBudget(Number(e.target.value))}>{[6000, 12000, 24000, 48000].map(n => <option key={n} value={n}>{n.toLocaleString()} {t.characters}</option>)}</select></label></div><p className="field-note">{t.pinsHint}</p></div></section><section className="handoff-preview panel"><div className="panel-heading"><div><h2>{t.handoffPreview}</h2><p>{bytes(byteLength(handoffText))} · {handoffText.length.toLocaleString()} {t.characters}</p></div><span className="document-badge">.md</span></div><pre className="handoff-document">{handoffText}</pre><div className="handoff-note"><ShieldCheck size={15} />{t.handoffNote}</div></section></div>}

      {archive && <section className="export-bar"><div className="export-copy"><span className="ready-mark"><Check size={19} /></span><div><strong>{view === 'handoff' ? t.handoffPreview : t.ready}</strong><small>{view === 'handoff' ? t.handoffNote : t.exportHint}</small></div></div><div className="export-actions">{view === 'handoff' ? <><button className="button secondary" disabled={working || !handoffText} onClick={() => void copyHandoff()}><Clipboard size={15} />{t.copy}</button><button className="button primary" disabled={working || !handoffText} onClick={() => download(handoffText, 'threadpack-handoff.md', 'text/markdown;charset=utf-8')}><ArrowDownToLine size={16} />{t.downloadHandoff}</button></> : <><button className="button secondary" disabled={working || !processed} onClick={() => setView('handoff')}>{t.buildHandoff}<ArrowUpRight size={15} /></button><button className="button primary" disabled={working || !processed} onClick={() => setDialog('export')}><ArrowDownToLine size={16} />{t.export}</button></>}</div></section>}

      {!archive && !importing && <section className="empty-state"><div className="empty-symbol"><Layers size={26} strokeWidth={1.2} /><span><ArrowRight size={12} /></span></div><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><div className="empty-formats"><span><Terminal size={13} />Codex & Claude Code</span><span><FileJson size={13} />ChatGPT & Claude</span><span><FileText size={13} />Markdown & text</span></div></section>}
    </main>

    <footer className="site-footer"><span className="footer-brand"><Package size={15} />ThreadPack <span>·</span> {t.footer}</span><span><span className="status-dot" />{t.privacy}<span className="footer-separator">/</span>MIT License</span></footer>
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {dragging && <div className="drag-overlay"><div><Upload size={44} /><h2>{t.drop}</h2><p>{t.dropHint}</p></div></div>}

    {dialog === 'help' && <Dialog close={() => setDialog(null)} label={t.help}><div className="dialog-eyebrow"><Package size={18} />THREADPACK</div><h2>{t.helpTitle}</h2><div className="help-steps">{[1, 2, 3].map(n => <div key={n}><strong>{t[`help${n}Title` as TranslationKey]}</strong><p>{t[`help${n}` as TranslationKey]}</p></div>)}</div><div className="help-notice"><h3><LockKeyhole size={15} />{t.helpPrivacy}</h3><p>{t.helpPrivacyText}</p><h3>{t.helpLimits}</h3><p>{t.helpLimitsText}</p></div></Dialog>}
    {dialog === 'paste' && <Dialog close={() => setDialog(null)} label={t.paste}><div className="dialog-eyebrow"><Clipboard size={17} />{t.paste}</div><h2>{t.pasteTitle}</h2><p className="dialog-subtitle">{t.pasteHint}</p><textarea className="paste-area" value={pasteText} aria-label={t.paste} placeholder={'User: …\nAssistant: …'} onChange={e => setPasteText(e.target.value)} /><div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>{t.cancel}</button><button className="button primary" disabled={importing || !pasteText.trim()} onClick={() => void openText(pasteText, 'pasted-conversation.txt')}>{t.parseText}<ArrowRight size={15} /></button></div></Dialog>}
    {dialog === 'export' && <Dialog close={() => setDialog(null)} label={t.export}><div className="dialog-eyebrow"><Package size={18} />{t.ready}</div><h2>{t.exportTitle}</h2><p className="dialog-subtitle">{t.exportSub}</p><div className="export-formats">{([{ format: 'markdown', title: 'markdown', hint: 'markdownHint', icon: FileText, ext: '.md' }, { format: 'jsonl', title: 'jsonl', hint: 'jsonlHint', icon: FileJson, ext: '.jsonl' }, { format: 'report', title: 'report', hint: 'reportHint', icon: ShieldCheck, ext: '.json' }] as const).map(({ format, title, hint, icon: Icon, ext }) => <button key={format} onClick={() => exportFile(format)}><span className="format-icon"><Icon size={21} strokeWidth={1.5} /></span><span><strong>{t[title]}</strong><small>{t[hint]}</small></span><span className="format-ext">{ext}</span><ArrowDownToLine size={16} /></button>)}</div><p className="export-disclaimer">{t.reviewNote}</p><p className="export-disclaimer">{t.exportWarning}</p></Dialog>}
  </div>;
}
