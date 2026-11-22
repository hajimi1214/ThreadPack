import type { ContextOmission, GeneratedProjectContext, MemoryCategory, MemoryProjectContext, MemorySessionState, MemoryStatus, ProjectMemoryFact } from './memory-types';

const categoryPriority: Record<MemoryCategory, number> = {
  goal: 6, decision: 5, constraint: 5, task: 4, risk: 4, 'open-question': 3,
};

const statusLabel: Record<MemoryStatus, string> = {
  confirmed: 'CONFIRMED', proposed: 'AI PROPOSAL · NOT CONFIRMED',
  'needs-review': 'NEEDS REVIEW', rejected: 'REJECTED', superseded: 'SUPERSEDED',
};

function terms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

function scoreFact(fact: ProjectMemoryFact, queryTerms: string[]): number {
  const text = `${fact.category} ${fact.topic} ${fact.statement}`.toLocaleLowerCase();
  const matches = queryTerms.filter(term => text.includes(term)).length;
  const status = fact.status === 'confirmed' ? 80 : fact.status === 'needs-review' ? 45 : 25;
  const evidence = fact.evidence.some(item => item.verification === 'source-matched') ? 20
    : fact.evidence.length ? 8 : -15;
  const queryScore = queryTerms.length ? matches * 30 - (queryTerms.length - matches) * 4 : 0;
  return status + categoryPriority[fact.category] * 5 + evidence + queryScore;
}

function evidenceText(fact: ProjectMemoryFact, sessions: Map<string, MemorySessionState>): string {
  if (!fact.evidence.length) return 'Evidence: none attached. This is an uncited entry.';
  return fact.evidence.map(evidence => {
    const session = evidence.sessionId ? sessions.get(evidence.sessionId) : undefined;
    const oldVersion = !!session && evidence.version !== undefined && evidence.version < session.currentVersion;
    const freshness = oldVersion ? 'historical version, review against current session' : '';
    const reference = evidence.kind === 'conversation'
      ? `${session?.title ?? 'Saved conversation'} v${evidence.version} / ${evidence.messageId}`
      : evidence.reference;
    const verification = evidence.verification === 'source-matched' ? 'source-matched'
      : evidence.verification === 'user-recorded' ? 'user-recorded, not independently verified' : 'unattached';
    const metadata = [evidence.commit ? `commit ${evidence.commit}` : '', evidence.command ? `command ${evidence.command}` : '']
      .filter(Boolean).join('; ');
    const quote = evidence.quote ? `: “${evidence.quote.replace(/\s+/g, ' ').slice(0, 240)}”` : '';
    return `Evidence (${verification}${freshness ? `; ${freshness}` : ''}): ${reference}${metadata ? ` · ${metadata}` : ''}${quote}`;
  }).join('\n');
}

function factBlock(fact: ProjectMemoryFact, sessions: Map<string, MemorySessionState>): string {
  const category = fact.category.toUpperCase();
  const topic = fact.topic ? ` · ${fact.topic}` : '';
  const taskState = fact.taskState ? ` · TASK ${fact.taskState.toUpperCase()}` : '';
  return `[${statusLabel[fact.status]} · ${fact.origin.toUpperCase()} · ${category}${topic}${taskState}]\n${fact.statement}\n${evidenceText(fact, sessions)}`;
}

export function generateProjectContext(input: {
  project: MemoryProjectContext;
  facts: ProjectMemoryFact[];
  sessions: MemorySessionState[];
  query: string;
  budget: number;
}): GeneratedProjectContext {
  if (!Number.isSafeInteger(input.budget) || input.budget < 1000 || input.budget > 100_000) {
    throw new Error('Context budget must be between 1,000 and 100,000 characters.');
  }
  if (typeof input.query !== 'string' || input.query.length > 1000) throw new Error('Enter a shorter context search query.');

  const sessionMap = new Map(input.sessions.map(session => [session.id, session]));
  const queryTerms = terms(input.query);
  const facts = input.facts.filter(fact => fact.status !== 'rejected' && fact.status !== 'superseded');
  const directMatches = facts.filter(fact => !queryTerms.length
    || queryTerms.some(term => `${fact.category} ${fact.topic} ${fact.statement}`.toLocaleLowerCase().includes(term)));
  const directIds = new Set(directMatches.map(fact => fact.id));
  const relatedIds = new Set(directMatches.flatMap(fact => fact.conflictsWith).filter(id => !directIds.has(id)));
  const relatedMatches = facts.filter(fact => relatedIds.has(fact.id));
  const matching = [...directMatches, ...relatedMatches].map(fact => ({ fact, score: scoreFact(fact, queryTerms) }));
  const relevantIds = new Set(matching.map(item => item.fact.id));
  const omissions: ContextOmission[] = facts
    .filter(fact => !relevantIds.has(fact.id))
    .map(fact => ({ id: fact.id, topic: fact.topic, category: fact.category, reason: 'not-relevant' }));

  const blocks: { id: string; text: string; fact?: ProjectMemoryFact }[] = [
    { id: 'project-name', text: `# ${input.project.name}` },
    ...(input.project.summary.trim() ? [{ id: 'project-status', text: `PROJECT STATUS · user-maintained\n${input.project.summary.trim()}` }] : []),
    ...(input.project.importantNotes.trim() ? [{ id: 'important-notes', text: `IMPORTANT RECORDS · user-maintained\n${input.project.importantNotes.trim()}` }] : []),
    ...matching.map(({ fact }) => ({ id: fact.id, text: factBlock(fact, sessionMap), fact })),
  ];
  const includedFactIds: string[] = [];
  const omittedSections: string[] = [];
  const included: string[] = [];
  let usedCharacters = 0;
  for (const block of blocks) {
    const separator = included.length ? '\n\n' : '';
    const nextSize = usedCharacters + separator.length + block.text.length;
    if (nextSize > input.budget) {
      if (block.fact) omissions.push({ id: block.fact.id, topic: block.fact.topic, category: block.fact.category, reason: 'budget' });
      else omittedSections.push(block.id);
      continue;
    }
    included.push(block.text);
    usedCharacters = nextSize;
    if (block.fact) includedFactIds.push(block.fact.id);
  }

  const includedFacts = facts.filter(fact => includedFactIds.includes(fact.id));
  const conflictCount = includedFacts.filter(fact => fact.conflictsWith.length > 0 || fact.status === 'needs-review').length;
  const proposedCount = includedFacts.filter(fact => fact.status === 'proposed').length;
  const staleEvidenceCount = includedFacts.filter(fact => fact.evidence.some(evidence => {
    const current = evidence.sessionId ? sessionMap.get(evidence.sessionId)?.currentVersion : undefined;
    return current !== undefined && evidence.version !== undefined && evidence.version < current;
  })).length;
  const uncitedCount = includedFacts.filter(fact => fact.evidence.length === 0
    || fact.evidence.every(evidence => evidence.verification === 'unattached')).length;
  const unverifiedEvidenceCount = includedFacts.filter(fact => fact.evidence.some(evidence => evidence.verification !== 'source-matched')).length;
  return {
    text: included.join('\n\n'), budget: input.budget, usedCharacters, includedFactIds, omissions, omittedSections,
    conflictCount, proposedCount, staleEvidenceCount, uncitedCount, unverifiedEvidenceCount,
  };
}
