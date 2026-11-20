import { test, expect } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Pin for handoff', exact: true }).click();
  await page.getByRole('button', { name: 'Build a handoff', exact: true }).click();
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Alpha draft note.');
  await page.getByRole('textbox', { name: 'Constraints', exact: true }).fill('Alpha constraints.');
  await page.getByRole('combobox', { name: 'Recent messages', exact: true }).selectOption('0');
  await page.getByRole('combobox', { name: 'Handoff text budget', exact: true }).selectOption('6000');
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('beta');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('');
  await expect(page.locator('.handoff-document')).not.toContainText('Alpha draft');
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Beta separate draft.');
  await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('alpha');
  await expect(page.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue('Alpha draft note.');
  await expect(page.getByRole('textbox', { name: 'Constraints', exact: true })).toHaveValue('Alpha constraints.');
  await expect(page.getByRole('combobox', { name: 'Recent messages', exact: true })).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Handoff text budget', exact: true })).toHaveValue('6000');
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
