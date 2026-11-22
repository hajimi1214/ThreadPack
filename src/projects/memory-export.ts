import { strToU8, zipSync } from 'fflate';
import type { GeneratedProjectContext, MemorySessionState, ProjectMemoryFact } from './memory-types';

export interface ProjectContextPackageInput {
  project: { name: string; summary: string; importantNotes: string };
  facts: ProjectMemoryFact[];
  sessions: MemorySessionState[];
  generated: GeneratedProjectContext;
  createdAt?: number;
}

function safeFilename(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return cleaned || 'project';
}

export function buildProjectContextPackage(input: ProjectContextPackageInput): { bytes: Uint8Array; filename: string } {
  const included = new Set(input.generated.includedFactIds);
  const facts = input.facts.filter(fact => included.has(fact.id));
  const sessions = new Map(input.sessions.map(session => [session.id, session]));
  const memory = {
    format: 'threadpack-project-context',
    version: 1,
    generatedAt: new Date(input.createdAt ?? Date.now()).toISOString(),
    project: input.project,
    budget: {
      characters: input.generated.budget,
      usedCharacters: input.generated.usedCharacters,
      includedFactIds: input.generated.includedFactIds,
      omittedFacts: input.generated.omissions,
      omittedSections: input.generated.omittedSections,
    },
    reviewSignals: {
      conflicts: input.generated.conflictCount,
      unconfirmedAIProposals: input.generated.proposedCount,
      staleEvidence: input.generated.staleEvidenceCount,
      uncitedFacts: input.generated.uncitedCount,
      userRecordedEvidence: input.generated.unverifiedEvidenceCount,
    },
    facts: facts.map(fact => ({
      id: fact.id, category: fact.category, topic: fact.topic, statement: fact.statement,
      origin: fact.origin, status: fact.status, taskState: fact.taskState,
      conflictsWith: fact.conflictsWith, supersedes: fact.supersedes,
      evidence: fact.evidence.map(evidence => ({
        ...evidence,
        ...(evidence.sessionId ? { sessionTitle: sessions.get(evidence.sessionId)?.title } : {}),
      })),
    })),
  };
  const readme = [
    `# ${input.project.name} context package`, '',
    'This is a local snapshot produced by ThreadPack. It does not update automatically.',
    'For browser AI tools, import PROJECT_CONTEXT.md and threadpack-memory.json using their supported project-file controls.',
    'For coding agents, place PROJECT_CONTEXT.md and threadpack-memory.json in the repository root. AGENTS.md, CLAUDE.md, and GEMINI.md provide short entry instructions.',
    'Confirmed facts include source references. AI proposals are not confirmed. Repository and test evidence marked user-recorded has not been independently checked by ThreadPack.',
    'Refresh and export this package again after project memory changes.',
  ].join('\n');
  const agentInstruction = [
    'Read PROJECT_CONTEXT.md and threadpack-memory.json before changing this project.',
    'Preserve the evidence status attached to each fact. AI proposals are not confirmed facts.',
    'Check cited old session versions against current repository state before relying on them.',
    'After the work, report changed files, tests actually run, and remaining uncertainty separately.',
  ].join('\n');
  return {
    bytes: zipSync({
      'PROJECT_CONTEXT.md': strToU8(input.generated.text),
      'threadpack-memory.json': strToU8(JSON.stringify(memory, null, 2)),
      'README.md': strToU8(readme),
      'AGENTS.md': strToU8(agentInstruction),
      'CLAUDE.md': strToU8(agentInstruction),
      'GEMINI.md': strToU8(agentInstruction),
    }, { level: 6 }),
    filename: `threadpack-context-${safeFilename(input.project.name)}.zip`,
  };
}
