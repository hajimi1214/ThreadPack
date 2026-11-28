import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function importConversation(page: Page, name: string, content: string) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      id: 'stable-project-session', title: 'Durable project history',
      messages: [{ id: 'source-user', role: 'user', content }],
    })),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
}

async function openProjects(page: Page) {
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(dialog.locator('.project-list')).toHaveAttribute('aria-busy', 'false');
  return dialog;
}

async function importBackup(page: Page, dialog: Locator, name: string, contents: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await dialog.locator('.project-library-heading').getByRole('button', { name: 'Restore backup', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/x-ndjson', buffer: contents });
}

test('project history survives reloads, deduplicates imports, restores versions and verifies backups', async ({ page }) => {
  await page.goto('/');
  await importConversation(page, 'source-v1.json', 'ORIGINAL_VERSION_ONE_SEARCH_MARKER');
  let dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).fill('Long-running project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.locator('.project-list-item')).toContainText('Long-running project');
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 1');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await importConversation(page, 'source-v1-duplicate.json', 'ORIGINAL_VERSION_ONE_SEARCH_MARKER');
  dialog = await openProjects(page);
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 1');
  await expect(dialog.locator('.project-session-item')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.reload();
  dialog = await openProjects(page);
  await expect(dialog.locator('.project-list-item')).toContainText('Long-running project');
  await expect(dialog.locator('.project-session-item')).toContainText('Durable project history');
  await dialog.getByLabel('Search project history…', { exact: true }).fill('ORIGINAL_VERSION_ONE_SEARCH_MARKER');
  await expect(dialog.locator('.project-session-item')).toContainText('Matched in conversation content');
  await dialog.getByLabel('Search project history…', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await importConversation(page, 'source-v2.json', 'UPDATED_VERSION_TWO_MARKER');
  dialog = await openProjects(page);
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 2');
  await dialog.getByLabel('Search project history…', { exact: true }).fill('ORIGINAL_VERSION_ONE_SEARCH_MARKER');
  await expect(dialog.locator('.project-session-item')).toContainText('Matched in conversation content');
  await dialog.getByLabel('Search project history…', { exact: true }).fill('');

  const historyButton = dialog.getByRole('button', { name: 'Version history', exact: true });
  await historyButton.click();
  const history = dialog.locator('.project-history');
  await expect(history).toContainText('Version 1');
  await expect(history).toContainText('Version 2');
  await history.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 3');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click();
  const backup = await download;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();
  const { readFile } = await import('node:fs/promises');
  const backupText = await readFile(backupPath!, 'utf8');
  expect(backupText).toContain('UPDATED_VERSION_TWO_MARKER');
  expect(backupText).toContain('ORIGINAL_VERSION_ONE_SEARCH_MARKER');

  const lines = backupText.trim().split('\n');
  const firstRevision = JSON.parse(lines[2]!) as { type: string; data: { content: string } };
  firstRevision.data.content += 'corruption';
  lines[2] = JSON.stringify(firstRevision);
  await importBackup(page, dialog, 'corrupt-project.jsonl', Buffer.from(lines.join('\n') + '\n'));
  await expect(dialog.getByRole('alert')).toContainText('integrity check');
  await expect(dialog.locator('.project-list-item')).toHaveCount(1);

  await importBackup(page, dialog, 'project-backup.jsonl', Buffer.from(backupText));
  await expect(dialog.locator('.project-list-item')).toHaveCount(2);
  await expect(dialog.locator('.project-session-item')).toContainText('Version 3');
  await dialog.getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(dialog.locator('.project-history')).toContainText('Version 1');
  await dialog.locator('.project-session-item').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('threadpack-session.jsonl');
  await expect(page.locator('.message-content').first()).toContainText('ORIGINAL_VERSION_ONE_SEARCH_MARKER');
});

test('unchanged session imports refresh source metadata without adding a revision', async ({ page }) => {
  await page.goto('/');
  const source = JSON.stringify({ id: 'stable-metadata-session', title: 'Stable title',
    messages: [{ id: 'same-message', role: 'user', content: 'Same normalized session body.' }] });
  const importFile = (name: string) => page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(source),
  });
  await importFile('initial-export.json');
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  const dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).fill('Metadata project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 1');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  await importFile('renamed-export.json');
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 1');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click();
  const backupPath = await (await download).path();
  expect(backupPath).toBeTruthy();
  const backup = (await readFile(backupPath!, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as {
    type: string; data: Record<string, unknown>;
  });
  const savedSession = backup.find(record => record.type === 'session')!.data;
  const currentRevision = backup.find(record => record.type === 'revision')!.data;
  expect(savedSession.sourceName).toBe('renamed-export.json');
  expect(currentRevision.sourceName).toBe('renamed-export.json');
  expect(savedSession.currentVersion).toBe(1);
  expect(backup.filter(record => record.type === 'revision')).toHaveLength(1);
});

test('project records stay isolated and deleting a project removes its history', async ({ page }) => {
  await page.goto('/');
  await importConversation(page, 'isolated.json', 'PROJECT_ALPHA_PRIVATE_MARKER');
  const dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).fill('Project Alpha');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toHaveCount(1);

  await dialog.getByLabel('Project name', { exact: true }).first().fill('Project Beta');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByText('No conversations saved in this project.', { exact: true })).toBeVisible();
  await dialog.getByLabel('Search project history…', { exact: true }).fill('PROJECT_ALPHA_PRIVATE_MARKER');
  await expect(dialog.locator('.project-session-item')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await dialog.locator('.project-confirm').getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(dialog.locator('.project-list-item')).toHaveCount(1);
  await expect(dialog.locator('.project-list-item')).toContainText('Project Alpha');
  await expect(dialog.locator('.project-session-item')).toHaveCount(1);
});

test('project snapshots and backups retain inactive conversation branches', async ({ page }) => {
  await page.goto('/');
  const source = {
    id: 'branch-session', title: 'Branch preservation', current_node: 'active-answer', mapping: {
      root: { parent: null, message: { id: 'root-message', author: { role: 'user' }, content: { parts: ['Branch question.'] } } },
      'active-answer': { parent: 'root', message: { id: 'active-message', author: { role: 'assistant' }, content: { parts: ['ACTIVE_BRANCH_MARKER'] } } },
      'alternate-answer': { parent: 'root', message: { id: 'alternate-message', author: { role: 'assistant' }, content: { parts: ['INACTIVE_BRANCH_MARKER'] } } },
    },
  };
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'branched-chat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  const dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).fill('Branched project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('2 · Version 1');

  await dialog.getByLabel('Search project history…', { exact: true }).fill('INACTIVE_BRANCH_MARKER');
  await expect(dialog.locator('.project-session-item')).toContainText('Matched in conversation content');
  await dialog.getByLabel('Search project history…', { exact: true }).fill('');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click();
  const backup = await download;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();
  const { readFile } = await import('node:fs/promises');
  const backupText = await readFile(backupPath!, 'utf8');
  expect(backupText).toContain('INACTIVE_BRANCH_MARKER');

  await importBackup(page, dialog, 'branched-project-backup.jsonl', Buffer.from(backupText));
  await expect(dialog.locator('.project-list-item')).toHaveCount(2);
  await dialog.getByRole('button', { name: /Branched project/ }).last().click();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.message-content').filter({ hasText: 'ACTIVE_BRANCH_MARKER' })).toHaveCount(1);
  await expect(page.locator('.message-content').filter({ hasText: 'INACTIVE_BRANCH_MARKER' })).toHaveCount(0);
});

test('project library fits a narrow viewport without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).first().fill('Mobile project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.locator('.project-detail')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    dialog: document.querySelector<HTMLElement>('.project-dialog')!.getBoundingClientRect().width,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.dialog).toBeLessThanOrEqual(dimensions.viewport);
});

