import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

async function importConversation(page: Page, name: string, content: string) {
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      id: 'memory-session', title: 'Runtime decisions',
      messages: [{ id: 'user-evidence', role: 'user', content }],
    })),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
}

async function openProjectMemory(page: Page) {
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  if (!await dialog.locator('.project-list-item').count()) {
    await dialog.getByLabel('Project name', { exact: true }).first().fill('Memory project');
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  }
  await expect(dialog.getByRole('button', { name: 'Add fact', exact: true })).toBeVisible();
  return dialog;
}

async function saveCurrentSession(dialog: Locator) {
  await expect(dialog.getByRole('button', { name: /Save current conversation/ })).toBeVisible();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toHaveCount(1);
}

async function restoreBackup(page: Page, dialog: Locator, name: string, contents: string | Buffer) {
  const chooser = page.waitForEvent('filechooser');
  const importButton = dialog.locator('.project-library-heading').getByRole('button', { name: 'Restore backup', exact: true });
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await (await chooser).setFiles({ name, mimeType: 'application/x-ndjson', buffer: Buffer.from(contents) });
}

test('project facts cite saved messages, expose conflicts, and generate a budgeted handoff', async ({ page }) => {
  await page.goto('/');
  await importConversation(page, 'runtime.json', 'The runtime must stay offline and use JSONL for backups.');
  const dialog = await openProjectMemory(page);
  await saveCurrentSession(dialog);
  await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();

  let form = dialog.locator('.memory-form');
  await form.locator('select').nth(0).selectOption('constraint');
  await form.locator('input').nth(0).fill('Runtime availability');
  await form.locator('textarea').nth(0).fill('The runtime must stay offline.');
  await expect(form.locator('select').nth(2)).toContainText('Runtime decisions');
  await form.locator('select').nth(2).selectOption({ label: 'Runtime decisions' });
  await form.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(dialog.locator('.memory-fact')).toContainText('Confirmed by user');
  await expect(dialog.locator('.memory-fact')).toContainText('Excerpt matched to the saved message');
  await expect(dialog.locator('.memory-fact')).toContainText('The runtime must stay offline.');

  await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
  form = dialog.locator('.memory-form');
  await form.locator('select').nth(0).selectOption('constraint');
  await form.locator('input').nth(0).fill('Runtime availability');
  await form.locator('textarea').nth(0).fill('The runtime requires a cloud connection.');
  await form.locator('select').nth(2).selectOption({ label: 'Runtime decisions' });
  await form.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(dialog.locator('.memory-conflict-banner')).toBeVisible();
  const conflict = dialog.locator('.memory-fact').filter({ hasText: 'The runtime requires a cloud connection.' });
  await expect(conflict).toContainText('Needs review');
  await conflict.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(dialog.locator('.memory-conflict-banner')).not.toBeVisible();

  await dialog.locator('.memory-context-controls input').fill('offline runtime');
  await dialog.getByRole('button', { name: 'Build context', exact: true }).click();
  const context = dialog.getByRole('textbox', { name: 'Generate project context', exact: true });
  await expect(context).toHaveValue(/The runtime must stay offline\./);
  await expect(context).toHaveValue(/Runtime decisions v1/);
  await expect(context).not.toHaveValue(/cloud connection/);
  await expect(dialog.locator('.memory-context-summary')).toContainText('Omitted items · 0');
});

