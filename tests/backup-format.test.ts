import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  createProjectBackupMigration, emptyBackupRecordCounts, validateProjectBackupMigration,
} from '../src/projects/backup-format';

const hash = async (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

test('backup migration identities are deterministic and bind their source format and digest', async () => {
  const counts = { ...emptyBackupRecordCounts(), session: 2, revision: 3, memory: 1 };
  const first = await createProjectBackupMigration('local-project', 'source-project', 8, 'a'.repeat(64),
    'record-validated', counts, 1_700_000_000_000, hash);
  const retry = await createProjectBackupMigration('local-project', 'source-project', 8, 'a'.repeat(64),
    'record-validated', counts, 1_700_000_000_001, hash);
  assert.equal(first.id, retry.id);
  assert.deepEqual(await validateProjectBackupMigration(first, 'local-project', hash), first);

  const wrongSource = { ...first, sourceFingerprint: 'b'.repeat(64) };
  await assert.rejects(validateProjectBackupMigration(wrongSource, 'local-project', hash), /identifier does not match/i);
  await assert.rejects(validateProjectBackupMigration({ ...first, sourceIntegrity: 'manifest-verified' }, 'local-project', hash), /invalid migration record/i);
  await assert.rejects(validateProjectBackupMigration(first, 'another-project', hash), /invalid migration record/i);
});
