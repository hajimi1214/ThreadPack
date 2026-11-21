import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS } from '../src/core';
import { applyCleanupRecipe, identifyCleanupRecipe } from '../src/cleanup-recipes';

test('built-in cleanup recipes describe their options and preserve exact custom rules', () => {
  assert.equal(DEFAULT_OPTIONS.redactEmails, true);
  const customSecrets = ['private-customer-reference'];
  const source = { ...DEFAULT_OPTIONS, customSecrets };
  const shareSafe = applyCleanupRecipe(source, 'share-safe');
  assert.equal(shareSafe.redactEmails, true);
  assert.deepEqual(shareSafe.customSecrets, customSecrets);
  assert.notEqual(shareSafe.customSecrets, customSecrets);
  assert.equal(identifyCleanupRecipe(shareSafe), 'share-safe');
  assert.equal(applyCleanupRecipe(source, 'balanced').redactEmails, false);

  shareSafe.customSecrets!.push('another-private-value');
  assert.deepEqual(source.customSecrets, customSecrets);
  assert.equal(identifyCleanupRecipe(applyCleanupRecipe(source, 'keep-text')), 'keep-text');
  assert.equal(identifyCleanupRecipe(DEFAULT_OPTIONS), 'share-safe');
});

test('manual edits leave the quick-recipe state and empty rules stay empty', () => {
  const custom = applyCleanupRecipe({ ...DEFAULT_OPTIONS, customSecrets: [] }, 'balanced');
  assert.deepEqual(custom.customSecrets, []);
  assert.equal(identifyCleanupRecipe({ ...DEFAULT_OPTIONS, toolLimit: 6000 }), null);
});
