import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReviewMemoryStatusTransition, effectiveMemoryStatus, isTerminalMemoryStatus, normalizeMemoryClaimText, sameMemoryClaimText } from '../src/projects/memory-lifecycle';

test('terminal memory statuses cannot re-enter the active lifecycle', () => {
  for (const terminal of ['rejected', 'superseded', 'expired', 'revoked'] as const) {
    assert.equal(isTerminalMemoryStatus(terminal), true);
    assert.equal(canReviewMemoryStatusTransition(terminal, 'confirmed'), false);
    assert.equal(canReviewMemoryStatusTransition(terminal, 'needs-review'), false);
    assert.equal(canReviewMemoryStatusTransition(terminal, terminal), false);
  }
});

test('review transitions permit only explicit user review actions', () => {
  assert.equal(canReviewMemoryStatusTransition('proposed', 'confirmed'), true);
  assert.equal(canReviewMemoryStatusTransition('proposed', 'rejected'), true);
  assert.equal(canReviewMemoryStatusTransition('needs-review', 'revoked'), false);
  assert.equal(canReviewMemoryStatusTransition('confirmed', 'revoked'), true);
  assert.equal(canReviewMemoryStatusTransition('confirmed', 'expired'), false);
});

test('expiry projection preserves explicit terminal history and expires active records at the boundary', () => {
  const now = 1_800_000_000_000;
  assert.equal(effectiveMemoryStatus('confirmed', now + 1, now), 'confirmed');
  assert.equal(effectiveMemoryStatus('needs-review', now, now), 'expired');
  assert.equal(effectiveMemoryStatus('rejected', now - 1, now), 'rejected');
  assert.equal(effectiveMemoryStatus('expired', undefined, now), 'expired');
});

test('claim normalization catches Unicode width and whitespace duplicates', () => {
  assert.equal(normalizeMemoryClaimText('  Ｕse   HTTPS  '), 'use https');
  assert.equal(sameMemoryClaimText('Use HTTPS', '  use   https '), true);
  assert.equal(sameMemoryClaimText('Use HTTPS', 'Use HTTP'), false);
});
