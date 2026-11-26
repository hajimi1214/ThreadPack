import { test, expect } from '@playwright/test';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface BackupRecord {
  type: string;
  data?: {
    id?: string;
    status?: string;
    statement?: string;
    acceptedFactId?: string;
    statusHistory?: { status: string }[];
    auditHistory?: { action: string }[];
    evidence?: { proposalId?: string }[];
  };
}

test.use({ serviceWorkers: 'block' });

async function importConversation(page: import('@playwright/test').Page) {
  const source = JSON.stringify({ id: 'shared-session', title: 'Shared project evidence', messages: [
    { id: 'shared-message', role: 'user', content: 'The shared project state stays local.' },
  ] });
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'shared-session.json', mimeType: 'application/json', buffer: Buffer.from(source),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
}

test('project changes update one authorized shared file and survive a reload', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
      showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
      readSharedAuditFile?: () => Promise<string>;
      setInboxAuditFile?: (text: string) => Promise<void>;
    };
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    const handlePrototype = typeof FileSystemFileHandle === 'undefined' ? undefined : FileSystemFileHandle.prototype as unknown as Record<string, unknown>;
    if (typeof testWindow.showSaveFilePicker !== 'function' || typeof storage.getDirectory !== 'function'
      || typeof handlePrototype?.getFile !== 'function' || typeof handlePrototype.createWritable !== 'function'
      || typeof handlePrototype.queryPermission !== 'function' || typeof handlePrototype.requestPermission !== 'function') return;
    testWindow.showSaveFilePicker = async () => {
      const root = await storage.getDirectory();
      return await root.getFileHandle('threadpack-live-project.jsonl', { create: true });
    };
    testWindow.showOpenFilePicker = async () => {
      const root = await storage.getDirectory();
      return [await root.getFileHandle('threadpack-project-updates.jsonl', { create: true })];
    };
    testWindow.setInboxAuditFile = async text => {
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle('threadpack-project-updates.jsonl', { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    };
    testWindow.readSharedAuditFile = async () => {
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle('threadpack-live-project.jsonl');
      return await (await handle.getFile()).text();
    };
  });

  await page.goto('/');
  const fileSharingSupported = await page.evaluate(() => {
    const handlePrototype = typeof FileSystemFileHandle === 'undefined' ? undefined : FileSystemFileHandle.prototype as unknown as Record<string, unknown>;
    return window.isSecureContext && typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
      && typeof (navigator.storage as StorageManager & { getDirectory?: unknown }).getDirectory === 'function'
      && typeof handlePrototype?.getFile === 'function' && typeof handlePrototype.createWritable === 'function'
      && typeof handlePrototype.queryPermission === 'function' && typeof handlePrototype.requestPermission === 'function';
  });
  if (!fileSharingSupported) {
    await importConversation(page);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Local project library', exact: true });
    await library.getByLabel('Project name', { exact: true }).fill('Local fallback project');
    await library.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(library.getByLabel('Connect live local state')).toContainText('Live sharing needs a secure Chromium-based browser');
    await expect(library.getByRole('button', { name: 'Connect live local state', exact: true })).toBeDisabled();
    return;
  }
  await importConversation(page);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Live shared project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Shared project evidence');
  await dialog.locator('.project-create-row').getByLabel('Project name', { exact: true }).fill('Isolated project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Isolated project/ })).toBeVisible();
  await dialog.getByRole('button', { name: /Live shared project/ }).click();

  await dialog.getByRole('button', { name: 'Connect live local state', exact: true }).click();
  await expect(dialog.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  let sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('Shared project evidence');
  expect(sharedText).not.toContain('Isolated project');

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const updatedSource = JSON.stringify({ id: 'shared-session', title: 'Shared project evidence', messages: [
    { id: 'shared-message', role: 'user', content: 'UPDATED_SHARED_SESSION_MARKER' },
  ] });
  await page.getByLabel('Import file', { exact: true }).setInputFiles({
    name: 'shared-session-updated.json', mimeType: 'application/json', buffer: Buffer.from(updatedSource),
  });
  await expect(page.locator('.messages-list')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await dialog.getByRole('button', { name: /Live shared project/ }).click();
  await dialog.getByRole('button', { name: /Save current conversation/ }).click();
  await expect(dialog.locator('.project-session-item')).toContainText('Version 2');
  await expect(dialog.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('UPDATED_SHARED_SESSION_MARKER');

  await dialog.getByLabel('Current status', { exact: true }).fill('Automatically shared latest project status.');
  await dialog.getByRole('button', { name: 'Save project details', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Project details saved.');
  await expect(dialog.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('Automatically shared latest project status.');

  await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
  const memoryForm = dialog.locator('.memory-form');
  await memoryForm.locator('select').nth(0).selectOption('constraint');
  await memoryForm.locator('input').nth(0).fill('Shared state');
  await memoryForm.locator('textarea').nth(0).fill('The latest confirmed facts are shared automatically.');
  await memoryForm.locator('select').nth(2).selectOption({ label: 'Shared project evidence' });
  await memoryForm.getByRole('button', { name: 'Confirm and save', exact: true }).click();
  await expect(dialog.locator('.memory-fact')).toContainText('Confirmed by user');
  await expect(dialog.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('The latest confirmed facts are shared automatically.');
  const sharedMemory = () => sharedText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as {
    type: string; data?: { status?: string; statusHistory?: { status: string }[] };
  }).find(record => record.type === 'memory')?.data;
  expect(sharedMemory()?.status).toBe('confirmed');
  const readThroughMcp = async (contents: string) => {
    const backupPath = testInfo.outputPath('shared-live.jsonl');
    await writeFile(backupPath, contents, 'utf8');
    const script = `import { runMcpServer } from ${JSON.stringify(new URL('../../cli/mcp-server.ts', import.meta.url).href)}; await runMcpServer(process.argv.slice(1), 'test');`;
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'threadpack_project_context', arguments: { query: 'Shared state', budget: 4000 },
    } }) + '\n';
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script,
      '--', '--backup', backupPath], { cwd: resolve('.'), encoding: 'utf8', input: request });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim()) as { result?: { content?: { text: string }[]; structuredContent?: { sourceVersion: string } } };
  };
  const confirmedContext = await readThroughMcp(sharedText);
  expect(confirmedContext.result?.content?.[0]?.text).toContain('The latest confirmed facts are shared automatically.');

  const fact = dialog.locator('.memory-fact').filter({ hasText: 'The latest confirmed facts are shared automatically.' });
  await fact.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(fact).toContainText('Rejected');
  await expect.poll(async () => {
    try {
      sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
    } catch { return undefined; }
    return sharedMemory()?.status;
  }, { timeout: 30_000 }).toBe('rejected');
  expect(sharedMemory()?.status).toBe('rejected');
  expect(sharedMemory()?.statusHistory?.map(item => item.status)).toEqual(['confirmed', 'rejected']);
  const rejectedContext = await readThroughMcp(sharedText);
  expect(rejectedContext.result?.structuredContent?.sourceVersion).not.toBe(confirmedContext.result?.structuredContent?.sourceVersion);
  expect(rejectedContext.result?.content?.[0]?.text).not.toContain('The latest confirmed facts are shared automatically.');

  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  let restored = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(restored.getByLabel('Connect live local state')).toContainText('threadpack-live-project.jsonl');
  await expect(restored.getByLabel('Connect live local state')).toContainText('Shared file is current');
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('Automatically shared latest project status.');

  await restored.getByRole('button', { name: 'Connect inbox', exact: true }).click();
  await expect(restored.getByLabel('AI update inbox')).toContainText('threadpack-project-updates.jsonl');
  const inboxBackupPath = testInfo.outputPath('shared-live.jsonl');
  await writeFile(inboxBackupPath, sharedText, 'utf8');
  const inboxPath = testInfo.outputPath('threadpack-project-updates.jsonl');
  await unlink(inboxPath).catch(() => {});
  const inboxScript = `import { runMcpServer } from ${JSON.stringify(new URL('../../cli/mcp-server.ts', import.meta.url).href)}; await runMcpServer(process.argv.slice(1), 'test');`;
  async function submitCandidate(statement: string, topic: string) {
    sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
    await writeFile(inboxBackupPath, sharedText, 'utf8');
    const backupRecords = sharedText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as {
      type: string; data?: { id?: string; currentVersion?: number; sessionId?: string; version?: number; content?: string };
    });
    const session = backupRecords.find(record => record.type === 'session')!.data!;
    const revision = backupRecords.find(record => record.type === 'revision' && record.data?.sessionId === session.id && record.data?.version === session.currentVersion)!.data!;
    const citedMessage = revision.content!.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { id?: string; content?: string })
      .find(message => message.content?.includes('UPDATED_SHARED_SESSION_MARKER'))!;
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'threadpack_project_submit_update', arguments: { client: 'browser-test-client', idempotencyKey: `browser:${topic}:${statement}`, sessionId: session.id, sessionVersion: session.currentVersion, messageId: citedMessage.id, evidenceQuote: 'UPDATED_SHARED_SESSION_MARKER', category: 'decision', topic, statement, evidenceReference: 'browser test' },
    } }) + '\n';
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', inboxScript, '--', '--backup', inboxBackupPath, '--inbox', inboxPath], { cwd: resolve('.'), encoding: 'utf8', input: request });
    expect(result.status, result.stderr).toBe(0);
    const rpcResponse = JSON.parse(result.stdout.trim()) as { error?: { message: string } };
    const rpcError = rpcResponse.error as { message: string } | undefined;
    if (rpcError) throw new Error(`MCP diagnostics=${result.stderr}; response=${rpcError.message}`);
    expect(rpcError).toBeUndefined();
    const inboxContent = await readFile(inboxPath, 'utf8');
    expect(inboxContent).toContain(statement);
    await page.evaluate(async text => await (window as unknown as { setInboxAuditFile: (value: string) => Promise<void> }).setInboxAuditFile(text), inboxContent);
  }
  await submitCandidate('A draft release rule from the client.', 'Release policy');
  const draftProposal = restored.locator('.project-update-item').filter({ hasText: 'A draft release rule from the client.' });
  await expect(draftProposal).toContainText('A draft release rule from the client.', { timeout: 30_000 });
  await draftProposal.getByRole('button', { name: 'Edit candidate', exact: true }).click();
  await draftProposal.locator('.project-update-edit input').nth(0).fill('Release policy');
  await draftProposal.locator('.project-update-edit textarea').nth(0).fill('Releases require explicit user approval.');
  await restored.locator('.project-update-edit').getByRole('button', { name: 'Save edit', exact: true }).click();
  const acceptedStatement = 'Releases require explicit user approval.';
  const acceptedProposalRow = restored.locator('.project-update-item').filter({ hasText: acceptedStatement });
  await expect(acceptedProposalRow).toContainText(acceptedStatement);
  await acceptedProposalRow.getByRole('button', { name: 'Accept as confirmed fact', exact: true }).click();
  await expect(restored.getByRole('button', { name: 'Accept as confirmed fact', exact: true })).toHaveCount(0);
  await expect(restored.locator('.memory-fact').filter({ hasText: acceptedStatement })).toContainText('Confirmed by user');
  await expect(restored.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });

  const acceptedBackupDownload = page.waitForEvent('download');
  await restored.getByRole('button', { name: 'Download backup', exact: true }).click();
  const acceptedBackupPath = await (await acceptedBackupDownload).path();
  const acceptedBackupLines = (await readFile(acceptedBackupPath!, 'utf8')).split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line) as BackupRecord);
  const acceptedUpdate = acceptedBackupLines.find(record => record.type === 'update' && record.data?.status === 'accepted')?.data;
  const acceptedFact = acceptedBackupLines.find(record => record.type === 'memory' && record.data?.evidence?.some(evidence => evidence.proposalId === acceptedUpdate?.id))?.data;
  expect(acceptedUpdate?.statusHistory?.map(change => change.status)).toEqual(['pending', 'reviewing', 'accepted']);
  expect(acceptedUpdate?.auditHistory?.map(change => change.action)).toEqual(['submitted', 'edited', 'review-started', 'accepted']);
  expect(acceptedFact?.evidence?.some(evidence => evidence.proposalId === acceptedUpdate?.id)).toBe(true);

  await page.evaluate(async statement => {
    const request = indexedDB.open('threadpack-project-library');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['projects', 'updates'], 'readwrite');
    const projectRequest = transaction.objectStore('projects').getAll();
    const updateRequest = transaction.objectStore('updates').index('projectId').getAll();
    const [projects, updates] = await Promise.all([
      new Promise<Record<string, unknown>[]>((resolve, reject) => { projectRequest.onsuccess = () => resolve(projectRequest.result); projectRequest.onerror = () => reject(projectRequest.error); }),
      new Promise<Record<string, unknown>[]>((resolve, reject) => { updateRequest.onsuccess = () => resolve(updateRequest.result); updateRequest.onerror = () => reject(updateRequest.error); }),
    ]);
    const project = projects.find(item => item.name === 'Live shared project');
    const update = updates.find(item => item.statement === statement && item.projectId === project?.id);
    if (!update) throw new Error('The accepted candidate was not saved.');
    update.status = 'reviewing';
    update.reviewingSince = Date.now() - 10 * 60_000;
    delete update.acceptedFactId;
    update.statusHistory = (update.statusHistory as { status: string }[]).filter(change => change.status !== 'accepted');
    update.auditHistory = (update.auditHistory as { action: string }[]).filter(change => change.action !== 'accepted');
    transaction.objectStore('updates').put(update);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
  }, acceptedStatement);
  const interruptedBackupDownload = page.waitForEvent('download');
  await restored.getByRole('button', { name: 'Download backup', exact: true }).click();
  const interruptedBackupPath = await (await interruptedBackupDownload).path();
  const interruptedBackup = (await readFile(interruptedBackupPath!, 'utf8')).split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line) as BackupRecord);
  const recoveredUpdate = interruptedBackup.find(record => record.type === 'update' && record.data?.statement === acceptedStatement)?.data;
  expect(recoveredUpdate?.status).toBe('accepted');
  expect(recoveredUpdate?.acceptedFactId).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  restored = page.getByRole('dialog', { name: 'Local project library', exact: true });
  await expect(restored.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  const sharedUpdate = sharedText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as BackupRecord)
    .find(record => record.type === 'update' && record.data?.statement === acceptedStatement)?.data;
  expect(sharedUpdate?.status).toBe('accepted');
  expect(sharedUpdate?.acceptedFactId).toBeTruthy();
  await expect(restored.getByRole('button', { name: 'Accept as confirmed fact', exact: true })).toHaveCount(0);
  await expect(restored.locator('.memory-fact').filter({ hasText: acceptedStatement })).toHaveCount(1);
  const recoveredStatus = await page.evaluate(async statement => {
    const request = indexedDB.open('threadpack-project-library');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('updates', 'readonly');
    const updateRequest = transaction.objectStore('updates').index('projectId').getAll();
    const updates = await new Promise<Record<string, unknown>[]>((resolve, reject) => { updateRequest.onsuccess = () => resolve(updateRequest.result); updateRequest.onerror = () => reject(updateRequest.error); });
    db.close();
    const update = updates.find(item => item.statement === statement);
    return { status: update?.status, reviewingSince: update?.reviewingSince, auditHistory: update?.auditHistory };
  }, acceptedStatement);
  expect(recoveredStatus.status, JSON.stringify(recoveredStatus)).toBe('accepted');

  await submitCandidate('Releases may be published automatically.', 'Release policy');
  await restored.getByRole('button', { name: 'Check inbox', exact: true }).click();
  const conflictingStatement = 'Releases may be published automatically.';
  const secondProposal = restored.locator('.project-update-item').filter({ hasText: conflictingStatement });
  await expect(secondProposal).toContainText(conflictingStatement, { timeout: 30_000 });
  await secondProposal.getByRole('button', { name: 'Accept as confirmed fact', exact: true }).click();
  await expect(restored.locator('.memory-conflict-banner')).toBeVisible();
  await expect(restored.locator('.memory-fact').filter({ hasText: acceptedStatement })).toContainText('Needs review');
  await expect(restored.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  const acceptedHistory = restored.getByLabel('Update audit history').locator('.project-update-item').filter({ hasText: acceptedStatement });
  await acceptedHistory.getByRole('button', { name: 'Revoke accepted update', exact: true }).click();
  await expect(restored.locator('.memory-fact').filter({ hasText: acceptedStatement })).toContainText('Rejected');
  await expect(restored.locator('.memory-fact').filter({ hasText: conflictingStatement })).toContainText('Confirmed by user');
  const conflictingFact = restored.locator('.memory-fact').filter({ hasText: conflictingStatement });
  await conflictingFact.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(conflictingFact).toContainText('Rejected');
  await expect(restored.getByLabel('Connect live local state')).toContainText('Shared file is current', { timeout: 30_000 });
  const finalBackupDownload = page.waitForEvent('download');
  await restored.getByRole('button', { name: 'Download backup', exact: true }).click();
  const finalBackupPath = await (await finalBackupDownload).path();
  await writeFile(testInfo.outputPath('final-update-backup.jsonl'), await readFile(finalBackupPath!));
  const backupLines = (await readFile(finalBackupPath!, 'utf8')).split(/\r?\n/).filter(Boolean);
  const backupHeader = JSON.parse(backupLines[0]!) as { project: { name: string } };
  backupHeader.project.name = 'Restored audit copy';
  backupLines[0] = JSON.stringify(backupHeader);
  const renamedBackupPath = testInfo.outputPath('restored-audit-copy.jsonl');
  await writeFile(renamedBackupPath, backupLines.join('\n') + '\n', 'utf8');
  const finalUpdates = (await readFile(finalBackupPath!, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { statement?: string; status?: string; statusHistory?: { status: string }[]; auditHistory?: { action: string }[] } })
    .filter(record => record.type === 'update').map(record => record.data!);
  expect(finalUpdates).toHaveLength(2);
  expect(finalUpdates.find(update => update.statement === acceptedStatement)?.status).toBe('revoked');
  expect(finalUpdates.find(update => update.statement === acceptedStatement)?.statusHistory?.map(change => change.status)).toEqual(['pending', 'reviewing', 'accepted', 'reviewing', 'revoked']);
  expect(finalUpdates.find(update => update.statement === acceptedStatement)?.auditHistory?.map(change => change.action)).toEqual(['submitted', 'edited', 'review-started', 'accepted', 'review-started', 'revoked']);
  expect(finalUpdates.find(update => update.statement === conflictingStatement)?.status).toBe('revoked');
  expect(finalUpdates.find(update => update.statement === conflictingStatement)?.statusHistory?.map(change => change.status)).toEqual(['pending', 'reviewing', 'accepted', 'revoked']);

  await restored.getByRole('button', { name: 'Disconnect shared file', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Live updates stopped. The file remains available to MCP clients');
  await expect(restored.getByLabel('Connect live local state')).toContainText('Choose a new empty file in a location you control');
  await restored.getByRole('button', { name: 'Connect live local state', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a new, empty file');
  sharedText = await page.evaluate(async () => await (window as unknown as { readSharedAuditFile: () => Promise<string> }).readSharedAuditFile());
  expect(sharedText).toContain('Automatically shared latest project status.');

  const restoreChooser = page.waitForEvent('filechooser');
  await restored.locator('.project-library-heading').getByRole('button', { name: 'Restore backup', exact: true }).click();
  await (await restoreChooser).setFiles(renamedBackupPath);
  await expect(restored.locator('.project-list-item')).toHaveCount(3);
  const copiedProject = restored.getByRole('button', { name: /Restored audit copy/ });
  await copiedProject.click();
  await expect(restored.getByLabel('Update audit history')).toContainText('revoked');
  await expect(restored.getByLabel('Update audit history')).toContainText('Accept as confirmed fact');
  await expect(restored.locator('.memory-fact').filter({ hasText: acceptedStatement })).toContainText('Rejected');
  await expect(restored.locator('.memory-fact').filter({ hasText: conflictingStatement })).toContainText('Rejected');
});
