import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { buildAIExtractionPrompt, parseAISuggestionResponse, validateAIEndpoint } from '../src/projects/memory-ai';
import { generateProjectContext } from '../src/projects/memory-context';
import { buildProjectContextPackage } from '../src/projects/memory-export';
import type { ProjectMemoryFact } from '../src/projects/memory-types';

function fact(overrides: Partial<ProjectMemoryFact> & Pick<ProjectMemoryFact, 'id' | 'topic' | 'statement'>): ProjectMemoryFact {
  const defaults: ProjectMemoryFact = {
    key: `project\0${overrides.id}`, id: '', projectId: 'project', normalizedTopic: '',
    category: 'decision', topic: '', statement: '', origin: 'user', status: 'confirmed',
    evidence: [{ id: `evidence-${overrides.id}`, kind: 'conversation', reference: 'Architecture chat v1 · message-2',
      quote: 'We agreed to keep this local.', sessionId: 'session', version: 1, messageId: 'message-2',
      messageFingerprint: 'a'.repeat(64), recordedAt: 1, verification: 'source-matched' }],
    conflictsWith: [], createdAt: 1, updatedAt: 1,
  };
  return Object.assign(defaults, overrides);
}

test('project context search ranks exact facts, reports stale evidence and omits whole records over budget', () => {
  const old = fact({ id: 'old', topic: 'Storage', statement: 'Keep project data in IndexedDB.', conflictsWith: ['current'], status: 'needs-review' });
  const current = fact({ id: 'current', topic: 'Storage', statement: 'Back up project history as JSONL.',
    status: 'needs-review', conflictsWith: ['old'], evidence: [{ ...old.evidence[0]!, version: 1 }] });
  const irrelevant = fact({ id: 'other', topic: 'Logging', statement: 'Avoid logging sensitive content.' });
  const generated = generateProjectContext({
    project: { name: 'ThreadPack', summary: 'Add durable project memory.', importantNotes: '' },
    facts: [old, current, irrelevant], sessions: [{ id: 'session', title: 'Architecture chat', currentVersion: 2 }],
    query: 'backup history', budget: 1000,
  });
  assert.deepEqual(generated.includedFactIds, ['current', 'old']);
  assert.equal(generated.conflictCount, 2);
  assert.equal(generated.staleEvidenceCount, 2);
  assert.equal(generated.omissions.find(item => item.id === 'other')?.reason, 'not-relevant');
  assert.ok(generated.text.includes('NEEDS REVIEW'));
  assert.ok(generated.text.includes('historical version'));
  assert.ok(generated.usedCharacters <= generated.budget);
});

test('project context never truncates a fact and reports budget omissions', () => {
  const oversized = fact({ id: 'oversized', topic: 'Build', statement: 'A'.repeat(1400) });
  const result = generateProjectContext({ project: { name: 'P', summary: '', importantNotes: '' },
    facts: [oversized], sessions: [], query: '', budget: 1000 });
  assert.equal(result.includedFactIds.length, 0);
  assert.equal(result.omissions[0]?.reason, 'budget');
  assert.equal(result.text.includes('A'.repeat(1400)), false);
});

test('AI endpoints reject credential-bearing and insecure remote URLs', () => {
  assert.equal(validateAIEndpoint('https://api.example.test/v1/chat/completions'), 'https://api.example.test/v1/chat/completions');
  assert.equal(validateAIEndpoint('http://localhost:8080/v1/chat/completions'), 'http://localhost:8080/v1/chat/completions');
  assert.throws(() => validateAIEndpoint('http://api.example.test/v1/chat/completions'), /HTTPS/);
  assert.throws(() => validateAIEndpoint('https://user:secret@api.example.test/v1'), /HTTPS/);
});

test('AI suggestions must cite exact excerpts from the explicitly selected evidence', () => {
  const sources = [{ sessionId: 'session', version: 2, title: 'Plan', messageId: 'message-3', role: 'user', content: 'The new runtime must stay offline.' }];
  const response = { choices: [{ message: { content: JSON.stringify({ facts: [{
    category: 'constraint', topic: 'Runtime', statement: 'The runtime must stay offline.',
    evidence: [{ sessionId: 'session', version: 2, messageId: 'message-3', quote: 'must stay offline' }],
  }] }) } }] };
  const suggestions = parseAISuggestionResponse(response, sources);
  assert.equal(suggestions[0]!.evidence[0]!.quote, 'must stay offline');
  assert.throws(() => parseAISuggestionResponse({ choices: [{ message: { content: JSON.stringify({ facts: [{
    category: 'decision', topic: 'Runtime', statement: 'A model made this up.',
    evidence: [{ sessionId: 'other', version: 1, messageId: 'message-1', quote: 'invented quote' }],
  }] }) } }] }, sources), /outside the selected evidence/);
  assert.throws(() => parseAISuggestionResponse({ choices: [{ message: { content: 'not JSON' } }] }, sources), /structured data/);
});

