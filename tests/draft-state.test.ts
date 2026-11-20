import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNonblankNotes } from '../src/draft-state';
import type { HandoffNoteFields } from '../src/draft-state';
import { isRedactionDraftDirty, parseRedactionDraft } from '../src/redaction-draft';

const emptyNotes = (): HandoffNoteFields => ({ goal: '', decisions: '', constraints: '', nextSteps: '' });

test('only nonblank text in the four handoff note fields triggers draft protection', () => {
  assert.equal(hasNonblankNotes(emptyNotes()), false);
  assert.equal(hasNonblankNotes({ goal: ' \t\n', decisions: '\u3000', constraints: '\r\n', nextSteps: '\u00a0' }), false);
  for (const key of ['goal', 'decisions', 'constraints', 'nextSteps'] as const) {
    assert.equal(hasNonblankNotes({ ...emptyNotes(), [key]: '继续作業 🔒' }), true);
  }
  const pinsOnly = { ...emptyNotes(), pins: ['message-1'], budget: 6000, ignored: 'metadata' };
  assert.equal(hasNonblankNotes(pinsOnly), false);
});

test('inherited or unrelated prototype keys do not count as saved handoff notes', () => {
  const inherited = Object.create({ goal: 'prototype goal', constructor: 'unexpected', __proto__: { nextSteps: 'inherited' } }) as HandoffNoteFields;
  assert.equal(hasNonblankNotes(inherited), false);
  const unrelated = JSON.parse('{"goal":"","decisions":"","constraints":"","nextSteps":"","__proto__":{"goal":"polluted"},"constructor":"ignored"}') as HandoffNoteFields;
  assert.equal(hasNonblankNotes(unrelated), false);
  const nullPrototype = Object.assign(Object.create(null), emptyNotes(), { decisions: 'Decided locally' }) as HandoffNoteFields;
  assert.equal(hasNonblankNotes(nullPrototype), true);
});

test('redaction drafts accept CRLF and blank lines while preserving literal spaces and deduplicating', () => {
  const draft = parseRedactionDraft(' \t\ninternal.example.test\r\n  customer reference  \r\n\r\ninternal.example.test\n__proto__');
  assert.equal(draft.valid, true);
  assert.deepEqual(draft.values, ['internal.example.test', '  customer reference  ', '__proto__']);
  assert.deepEqual(parseRedactionDraft('\r\n \t\n'), { values: [], valid: true });
});

test('invalid redaction drafts are always dirty and return no submitted values', () => {
  for (const text of ['ab', 'x'.repeat(1001), Array.from({ length: 51 }, (_, index) => `private-rule-${index}`).join('\n')]) {
    assert.deepEqual(parseRedactionDraft(text), { values: [], valid: false });
    assert.equal(isRedactionDraftDirty(text), true);
    assert.equal(isRedactionDraftDirty(text, ['valid-current']), true);
  }
});

test('dirty comparison distinguishes unapplied additions, removals and significant spaces', () => {
  assert.equal(isRedactionDraftDirty(''), false);
  assert.equal(isRedactionDraftDirty(' \n\r\n', []), false);
  assert.equal(isRedactionDraftDirty('internal.example.test'), true);
  assert.equal(isRedactionDraftDirty('', ['internal.example.test']), true);
  assert.equal(isRedactionDraftDirty('  customer reference  ', ['customer reference']), true);
  assert.equal(isRedactionDraftDirty('customer reference', ['  customer reference  ']), true);
  assert.equal(isRedactionDraftDirty('CaseValue', ['casevalue']), true);
});

test('equivalent applied rule sets stay clean despite order, duplicates or line endings', () => {
  const applied = ['alpha-value', 'beta-value', '  literal spaces  '];
  const original = JSON.stringify(applied);
  assert.equal(isRedactionDraftDirty('beta-value\r\nalpha-value\n\n  literal spaces  \nalpha-value', applied), false);
  assert.equal(isRedactionDraftDirty('__proto__', ['__proto__']), false);
  assert.equal(JSON.stringify(applied), original);
});

test('draft validation agrees with Unicode limits and safely rejects corrupt applied state', () => {
  assert.equal(parseRedactionDraft('🔒🔑').valid, false);
  assert.equal(parseRedactionDraft('🔒🔑📦').valid, true);
  assert.equal(parseRedactionDraft('文'.repeat(1000)).valid, true);
  assert.equal(parseRedactionDraft('文'.repeat(1001)).valid, false);
  assert.equal(isRedactionDraftDirty('valid-value', ['ab']), true);
});
