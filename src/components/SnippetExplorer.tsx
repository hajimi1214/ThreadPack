import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { AlertCircle, Archive, Check, ChevronLeft, ChevronRight, Code2, Copy, Download, LoaderCircle, Search, WrapText } from 'lucide-react';
import type { TranslationKey } from '../i18n';
import type { CopyMessageResult, ExportResult, SnippetArchiveResult, SnippetQueryResult } from '../worker/types';
import HighlightedCode from './HighlightedCode';
import type { useWorkerClient } from '../hooks/useWorkerClient';

interface Props {
  archiveId: number; conversationId: string; revision: number;
  request: ReturnType<typeof useWorkerClient>['request'];
  t: Record<TranslationKey, string>;
  download: (content: BlobPart, name: string, type: string) => void;
  notify: (text: string, tone?: 'success' | 'error') => void;
}

export default function SnippetExplorer({ archiveId, conversationId, revision, request, t, download, notify }: Props) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SnippetQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [language, setLanguage] = useState('');
  const [languages, setLanguages] = useState<{ language: string; count: number }[]>([]);
  const [wrap, setWrap] = useState(false);
  const [failed, setFailed] = useState(false);
  const [action, setAction] = useState<{ id: string; kind: 'copy' | 'download' | 'zip'; state: 'pending' | 'success' | 'error' } | null>(null);
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const selection = { archiveId, conversationId, revision };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false); setResult(null);
    request<SnippetQueryResult>({ type: 'query-snippets', archiveId, conversationId, revision, page, pageSize: 20, query: deferredQuery, language }).then(data => {
      if (active) { setResult(data); setLanguages(data.languages); setLoading(false); }
    }).catch(() => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [archiveId, conversationId, revision, page, deferredQuery, language, request]);
  useEffect(() => {
    if (!action || action.state === 'pending') return;
    const timer = setTimeout(() => setAction(null), 2200);
    return () => clearTimeout(timer);
  }, [action]);
  function changePage(next: number) {
    heading.current?.focus({ preventScroll: true });
    const dialog = heading.current?.closest('.dialog');
    if (dialog) dialog.scrollTop = 0;
    setPage(next);
  }

  async function perform(id: string, kind: 'copy' | 'download') {
    if (actionLock.current) return;
    actionLock.current = true;
    setAction({ id, kind, state: 'pending' });
    try {
      if (kind === 'copy') {
        const data = await request<CopyMessageResult>({ type: 'copy-snippet', ...selection, snippetId: id });
        if (!mounted.current) return;
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(data.text);
      } else {
        const data = await request<ExportResult>({ type: 'export-snippet', ...selection, snippetId: id });
        if (!mounted.current) return;
        download(data.buffer, data.filename, data.mimeType);
      }
      if (mounted.current) { setAction({ id, kind, state: 'success' }); if (kind === 'copy') notify(t.copied); }
    } catch {
      if (mounted.current) { setAction({ id, kind, state: 'error' }); notify(kind === 'copy' ? t.clipboardError : t.snippetExportFailed, 'error'); }
    } finally { actionLock.current = false; }
  }
  async function exportZip() {
    if (actionLock.current || loading || deferredQuery !== query || !result?.total) return;
    actionLock.current = true; setAction({ id: 'archive', kind: 'zip', state: 'pending' });
    try {
      const data = await request<SnippetArchiveResult>({ type: 'export-snippets', ...selection, query: deferredQuery, language });
      if (!mounted.current) return;
      download(data.buffer, data.filename, data.mimeType);
      setAction({ id: 'archive', kind: 'zip', state: 'success' });
    } catch { if (mounted.current) { setAction({ id: 'archive', kind: 'zip', state: 'error' }); notify(t.snippetZipFailed, 'error'); } }
    finally { actionLock.current = false; }
  }
  const pending = action?.state === 'pending';
  const searching = loading || deferredQuery !== query;

  return <div className="snippet-explorer" aria-busy={loading}>
    <div className="dialog-eyebrow"><Code2 size={18} />{t.codeSnippets}</div>
    <h2 ref={heading} tabIndex={-1}>{t.codeSnippets}</h2><p className="dialog-subtitle">{t.codeSnippetsHint}</p>
    <div className="snippet-toolbar">
      <label className="snippet-search"><Search size={14} /><input type="search" maxLength={1000} value={query} aria-label={t.snippetSearch} placeholder={t.snippetSearch} disabled={pending} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <select className="snippet-language-filter" value={language} aria-label={t.snippetLanguage} disabled={pending} onChange={event => { setLanguage(event.target.value); setPage(0); }}><option value="">{t.snippetAllLanguages}</option>{languages.map(option => <option key={option.language} value={option.language}>{option.language} ({option.count})</option>)}</select>
      <button className="snippet-wrap" aria-label={t.snippetWrap} title={t.snippetWrap} aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText size={16} /></button>
      <button className="button primary small snippet-zip" aria-label={t.snippetDownloadZip} title={t.snippetZipHint} aria-busy={pending && action?.kind === 'zip'} disabled={pending || searching || !result?.total} onClick={() => void exportZip()}>{pending && action?.kind === 'zip' ? <LoaderCircle size={14} className="spin" /> : action?.kind === 'zip' && action.state === 'success' ? <Check size={14} /> : <Archive size={14} />}{pending && action?.kind === 'zip' ? t.exporting : t.snippetDownloadZip}</button>
    </div>
    {loading && <p className="snippet-loading" role="status"><LoaderCircle size={18} className="spin" />{t.processing}</p>}
    {failed && <p role="alert" className="snippet-empty"><AlertCircle size={18} />{t.snippetLoadFailed}</p>}
    {result && <><div className="snippet-total">{result.total.toLocaleString()}{(query || language) && ` / ${result.allTotal.toLocaleString()}`} {t.snippetReady}</div>
      {!result.total && <div className="snippet-empty"><Code2 size={28} /><span>{query || language ? t.snippetNoMatches : t.noSnippets}</span>{(query || language) && <button className="button secondary small" onClick={() => { setQuery(''); setLanguage(''); setPage(0); }}>{t.clearFilters}</button>}</div>}
      <div className="snippet-list">{result.items.map(item => <article className="snippet-card" key={item.id}>
        <div className="snippet-heading"><span className="snippet-language">{item.language || 'text'}</span><span>{t.snippetSource} {item.messageIndex + 1}</span><span>{item.lines.toLocaleString()} {t.snippetLines}</span><span>{item.characters.toLocaleString()} {t.snippetCharacters}</span></div>
        <HighlightedCode code={item.preview} language={item.language} wrap={wrap} />
        {item.shortened && <p className="snippet-shortened">{t.snippetPreviewShortened}</p>}
        <div className="snippet-actions">{(['copy', 'download'] as const).map(kind => {
          const current = action?.id === item.id && action.kind === kind ? action.state : null;
          const label = kind === 'copy' ? t.snippetCopy : t.snippetDownload;
          return <button key={kind} className="button secondary small" aria-label={label} aria-busy={current === 'pending'} data-state={current ?? 'idle'} disabled={action?.state === 'pending'} onClick={() => void perform(item.id, kind)}>
            {current === 'pending' ? <LoaderCircle size={14} className="spin" /> : current === 'success' ? <Check size={14} /> : current === 'error' ? <AlertCircle size={14} /> : kind === 'copy' ? <Copy size={14} /> : <Download size={14} />}
            {current === 'pending' ? kind === 'copy' ? t.copying : t.exporting : current === 'success' && kind === 'copy' ? t.copied : label}
          </button>;
        })}</div>
      </article>)}</div>
      {result.pageCount > 1 && <div className="pagination"><button className="text-button" disabled={!result.page} onClick={() => changePage(result.page - 1)}><ChevronLeft size={14} />{t.prev}</button><span>{result.page + 1} / {result.pageCount}</span><button className="text-button" disabled={result.page === result.pageCount - 1} onClick={() => changePage(result.page + 1)}>{t.next}<ChevronRight size={14} /></button></div>}
    </>}
  </div>;
}