test('AI extraction prompt names its limits and sends only supplied evidence', () => {
  const prompt = buildAIExtractionPrompt({ projectName: 'Demo', projectStatus: 'Build the memory layer.',
    selectedFacts: [], messages: [{ sessionId: 's1', version: 1, title: 'Chat', messageId: 'm1', role: 'user', content: 'Keep the work offline.' }] });
  assert.match(prompt, /untrusted quoted data/);
  assert.match(prompt, /Do not infer repository state or test success/);
  assert.match(prompt, /Keep the work offline/);
  assert.doesNotMatch(prompt, /secret-key/);
});

test('portable AI context package retains evidence and tool entry instructions without secrets', () => {
  const entry = fact({ id: 'decision-1', topic: 'Storage', statement: 'Keep project history local.' });
  const generated = generateProjectContext({ project: { name: 'ThreadPack Stage 5', summary: 'Connect tools.', importantNotes: '' },
    facts: [entry], sessions: [{ id: 'session', title: 'Design session', currentVersion: 2 }], query: 'storage', budget: 2000 });
  const pack = buildProjectContextPackage({ project: { name: 'ThreadPack Stage 5', summary: 'Connect tools.', importantNotes: '' },
    facts: [entry], sessions: [{ id: 'session', title: 'Design session', currentVersion: 2 }], generated, createdAt: 1 });
  const files = unzipSync(pack.bytes);
  const context = strFromU8(files['PROJECT_CONTEXT.md']!);
  const memory = JSON.parse(strFromU8(files['threadpack-memory.json']!)) as {
    facts: { evidence: { sessionTitle?: string; verification: string }[] }[];
    budget: { includedFactIds: string[] };
  };
  assert.equal(pack.filename, 'threadpack-context-ThreadPack-Stage-5.zip');
  assert.ok(files['AGENTS.md']);
  assert.ok(files['CLAUDE.md']);
  assert.ok(files['GEMINI.md']);
  assert.ok(strFromU8(files['AGENTS.md']!).includes('AI proposals are not confirmed facts'));
  assert.ok(context.includes('Keep project history local.'));
  assert.equal(memory.facts[0]!.evidence[0]!.sessionTitle, 'Design session');
  assert.equal(memory.facts[0]!.evidence[0]!.verification, 'source-matched');
  assert.deepEqual(memory.budget.includedFactIds, ['decision-1']);
  assert.doesNotMatch(JSON.stringify(memory), /synthetic-api-key-do-not-store/);
  const rejected = { ...entry, status: 'rejected' as const, updatedAt: 2 };
  assert.throws(() => buildProjectContextPackage({ project: { name: 'ThreadPack Stage 5', summary: 'Connect tools.', importantNotes: '' },
    facts: [rejected], sessions: [{ id: 'session', title: 'Design session', currentVersion: 2 }], generated }), /out of date/);
});

test('continuation benchmark retrieves every labeled fact within budget without dropping its evidence status', () => {
  const corpus = [
    fact({ id: 'offline-runtime', category: 'constraint', topic: 'Runtime', statement: 'The project runtime must remain offline.' }),
    fact({ id: 'branch-preservation', category: 'decision', topic: 'Session import', statement: 'Keep alternate ChatGPT branches in saved history.' }),
    fact({ id: 'backup-recovery', category: 'task', topic: 'Backup recovery', statement: 'Test restoring a versioned project backup.', taskState: 'in-progress' }),
    fact({ id: 'redaction', category: 'risk', topic: 'Privacy', statement: 'Review redaction before sharing untrusted conversation data.' }),
  ];
  const cases = [
    { query: 'offline runtime', expected: ['offline-runtime'] },
    { query: 'ChatGPT alternate branches', expected: ['branch-preservation'] },
    { query: 'versioned project backup', expected: ['backup-recovery'] },
    { query: 'redaction sharing privacy', expected: ['redaction'] },
  ];
  let retrieved = 0;
  let returned = 0;
  const unexpected: string[] = [];
  for (const item of cases) {
    const generated = generateProjectContext({ project: { name: 'ThreadPack', summary: '', importantNotes: '' },
      facts: corpus, sessions: [{ id: 'session', title: 'Synthetic evidence session', currentVersion: 1 }],
      query: item.query, budget: 2000 });
    retrieved += item.expected.filter(id => generated.includedFactIds.includes(id)).length;
    returned += generated.includedFactIds.length;
    unexpected.push(...generated.includedFactIds.filter(id => !item.expected.includes(id)).map(id => `${item.query} -> ${id}`));
    assert.equal(generated.usedCharacters <= generated.budget, true);
    for (const id of generated.includedFactIds) {
      assert.ok(generated.text.includes(corpus.find(entry => entry.id === id)!.statement));
      assert.match(generated.text, /CONFIRMED|NEEDS REVIEW|AI PROPOSAL/);
      assert.match(generated.text, /Evidence \(source-matched\)/);
    }
  }
  const recall = retrieved / cases.reduce((total, item) => total + item.expected.length, 0);
  const precision = retrieved / returned;
  assert.equal(recall, 1);
  assert.equal(precision, 1, unexpected.join('; '));
});