test('AI proposals are source-checked, stay pending review, and leave no stored API key', async ({ page }) => {
  await page.goto('/');
  await importConversation(page, 'ai-evidence.json', 'The service must never send conversation text over the network.');
  const dialog = await openProjectMemory(page);
  await saveCurrentSession(dialog);
  const secret = 'synthetic-api-key-do-not-store';
  const endpoint = new URL('/v1/chat/completions', page.url()).toString();
  let capturedAuthorization = '';
  let capturedEvidence = '';
  let routeError = '';
  await page.route('**/v1/chat/completions', async route => {
    try {
      const request = route.request();
      capturedAuthorization = request.headers().authorization ?? '';
      const body = request.postDataJSON() as { messages: { content: string }[] };
      const prompt = body.messages.at(-1)!.content;
      const evidence = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as {
        evidenceMessages: { sessionId: string; version: number; messageId: string; content: string }[];
      };
      const source = evidence.evidenceMessages[0]!;
      capturedEvidence = source.content;
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ facts: [{
        category: 'constraint', topic: 'Network privacy', statement: 'Conversation text must stay offline.',
        evidence: [{ sessionId: source.sessionId, version: source.version, messageId: source.messageId, quote: 'never send conversation text over the network' }],
      }] }) } }] } });
    } catch (error) {
      routeError = error instanceof Error ? error.message : String(error);
      await route.fulfill({ status: 500, body: '{}' });
    }
  });

  const ai = dialog.locator('.memory-ai-panel');
  await ai.locator('summary').click();
  await ai.getByLabel('Enable AI suggestions for this session', { exact: true }).check();
  await ai.getByLabel('Chat Completions endpoint', { exact: true }).fill(endpoint);
  await ai.getByLabel('Model', { exact: true }).fill('test-model');
  await ai.getByLabel('API key · held in memory only', { exact: true }).fill(secret);
  await ai.locator('.memory-ai-sessions label').filter({ hasText: 'Runtime decisions' }).getByRole('checkbox').check();
  await ai.getByRole('button', { name: 'Extract suggestions', exact: true }).click();

  const proposal = dialog.locator('.memory-fact').filter({ hasText: 'Conversation text must stay offline.' });
  await expect(proposal).toContainText('AI proposal · not confirmed');
  await expect(proposal).toContainText('Excerpt matched to the saved message');
  expect(capturedAuthorization).toBe(`Bearer ${secret}`);
  expect(capturedEvidence).toContain('The service must never send conversation text over the network.');
  expect(routeError).toBe('');

  await proposal.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(proposal).toContainText('Confirmed by user');
  await ai.getByRole('button', { name: 'Extract suggestions', exact: true }).click();
  await expect(dialog.locator('.memory-fact')).toHaveCount(1);
  await expect(dialog.locator('.memory-fact')).toContainText('Confirmed by user');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download backup', exact: true }).click();
  const backupPath = await (await download).path();
  expect(backupPath).toBeTruthy();
  const backupText = await readFile(backupPath!, 'utf8');
  expect(backupText).toContain('Conversation text must stay offline.');
  expect(backupText).not.toContain(secret);
  await restoreBackup(page, dialog, 'memory-project-backup.jsonl', backupText);
  await expect(dialog.locator('.project-list-item')).toHaveCount(2);
  await expect(dialog.locator('.memory-fact')).toContainText('Conversation text must stay offline.');
  await expect(dialog.locator('.memory-fact')).toContainText('Excerpt matched to the saved message');
});

test('version-one project backups restore after the IndexedDB schema migration', async ({ page }) => {
  await page.goto('/');
  const dialog = await openProjectMemory(page);
  const content = JSON.stringify({ id: 'legacy-message-1', role: 'user', content: 'Legacy project evidence.' }) + '\n';
  const fingerprint = createHash('sha256').update(content).digest('hex');
  const now = Date.now();
  const backup = [
    { type: 'threadpack_project', version: 1, createdAt: now, project: { name: 'Legacy project', summary: '', importantNotes: '', createdAt: now, updatedAt: now }, sessionCount: 1, revisionCount: 1 },
    { type: 'session', data: { id: 'legacy-session', sessionKey: 'source:generic:legacy', title: 'Legacy history', sourceName: 'legacy.json', platform: 'generic', sourceId: 'legacy', format: 'Messages JSON export', messageCount: 1, fingerprint, currentVersion: 1, createdAt: now, updatedAt: now } },
    { type: 'revision', data: { sessionId: 'legacy-session', version: 1, fingerprint, content, title: 'Legacy history', platform: 'generic', sourceId: 'legacy', format: 'Messages JSON export', messageCount: 1, sourceName: 'legacy.json', createdAt: now } },
  ].map(record => JSON.stringify(record)).join('\n') + '\n';
  await restoreBackup(page, dialog, 'legacy-project.jsonl', backup);
  await expect(dialog.locator('.project-list-item')).toHaveCount(2);
  await dialog.getByRole('button', { name: /Legacy project/ }).last().click();
  await expect(dialog.locator('.project-session-item')).toContainText('Legacy history');
  await dialog.locator('.project-session-item').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('threadpack-session.jsonl');
  await expect(page.locator('.message-content')).toContainText('Legacy project evidence.');
});

