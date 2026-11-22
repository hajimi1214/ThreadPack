import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('conversation drafts survive switching and are discarded with the archive', async ({ page }) => {
  await page.goto('/');
  const fixture = [
    { id: 'alpha', title: 'Alpha', messages: [{ role: 'user', content: 'Alpha context to pin.' }] },
    { id: 'beta', title: 'Beta', messages: [{ role: 'user', content: 'Beta context to pin.' }] },
  ];
  const upload = () => page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'drafts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const ready = () => expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await upload(); await ready();
  await page.getByRole('article').first().getByRole('button', { name: 'Pin for handoff', exact: true }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Alpha draft note.');
  await page.getByRole('textbox', { name: 'Constraints', exact: true }).fill('Alpha constraints.');
  await page.getByRole('combobox', { name: 'Recent messages', exact: true }).selectOption('0');
  await page.getByRole('combobox', { name: 'Handoff text budget', exact: true }).selectOption('6000');
  await page.getByRole('button', { name: 'Latest timestamps', exact: true }).click();
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('beta');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Source order', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.handoff-document')).not.toContainText('Alpha draft');
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Beta separate draft.');
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('alpha');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('Alpha draft note.');
  await expect(page.getByRole('textbox', { name: 'Constraints', exact: true })).toHaveValue('Alpha constraints.');
  await expect(page.getByRole('combobox', { name: 'Recent messages', exact: true })).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Handoff text budget', exact: true })).toHaveValue('6000');
  await expect(page.getByRole('button', { name: 'Latest timestamps', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.handoff-document')).toContainText('Alpha context to pin.');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['threadpack-language']);
  await page.getByRole('button', { name: 'Workbench', exact: true }).click(); await ready();
  await expect(page.getByRole('button', { name: 'Unpin message', exact: true })).toBeVisible();
  await upload();
  await page.getByRole('dialog', { name: 'Unsaved handoff notes', exact: true }).getByRole('button', { name: 'Discard notes', exact: true }).click();
  await ready();
  await expect(page.getByRole('button', { name: 'Pin for handoff', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('This draft must be cleared.');
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unsaved handoff notes', exact: true }).getByRole('button', { name: 'Discard notes', exact: true }).click();
  await upload(); await ready();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
});

test('handoff drafts export and import independently with a source-bound pin check', async ({ page }) => {
  await page.goto('/');
  const fixture = [
    { id: 'source-conversation', title: 'Source conversation', messages: [
      { id: 'provider-private-id', role: 'user', content: 'Pinned source message.' },
      { id: 'another-private-id', role: 'assistant', content: 'Reply to preserve in context.' },
    ] },
    { id: 'other-conversation', title: 'Other conversation', messages: [
      { role: 'user', content: 'An unrelated message.' },
    ] },
  ];
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('article').first().getByRole('button', { name: 'Pin for handoff', exact: true }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Sensitive draft note stays as entered.');
  await page.getByRole('button', { name: 'Latest timestamps', exact: true }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export draft', exact: true }).click();
  const draftPath = await (await download).path();
  const draftText = await readFile(draftPath!, 'utf8');
  const draft = JSON.parse(draftText) as { notes: { goal: string }; pinnedMessages: { number: number; fingerprint: string }[] };
  expect(draft.notes.goal).toBe('Sensitive draft note stays as entered.');
  expect(draft.pinnedMessages.map(pin => pin.number)).toEqual([1]);
  expect(draftText).not.toContain('provider-private-id');
  expect(draftText).not.toContain('Pinned source message.');

  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Keep current draft when replacement is canceled.');
  const loadDraft = () => page.getByLabel('Import draft', { exact: true }).setInputFiles({
    name: 'handoff-draft.json', mimeType: 'application/json', buffer: Buffer.from(draftText),
  });
  await loadDraft();
  const replaceDialog = page.getByRole('dialog', { name: 'Replace the current handoff draft?', exact: true });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('Keep current draft when replacement is canceled.');

  await loadDraft();
  await page.getByRole('dialog', { name: 'Replace the current handoff draft?', exact: true }).getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('Sensitive draft note stays as entered.');
  await expect(page.locator('.handoff-document')).toContainText('Pinned source message.');

  const invalid = { ...draft, pinnedMessages: [{ number: 3, fingerprint: '0'.repeat(64) }] };
  await page.getByLabel('Import draft', { exact: true }).setInputFiles({
    name: 'invalid-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await expect(page.locator('.toast')).toContainText('invalid or uses an unsupported version');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('Sensitive draft note stays as entered.');

  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('other-conversation');
  await page.getByLabel('Import draft', { exact: true }).setInputFiles({
    name: 'handoff-draft.json', mimeType: 'application/json', buffer: Buffer.from(draftText),
  });
  await expect(page.locator('.toast')).toContainText('do not match this conversation');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
});
