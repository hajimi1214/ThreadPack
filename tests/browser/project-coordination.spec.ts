import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupLocalProjectTrust } from './helpers/project-trust';

test.use({ serviceWorkers: 'block' });

test('MCP task claims and results flow through shared project review', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
      showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
      readProjectFile?: () => Promise<string>;
      setInboxFile?: (text: string) => Promise<void>;
    };
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    const handlePrototype = typeof FileSystemFileHandle === 'undefined' ? undefined : FileSystemFileHandle.prototype as unknown as Record<string, unknown>;
    if (typeof testWindow.showSaveFilePicker !== 'function' || typeof storage.getDirectory !== 'function'
      || typeof handlePrototype?.getFile !== 'function' || typeof handlePrototype.createWritable !== 'function'
      || typeof handlePrototype.queryPermission !== 'function' || typeof handlePrototype.requestPermission !== 'function') return;
    testWindow.showSaveFilePicker = async () => (await storage.getDirectory!()).getFileHandle('coordination-project.jsonl', { create: true });
    testWindow.showOpenFilePicker = async () => [await (await storage.getDirectory!()).getFileHandle('coordination-inbox.jsonl', { create: true })];
    testWindow.readProjectFile = async () => (await (await storage.getDirectory!()).getFileHandle('coordination-project.jsonl')).getFile().then(file => file.text());
    testWindow.setInboxFile = async text => {
      const handle = await (await storage.getDirectory!()).getFileHandle('coordination-inbox.jsonl', { create: true });
      const writer = await handle.createWritable();
      await writer.write(text);
      await writer.close();
    };
  });

  await page.goto('/');
  const supported = await page.evaluate(() => {
    const handlePrototype = typeof FileSystemFileHandle === 'undefined' ? undefined : FileSystemFileHandle.prototype as unknown as Record<string, unknown>;
    return window.isSecureContext && typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
      && typeof (navigator.storage as StorageManager & { getDirectory?: unknown }).getDirectory === 'function'
      && typeof handlePrototype?.getFile === 'function' && typeof handlePrototype.createWritable === 'function'
      && typeof handlePrototype.queryPermission === 'function' && typeof handlePrototype.requestPermission === 'function';
  });
  if (!supported) test.skip(true, 'This environment does not expose secure local file sharing.');

  const source = JSON.stringify({ id: 'coordination-session', title: 'Backup recovery work', messages: [
    { id: 'task-instruction', role: 'user', content: 'Verify project backup restoration.' },
    { id: 'task-result-message', role: 'assistant', content: 'Restore fixture verification completed successfully.' },
  ] });
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'coordination.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await library.getByLabel('Project name', { exact: true }).fill('Coordination project');
  await library.getByRole('button', { name: 'Create project', exact: true }).click();
  await library.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(library.locator('.project-session-item')).toContainText('Backup recovery work');
  await setupLocalProjectTrust(page, library);
  await library.getByRole('button', { name: 'Connect live local state', exact: true }).click();
  await expect(library.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  await library.getByRole('button', { name: 'Connect inbox', exact: true }).click();
  await expect(library.getByLabel('AI update inbox')).toContainText('coordination-inbox.jsonl');

  await library.getByRole('button', { name: 'Add fact', exact: true }).click();
  const memoryForm = library.locator('.memory-form');
  await memoryForm.locator('select').nth(0).selectOption('task');
  await memoryForm.locator('select').nth(1).selectOption('in-progress');
  await memoryForm.locator('input').nth(0).fill('Backup recovery');
  await memoryForm.locator('textarea').nth(0).fill('Verify project backup restoration.');
  await memoryForm.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(library.locator('.memory-fact').filter({ hasText: 'Verify project backup restoration.' })).toContainText('Signed by this project’s local trusted key');
  await expect.poll(async () => page.evaluate(async statement => {
    const contents = await (window as unknown as { readProjectFile: () => Promise<string> }).readProjectFile();
    return contents.split(/\r?\n/).filter(Boolean).some(line => {
      const record = JSON.parse(line) as { type: string; data?: { statement?: string; status?: string } };
      return record.type === 'memory' && record.data?.statement === statement && record.data.status === 'confirmed';
    });
  }, 'Verify project backup restoration.'),
  { timeout: 30_000 }).toBe(true);

  const statePath = testInfo.outputPath('coordination-project.jsonl');
  const inboxPath = testInfo.outputPath('coordination-inbox.jsonl');
  await writeFile(inboxPath, '', 'utf8');
  const script = `import { runMcpServer } from ${JSON.stringify(new URL('../../cli/mcp-server.ts', import.meta.url).href)}; await runMcpServer(process.argv.slice(1), 'test');`;
  async function callTool(name: string, args: Record<string, unknown> = {}, syncInbox = true) {
    const state = await page.evaluate(async () => await (window as unknown as { readProjectFile: () => Promise<string> }).readProjectFile());
    await writeFile(statePath, state, 'utf8');
    const projectRecord = state.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { type: string; projectId?: string })
      .find(record => record.type === 'threadpack_project');
    expect(projectRecord?.projectId).toBeTruthy();
    const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n';
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, '--',
      '--backup', statePath, '--inbox', inboxPath, '--client-id', 'codex-local', '--project-id', projectRecord!.projectId!,
      '--allow-candidate-updates', '--allow-task-coordination'], {
      cwd: resolve('.'), encoding: 'utf8', input,
    });
    expect(result.status, result.stderr).toBe(0);
    const response = JSON.parse(result.stdout.trim()) as { error?: { message: string }; result?: { structuredContent?: Record<string, unknown> } };
    expect(response.error, result.stderr).toBeUndefined();
    if (syncInbox) {
      await page.evaluate(async text => await (window as unknown as { setInboxFile: (value: string) => Promise<void> }).setInboxFile(text), await readFile(inboxPath, 'utf8'));
    }
    return response.result?.structuredContent ?? {};
  }

  const available = await callTool('threadpack_project_tasks');
  const tasks = available.tasks as { id: string; activeClaim: unknown }[];
  expect(tasks).toHaveLength(1);
  expect(tasks[0]!.activeClaim).toBeNull();
  const taskId = tasks[0]!.id;
  const lease = await callTool('threadpack_project_claim_task', {
    idempotencyKey: 'codex-claim-backup', action: 'claim', taskId, leaseSeconds: 300,
  });
  expect(lease.status).toBe('recorded');
  expect(lease.clientIdentityVerified).toBe(false);
  const coordination = library.getByLabel('AI task coordination');
  await expect(coordination).toContainText('codex-local', { timeout: 30_000 });
  await expect(coordination).toContainText('Claim active');

  const records = (await page.evaluate(async () => await (window as unknown as { readProjectFile: () => Promise<string> }).readProjectFile()))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { id?: string; currentVersion?: number; sessionId?: string; version?: number; content?: string } });
  const session = records.find(record => record.type === 'session')!.data!;
  const revision = records.find(record => record.type === 'revision' && record.data?.sessionId === session.id && record.data?.version === session.currentVersion)!.data!;
  const resultMessage = revision.content!.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { id?: string; content?: string })
    .find(message => message.content?.includes('Restore fixture verification completed successfully.'))!;
  await callTool('threadpack_project_submit_update', {
    idempotencyKey: 'codex-backup-result', sessionId: session.id, sessionVersion: session.currentVersion,
    messageId: resultMessage.id, evidenceQuote: 'Restore fixture verification completed successfully.', category: 'task',
    taskId, claimId: lease.claimId, taskState: 'done', topic: 'Backup recovery',
    statement: 'The backup restore completed successfully.',
  }, false);
  const released = await callTool('threadpack_project_claim_task', {
    idempotencyKey: 'codex-release-backup', action: 'release', claimId: lease.claimId,
  }, false);
  expect(released.status).toBe('recorded');
  await page.evaluate(async text => await (window as unknown as { setInboxFile: (value: string) => Promise<void> }).setInboxFile(text), await readFile(inboxPath, 'utf8'));
  const candidate = library.locator('.project-update-item').filter({ hasText: 'The backup restore completed successfully.' });
  await expect(candidate).toContainText('The backup restore completed successfully.', { timeout: 30_000 });
  await candidate.getByRole('button', { name: 'Accept as confirmed fact', exact: true }).click();
  await expect(library.locator('.memory-conflict-banner')).toBeVisible();
  await expect(library.locator('.memory-fact').filter({ hasText: 'Verify project backup restoration.' })).toContainText('Needs review');
  await expect(library.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  const shared = await page.evaluate(async () => await (window as unknown as { readProjectFile: () => Promise<string> }).readProjectFile());
  const sharedRecords = shared.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { action?: string; taskId?: string; claimId?: string; status?: string; statement?: string } });
  expect(sharedRecords.some(record => record.type === 'claim' && record.data?.action === 'claimed' && record.data.taskId === taskId)).toBe(true);
  expect(sharedRecords.some(record => record.type === 'claim' && record.data?.action === 'released' && record.data.claimId === lease.claimId)).toBe(true);
  expect(sharedRecords.some(record => record.type === 'update' && record.data?.status === 'accepted' && record.data.statement === 'The backup restore completed successfully.')).toBe(true);
  await expect(coordination).toContainText('Claim released');
  const backupDownload = page.waitForEvent('download');
  await library.getByRole('button', { name: 'Download backup', exact: true }).click();
  const backupPath = await (await backupDownload).path();
  const backupRecords = (await readFile(backupPath!, 'utf8')).split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line) as { type: string; data?: { action?: string; claimId?: string } });
  expect(backupRecords.filter(record => record.type === 'claim').map(record => record.data?.action)).toEqual(['claimed', 'released']);
  const restoreChooser = page.waitForEvent('filechooser');
  await library.locator('.project-library-heading').getByRole('button', { name: 'Restore backup', exact: true }).click();
  await (await restoreChooser).setFiles(backupPath!);
  await expect(library.locator('.project-list-item')).toHaveCount(2);
  await library.locator('.project-list-item').last().click();
  await expect(library.getByLabel('AI task coordination')).toContainText('Claim released');
});
