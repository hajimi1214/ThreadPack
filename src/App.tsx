import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Code2, Command, Copy, Download, Eye, FileJson, FileText, Globe2, HelpCircle, ImageMinus, Layers, Link, LoaderCircle, LockKeyhole, Mail, Package, Pin, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Terminal, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DEFAULT_OPTIONS, validateCustomSecrets } from './core';
import type { CleanOptions, Role } from './core';
import { createDemo } from './demo';
import { dictionary, htmlLanguage, resolveLanguage, SUPPORTED_LANGUAGES } from './i18n';
import type { Lang, TranslationKey } from './i18n';
import { useConversationDrafts } from './hooks/useConversationDrafts';
import { useWorkerClient } from './hooks/useWorkerClient';
import { useMediaQuery } from './hooks/useMediaQuery';
import { isRedactionDraftDirty } from './redaction-draft';
import { applyCleanupRecipe, identifyCleanupRecipe } from './cleanup-recipes';
import MessageCard from './components/MessageCard';
import LandingShowcase from './components/LandingShowcase';
import CommandMenu from './components/CommandMenu';
import SnippetExplorer from './components/SnippetExplorer';
import MarkdownDocument from './components/MarkdownDocument';
import type { QuickAction } from './components/CommandMenu';
import THIRD_PARTY_NOTICES from '../public/third-party-licenses.txt?raw';
import { APP_VERSION } from './version';
import { startPwa, applyUpdate } from './pwa';
import type { ParseInfo, CleanSummary, QueryResult, ExportResult, ContextBundleResult, ExcerptExportResult, HandoffResult, ImportProgress, CopyMessageResult, CompareMessageResult } from './worker/types';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type PendingAction = { kind: 'clear' } | { kind: 'import'; name: string; content: { text?: string; file?: File }; isDemo: boolean };
const MAX_BYTES = 100 * 1024 * 1024;
const NO_PIN_FILTER: string[] = [];
const PROJECT_URL = 'https://hajimi1214.github.io/ThreadPack/';
const reviewChangeLabels = { image: 'imagesRemoved', tool: 'outputsTrimmed', duplicate: 'duplicatesRemoved', secret: 'secretsRedacted', email: 'emailsRedacted', custom: 'customRedacted' } as const;
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(2)} MiB`;
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

function ThirdPartyNotices({ t }: { t: Record<TranslationKey, string> }) {
  return <details className="third-party-notices"><summary>{t.thirdPartyNotices}</summary><pre>{THIRD_PARTY_NOTICES}</pre></details>;
}

function Toggle({ title, hint, icon: Icon, checked, onChange }: { title: string; hint: string; icon: LucideIcon; checked: boolean; onChange: () => void }) {
  return <button className={`toggle-row ${checked ? 'enabled' : ''}`} role="switch" aria-checked={checked} aria-label={title} onClick={onChange}>
    <span className="toggle-icon"><Icon size={17} strokeWidth={1.65} /></span>
    <span className="toggle-copy"><strong>{title}</strong><small>{hint}</small></span>
    <span className="switch"><span /></span>
  </button>;
}

function MarkdownViewToggle({ enabled, onChange, t }: { enabled: boolean; onChange: () => void; t: Record<TranslationKey, string> }) {
  return <div className="segmented markdown-view-toggle" role="group" aria-label={t.viewFormat}>
    <button aria-label={t.plainTextView} title={t.plainTextView} aria-pressed={!enabled} className={!enabled ? 'active' : ''} onClick={() => { if (enabled) onChange(); }}><FileText size={13} /><span>{t.plainTextView}</span></button>
    <button aria-label={t.markdownView} title={t.markdownView} aria-pressed={enabled} className={enabled ? 'active' : ''} onClick={() => { if (!enabled) onChange(); }}><BookOpen size={13} /><span>{t.markdownView}</span></button>
  </div>;
}

function Dialog({ children, close, label, closeLabel, className = '' }: { children: ReactNode; close: () => void; label: string; closeLabel: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('button, textarea, input, select'))?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])].filter(item => item.getClientRects().length > 0);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) {
        event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={label}>
      <button className="icon-button dialog-close" aria-label={closeLabel} onClick={close}><X size={20} /></button>{children}
    </div>
  </div>;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => { try { return resolveLanguage(localStorage.getItem('threadpack-language'), navigator.languages); } catch { return resolveLanguage(null, navigator.languages); } });
  const t = dictionary(lang);
  const [view, setView] = useState<'workbench' | 'handoff'>('workbench');
  const [dialog, setDialog] = useState<'help' | 'paste' | 'export' | 'excerpt' | 'compare' | 'commands' | 'snippets' | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [archive, setArchive] = useState<ParseInfo | null>(null);
  const [selected, setSelected] = useState('');
  const [processed, setProcessed] = useState<(CleanSummary & { generation: number; optionsKey: string }) | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [querying, setQuerying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'jsonl' | 'report' | 'bundle' | null>(null);
  const [handoffCopyState, setHandoffCopyState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [handoffText, setHandoffText] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState(false);
  const [messageReview, setMessageReview] = useState<{ messageId: string; result: CompareMessageResult } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const isCompact = useMediaQuery('(max-width: 800px)');
  const [filename, setFilename] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<CleanOptions>({ ...DEFAULT_OPTIONS });
  const [mode, setMode] = useState<'cleaned' | 'original'>('cleaned');
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [changedOnly, setChangedOnly] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState('');
  const [page, setPage] = useState(0);
  const { pins, notes, recent, budget, setPins, setNotes, setRecent, setBudget, clearDrafts, hasNotes } = useConversationDrafts(selected);
  const [pasteText, setPasteText] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const goalInput = useRef<HTMLTextAreaElement>(null);
  const customRules = useRef<HTMLDetailsElement>(null);
  const readingPositions = useRef(new Map<string, number>());
  const messageReviewGeneration = useRef(0);
  const notificationSequence = useRef(0);
  const exportLock = useRef(false);
  const exportGeneration = useRef(0);
  const handoffCopyLock = useRef(false);
  const shareLock = useRef(false);
  const handoffCopyGeneration = useRef(0);
  const { request, stop: stopWorker } = useWorkerClient();
  const importGeneration = useRef(0);
  const activeArchiveId = useRef<number | null>(null);
  const cleanupGeneration = useRef(0);
  const optionsKey = JSON.stringify(options);
  const customDirty = isRedactionDraftDirty(customText, options.customSecrets);
  const currentConversation = archive?.conversations.find(c => c.id === selected);
  const activeRecipe = identifyCleanupRecipe(options);
  const activeRecipeHint: TranslationKey = activeRecipe === 'share-safe' ? 'shareSafeRecipeHint'
    : activeRecipe === 'keep-text' ? 'keepTextRecipeHint' : activeRecipe === 'balanced' ? 'balancedRecipeHint' : 'customRecipeHint';
  const queryPinnedIds = pinnedOnly ? pins : NO_PIN_FILTER;
  const readingPositionKey = archive ? JSON.stringify([archive.archiveId, selected, mode, deferredQuery, filter, changedOnly, pinnedOnly, pinnedOnly ? [...pins].sort() : [], page]) : '';
  const actionContext = JSON.stringify([archive?.archiveId, selected, processed?.revision, mode, customDirty, optionsKey]);
  const actionContextRef = useRef(actionContext);
  actionContextRef.current = actionContext;
  const handoffCopyContext = JSON.stringify([actionContext, handoffText, notes, recent, budget]);
  const handoffCopyContextRef = useRef(handoffCopyContext);
  handoffCopyContextRef.current = handoffCopyContext;
  const overlayOpen = dialog !== null || !!pendingAction || isCompact && settingsOpen;

  useEffect(() => {
    ++handoffCopyGeneration.current; handoffCopyLock.current = false; setHandoffCopyState('idle');
  }, [handoffCopyContext]);
  useEffect(() => {
    const stop = startPwa(() => setUpdateReady(true));
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    return () => { stop(); window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installed); };
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') void openText(createDemo(), 'checkout-session.jsonl', true);
  }, []);
  useEffect(() => { document.documentElement.lang = htmlLanguage(lang); try { localStorage.setItem('threadpack-language', lang); } catch { /* Optional preference only. */ } }, [lang]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    if (shareState !== 'success' && shareState !== 'error') return;
    const timer = setTimeout(() => setShareState('idle'), 2200);
    return () => clearTimeout(timer);
  }, [shareState]);
  useEffect(() => {
    if (handoffCopyState !== 'success' && handoffCopyState !== 'error') return;
    const timer = setTimeout(() => setHandoffCopyState('idle'), 2200);
    return () => clearTimeout(timer);
  }, [handoffCopyState]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      if (pendingAction || settingsOpen || dialog && dialog !== 'commands') return;
      event.preventDefault(); setDialog(value => value === 'commands' ? null : 'commands');
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [dialog, pendingAction, settingsOpen]);
  useEffect(() => { setPage(0); }, [filter, query, selected, mode, changedOnly, pinnedOnly]);
  useLayoutEffect(() => {
    if (!archive) return;
    window.scrollTo({ top: 0 });
    if (view === 'handoff') { if (!isCompact) goalInput.current?.focus({ preventScroll: true }); }
    else {
      if (messageList.current) messageList.current.scrollTop = readingPositions.current.get(readingPositionKey) ?? 0;
      previewPanel.current?.focus({ preventScroll: true });
    }
  }, [view, archive, selected, isCompact]);
  useEffect(() => { if (!isCompact) setSettingsOpen(false); }, [isCompact]);

  useEffect(() => {
    if (!archive || !selected) return;
    let active = true;
    const generation = ++cleanupGeneration.current;
    setBusy(true);
    setProcessed(null);
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
      mode, query: deferredQuery, role: filter, changedOnly, pinnedOnly, pinnedIds: queryPinnedIds, page, pageSize: 30 }).then(data => {
      if (active && processed.generation === cleanupGeneration.current) {
        setPreview(data); setQuerying(false);
      }
    }).catch(err => { if (active && processed.generation === cleanupGeneration.current && err.message !== 'Cancelled') { setError(err.message); setPreview(null); setQuerying(false); } });
    return () => { active = false; };
  }, [archive, processed, selected, busy, optionsKey, mode, deferredQuery, filter, changedOnly, pinnedOnly, queryPinnedIds, page, request]);
  useLayoutEffect(() => {
    if (archive && preview && messageList.current) messageList.current.scrollTop = readingPositions.current.get(readingPositionKey) ?? 0;
  }, [preview, archive, selected, readingPositionKey]);

  useEffect(() => {
    if (!archive || !processed || busy || processed.generation !== cleanupGeneration.current || processed.optionsKey !== optionsKey) { setHandoffText(''); setHandoffBusy(false); setHandoffError(false); return; }
    let active = true;
    setHandoffBusy(true);
    setHandoffError(false);
    const timer = setTimeout(() => {
      request<HandoffResult>({ type: 'handoff', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision,
        notes, pinnedIds: pins, recentCount: recent, maxCharacters: budget }).then(data => {
        if (active && processed.generation === cleanupGeneration.current) { setHandoffText(data.text); setHandoffBusy(false); setHandoffError(false); }
      }).catch(err => { if (active && processed.generation === cleanupGeneration.current && err.message !== 'Cancelled') { setError(err.message); setHandoffBusy(false); setHandoffError(true); } });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [archive, processed, selected, busy, optionsKey, notes, pins, recent, budget, request]);

  async function performImport(name: string, content: { text?: string; file?: File }, isDemo = false) {
    ++exportGeneration.current; exportLock.current = false; setExporting(false); setExportFormat(null);
    if (dialog === 'compare') closeMessageReview();
    else if (dialog === 'commands' || dialog === 'excerpt' || dialog === 'snippets') setDialog(null);
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
      readingPositions.current.clear();
      setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); setChangedOnly(false); setPinnedOnly(false);
      setFilename(name); setDemo(isDemo); clearDrafts(); setQuery(''); setFilter('all'); setMode('cleaned'); setPage(0);
      setSettingsOpen(false); setView('workbench'); setDialog(null); setPasteText(''); setHandoffCopyState('idle'); window.scrollTo({ top: 0 });
    } catch (err) { if (generation === importGeneration.current && (err as Error).message !== 'Cancelled') setError(err instanceof Error ? err.message : t.errorTitle); }
    finally { if (generation === importGeneration.current) { setImporting(false); setImportProgress(null); } }
  }
  function importArchive(name: string, content: { text?: string; file?: File }, isDemo = false) {
    if (hasNotes && !importing) {
      if (dialog === 'compare') closeMessageReview(); else setDialog(null);
      setSettingsOpen(false); setPendingAction({ kind: 'import', name, content, isDemo }); return Promise.resolve();
    }
    return performImport(name, content, isDemo);
  }
  const openText = (text: string, name: string, isDemo = false) => importArchive(name, { text }, isDemo);
  const openFile = (file: File) => importArchive(file.name, { file });

  function clearWorkspace() {
    ++exportGeneration.current; exportLock.current = false;
    ++messageReviewGeneration.current; setMessageReview(null); setReviewBusy(false);
    activeArchiveId.current = null; ++importGeneration.current; ++cleanupGeneration.current; stopWorker();
    setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); setChangedOnly(false); setPinnedOnly(false);
    setArchive(null); setProcessed(null); setPreview(null); setSelected(''); setFilename(''); clearDrafts(); setQuery(''); setPasteText('');
    setError(''); setBusy(false); setImporting(false); setImportProgress(null); setQuerying(false); setExporting(false); setHandoffBusy(false);
    setHandoffText(''); setDemo(false); setView('workbench'); setSettingsOpen(false); setDialog(null); setExportFormat(null); setHandoffCopyState('idle'); notify(t.cleared);
    readingPositions.current.clear();
  }
  function clear() { if (hasNotes && !importing) setPendingAction({ kind: 'clear' }); else clearWorkspace(); }
  function discardNotes() {
    const action = pendingAction; setPendingAction(null);
    if (action?.kind === 'clear') clearWorkspace();
    else if (action) void performImport(action.name, action.content, action.isDemo);
  }
  function navigate(next: 'workbench' | 'handoff') {
    if (archive && messageList.current) rememberReadingPosition(readingPositionKey, messageList.current.scrollTop);
    setView(next);
  }
  function finishSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => { previewPanel.current?.focus({ preventScroll: true }); previewPanel.current?.scrollIntoView({ block: 'nearest' }); });
  }
  function selectConversation(id: string) {
    setSelected(id); setProcessed(null); setPreview(null); setError('');
    setQuery(''); setFilter('all'); setChangedOnly(false); setPinnedOnly(false); setPage(0);
  }
  function notify(text: string, tone: 'success' | 'error' = 'success') { setToast({ text, tone, id: ++notificationSequence.current }); }
  function toggle(key: keyof CleanOptions) { setOptions(previous => ({ ...previous, [key]: !previous[key] })); }
  function togglePin(id: string) {
    notify(pins.includes(id) ? t.pinRemoved : t.pinAdded);
    setPins(previous => previous.includes(id) ? previous.filter(p => p !== id) : [...previous, id]);
  }
  function clearFilters() { setFilter('all'); setQuery(''); setChangedOnly(false); setPinnedOnly(false); setPage(0); }
  function rememberReadingPosition(key: string, top: number) {
    readingPositions.current.delete(key);
    readingPositions.current.set(key, top);
    while (readingPositions.current.size > 200) readingPositions.current.delete(readingPositions.current.keys().next().value!);
  }
  function applyCustomRules() {
    try {
      const values = validateCustomSecrets(customText.split(/\r?\n/).filter(value => value.trim()));
      setOptions(previous => ({ ...previous, customSecrets: values })); setCustomError(''); notify(t.rulesApplied);
    } catch {
      setCustomError(t.customInvalid);
      if (isCompact) setSettingsOpen(true);
      requestAnimationFrame(() => { if (customRules.current) customRules.current.open = true; document.getElementById('custom-values')?.focus(); });
    }
  }
  function clearCustomRules() { setCustomText(''); setCustomError(''); setOptions(previous => ({ ...previous, customSecrets: [] })); }
  function resetRecipe() { setOptions({ ...DEFAULT_OPTIONS }); setCustomText(''); setCustomError(''); notify(t.recipeReset); }

  function download(content: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500); notify(t.downloaded);
  }
  async function exportFile(format: 'markdown' | 'jsonl' | 'report' | 'bundle', excerpt = false) {
    if (!archive || !processed || working || customDirty || exportLock.current || excerpt && (format === 'report' || format === 'bundle' || !preview?.total)) return;
    const generation = importGeneration.current;
    const operation = ++exportGeneration.current;
    const context = actionContext;
    exportLock.current = true; setExporting(true); setExportFormat(format);
    try {
      const result = excerpt
        ? await request<ExcerptExportResult>({ type: 'export-excerpt', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision,
          format, mode, query: deferredQuery, role: filter, changedOnly, pinnedOnly, pinnedIds: queryPinnedIds })
        : format === 'bundle'
          ? await request<ContextBundleResult>({ type: 'export-bundle', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision,
            notes, pinnedIds: pins, recentCount: recent, maxCharacters: budget })
          : await request<ExportResult>({ type: 'export', archiveId: archive.archiveId, conversationId: selected, revision: processed.revision, format });
      if (operation !== exportGeneration.current || generation !== importGeneration.current || context !== actionContextRef.current) return;
      download(result.buffer, result.filename, result.mimeType); setDialog(null);
    } catch (err) { if (operation === exportGeneration.current && generation === importGeneration.current && (err as Error).message !== 'Cancelled') { setError(t.exportFailed); setDialog(null); } }
    finally { if (operation === exportGeneration.current) { exportLock.current = false; setExporting(false); setExportFormat(null); } }
  }
  async function copyHandoff() {
    if (customDirty || working || handoffBusy || !handoffText || handoffCopyLock.current) return;
    const generation = importGeneration.current;
    const operation = ++handoffCopyGeneration.current;
    const context = handoffCopyContext;
    handoffCopyLock.current = true; setHandoffCopyState('pending');
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(handoffText);
      if (generation === importGeneration.current && operation === handoffCopyGeneration.current && context === handoffCopyContextRef.current) { setHandoffCopyState('success'); notify(t.copied); }
    } catch { if (generation === importGeneration.current && operation === handoffCopyGeneration.current && context === handoffCopyContextRef.current) { setHandoffCopyState('error'); notify(t.clipboardError, 'error'); } }
    finally { if (operation === handoffCopyGeneration.current) handoffCopyLock.current = false; }
  }
  async function copyMessage(messageId: string): Promise<boolean> {
    if (!archive || !processed || working || customDirty || processed.optionsKey !== optionsKey) return false;
    const generation = importGeneration.current;
    const context = actionContext;
    try {
      const result = await request<CopyMessageResult>({ type: 'copy-message', archiveId: archive.archiveId, conversationId: selected,
        revision: processed.revision, messageId, mode });
      if (generation !== importGeneration.current || context !== actionContextRef.current) return false;
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(result.text);
      if (generation === importGeneration.current && context === actionContextRef.current) { notify(t.copiedMessage); return true; }
    } catch (err) {
      if (generation === importGeneration.current && context === actionContextRef.current && (err as Error).message !== 'Cancelled') notify(t.clipboardError, 'error');
    }
    return false;
  }
  async function reviewMessage(messageId: string) {
    if (!archive || !processed || working || customDirty || processed.optionsKey !== optionsKey) return;
    const generation = importGeneration.current;
    const reviewGeneration = ++messageReviewGeneration.current;
    setMessageReview(null); setReviewBusy(true); setDialog('compare');
    try {
      const result = await request<CompareMessageResult>({ type: 'compare-message', archiveId: archive.archiveId,
        conversationId: selected, revision: processed.revision, messageId });
      if (generation !== importGeneration.current || reviewGeneration !== messageReviewGeneration.current || processed.generation !== cleanupGeneration.current) return;
      setMessageReview({ messageId, result });
    } catch (err) {
      if (generation === importGeneration.current && reviewGeneration === messageReviewGeneration.current && (err as Error).message !== 'Cancelled') { setError(t.comparisonFailed); setDialog(null); }
    } finally { if (generation === importGeneration.current && reviewGeneration === messageReviewGeneration.current) setReviewBusy(false); }
  }
  function closeMessageReview() {
    ++messageReviewGeneration.current; setMessageReview(null); setReviewBusy(false); setDialog(null);
  }
  async function shareProject() {
    if (shareLock.current) return;
    shareLock.current = true; setShareState('pending');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(PROJECT_URL);
      setShareState('success'); notify(t.shareProjectCopied);
    } catch { setShareState('error'); notify(t.copyFailed, 'error'); }
    finally { shareLock.current = false; }
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
  const filtersActive = !!query || filter !== 'all' || changedOnly || pinnedOnly;
  const quickActions: QuickAction[] = [
    { id: 'import', label: t.import, keywords: 'open upload file', run: () => input.current?.click(), disabled: importing },
    { id: 'paste', label: t.paste, keywords: 'clipboard text', run: () => setDialog('paste'), disabled: importing },
    { id: 'demo', label: t.demo, keywords: 'sample example', run: () => void openText(createDemo(), 'checkout-session.jsonl', true), disabled: importing },
    { id: 'search', label: t.focusSearch, keywords: 'find filter', run: () => { navigate('workbench'); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus()); }, disabled: !archive },
    { id: 'filters', label: t.clearFilters, keywords: 'reset all', run: clearFilters, disabled: !filtersActive },
    { id: 'export', label: t.export, keywords: 'download markdown jsonl', run: () => setDialog('export'), disabled: !processed || working || customDirty },
    { id: 'excerpt', label: t.exportExcerpt, keywords: 'download matches filtered', run: () => setDialog('excerpt'), disabled: !preview?.total || working || customDirty },
    { id: 'snippets', label: t.codeSnippets, keywords: 'code extract snippets typescript python javascript zip filter', run: () => setDialog('snippets'), disabled: !processed || working || customDirty },
    { id: 'handoff', label: t.buildHandoff, keywords: 'notes context', run: () => navigate('handoff'), disabled: !processed || working },
    { id: 'balanced', label: t.balancedRecipe, keywords: 'recipe', run: () => { setOptions(current => applyCleanupRecipe(current, 'balanced')); notify(t.recipeApplied); }, disabled: !archive },
    { id: 'share', label: t.shareSafeRecipe, keywords: 'recipe email', run: () => { setOptions(current => applyCleanupRecipe(current, 'share-safe')); notify(t.recipeApplied); }, disabled: !archive },
    { id: 'first', label: t.firstPage, keywords: 'beginning', run: () => setPage(0), disabled: !archive || safePage === 0 },
    { id: 'last', label: t.lastPage, keywords: 'end', run: () => setPage(pageCount - 1), disabled: !archive || safePage === pageCount - 1 },
    { id: 'help', label: t.help, keywords: 'help guide', run: () => setDialog('help') },
  ];
  function executeQuickAction(action: QuickAction) {
    setDialog(null);
    requestAnimationFrame(action.run);
  }
  const changeRows: { key: 'imagesRemoved' | 'outputsTrimmed' | 'duplicatesRemoved' | 'secretsRedacted' | 'emailsRedacted' | 'customRedacted'; icon: LucideIcon }[] = [
    { key: 'imagesRemoved', icon: ImageMinus }, { key: 'outputsTrimmed', icon: Terminal }, { key: 'duplicatesRemoved', icon: Copy },
    { key: 'secretsRedacted', icon: ShieldCheck }, { key: 'emailsRedacted', icon: Mail }, { key: 'customRedacted', icon: LockKeyhole },
  ];

  const cleanupPanel = (
    <aside id="cleanup-settings" className={`recipe-panel panel ${settingsOpen ? 'settings-open' : ''}`}><div className="panel-heading"><div><h2>{t.recipe}</h2><p>{t.recipeSub}</p></div><button className="icon-button muted" title={t.reset} aria-label={t.reset} onClick={resetRecipe}><RotateCcw size={15} /></button></div>
          <div className="recipe-presets" role="group" aria-label={t.quickRecipes}>{([{ id: 'balanced', label: 'balancedRecipe', hint: 'balancedRecipeHint', icon: Sparkles }, { id: 'share-safe', label: 'shareSafeRecipe', hint: 'shareSafeRecipeHint', icon: ShieldCheck }, { id: 'keep-text', label: 'keepTextRecipe', hint: 'keepTextRecipeHint', icon: FileText }] as const).map(({ id, label, hint, icon: Icon }) => <button key={id} className={activeRecipe === id ? 'active' : ''} aria-pressed={activeRecipe === id} title={t[hint]} onClick={() => { setOptions(current => applyCleanupRecipe(current, id)); notify(t.recipeApplied); }}><Icon size={15} /><span>{t[label]}</span></button>)}</div><p className="recipe-preset-hint">{t[activeRecipeHint]}</p>
          <div className="recipe-controls"><Toggle title={t.stripImages} hint={t.stripImagesHint} icon={ImageMinus} checked={options.stripImages} onChange={() => toggle('stripImages')} /><Toggle title={t.trimTools} hint={t.trimToolsHint} icon={Terminal} checked={options.trimToolOutputs} onChange={() => toggle('trimToolOutputs')} />
            {options.trimToolOutputs && <div className="range-control"><div><label htmlFor="tool-limit">{t.toolLimit}</label><output htmlFor="tool-limit">{options.toolLimit.toLocaleString()}</output></div><input id="tool-limit" type="range" min="500" max="12000" step="500" value={options.toolLimit} onChange={e => setOptions(o => ({ ...o, toolLimit: Number(e.target.value) }))} /><div className="range-labels"><span>500</span><span>12,000</span></div></div>}
            <Toggle title={t.dedup} hint={t.dedupHint} icon={Copy} checked={options.deduplicate} onChange={() => toggle('deduplicate')} /><div className="recipe-divider" /><Toggle title={t.redact} hint={t.redactHint} icon={ShieldCheck} checked={options.redact} onChange={() => toggle('redact')} /><Toggle title={t.emails} hint={t.emailsHint} icon={Mail} checked={options.redactEmails} onChange={() => toggle('redactEmails')} />
            <details ref={customRules} className="custom-rules"><summary><LockKeyhole size={14} />{t.customRules}<span>{options.customSecrets?.length ?? 0}</span></summary><p>{t.customHint}</p><label htmlFor="custom-values">{t.customValues}</label><textarea id="custom-values" rows={4} maxLength={51000} autoComplete="off" spellCheck={false} value={customText} placeholder={'internal.example.test\ncustomer-reference-123'} onChange={e => { setCustomText(e.target.value); setCustomError(''); }} />{customError && <p className="custom-error" role="alert">{customError}</p>}<div className="custom-rule-actions"><button className="button secondary small" onClick={applyCustomRules}>{t.applyCustom}</button><button className="text-button" onClick={clearCustomRules}>{t.clearCustom}</button></div></details>
          </div>
          <div className="privacy-card compact-notice"><ShieldCheck size={16} /><span>{t.reviewNote}</span></div>
        </aside>
  );

  return <div className={`app-shell ${archive ? 'has-archive' : ''} ${view === 'handoff' ? 'handoff-view' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) void openFile(e.dataTransfer.files[0]); }}>
    <header className="site-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('workbench'); }} aria-label="ThreadPack"><span className="brand-icon"><Package size={21} strokeWidth={1.7} /></span><span>Thread<span className="brand-light">Pack</span><span className="version">v{APP_VERSION}</span></span></a>
      <nav className="main-nav" aria-label={t.workbench}>
        <button className={view === 'workbench' ? 'selected' : ''} onClick={() => navigate('workbench')}>{t.workbench}</button>
        <button className={view === 'handoff' ? 'selected' : ''} onClick={() => navigate('handoff')} disabled={!processed}>{t.handoff}{pins.length > 0 && <span className="nav-count">{pins.length}</span>}</button>
      </nav>
      <div className="header-actions">{installPrompt && <button className="install-button" onClick={() => void installApp()}><Download size={14} />{t.installApp}</button>}<button className="command-trigger" aria-label={t.quickActions} title={`${t.quickActions} (Ctrl/⌘ K)`} onClick={() => setDialog('commands')}><Command size={15} /><kbd>Ctrl K</kbd></button><button className="help-button" aria-label={t.help} onClick={() => setDialog('help')}><HelpCircle size={15} /><span>{t.help}</span></button><span className="header-divider" /><label className="language-picker"><Globe2 size={14} /><select aria-label="Language / 语言" value={lang} onChange={event => setLang(event.target.value as Lang)}>{SUPPORTED_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}</select><ChevronDown size={11} /></label></div>
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
        <input ref={input} type="file" tabIndex={-1} accept=".zip,.jsonl,.ndjson,.json,.md,.txt,.log" aria-label={t.import} className="file-input" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
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
        {!isCompact && cleanupPanel}
        <section ref={previewPanel} tabIndex={-1} className="preview-panel panel"><div className="panel-heading preview-heading"><div><h2>{t.preview}<span className="count-badge">{currentConversation?.messageCount ?? 0}</span></h2><p>{preview ? preview.total.toLocaleString() + ' ' + t.resultCount : t.previewSub}</p></div><div className="preview-tools"><button className="snippet-trigger" disabled={working || customDirty || !processed} onClick={() => setDialog('snippets')}><Code2 size={14} />{t.codeSnippets}</button><MarkdownViewToggle enabled={markdownPreview} onChange={() => setMarkdownPreview(value => !value)} t={t} /><div className="segmented" aria-label={t.preview}><button aria-pressed={mode === 'cleaned'} className={mode === 'cleaned' ? 'active' : ''} onClick={() => setMode('cleaned')}>{t.cleaned}</button><button aria-pressed={mode === 'original'} className={mode === 'original' ? 'active' : ''} onClick={() => setMode('original')}>{t.original}</button></div></div></div>
          <div className="preview-toolbar"><div className="preview-filters"><div className="role-filter">{(['all', 'user', 'assistant', 'tool', 'system'] as const).map(role => <button key={role} aria-pressed={filter === role} className={filter === role ? 'active' : ''} onClick={() => setFilter(role)}>{t[role]}</button>)}</div><button className={`changed-filter ${changedOnly ? 'active' : ''}`} aria-pressed={changedOnly} onClick={() => setChangedOnly(value => !value)}><Check size={11} />{t.changedOnly}</button><button className={`changed-filter ${pinnedOnly ? 'active' : ''}`} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(value => !value)}><Pin size={11} />{t.pinnedOnly}</button></div><label className="search-box"><Search size={14} /><input type="search" maxLength={1000} value={query} placeholder={t.search} aria-label={t.search} onChange={e => setQuery(e.target.value)} /></label>{filtersActive && <button className="filter-clear icon-button" aria-label={t.clearFilters} title={t.clearFilters} onClick={clearFilters}><RotateCcw size={14} /></button>}<button className="excerpt-trigger" disabled={working || customDirty || !preview?.total} onClick={() => setDialog('excerpt')}><Download size={13} /><span>{t.exportExcerpt}</span><b>{preview?.total.toLocaleString() ?? 0}</b></button></div>
          {mode === 'original' && <div className="original-warning"><LockKeyhole size={14} />{t.originalWarning}</div>}
          <div ref={messageList} onScroll={event => { if (archive && !busy && !querying) rememberReadingPosition(readingPositionKey, event.currentTarget.scrollTop); }} className={`messages-list ${working ? 'processing' : ''}`} aria-busy={working}>
            {working && <div className="processing-overlay" role="status"><span><LoaderCircle size={17} className="spin" />{t.processing}</span></div>}
            {processed && !working && !visible.length && <div className="no-results">{t.noResults}{filtersActive && <button className="button secondary small" onClick={clearFilters}>{t.clearFilters}</button>}</div>}
            {visible.map(({ message, index, bytes: messageBytes, changes, shortened }) => <MessageCard key={`${selected}-${mode}-${message.id}`} message={message} index={index} sizeLabel={bytes(messageBytes)} pinned={pins.includes(message.id)} onPin={() => togglePin(message.id)} onCopy={() => copyMessage(message.id)} onReview={() => void reviewMessage(message.id)} copyDisabled={working || customDirty} changes={changes} query={deferredQuery} sourceShortened={shortened} markdownPreview={markdownPreview} t={t} />)}
          </div>
          {pageCount > 1 && <div className="pagination"><button className="text-button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={15} />{t.prev}</button><span>{safePage + 1} / {pageCount}</span><button className="text-button" disabled={safePage === pageCount - 1} onClick={() => setPage(safePage + 1)}>{t.next}<ChevronRight size={15} /></button></div>}
          <div className="changes-panel"><div className="overline">{t.changes}</div><div className="changes-list">{changeRows.filter(row => (row.key !== 'emailsRedacted' || options.redactEmails) && (row.key !== 'customRedacted' || !!options.customSecrets?.length)).map(({ key, icon: Icon }) => <span key={key} className={stats?.[key] ? 'has-changes' : ''}><Icon size={13} /><strong>{stats?.[key] ?? 0}</strong>{t[key]}</span>)}</div></div>
        </section>
      </div>}

      {archive && view === 'handoff' && processed && <div className="handoff-grid">
        <section className="notes-panel panel">
          <div className="panel-heading"><div><h2>{t.notes}</h2><p>{pins.length} {t.pinned}</p></div><Pin size={17} /></div>
          <div className="notes-body">
            {(['goal', 'decisions', 'constraints', 'nextSteps'] as const).map(key => <label className="note-field" key={key}><span>{t[key]}</span><textarea ref={key === 'goal' ? goalInput : undefined} value={notes[key]} maxLength={12000} placeholder={t[`${key}Hint`]} rows={key === 'goal' ? 2 : 3} onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))} /></label>)}
            <div className="handoff-settings">
              <label>{t.recent}<select value={recent} onChange={e => setRecent(Number(e.target.value))}>{[0, 4, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
              <label>{t.budget}<select value={budget} onChange={e => setBudget(Number(e.target.value))}>{[6000, 12000, 24000, 48000].map(n => <option key={n} value={n}>{n.toLocaleString()} {t.characters}</option>)}</select></label>
            </div>
            <p className="field-note">{t.pinsHint}</p><p className="field-note draft-note">{t.draftHint}</p>
          </div>
        </section>
        <section className="handoff-preview panel" aria-busy={handoffBusy}>
          <div className="panel-heading">
            <div><h2>{t.handoffPreview}</h2><p>{bytes(byteLength(handoffText))} · {handoffText.length.toLocaleString()} {t.characters}</p></div>
            <div className="handoff-preview-tools"><MarkdownViewToggle enabled={markdownPreview} onChange={() => setMarkdownPreview(value => !value)} t={t} /><span className="document-badge">.md</span></div>
          </div>
          {handoffBusy && <p className="handoff-refresh" role="status"><LoaderCircle size={13} className="spin" />{t.handoffUpdating}</p>}
          {handoffError && <p className="handoff-refresh handoff-refresh-error" role="alert">{t.handoffFailed}</p>}
          {markdownPreview
            ? <MarkdownDocument className="handoff-document handoff-markdown" source={handoffText} imageLabel={t.imagePreviewHidden} />
            : <pre className="handoff-document">{handoffText}</pre>}
          <div className="handoff-note"><ShieldCheck size={15} />{t.handoffNote}</div>
        </section>
      </div>}

      {archive && <section className="export-bar">{customDirty && <div className="pending-redactions" role="status"><div><strong>{t.unappliedRules}</strong><small>{t.unappliedHint}</small></div><button className="button secondary small" onClick={applyCustomRules}>{t.applyCustom}</button></div>}<div className="export-copy"><span className="ready-mark"><Check size={19} /></span><div><strong>{view === 'handoff' ? t.handoffPreview : t.ready}</strong><small>{view === 'handoff' ? t.handoffNote : t.exportHint}</small></div></div><div className="export-actions">{view === 'handoff' ? <><button className="button secondary handoff-copy" aria-label={t.copy} aria-busy={handoffCopyState === 'pending'} data-state={handoffCopyState} disabled={working || customDirty || handoffBusy || !handoffText || handoffCopyState === 'pending'} onClick={() => void copyHandoff()}>{handoffCopyState === 'pending' ? <LoaderCircle size={15} className="spin" /> : handoffCopyState === 'success' ? <Check size={15} /> : handoffCopyState === 'error' ? <AlertCircle size={15} /> : <Clipboard size={15} />}{handoffCopyState === 'pending' ? t.copying : handoffCopyState === 'success' ? t.copied : t.copy}</button><button className="button primary" disabled={working || customDirty || handoffBusy || !handoffText} onClick={() => download(handoffText, 'threadpack-handoff.md', 'text/markdown;charset=utf-8')}><ArrowDownToLine size={16} />{t.downloadHandoff}</button></> : <><button className="button secondary" disabled={working || !processed} onClick={() => navigate('handoff')}>{t.buildHandoff}<ArrowUpRight size={15} /></button><button className="button primary" disabled={working || customDirty || !processed} onClick={() => setDialog('export')}><ArrowDownToLine size={16} />{t.export}</button></>}</div></section>}

      {!archive && !importing && <><LandingShowcase t={t} onDemo={() => void openText(createDemo(), 'checkout-session.jsonl', true)} onShare={() => void shareProject()} sharing={shareState === 'pending'} shared={shareState === 'success'} /><section className="import-guide-card" aria-labelledby="import-guide-heading"><div><h2 id="import-guide-heading">{t.guideTitle}</h2><p>{t.guideCodex}</p><p>{t.guideChatgpt}</p><p>{t.guideText}</p></div><a className="button secondary small" href="https://hajimi1214.github.io/ThreadPack/import-guide.html" target="_blank" rel="noopener noreferrer">{t.guideLink}<ArrowUpRight size={14} /></a></section><div className="empty-formats landing-formats"><span><Terminal size={13} />Codex & Claude Code</span><span><FileJson size={13} />ChatGPT & Claude</span><span><FileText size={13} />Markdown & text</span></div></>}
      </div>
    </main>

    <footer className="site-footer"><span className="footer-brand"><Package size={15} />ThreadPack <span>·</span> {t.footer}</span><span><span className="status-dot" />{t.privacy}<span className="footer-separator">/</span><a href="./third-party-licenses.txt" target="_blank" rel="noopener noreferrer">{t.thirdPartyNotices}</a><span className="footer-separator">/</span>MIT</span></footer>
    {toast && <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'toast-error' : ''} ${overlayOpen ? 'above-dialog' : ''}`} role="status">{toast.tone === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}<span>{toast.text}</span></div>}
    {dragging && <div className="drag-overlay"><div><Upload size={44} /><h2>{t.drop}</h2><p>{t.dropHint}</p></div></div>}


    {dialog === 'snippets' && archive && processed && <Dialog close={() => setDialog(null)} label={t.codeSnippets} closeLabel={t.close} className="snippet-dialog"><SnippetExplorer key={`${archive.archiveId}:${selected}:${processed.revision}`} archiveId={archive.archiveId} conversationId={selected} revision={processed.revision} request={request} t={t} download={download} notify={notify} /><ThirdPartyNotices t={t} /></Dialog>}
    {dialog === 'commands' && <Dialog close={() => setDialog(null)} label={t.quickActions} closeLabel={t.close} className="command-dialog"><CommandMenu actions={quickActions} t={t} execute={executeQuickAction} /></Dialog>}
    {isCompact && settingsOpen && <Dialog close={() => setSettingsOpen(false)} label={t.recipe} closeLabel={t.close} className="settings-sheet"><div className="settings-sheet-content">{cleanupPanel}</div><div className="settings-sheet-actions"><button className="button primary" onClick={finishSettings}>{t.doneSettings}<Check size={16} /></button></div></Dialog>}
    {dialog === 'compare' && <Dialog close={closeMessageReview} label={t.comparisonTitle} closeLabel={t.close} className="message-review-dialog"><div className="dialog-eyebrow"><Eye size={17} />{t.comparisonTitle}</div><h2>{t.comparisonTitle}</h2><p className="review-message-warning"><ShieldCheck size={14} />{t.compareWarning}</p>{reviewBusy && <p className="review-message-loading" role="status"><LoaderCircle size={16} className="spin" />{t.processing}</p>}{messageReview && <><div className="review-change-list">{messageReview.result.changes.map((change, index) => <span key={`${change.kind}-${index}`}>{change.count} {t[reviewChangeLabels[change.kind]]}</span>)}</div><div className="review-columns"><section className="review-column"><h3>{t.compareOriginal}</h3><pre>{messageReview.result.original.text || '—'}</pre>{messageReview.result.original.shortened && <small>{t.comparisonShortened}</small>}</section><section className="review-column"><h3>{t.compareCleaned}</h3><pre>{messageReview.result.cleaned.text || '—'}</pre>{messageReview.result.cleaned.shortened && <small>{t.comparisonShortened}</small>}</section></div>{(messageReview.result.original.imageHidden || messageReview.result.cleaned.imageHidden) && <p className="review-message-note">{t.imagePreviewHidden}</p>}</>}</Dialog>}
    {pendingAction && <Dialog close={() => setPendingAction(null)} label={t.unsavedNotes} closeLabel={t.close}><div className="dialog-eyebrow"><FileText size={17} />{t.unsavedNotes}</div><h2>{t.unsavedNotes}</h2><p className="dialog-subtitle">{t.discardHint}</p><div className="dialog-actions"><button className="button secondary" onClick={() => setPendingAction(null)}>{t.keepWorking}</button><button className="button danger" onClick={discardNotes}>{t.discardNotes}</button></div></Dialog>}
    {dialog === 'help' && <Dialog close={() => setDialog(null)} label={t.help} closeLabel={t.close}><div className="dialog-eyebrow"><Package size={18} />THREADPACK</div><h2>{t.helpTitle}</h2><div className="help-steps">{[1, 2, 3].map(n => <div key={n}><strong>{t[`help${n}Title` as TranslationKey]}</strong><p>{t[`help${n}` as TranslationKey]}</p></div>)}</div><div className="help-notice"><h3><LockKeyhole size={15} />{t.helpPrivacy}</h3><p>{t.helpPrivacyText}</p><h3>{t.helpLimits}</h3><p>{t.helpLimitsText}</p></div><div className="help-project-actions"><a className="button secondary small" href="https://hajimi1214.github.io/ThreadPack/import-guide.html" target="_blank" rel="noopener noreferrer">{t.guideLink}<ArrowUpRight size={14} /></a><button className="button secondary small" aria-label={t.shareProject} aria-busy={shareState === 'pending'} disabled={shareState === 'pending'} title={t.shareProjectHint} onClick={() => void shareProject()}>{shareState === 'pending' ? <LoaderCircle size={14} className="spin" /> : shareState === 'success' ? <Check size={14} /> : <Link size={14} />}{shareState === 'success' ? t.copied : t.shareProject}</button></div><ThirdPartyNotices t={t} /></Dialog>}
    {dialog === 'paste' && <Dialog close={() => setDialog(null)} label={t.paste} closeLabel={t.close}><div className="dialog-eyebrow"><Clipboard size={17} />{t.paste}</div><h2>{t.pasteTitle}</h2><p className="dialog-subtitle">{t.pasteHint}</p><textarea className="paste-area" value={pasteText} aria-label={t.paste} placeholder={'User: …\nAssistant: …'} onChange={e => setPasteText(e.target.value)} /><div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>{t.cancel}</button><button className="button primary" disabled={importing || !pasteText.trim()} onClick={() => void openText(pasteText, 'pasted-conversation.txt')}>{t.parseText}<ArrowRight size={15} /></button></div></Dialog>}
    {(dialog === 'export' || dialog === 'excerpt') && <Dialog close={() => { if (!exportLock.current) setDialog(null); }} label={dialog === 'excerpt' ? t.exportExcerpt : t.export} closeLabel={t.close}>
      <div className="dialog-eyebrow"><Package size={18} />{dialog === 'excerpt' ? `${preview?.total.toLocaleString() ?? 0} ${t.resultCount}` : t.ready}</div>
      <h2>{dialog === 'excerpt' ? t.excerptTitle : t.exportTitle}</h2><p className="dialog-subtitle">{dialog === 'excerpt' ? t.excerptHint : t.exportSub}</p>
      {dialog === 'excerpt' && <p className="excerpt-cleaned-note"><ShieldCheck size={14} />{t.excerptCleanedNote}</p>}
      <div className="export-formats">{([{ format: 'markdown', title: 'markdown', hint: 'markdownHint', icon: FileText, ext: '.md' }, { format: 'jsonl', title: 'jsonl', hint: 'jsonlHint', icon: FileJson, ext: '.jsonl' }, { format: 'report', title: 'report', hint: 'reportHint', icon: ShieldCheck, ext: '.json' }, { format: 'bundle', title: 'contextBundle', hint: 'contextBundleHint', icon: Package, ext: '.zip' }] as const).filter(item => dialog !== 'excerpt' || item.format !== 'report' && item.format !== 'bundle').map(({ format, title, hint, icon: Icon, ext }) => <button key={format} aria-label={`${t[title]} ${t[hint]}`} aria-busy={exporting && exportFormat === format} disabled={exporting || customDirty} onClick={() => void exportFile(format, dialog === 'excerpt')}><span className="format-icon">{exporting && exportFormat === format ? <LoaderCircle size={21} className="spin" /> : <Icon size={21} strokeWidth={1.5} />}</span><span><strong>{exporting && exportFormat === format ? t.exporting : t[title]}</strong><small>{t[hint]}</small></span><span className="format-ext">{ext}</span><ArrowDownToLine size={16} /></button>)}</div>
      <p className="export-disclaimer">{t.reviewNote}</p><p className="export-disclaimer">{t.exportWarning}</p>
    </Dialog>}
  </div>;
}
