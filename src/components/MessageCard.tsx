import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Copy, Eye, LoaderCircle, Pin, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import type { CleanResult, Conversation } from '../core';
import type { TranslationKey } from '../i18n';
import { messagePreview, searchPattern } from '../preview';

const changeLabels = {
  image: 'imagesRemoved', tool: 'outputsTrimmed', duplicate: 'duplicatesRemoved',
  secret: 'secretsRedacted', email: 'emailsRedacted', custom: 'customRedacted',
} as const;

export default function MessageCard({ message, index, sizeLabel, pinned, onPin, onCopy, onReview, copyDisabled = false, changes, query, sourceShortened = false, t }: {
  message: Conversation['messages'][number]; index: number; sizeLabel: string; pinned: boolean; onPin: () => void; onCopy: () => Promise<boolean>; onReview: () => void; copyDisabled?: boolean;
  changes: CleanResult['changes']; query: string; sourceShortened?: boolean; t: Record<TranslationKey, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const mounted = useRef(false);
  const copyPending = useRef(false);
  const copyGeneration = useRef(0);
  const resetCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyPending.current = false;
      ++copyGeneration.current;
      if (resetCopyTimer.current) clearTimeout(resetCopyTimer.current);
    };
  }, []);
  async function copy() {
    if (copyDisabled || copyPending.current) return;
    if (resetCopyTimer.current) clearTimeout(resetCopyTimer.current);
    const generation = ++copyGeneration.current;
    copyPending.current = true;
    setCopyState('pending');
    let copied = false;
    try { copied = await onCopy(); } catch { /* The action state below also covers rejected clipboard requests. */ }
    if (!mounted.current || generation !== copyGeneration.current) return;
    copyPending.current = false;
    setCopyState(copied ? 'success' : 'error');
    resetCopyTimer.current = setTimeout(() => {
      if (mounted.current && generation === copyGeneration.current) setCopyState('idle');
    }, 2200);
  }
  const copyTitle = copyState === 'pending' ? t.copying : copyState === 'success' ? t.copiedMessage : copyState === 'error' ? t.copyFailed : t.copyMessage;
  const copyLabel = copyState === 'pending' ? t.copying : t.copied;
  const preview = messagePreview(message.content, query, expanded);
  const changeCount = changes.reduce((n, c) => n + c.count, 0);
  const RoleIcon = message.role === 'tool' ? Terminal : message.role === 'assistant' ? Sparkles : message.role === 'system' ? ShieldCheck : null;
  const match = searchPattern(query)?.exec(preview.text)?.index ?? -1;
  return <article className={`message-card role-${message.role} ${pinned ? 'is-pinned' : ''}`}>
    <div className="message-heading">
      <div className="message-role"><span className="role-avatar">{RoleIcon ? <RoleIcon size={13} /> : <span>U</span>}</span><strong>{t[message.role]}</strong><span className="message-index">{String(index + 1).padStart(2, '0')}</span></div>
      <div className="message-meta">{changeCount > 0 && <span className="changed-dot" title={`${changeCount} ${t.changeCount}`}>{changeCount} {t.changeCount}</span>}<span>{sizeLabel}</span><button className="message-copy-button" data-state={copyState} aria-label={t.copyMessage} aria-busy={copyState === 'pending'} title={copyTitle} disabled={copyDisabled || copyState === 'pending'} onClick={() => void copy()}>{copyState === 'pending' ? <LoaderCircle size={14} className="spin" /> : copyState === 'success' ? <Check size={14} /> : copyState === 'error' ? <CircleAlert size={14} /> : <Copy size={14} />}{(copyState === 'pending' || copyState === 'success') && <span className="message-copy-feedback">{copyLabel}</span>}</button><button className={`pin-button ${pinned ? 'active' : ''}`} aria-label={pinned ? t.unpin : t.pin} aria-pressed={pinned} onClick={onPin} title={pinned ? t.unpin : t.pin}><Pin size={14} /></button></div>
    </div>
    {changes.length > 0 && <div className="message-change-labels">{changes.map((change, n) => <span key={`${change.kind}-${n}`}>{change.count} {t[changeLabels[change.kind]]}</span>)}</div>}
    {changes.length > 0 && <button className="review-message-button" disabled={copyDisabled} onClick={onReview}><Eye size={13} />{t.reviewChanges}</button>}
    {preview.contextual && <span className="search-match-label">{t.searchMatch}</span>}
    <pre className="message-content">{match >= 0 ? <>{preview.text.slice(0, match)}<mark>{preview.text.slice(match, match + query.length)}</mark>{preview.text.slice(match + query.length)}</> : preview.text || '—'}</pre>
    {preview.expandable && <button className="text-button expand-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? t.collapse : t.expand}<ChevronDown size={13} className={expanded ? 'rotate' : ''} /></button>}
    {sourceShortened && <small className="preview-footnote">{t.previewShortened}</small>}
  </article>;
}
