import { useCallback, useState } from 'react';
import type { SetStateAction } from 'react';

export interface HandoffNotes {
  goal: string;
  decisions: string;
  constraints: string;
  nextSteps: string;
}

interface ConversationDraft {
  notes: HandoffNotes;
  pins: string[];
  recent: number;
  budget: number;
}

const freshDraft = (): ConversationDraft => ({
  notes: { goal: '', decisions: '', constraints: '', nextSteps: '' },
  pins: [], recent: 8, budget: 12000,
});

/** Drafts live only in this mounted workspace; importing or clearing resets them. */
export function useConversationDrafts(conversationId: string) {
  const [drafts, setDrafts] = useState<Map<string, ConversationDraft>>(() => new Map());
  const draft = drafts.get(conversationId) ?? freshDraft();
  const update = useCallback(<K extends keyof ConversationDraft>(key: K, action: SetStateAction<ConversationDraft[K]>) => {
    if (!conversationId) return;
    setDrafts(previous => {
      const current = previous.get(conversationId) ?? freshDraft();
      const value = typeof action === 'function'
        ? (action as (previous: ConversationDraft[K]) => ConversationDraft[K])(current[key])
        : action;
      const next = new Map(previous);
      next.set(conversationId, { ...current, [key]: value });
      return next;
    });
  }, [conversationId]);
  const setNotes = useCallback((action: SetStateAction<HandoffNotes>) => update('notes', action), [update]);
  const setPins = useCallback((action: SetStateAction<string[]>) => update('pins', action), [update]);
  const setRecent = useCallback((action: SetStateAction<number>) => update('recent', action), [update]);
  const setBudget = useCallback((action: SetStateAction<number>) => update('budget', action), [update]);
  const clearDrafts = useCallback(() => setDrafts(new Map()), []);
  return { ...draft, setNotes, setPins, setRecent, setBudget, clearDrafts };
}
