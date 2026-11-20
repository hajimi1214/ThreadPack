import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Command, Search } from 'lucide-react';
import type { TranslationKey } from '../i18n';

export interface QuickAction { id: string; label: string; keywords?: string; shortcut?: string; run: () => void; disabled?: boolean }

export default function CommandMenu({ actions, t, execute }: { actions: QuickAction[]; t: Record<TranslationKey, string>; execute: (action: QuickAction) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = actions.filter(action => !action.disabled && terms.every(term => `${action.label} ${action.keywords ?? ''}`.toLocaleLowerCase().includes(term)));
  const index = Math.min(active, Math.max(0, filtered.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, query]);

  return <div className="command-menu">
    <div className="command-title"><Command size={17} /><h2>{t.quickActions}</h2><kbd>Esc</kbd></div>
    <label className="command-search"><Search size={17} /><input data-autofocus role="combobox" aria-label={t.searchActions} aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered[index] ? `${listId}-${filtered[index].id}` : undefined} value={query} placeholder={t.searchActions} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (filtered.length) setActive((index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
      } else if (event.key === 'Enter' && filtered[index]) { event.preventDefault(); execute(filtered[index]); }
    }} /></label>
    <div ref={list} className="command-list" role="listbox" id={listId} aria-label={t.quickActions}>
      {filtered.map((action, i) => <button key={action.id} type="button" role="option" id={`${listId}-${action.id}`} aria-selected={i === index} tabIndex={-1} className={i === index ? 'active' : ''} onPointerMove={() => setActive(i)} onClick={() => execute(action)}><span>{action.label}</span>{action.shortcut ? <kbd>{action.shortcut}</kbd> : <ArrowUpRight size={14} />}</button>)}
      {!filtered.length && <p className="command-empty">{t.noActions}</p>}
    </div>
  </div>;
}
