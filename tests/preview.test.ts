import test from 'node:test';
import assert from 'node:assert/strict';
import { messagePreview, searchPattern } from '../src/preview';

test('late search matches are included in both collapsed and expanded previews', () => {
  const content = 'Early context. '.repeat(1100) + 'EXACT_LATE_NEEDLE' + ' Final context.'.repeat(500);
  for (const expanded of [false, true]) {
    const preview = messagePreview(content, 'exact_late_needle', expanded);
    assert.equal(preview.contextual, true);
    assert.match(preview.text, /EXACT_LATE_NEEDLE/);
    assert.ok(preview.text.length < content.length);
  }
  assert.equal(messagePreview(content, '', false).contextual, false);
  assert.match(messagePreview(content, '', false).text, /^Early context/);
});

test('search treats regex characters as literal text and keeps original Unicode offsets', () => {
  const pattern = searchPattern('path[0].*');
  assert.ok(pattern?.test('literal PATH[0].* value'));
  assert.equal(pattern?.test('path0xxxx'), false);
  const preview = messagePreview('İ'.repeat(1500) + '日本語 searchTarget', 'searchTarget', false);
  assert.match(preview.text, /日本語 searchTarget/);
  assert.equal(searchPattern('searchTarget')?.exec(preview.text)?.[0], 'searchTarget');
});

test('base64 stays hidden in previews without swallowing following text', () => {
  const content = 'Before\ndata:image/png;base64,' + 'QUJD'.repeat(10000) + '\nKeep this sentence.';
  const preview = messagePreview(content, '', false);
  assert.ok(preview.text.includes('Keep this sentence.'));
  assert.ok(preview.text.includes('hidden in preview'));
  assert.equal(preview.text.includes('QUJD'), false);
});
