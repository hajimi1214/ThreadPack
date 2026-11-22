import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_HANDOFF_DRAFT_BYTES, parseHandoffDraft, serializeHandoffDraft, sha256Fingerprint } from '../src/handoff-draft';

const draft = {
  format: 'threadpack-handoff-draft' as const,
  version: 1 as const,
  source: { format: 'Messages JSON export', fingerprint: 'a'.repeat(64), messageCount: 2 },
  notes: { goal: 'Keep this note as entered', decisions: '', constraints: '', nextSteps: '' },
  pinnedMessages: [{ number: 2, fingerprint: 'b'.repeat(64) }],
  recentCount: 8,
  recentMode: 'source' as const,
  maxCharacters: 12000 as const,
};

test('handoff drafts round-trip only versioned settings and validate pinned message numbers', () => {
  const text = serializeHandoffDraft(draft);
  assert.deepEqual(parseHandoffDraft(text), draft);
  assert.ok(!text.includes('provider-message-id'));
  assert.ok(!text.includes('message body'));
});

test('handoff drafts reject malformed structure, unsupported keys, duplicate pins and out-of-range numbers', () => {
  const cases = [
    '{ malformed',
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, extra: 'unexpected' }),
    JSON.stringify({ ...draft, pinnedMessages: [{ number: 0, fingerprint: 'b'.repeat(64) }] }),
    JSON.stringify({ ...draft, pinnedMessages: [{ number: 3, fingerprint: 'b'.repeat(64) }] }),
    JSON.stringify({ ...draft, pinnedMessages: [{ number: 1, fingerprint: 'b'.repeat(64) }, { number: 1, fingerprint: 'c'.repeat(64) }] }),
  ];
  for (const text of cases) assert.throws(() => parseHandoffDraft(text));
});

test('handoff draft size limit is enforced on UTF-8 bytes for import and export', () => {
  assert.throws(() => parseHandoffDraft(' '.repeat(MAX_HANDOFF_DRAFT_BYTES + 1)));
  const oversized = { ...draft, notes: { ...draft.notes, goal: '文'.repeat(MAX_HANDOFF_DRAFT_BYTES) } };
  assert.throws(() => serializeHandoffDraft(oversized as typeof draft));
});

test('SHA-256 fingerprints are stable without exposing the input', async () => {
  const value = 'synthetic private message body';
  const first = await sha256Fingerprint(value);
  assert.equal(first, await sha256Fingerprint(value));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.ok(!first.includes(value));
  assert.notEqual(first, await sha256Fingerprint(`${value}!`));
});
