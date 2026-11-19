import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Copy, Download, FileJson, FileText, Globe2, HelpCircle, ImageMinus, Layers, LoaderCircle, LockKeyhole, Mail, Package, Pin, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Terminal, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DEFAULT_OPTIONS, validateCustomSecrets } from './core';
import type { CleanOptions, Role } from './core';
import { createDemo } from './demo';
import { dictionary, htmlLanguage, resolveLanguage, SUPPORTED_LANGUAGES } from './i18n';
import type { Lang, TranslationKey } from './i18n';
import { useConversationDrafts } from './hooks/useConversationDrafts';
import { useWorkerClient } from './hooks/useWorkerClient';
import MessageCard from './components/MessageCard';
import { APP_VERSION } from './version';
import { startPwa, applyUpdate } from './pwa';
import type { ParseInfo, CleanSummary, QueryResult, ExportResult, HandoffResult, ImportProgress } from './worker/types';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
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

function Dialog({ children, close, label, closeLabel }: { children: ReactNode; close: () => void; label: string; closeLabel: string }) {
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
      <button className="icon-button dialog-close" aria-label={closeLabel} onClick={close}><X size={20} /></button>{children}
    </div>
  </div>;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => { try { return resolveLanguage(localStorage.getItem('threadpack-language'), navigator.languages); } catch { return resolveLanguage(null, navigator.languages); } });
  const t = dictionary(lang);
  const [view, setView] = useState<'workbench' | 'handoff'>('workbench');
  const [dialog, setDialog] = useState<'help' | 'paste' | 'export' | null>(null);
  const [archive, setArchive] = useState<ParseInfo | null>(null);
  const [selected, setSelected] = useState('');
  const [processed, setProcessed] = useState<(CleanSummary & { generation: number; optionsKey: string }) | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [querying, setQuerying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [handoffText, setHandoffText] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filename, setFilename] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<CleanOptions>({ ...DEFAULT_OPTIONS });
  const [mode, setMode] = useState<'cleaned' | 'original'>('cleaned');
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [changedOnly, setChangedOnly] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState('');
  const [page, setPage] = useState(0);
  const { pins, notes, recent, budget, setPins, setNotes, setRecent, setBudget, clearDrafts } = useConversationDrafts(selected);
  const [pasteText, setPasteText] = useState('');
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const { request, stop: stopWorker } = useWorkerClient();
  const importGeneration = useRef(0);
  const activeArchiveId = useRef<number | null>(null);
  const cleanupGeneration = useRef(0);
  const optionsKey = JSON.stringify(options);
  const currentConversation = archive?.conversations.find(c => c.id === selected);

  useEffect(() => {
    const stop = startPwa(() => setUpdateReady(true));
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    return () => { stop(); window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installed); };
  }, []);
  useEffect(() => { document.documentElement.lang = htmlLanguage(lang); try { localStorage.setItem('threadpack-language', lang); } catch { /* Optional preference only. */ } }, [lang]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { setPage(0); }, [filter, query, selected, mode, changedOnly]);

  useEffect(() => {
    if (!archive || !selected) return;
    let active = true;
    const generation = ++cleanupGeneration.current;
    setBusy(true);
    setProcessed(null); setPreview(null);
    request<CleanSummary>({ type: 'clean', archiveId: archive.archiveId, conversationId: selected, options }).then(data => {
      if (active && generation === cleanupGeneration.current) { setProcessed({ ...data, generation, optionsKey }); setBusy(false); }
    }).catch(err => { if (active && err.message !== 'Cancelled') { setError(err.message); setBusy(false); } });
    return () => { active = false; };
  }, [archive, selected, options, optionsKey, request]);

  useEffect(() => {
    if (!archive || !processed || busy || processed.generation !== cleanupGeneration.current || processed.optionsKey !== optionsKey) return;
    let active = true;
    setQuerying(true);
    request<QueryResult>({ type: 'query', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision,
      mode, query: deferredQuery, role: filter, changedOnly, page, pageSize: 30 }).then(data => {
      if (active && processed.generation === cleanupGeneration.current) { setPreview(data); setQuerying(false); messageList.current?.scrollTo({ top: 0 }); }
    }).catch(err => { if (active && processed.generation === cleanupGeneration.current && err.message !== 'Cancelled') { setError(err.message); setPreview(null); setQuerying(false); } });
    return () => { active = false; };
  }, [archive, processed, selected, busy, optionsKey, mode, deferredQuery, filter, changedOnly, page, request]);

  useEffect(() => {
    if (!archive || !processed || busy || processed.generation !== cleanupGeneration.current || processed.optionsKey !== optionsKey) { setHandoffText(''); setHandoffBusy(false); return; }
    let active = true;
    setHandoffText('');
    setHandoffBusy(true);
    request<HandoffResult>({ type: 'handoff', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision,
      notes, pinnedIds: pins, recentCount: recent, maxCharacters: budget }).then(data => {
      if (active && processed.generation === cleanupGeneration.current) { setHandoffText(data.text); setHandoffBusy(false); }
    }).catch(err => { if (active && processed.generation === cleanupGeneration.current && err.message !== 'Cancelled') { setError(err.message); setHandoffText(''); setHandoffBusy(false); } });
    return () => { active = false; };
  }, [archive, processed, selected, busy, optionsKey, notes, pins, recent, budget, request]);

  async function importArchive(name: string, content: { text?: string; file?: File }, isDemo = false) {
    const generation = ++importGeneration.current;
    if ((content.file?.size ?? byteLength(content.text ?? '')) > MAX_BYTES) { setError(t.tooLarge); setImporting(false); return; }
    setImporting(true); setImportProgress(null); setError('');
    try {
      const result = await request<ParseInfo>({ type: 'parse', archiveId: generation, keepArchiveId: activeArchiveId.current,
        ...content, filename: name }, progress => { if (generation === importGeneration.current) setImportProgress(progress); });
      if (generation !== importGeneration.current) return;
      if (!result.conversations.length) throw new Error(t.noConversation);
      activeArchiveId.current = result.archiveId;
      setArchive(result); setSelected(result.conversations[0].id); setProcessed(null); setPreview(null);
      setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); setChangedOnly(false);
      setFilename(name); setDemo(isDemo); clearDrafts(); setQuery(''); setFilter('all'); setMode('cleaned'); setPage(0);
      setSettingsOpen(false); setView('workbench'); setDialog(null); setPasteText(''); window.scrollTo({ top: 0 });
    } catch (err) { if (generation === importGeneration.current && (err as Error).message !== 'Cancelled') setError(err instanceof Error ? err.message : t.errorTitle); }
    finally { if (generation === importGeneration.current) { setImporting(false); setImportProgress(null); } }
  }
  const openText = (text: string, name: string, isDemo = false) => importArchive(name, { text }, isDemo);
  const openFile = (file: File) => importArchive(file.name, { file });

  function clear() {
    activeArchiveId.current = null; ++importGeneration.current; ++cleanupGeneration.current; stopWorker();
    setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); setChangedOnly(false);
    setArchive(null); setProcessed(null); setPreview(null); setSelected(''); setFilename(''); clearDrafts(); setQuery(''); setPasteText('');
    setError(''); setBusy(false); setImporting(false); setImportProgress(null); setQuerying(false); setExporting(false); setHandoffBusy(false);
    setHandoffText(''); setDemo(false); setView('workbench'); setSettingsOpen(false); setToast(t.cleared);
  }
  function selectConversation(id: string) { setSelected(id); setProcessed(null); setPreview(null); setError(''); }
  function toggle(key: keyof CleanOptions) { setOptions(previous => ({ ...previous, [key]: !previous[key] })); }
  function togglePin(id: string) { setPins(previous => previous.includes(id) ? previous.filter(p => p !== id) : [...previous, id]); }
  function applyCustomRules() {
    try {
      const values = validateCustomSecrets(customText.split(/\r?\n/).filter(value => value.trim()));
      setOptions(previous => ({ ...previous, customSecrets: values })); setCustomError('');
    } catch { setCustomError(t.customInvalid); }
  }
  function clearCustomRules() { setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); }
  function resetRecipe() { setOptions({ ...DEFAULT_OPTIONS }); setCustomText(''); setCustomError(''); }

  function download(content: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500); setToast(t.downloaded);
  }
  async function exportFile(format: 'markdown' | 'jsonl' | 'report') {
    if (!archive || !processed || working) return;
    const generation = importGeneration.current;
    setExporting(true);
    try {
      const result = await request<ExportResult>({ type: 'export', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision, format });
      if (generation !== importGeneration.current) return;
      download(result.buffer, result.filename, result.mimeType); setDialog(null);
    } catch (err) { if (generation === importGeneration.current && (err as Error).message !== 'Cancelled') { setError(t.exportFailed); setDialog(null); } }
    finally { if (generation === importGeneration.current) setExporting(false); }
  }
  async function copyHandoff() {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(handoffText); setToast(t.copied); }
    catch { setToast(t.clipboardError); }
  }
  async function installApp() {
    if (!installPrompt) return;
    try { await installPrompt.prompt(); await installPrompt.userChoice; } catch { /* Installation is optional. */ }
    setInstallPrompt(null);
  }

  const visible = preview?.items ?? [];
  const pageCount = preview?.pageCount ?? 1;
  const safePage = preview?.page ?? 0;
  const stats = processed?.stats;
  const reduction = stats && stats.beforeBytes ? Math.max(0, 100 * (1 - stats.afterBytes / stats.beforeBytes)) : 0;
  const working = busy || importing || querying || deferredQuery !== query || exporting || !!processed && processed.optionsKey !== optionsKey;
  const changeRows: { key: 'imagesRemoved' | 'outputsTrimmed' | 'duplicatesRemoved' | 'secretsRedacted' | 'emailsRedacted' | 'customRedacted'; icon: LucideIcon }[] = [
    { key: 'imagesRemoved', icon: ImageMinus }, { key: 'outputsTrimmed', icon: Terminal }, { key: 'duplicatesRemoved', icon: Copy },
    { key: 'secretsRedacted', icon: ShieldCheck }, { key: 'emailsRedacted', icon: Mail }, { key: 'customRedacted', icon: LockKeyhole },
  ];

  return <div className={`app-shell ${archive ? 'has-archive' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) void openFile(e.dataTransfer.files[0]); }}>
    <header className="site-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('workbench'); }} aria-label="ThreadPack"><span className="brand-icon"><Package size={21} strokeWidth={1.7} /></span><span>Thread<span className="brand-light">Pack</span><span className="version">v{APP_VERSION}</span></span></a>
      <nav className="main-nav" aria-label={t.workbench}>
        <button className={view === 'workbench' ? 'selected' : ''} onClick={() => setView('workbench')}>{t.workbench}</button>
        <button className={view === 'handoff' ? 'selected' : ''} onClick={() => setView('handoff')} disabled={!processed}>{t.handoff}{pins.length > 0 && <span className="nav-count">{pins.length}</span>}</button>
      </nav>
      <div className="header-actions">{installPrompt && <button className="install-button" onClick={() => void installApp()}><Download size={14} />{t.installApp}</button>}<button className="help-button" aria-label={t.help} onClick={() => setDialog('help')}><HelpCircle size={15} /><span>{t.help}</span></button><span className="header-divider" /><label className="language-picker"><Globe2 size={14} /><select aria-label="Language / 语言" value={lang} onChange={event => setLang(event.target.value as Lang)}>{SUPPORTED_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}</select><ChevronDown size={11} /></label></div>
    </header>

    <main className={archive ? 'loaded' : ''}>
      {updateReady && <div className="update-notice" role="status"><p>{t.updateReady}</p><button className="button secondary small" onClick={applyUpdate}>{t.updateApp}</button><button className="icon-button" aria-label={t.close} onClick={() => setUpdateReady(false)}><X size={16} /></button></div>}
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span />{t.heroLabel}</div><h1>{view === 'handoff' ? t.handoffTitle : t.heroTitle.split('\n').map((line, i) => <span key={line}>{line}{i === 0 && <br />}</span>)}</h1><p>{view === 'handoff' ? t.handoffSub : t.heroDescription}</p></div>
        <div className="hero-art" aria-hidden="true">
          <div className="reference-card reference-card-code"><div className="decoration-dots"><i /><i /><i /><span>conversation.jsonl</span></div><div className="decoration-code"><span>{'{ "role": "user",'}</span><span>{'  "content": "…" }'}</span><span className="code-muted">{'{ "role": "assistant",'}</span><span className="code-muted">{'  "content": "…" }'}</span></div><div className="decoration-footer"><FileJson size={12} /><ArrowRight size={12} /><FileText size={12} /><span>.md</span></div></div>
          <div className="reference-card reference-card-chart"><div className="decoration-chart-title"><Layers size={13} /><span>THREADPACK</span></div><div className="decoration-bars">{[37, 63, 48, 87, 61, 33, 20].map((height, index) => <i key={index} style={{ height: String(height) + '%' }} />)}</div><div className="decoration-baseline" /></div>
          <div className="reference-card reference-card-shield"><span><ShieldCheck size={21} /></span><div><strong>{t.privacy}</strong><small>{t.local}</small></div><Check size={14} /></div>
          <div className="reference-orbit"><Globe2 size={27} strokeWidth={1.3} /><strong>05</strong><span>EN · 中文 · 日本語<br />FR · ES</span></div>
        </div>
      </section>

      <div className="workbench-surface"><div className="workspace-kicker"><span /><strong>{view === 'handoff' ? t.handoff : t.workbench}</strong><span>{t.privacy}</span></div>
      <div className="privacy-strip"><span><LockKeyhole size={13} /><strong>{t.local}</strong></span><span className="privacy-formats">{t.supported}</span></div>

      {error && <div className="error-banner" role="alert"><div><strong>{t.errorTitle}</strong><p>{error}</p></div><button className="icon-button" aria-label={t.close} onClick={() => setError('')}><X size={17} /></button></div>}

      <section className={`import-panel ${archive ? 'has-file' : ''}`}>
        <input ref={input} type="file" accept=".jsonl,.ndjson,.json,.md,.txt,.log" aria-label={t.import} className="file-input" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
        {!archive ? <><button className="drop-target" disabled={importing} onClick={() => input.current?.click()}><span className="upload-icon"><Upload size={23} strokeWidth={1.6} /></span><span><strong>{t.drop}</strong><small>{t.dropHint}</small></span></button><div className="import-alternatives"><button className="button secondary" disabled={importing} onClick={() => void openText(createDemo(), 'checkout-session.jsonl', true)}><Sparkles size={15} />{t.demo}</button><button className="text-button" onClick={() => setDialog('paste')}><Clipboard size={14} />{t.paste}</button></div></> : <><div className="file-summary"><span className="file-icon"><FileText size={23} strokeWidth={1.5} /></span><div className="file-details"><div className="overline">{t.fileLabel}{demo && <span className="demo-badge">{t.demoBadge}</span>}</div><strong title={filename}>{filename}</strong><small>{archive.format} <span>·</span> {bytes(archive.sourceBytes)}</small></div></div><div className="file-controls">{archive.conversations.length > 1 && <div className="select-wrap"><select aria-label={t.conversations} value={selected} onChange={e => selectConversation(e.target.value)}>{archive.conversations.map((c, i) => <option key={c.id} value={c.id}>{i + 1}. {c.title.slice(0, 100)}</option>)}</select><ChevronDown size={14} /></div>}<button className="button secondary small" onClick={() => input.current?.click()}><Upload size={14} />{t.changeFile}</button><button className="icon-button muted" aria-label={t.clear} title={t.clear} onClick={clear}><Trash2 size={16} /></button></div></>}
      </section>

      {importing && <div className="import-loading" role="status"><div className="import-progress"><strong><LoaderCircle size={17} className="spin" />{importProgress && importProgress.loaded < importProgress.total ? t.readingFile : t.parsingFile}</strong>{importProgress && <><progress max={Math.max(1, importProgress.total)} value={importProgress.loaded} /><small>{bytes(importProgress.loaded)} / {bytes(importProgress.total)}</small></>}</div><button className="button secondary small" onClick={clear}>{t.cancelImport}</button></div>}

      {archive?.warnings.length ? <details className="warnings"><summary>{t.warnings} <span>{archive.warnings.length}</span></summary><ul>{archive.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details> : null}

      {archive && <section className="metrics" aria-label={t.payloadHint}>
        <div className="metric"><div className="metric-title">{t.sourceSize}<FileText size={14} /></div><strong>{stats ? bytes(stats.beforeBytes) : '—'}</strong><small>{t.payloadHint}</small></div>
        <div className="metric"><div className="metric-title">{t.cleanSize}<Package size={14} /></div><strong>{stats ? bytes(stats.afterBytes) : '—'}</strong><div className="mini-bars" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} className={stats && i < Math.max(1, Math.ceil(24 * stats.afterBytes / Math.max(stats.beforeBytes, stats.afterBytes, 1))) ? 'filled' : ''} />)}</div></div>
        <div className="metric metric-saved"><div className="metric-title">{t.saved}<ArrowDownToLine size={14} /></div><strong>{stats ? reduction.toFixed(1) : '—'}<span>%</span></strong><small>{stats ? `${bytes(stats.removedBytes)} ${t.removed}` : '—'}</small></div>
        <div className="metric"><div className="metric-title">{t.messages}<Layers size={14} /></div><strong>{currentConversation?.messageCount.toLocaleString() ?? '—'}</strong><small>{pins.length} {t.pinned}</small></div>
      </section>}

      {archive && view === 'workbench' && <div className="workspace-grid">
        <button className="settings-toggle button secondary" aria-label={t.recipe} aria-expanded={settingsOpen} aria-controls="cleanup-settings" onClick={() => setSettingsOpen(value => !value)}><Settings2 size={16} />{t.recipe}<ChevronDown size={14} className={settingsOpen ? 'rotate' : ''} /></button>
        <aside id="cleanup-settings" className={`recipe-panel panel ${settingsOpen ? 'settings-open' : ''}`}><div className="panel-heading"><div><h2>{t.recipe}</h2><p>{t.recipeSub}</p></div><button className="icon-button muted" title={t.reset} aria-label={t.reset} onClick={resetRecipe}><RotateCcw size={15} /></button></div>
          <div className="recipe-controls"><Toggle title={t.stripImages} hint={t.stripImagesHint} icon={ImageMinus} checked={options.stripImages} onChange={() => toggle('stripImages')} /><Toggle title={t.trimTools} hint={t.trimToolsHint} icon={Terminal} checked={options.trimToolOutputs} onChange={() => toggle('trimToolOutputs')} />
            {options.trimToolOutputs && <div className="range-control"><div><label htmlFor="tool-limit">{t.toolLimit}</label><output htmlFor="tool-limit">{options.toolLimit.toLocaleString()}</output></div><input id="tool-limit" type="range" min="500" max="12000" step="500" value={options.toolLimit} onChange={e => setOptions(o => ({ ...o, toolLimit: Number(e.target.value) }))} /><div className="range-labels"><span>500</span><span>12,000</span></div></div>}
            <Toggle title={t.dedup} hint={t.dedupHint} icon={Copy} checked={options.deduplicate} onChange={() => toggle('deduplicate')} /><div className="recipe-divider" /><Toggle title={t.redact} hint={t.redactHint} icon={ShieldCheck} checked={options.redact} onChange={() => toggle('redact')} /><Toggle title={t.emails} hint={t.emailsHint} icon={Mail} checked={options.redactEmails} onChange={() => toggle('redactEmails')} />
            <details className="custom-rules"><summary><LockKeyhole size={14} />{t.customRules}<span>{options.customSecrets?.length ?? 0}</span></summary><p>{t.customHint}</p><label htmlFor="custom-values">{t.customValues}</label><textarea id="custom-values" rows={4} maxLength={51000} autoComplete="off" spellCheck={false} value={customText} placeholder={'internal.example.test\ncustomer-reference-123'} onChange={e => { setCustomText(e.target.value); setCustomError(''); }} />{customError && <p className="custom-error" role="alert">{customError}</p>}<div className="custom-rule-actions"><button className="button secondary small" onClick={applyCustomRules}>{t.applyCustom}</button><button className="text-button" onClick={clearCustomRules}>{t.clearCustom}</button></div></details>
          </div>
          <div className="privacy-card"><ShieldCheck size={21} strokeWidth={1.4} /><strong>{t.privacyTitle}</strong><p>{t.privacyDescription}</p><span>{t.reviewNote}</span></div>
        </aside>
        <section className="preview-panel panel"><div className="panel-heading preview-heading"><div><h2>{t.preview}<span className="count-badge">{currentConversation?.messageCount ?? 0}</span></h2><p>{preview ? preview.total.toLocaleString() + ' ' + t.resultCount : t.previewSub}</p></div><div className="segmented" aria-label={t.preview}><button aria-pressed={mode === 'cleaned'} className={mode === 'cleaned' ? 'active' : ''} onClick={() => setMode('cleaned')}>{t.cleaned}</button><button aria-pressed={mode === 'original'} className={mode === 'original' ? 'active' : ''} onClick={() => setMode('original')}>{t.original}</button></div></div>
          <div className="preview-toolbar"><div className="preview-filters"><div className="role-filter">{(['all', 'user', 'assistant', 'tool'] as const).map(role => <button key={role} aria-pressed={filter === role} className={filter === role ? 'active' : ''} onClick={() => setFilter(role)}>{t[role]}</button>)}</div><button className={`changed-filter ${changedOnly ? 'active' : ''}`} aria-pressed={changedOnly} onClick={() => setChangedOnly(value => !value)}><Check size={11} />{t.changedOnly}</button></div><label className="search-box"><Search size={14} /><input type="search" maxLength={1000} value={query} placeholder={t.search} aria-label={t.search} onChange={e => setQuery(e.target.value)} /></label></div>
          {mode === 'original' && <div className="original-warning"><LockKeyhole size={14} />{t.originalWarning}</div>}
          <div ref={messageList} className={`messages-list ${working ? 'processing' : ''}`} aria-busy={working}>
            {working && <div className="processing-overlay" role="status"><span><LoaderCircle size={17} className="spin" />{t.processing}</span></div>}
            {processed && !visible.length && <p className="no-results">{t.noResults}</p>}
            {visible.map(({ message, index, bytes: messageBytes, changes, shortened }) => <MessageCard key={`${selected}-${mode}-${message.id}`} message={message} index={index} sizeLabel={bytes(messageBytes)} pinned={pins.includes(message.id)} onPin={() => togglePin(message.id)} changes={changes} query={deferredQuery} sourceShortened={shortened} t={t} />)}
          </div>
          {pageCount > 1 && <div className="pagination"><button className="text-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={15} />{t.prev}</button><span>{safePage + 1} / {pageCount}</span><button className="text-button" disabled={safePage === pageCount - 1} onClick={() => setPage(safePage + 1)}>{t.next}<ChevronRight size={15} /></button></div>}
          <div className="changes-panel"><div className="overline">{t.changes}</div><div className="changes-list">{changeRows.filter(row => (row.key !== 'emailsRedacted' || options.redactEmails) && (row.key !== 'customRedacted' || !!options.customSecrets?.length)).map(({ key, icon: Icon }) => <span key={key} className={stats?.[key] ? 'has-changes' : ''}><Icon size={13} /><strong>{stats?.[key] ?? 0}</strong>{t[key]}</span>)}</div></div>
        </section>
      </div>}

      {archive && view === 'handoff' && processed && <div className="handoff-grid"><section className="notes-panel panel"><div className="panel-heading"><div><h2>{t.notes}</h2><p>{pins.length} {t.pinned}</p></div><Pin size={17} /></div><div className="notes-body">{(['goal', 'decisions', 'constraints', 'nextSteps'] as const).map(key => <label className="note-field" key={key}><span>{t[key]}</span><textarea value={notes[key]} maxLength={12000} placeholder={t[`${key}Hint`]} rows={key === 'goal' ? 2 : 3} onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))} /></label>)}<div className="handoff-settings"><label>{t.recent}<select value={recent} onChange={e => setRecent(Number(e.target.value))}>{[0, 4, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select></label><label>{t.budget}<select value={budget} onChange={e => setBudget(Number(e.target.value))}>{[6000, 12000, 24000, 48000].map(n => <option key={n} value={n}>{n.toLocaleString()} {t.characters}</option>)}</select></label></div><p className="field-note">{t.pinsHint}</p><p className="field-note draft-note">{t.draftHint}</p></div></section><section className="handoff-preview panel"><div className="panel-heading"><div><h2>{t.handoffPreview}</h2><p>{bytes(byteLength(handoffText))} · {handoffText.length.toLocaleString()} {t.characters}</p></div><span className="document-badge">.md</span></div><pre className="handoff-document">{handoffText}</pre><div className="handoff-note"><ShieldCheck size={15} />{t.handoffNote}</div></section></div>}

      {archive && <section className="export-bar"><div className="export-copy"><span className="ready-mark"><Check size={19} /></span><div><strong>{view === 'handoff' ? t.handoffPreview : t.ready}</strong><small>{view === 'handoff' ? t.handoffNote : t.exportHint}</small></div></div><div className="export-actions">{view === 'handoff' ? <><button className="button secondary" disabled={working || handoffBusy || !handoffText} onClick={() => void copyHandoff()}><Clipboard size={15} />{t.copy}</button><button className="button primary" disabled={working || handoffBusy || !handoffText} onClick={() => download(handoffText, 'threadpack-handoff.md', 'text/markdown;charset=utf-8')}><ArrowDownToLine size={16} />{t.downloadHandoff}</button></> : <><button className="button secondary" disabled={working || !processed} onClick={() => setView('handoff')}>{t.buildHandoff}<ArrowUpRight size={15} /></button><button className="button primary" disabled={working || !processed} onClick={() => setDialog('export')}><ArrowDownToLine size={16} />{t.export}</button></>}</div></section>}

      {!archive && !importing && <section className="empty-state"><div className="empty-symbol"><Layers size={26} strokeWidth={1.2} /><span><ArrowRight size={12} /></span></div><h2>{t.emptyTitle}</h2><p>{t.emptyBody}</p><div className="empty-formats"><span><Terminal size={13} />Codex & Claude Code</span><span><FileJson size={13} />ChatGPT & Claude</span><span><FileText size={13} />Markdown & text</span></div></section>}
      </div>
    </main>

    <footer className="site-footer"><span className="footer-brand"><Package size={15} />ThreadPack <span>·</span> {t.footer}</span><span><span className="status-dot" />{t.privacy}<span className="footer-separator">/</span>MIT License</span></footer>
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {dragging && <div className="drag-overlay"><div><Upload size={44} /><h2>{t.drop}</h2><p>{t.dropHint}</p></div></div>}

    {dialog === 'help' && <Dialog close={() => setDialog(null)} label={t.help} closeLabel={t.close}><div className="dialog-eyebrow"><Package size={18} />THREADPACK</div><h2>{t.helpTitle}</h2><div className="help-steps">{[1, 2, 3].map(n => <div key={n}><strong>{t[`help${n}Title` as TranslationKey]}</strong><p>{t[`help${n}` as TranslationKey]}</p></div>)}</div><div className="help-notice"><h3><LockKeyhole size={15} />{t.helpPrivacy}</h3><p>{t.helpPrivacyText}</p><h3>{t.helpLimits}</h3><p>{t.helpLimitsText}</p></div></Dialog>}
    {dialog === 'paste' && <Dialog close={() => setDialog(null)} label={t.paste} closeLabel={t.close}><div className="dialog-eyebrow"><Clipboard size={17} />{t.paste}</div><h2>{t.pasteTitle}</h2><p className="dialog-subtitle">{t.pasteHint}</p><textarea className="paste-area" value={pasteText} aria-label={t.paste} placeholder={'User: …\nAssistant: …'} onChange={e => setPasteText(e.target.value)} /><div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>{t.cancel}</button><button className="button primary" disabled={importing || !pasteText.trim()} onClick={() => void openText(pasteText, 'pasted-conversation.txt')}>{t.parseText}<ArrowRight size={15} /></button></div></Dialog>}
    {dialog === 'export' && <Dialog close={() => setDialog(null)} label={t.export} closeLabel={t.close}><div className="dialog-eyebrow"><Package size={18} />{t.ready}</div><h2>{t.exportTitle}</h2><p className="dialog-subtitle">{t.exportSub}</p><div className="export-formats">{([{ format: 'markdown', title: 'markdown', hint: 'markdownHint', icon: FileText, ext: '.md' }, { format: 'jsonl', title: 'jsonl', hint: 'jsonlHint', icon: FileJson, ext: '.jsonl' }, { format: 'report', title: 'report', hint: 'reportHint', icon: ShieldCheck, ext: '.json' }] as const).map(({ format, title, hint, icon: Icon, ext }) => <button key={format} disabled={exporting} onClick={() => void exportFile(format)}><span className="format-icon"><Icon size={21} strokeWidth={1.5} /></span><span><strong>{t[title]}</strong><small>{t[hint]}</small></span><span className="format-ext">{ext}</span><ArrowDownToLine size={16} /></button>)}</div><p className="export-disclaimer">{t.reviewNote}</p><p className="export-disclaimer">{t.exportWarning}</p></Dialog>}
  </div>;
}