test('disabling IndexedDB reports a project-library error while temporary processing remains available', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }));
  await page.goto('/');
  await importConversation(page, 'temporary.json', 'TEMPORARY_WORKFLOW_MARKER');
  const dialog = await openProjects(page);
  await expect(dialog.getByRole('alert')).toContainText('Local project storage is unavailable');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.message-content').filter({ hasText: 'TEMPORARY_WORKFLOW_MARKER' })).toHaveCount(1);
});

test('archiving a project preserves its identity and history and allows restoration', async ({ page }) => {
  await page.goto('/');
  await importConversation(page, 'archived-session.json', 'ARCHIVED_PROJECT_HISTORY_MARKER');
  const dialog = await openProjects(page);
  await dialog.getByLabel('Project name', { exact: true }).fill('Keep this project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Durable project history');
  const projectId = await dialog.locator('.project-list-item').getAttribute('data-project-id');
  expect(projectId).toBeTruthy();

  await dialog.getByRole('button', { name: 'Archive project', exact: true }).click();
  await expect(dialog.locator('.project-list-item')).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Archived projects', exact: true })).toContainText('Keep this project');
  await page.reload();
  const restoredDialog = await openProjects(page);
  await expect(restoredDialog.locator('.project-list-item')).toHaveCount(0);
  const archived = restoredDialog.getByRole('region', { name: 'Archived projects', exact: true });
  const archivedItem = archived.locator('.project-archived-item[data-project-id="' + projectId + '"]');
  await expect(archivedItem).toContainText('Keep this project');
  await archivedItem.getByRole('button', { name: 'Restore', exact: true }).click();

  const restored = restoredDialog.locator('.project-list-item');
  await expect(restored).toHaveCount(1);
  await expect(restored).toHaveAttribute('data-project-id', projectId!);
  await expect(restoredDialog.locator('.project-session-item')).toContainText('Durable project history');
  await expect(restoredDialog.locator('.project-session-item')).toContainText('Version 1');
});