test('indexed database version one projects survive the schema upgrade and accept memory facts', async ({ page }) => {
  const projectId = 'pre-upgrade-project';
  const sessionId = 'pre-upgrade-session';
  const content = JSON.stringify({ id: 'message-1', role: 'user', content: 'This existing project remains available after upgrading.' }) + '\n';
  const fingerprint = createHash('sha256').update(content).digest('hex');
  const now = Date.now();
  await page.goto('/robots.txt');
  await page.evaluate(async ({ projectId, sessionId, content, fingerprint, now }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('threadpack-project-library', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        const sessions = db.createObjectStore('sessions', { keyPath: 'key' });
        sessions.createIndex('projectId', 'projectId');
        sessions.createIndex('projectSessionKey', ['projectId', 'sessionKey'], { unique: true });
        sessions.createIndex('projectUpdatedAt', ['projectId', 'updatedAt']);
        const revisions = db.createObjectStore('revisions', { keyPath: 'key' });
        revisions.createIndex('projectId', 'projectId');
        revisions.createIndex('projectSession', ['projectId', 'sessionId']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['projects', 'sessions', 'revisions'], 'readwrite');
      tx.objectStore('projects').put({ id: projectId, name: 'Pre-upgrade project', summary: 'Existing project state.',
        importantNotes: 'Retain this note.', createdAt: now, updatedAt: now });
      tx.objectStore('sessions').put({ key: `${projectId}\0${sessionId}`, projectId, id: sessionId,
        sessionKey: 'source:generic:pre-upgrade', title: 'Existing session', sourceName: 'old.json', platform: 'generic',
        sourceId: 'pre-upgrade', format: 'Messages JSON export', messageCount: 1, fingerprint,
        currentVersion: 1, createdAt: now, updatedAt: now });
      tx.objectStore('revisions').put({ key: [projectId, sessionId, 1], projectId, sessionId, version: 1,
        fingerprint, content, sourceName: 'old.json', createdAt: now });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    database.close();
  }, { projectId, sessionId, content, fingerprint, now });

  await page.goto('/');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(dialog.locator('.project-list-item')).toContainText('Pre-upgrade project');
  await expect(dialog.locator('.project-session-item')).toContainText('Existing session');
  await dialog.locator('.project-session-item').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.file-details > strong')).toHaveText('threadpack-session.jsonl');
  await expect(page.locator('.message-content')).toContainText('This existing project remains available after upgrading.');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const migratedDialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(migratedDialog.locator('.project-list-item')).toContainText('Pre-upgrade project');
  await migratedDialog.getByRole('button', { name: /Pre-upgrade project/ }).click();
  await expect(migratedDialog.locator('.project-session-item')).toContainText('Existing session');
  await migratedDialog.getByRole('button', { name: 'Add fact', exact: true }).click();
  const form = migratedDialog.locator('.memory-form');
  await form.locator('select').nth(0).selectOption('decision');
  await form.locator('input').nth(0).fill('Existing migration');
  await form.locator('textarea').nth(0).fill('The previous project remains available after migration.');
  await form.locator('select').nth(1).selectOption('user');
  await form.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(migratedDialog.locator('.memory-fact')).toContainText('The previous project remains available after migration.');
});
