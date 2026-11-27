import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { RecoveryBundle } from '../../../src/projects/trust-crypto';
import { readFile } from 'node:fs/promises';

export async function setupLocalProjectTrust(page: Page, dialog: Locator): Promise<RecoveryBundle> {
  const panel = dialog.getByLabel('Verifiable project confirmations');
  const readyLabel = 'Signed confirmations are enabled on this device.';
  const isReady = await panel.getByText(readyLabel, { exact: true }).count() > 0;
  const passphrases = panel.locator('input[type="password"]');
  const recoveryPassphrase = 'synthetic-stage-one-recovery-passphrase';
  if (!isReady) {
    await passphrases.nth(0).fill(recoveryPassphrase);
    await passphrases.nth(1).fill(recoveryPassphrase);
    await panel.getByRole('button', { name: 'Create local trust identity', exact: true }).click();
  }
  await expect(panel.getByRole('button', { name: 'Download encrypted recovery kit', exact: true })).toBeVisible();
  const downloadReady = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download encrypted recovery kit', exact: true }).click();
  const download = await downloadReady;
  const recoveryPath = await download.path();
  expect(recoveryPath).toBeTruthy();
  const recoveryBundle = JSON.parse(await readFile(recoveryPath!, 'utf8')) as RecoveryBundle;
  expect(recoveryBundle.schema).toBe('threadpack.recovery.v1');
  if (!isReady) {
    await panel.getByRole('button', { name: 'I saved the recovery kit', exact: true }).click();
    await expect(panel).toContainText(readyLabel);
  }
  return recoveryBundle;
}
