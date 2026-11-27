import { sha256Fingerprint } from '../handoff-draft';

export const PROJECT_BACKUP_VERSION = 9 as const;
export const PROJECT_BACKUP_MANIFEST_VERSION = 1 as const;
export const PROJECT_BACKUP_CHAIN_SEED = 'threadpack-project-backup-record-chain-v1';

export type BackupRecordHasher = (value: string) => Promise<string>;

export interface BackupRecordLike {
  type?: unknown;
  data?: unknown;
  fingerprint?: unknown;
}

export interface BackupRecordCounts {
  session: number;
  revision: number;
  memory: number;
  update: number;
  claim: number;
  trust_state: number;
  trust_event: number;
  migration: number;
}

export interface ProjectBackupManifest {
  type: 'manifest';
  version: typeof PROJECT_BACKUP_MANIFEST_VERSION;
  recordCount: number;
  recordChainHash: string;
  recordCounts: BackupRecordCounts;
}

export interface ProjectBackupMigrationData {
  id: string;
  projectId: string;
  action: 'backup-import';
  sourceFormatVersion: number;
  targetFormatVersion: typeof PROJECT_BACKUP_VERSION;
  migrationVersion: 1;
  sourceProjectId?: string;
  sourceFingerprint: string;
  sourceIntegrity: 'record-validated' | 'manifest-verified';
  recordCounts: BackupRecordCounts;
  trustDisposition: 'untrusted-import';
  createdAt: number;
}

export interface ProjectBackupMigrationRecord extends ProjectBackupMigrationData {
  key: [string, string];
  projectId: string;
}

const COUNT_KEYS: (keyof BackupRecordCounts)[] = [
  'session', 'revision', 'memory', 'update', 'claim', 'trust_state', 'trust_event', 'migration',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isBackupRecordCounts(value: unknown): value is BackupRecordCounts {
  return isRecord(value) && Object.keys(value).length === COUNT_KEYS.length
    && COUNT_KEYS.every(key => Number.isSafeInteger(value[key])
      && (value[key] as number) >= 0 && (value[key] as number) <= 1_000_000);
}

export async function digestProjectBackupRecord(
  record: BackupRecordLike,
  hash: BackupRecordHasher = sha256Fingerprint,
): Promise<string> {
  if (typeof record.type !== 'string' || record.type === 'manifest') {
    throw new Error('The project backup manifest cannot be part of its own record chain.');
  }

  if (record.type === 'revision') {
    if (!isRecord(record.data)) throw new Error('The project backup revision metadata is invalid.');
    const data = record.data;
    const metadata = {
      sessionId: data.sessionId,
      version: data.version,
      fingerprint: data.fingerprint,
      title: data.title,
      platform: data.platform,
      ...(typeof data.sourceId === 'string' ? { sourceId: data.sourceId } : {}),
      format: data.format,
      messageCount: data.messageCount,
      sourceName: data.sourceName,
      createdAt: data.createdAt,
    };
    return hash(JSON.stringify({ type: record.type, data: metadata }));
  }

  if (typeof record.fingerprint === 'string') return hash(`${record.type}\0${record.fingerprint}`);
  return hash(JSON.stringify(record));
}

export async function extendProjectBackupRecordChain(
  chain: string,
  recordDigest: string,
  hash: BackupRecordHasher = sha256Fingerprint,
): Promise<string> {
  return hash(`${chain}\0${recordDigest}`);
}

export function emptyBackupRecordCounts(): BackupRecordCounts {
  return { session: 0, revision: 0, memory: 0, update: 0, claim: 0, trust_state: 0, trust_event: 0, migration: 0 };
}

export async function createProjectBackupMigration(
  projectId: string,
  sourceProjectId: string | undefined,
  sourceFormatVersion: number,
  sourceFingerprint: string,
  sourceIntegrity: ProjectBackupMigrationData['sourceIntegrity'],
  recordCounts: BackupRecordCounts,
  createdAt: number,
  hash: BackupRecordHasher = sha256Fingerprint,
): Promise<ProjectBackupMigrationData> {
  const id = await hash(JSON.stringify({ sourceFormatVersion, sourceFingerprint, targetFormatVersion: PROJECT_BACKUP_VERSION }));
  return {
    id,
    projectId,
    action: 'backup-import',
    sourceFormatVersion,
    targetFormatVersion: PROJECT_BACKUP_VERSION,
    migrationVersion: 1,
    ...(sourceProjectId ? { sourceProjectId } : {}),
    sourceFingerprint,
    sourceIntegrity,
    recordCounts: { ...recordCounts },
    trustDisposition: 'untrusted-import',
    createdAt,
  };
}

export async function validateProjectBackupMigration(
  value: unknown,
  expectedProjectId: string,
  hash: BackupRecordHasher = sha256Fingerprint,
): Promise<ProjectBackupMigrationData> {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id)
    || value.projectId !== expectedProjectId || value.action !== 'backup-import'
    || !Number.isSafeInteger(value.sourceFormatVersion) || (value.sourceFormatVersion as number) < 1
    || (value.sourceFormatVersion as number) > PROJECT_BACKUP_VERSION
    || value.targetFormatVersion !== PROJECT_BACKUP_VERSION || value.migrationVersion !== 1
    || value.sourceProjectId !== undefined && (typeof value.sourceProjectId !== 'string' || !value.sourceProjectId || value.sourceProjectId.length > 200)
    || typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    || value.sourceIntegrity !== 'record-validated' && value.sourceIntegrity !== 'manifest-verified'
    || (value.sourceFormatVersion as number) === PROJECT_BACKUP_VERSION && value.sourceIntegrity !== 'manifest-verified'
    || (value.sourceFormatVersion as number) < PROJECT_BACKUP_VERSION && value.sourceIntegrity !== 'record-validated'
    || value.trustDisposition !== 'untrusted-import' || !Number.isSafeInteger(value.createdAt)
    || !isBackupRecordCounts(value.recordCounts)) {
    throw new Error('The project backup contains an invalid migration record.');
  }
  const expected = await createProjectBackupMigration(expectedProjectId,
    typeof value.sourceProjectId === 'string' ? value.sourceProjectId : undefined,
    value.sourceFormatVersion as number, value.sourceFingerprint, value.sourceIntegrity,
    value.recordCounts as unknown as BackupRecordCounts, value.createdAt as number, hash);
  if (value.id !== expected.id) throw new Error('The project backup migration identifier does not match its source.');
  return expected;
}

export function incrementBackupRecordCount(counts: BackupRecordCounts, type: string): void {
  if (!(COUNT_KEYS as string[]).includes(type)) throw new Error('The project backup contains an unsupported counted record.');
  counts[type as keyof BackupRecordCounts]++;
}

export function backupRecordCountsMatch(expected: unknown, actual: BackupRecordCounts): boolean {
  if (!isRecord(expected) || Object.keys(expected).length !== COUNT_KEYS.length) return false;
  return COUNT_KEYS.every(key => Number.isSafeInteger(expected[key]) && expected[key] === actual[key]);
}

export function validateProjectBackupManifest(value: unknown): ProjectBackupManifest {
  if (!isRecord(value) || value.type !== 'manifest' || value.version !== PROJECT_BACKUP_MANIFEST_VERSION
    || !Number.isSafeInteger(value.recordCount) || (value.recordCount as number) < 1
    || typeof value.recordChainHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.recordChainHash)
    || !isBackupRecordCounts(value.recordCounts)) {
    throw new Error('The project backup manifest is invalid.');
  }
  return value as unknown as ProjectBackupManifest;
}
