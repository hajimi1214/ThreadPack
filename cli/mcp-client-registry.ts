import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const REGISTRY_TYPE = 'threadpack_mcp_client_registry';
const REGISTRY_VERSION = 1;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_CLIENTS = 256;
const CLIENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface McpClientPermissions {
  readProject: true;
  candidateUpdates: boolean;
  taskCoordination: boolean;
}

export interface RegisteredMcpClient {
  id: string;
  projectId: string;
  tokenHash: string;
  permissions: McpClientPermissions;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

interface McpClientRegistry {
  type: typeof REGISTRY_TYPE;
  version: typeof REGISTRY_VERSION;
  clients: RegisteredMcpClient[];
}

export interface AuthenticatedMcpClient {
  id: string;
  projectId: string;
  permissions: McpClientPermissions;
  credentialVersion: 1;
}

export interface IssueMcpClientOptions {
  registryPath: string;
  id: string;
  projectId: string;
  allowCandidateUpdates: boolean;
  allowTaskCoordination: boolean;
}

const emptyRegistry = (): McpClientRegistry => ({ type: REGISTRY_TYPE, version: REGISTRY_VERSION, clients: [] });
const tokenDigest = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function registryError(): Error {
  return new Error('The MCP client registry is invalid or cannot be accessed securely.');
}

function validateRegistry(value: unknown): McpClientRegistry {
  if (!isRecord(value) || Object.keys(value).some(key => !['type', 'version', 'clients'].includes(key))
    || value.type !== REGISTRY_TYPE || value.version !== REGISTRY_VERSION
    || !Array.isArray(value.clients) || value.clients.length > MAX_CLIENTS) throw registryError();

  const ids = new Set<string>();
  const clients = value.clients.map((candidate): RegisteredMcpClient => {
    if (!isRecord(candidate) || Object.keys(candidate).some(key => ![
      'id', 'projectId', 'tokenHash', 'permissions', 'createdAt', 'updatedAt', 'revokedAt',
    ].includes(key))) throw registryError();
    const permissions = candidate.permissions;
    const createdAt = candidate.createdAt;
    const updatedAt = candidate.updatedAt;
    const revokedAt = candidate.revokedAt;
    if (typeof candidate.id !== 'string' || !CLIENT_ID.test(candidate.id)
      || typeof candidate.projectId !== 'string' || !PROJECT_ID.test(candidate.projectId)
      || typeof candidate.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.tokenHash)
      || !isRecord(permissions) || Object.keys(permissions).some(key => !['readProject', 'candidateUpdates', 'taskCoordination'].includes(key))
      || permissions.readProject !== true || typeof permissions.candidateUpdates !== 'boolean'
      || typeof permissions.taskCoordination !== 'boolean'
      || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)
      || typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt)
      || updatedAt < createdAt
      || revokedAt !== null && (typeof revokedAt !== 'number' || !Number.isSafeInteger(revokedAt) || revokedAt < createdAt)
      || ids.has(candidate.id)) throw registryError();
    ids.add(candidate.id);
    return {
      id: candidate.id,
      projectId: candidate.projectId,
      tokenHash: candidate.tokenHash,
      permissions: {
        readProject: true,
        candidateUpdates: permissions.candidateUpdates,
        taskCoordination: permissions.taskCoordination,
      },
      createdAt,
      updatedAt,
      revokedAt: revokedAt as number | null,
    };
  });
  return { type: REGISTRY_TYPE, version: REGISTRY_VERSION, clients };
}

async function inspectRegistryFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_REGISTRY_BYTES) throw registryError();
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw registryError();
}

async function readRegistryBytes(path: string): Promise<Buffer> {
  let file: FileHandle | undefined;
  try {
    const beforeOpen = await lstat(path);
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.size > MAX_REGISTRY_BYTES
      || process.platform !== 'win32' && (beforeOpen.mode & 0o077) !== 0) throw registryError();

    const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
    file = await open(path, fsConstants.O_RDONLY | noFollow);
    const opened = await file.stat();
    const afterOpen = await lstat(path);
    if (!opened.isFile() || afterOpen.isSymbolicLink()
      || opened.dev !== beforeOpen.dev || opened.ino !== beforeOpen.ino
      || afterOpen.dev !== opened.dev || afterOpen.ino !== opened.ino
      || opened.size > MAX_REGISTRY_BYTES
      || process.platform !== 'win32' && (opened.mode & 0o077) !== 0) throw registryError();

    const bytes = await file.readFile();
    if (bytes.byteLength > MAX_REGISTRY_BYTES) throw registryError();
    return bytes;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw cause;
    if (cause instanceof Error && cause.message === 'The MCP client registry is invalid or cannot be accessed securely.') throw cause;
    throw registryError();
  } finally {
    await file?.close().catch(() => {});
  }
}

async function readRegistry(path: string, allowMissing: boolean): Promise<McpClientRegistry> {
  try {
    const bytes = await readRegistryBytes(path);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateRegistry(JSON.parse(text) as unknown);
  } catch (cause) {
    if (allowMissing && (cause as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry();
    if (cause instanceof Error && cause.message === 'The MCP client registry is invalid or cannot be accessed securely.') throw cause;
    throw registryError();
  }
}

async function saveRegistry(path: string, registry: McpClientRegistry): Promise<void> {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const parent = await lstat(dirname(target)).catch(() => undefined);
  if (!parent?.isDirectory()) throw new Error('The MCP client registry directory must already exist.');

  try {
    await inspectRegistryFile(target);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }

  let file: FileHandle | undefined;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, target);
    if (process.platform !== 'win32') {
      const written = await lstat(target);
      if ((written.mode & 0o077) !== 0) throw registryError();
    }
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function withRegistryLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${resolve(path)}.lock`;
  let lock: FileHandle | undefined;
  try {
    lock = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
    await lock.sync();
  } catch (cause) {
    await lock?.close().catch(() => {});
    if (lock) await unlink(lockPath).catch(() => {});
    throw new Error((cause as NodeJS.ErrnoException).code === 'EEXIST'
      ? 'Another MCP client registry operation is in progress. If it stopped unexpectedly, inspect and remove the stale .lock file.'
      : 'The MCP client registry could not be locked safely.');
  }
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

function validateIdentity(id: string, projectId: string): void {
  if (!CLIENT_ID.test(id) || !PROJECT_ID.test(projectId)) {
    throw new Error('Use a lowercase client ID and a valid exact project ID.');
  }
}

function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function issueMcpClient(options: IssueMcpClientOptions): Promise<{ client: Omit<RegisteredMcpClient, 'tokenHash'>; token: string }> {
  validateIdentity(options.id, options.projectId);
  return withRegistryLock(options.registryPath, async () => {
    const registry = await readRegistry(options.registryPath, true);
    if (registry.clients.length >= MAX_CLIENTS) throw new Error('The MCP client registry has reached its 256-client limit.');
    if (registry.clients.some(client => client.id === options.id)) throw new Error('That MCP client ID already exists. Use rotate or revoke.');
    const token = issueToken();
    const now = Date.now();
    const client: RegisteredMcpClient = {
      id: options.id,
      projectId: options.projectId,
      tokenHash: tokenDigest(token),
      permissions: {
        readProject: true,
        candidateUpdates: options.allowCandidateUpdates,
        taskCoordination: options.allowTaskCoordination,
      },
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    };
    registry.clients.push(client);
    await saveRegistry(options.registryPath, registry);
    const { tokenHash: _tokenHash, ...publicClient } = client;
    return { client: publicClient, token };
  });
}

export async function rotateMcpClientToken(registryPath: string, id: string): Promise<{ client: Omit<RegisteredMcpClient, 'tokenHash'>; token: string }> {
  if (!CLIENT_ID.test(id)) throw new Error('Use a valid client ID.');
  return withRegistryLock(registryPath, async () => {
    const registry = await readRegistry(registryPath, false);
    const client = registry.clients.find(candidate => candidate.id === id);
    if (!client || client.revokedAt !== null) throw new Error('The MCP client is not active.');
    const token = issueToken();
    client.tokenHash = tokenDigest(token);
    client.updatedAt = Date.now();
    await saveRegistry(registryPath, registry);
    const { tokenHash: _tokenHash, ...publicClient } = client;
    return { client: publicClient, token };
  });
}

export async function revokeMcpClient(registryPath: string, id: string): Promise<RegisteredMcpClient> {
  if (!CLIENT_ID.test(id)) throw new Error('Use a valid client ID.');
  return withRegistryLock(registryPath, async () => {
    const registry = await readRegistry(registryPath, false);
    const client = registry.clients.find(candidate => candidate.id === id);
    if (!client) throw new Error('The MCP client does not exist.');
    if (client.revokedAt === null) {
      client.revokedAt = Date.now();
      client.updatedAt = client.revokedAt;
      await saveRegistry(registryPath, registry);
    }
    return client;
  });
}

export async function listMcpClients(registryPath: string): Promise<Omit<RegisteredMcpClient, 'tokenHash'>[]> {
  const registry = await readRegistry(registryPath, true);
  return registry.clients.map(({ tokenHash: _tokenHash, ...client }) => client);
}

export async function authenticateMcpClient(options: {
  registryPath: string;
  id: string;
  projectId: string;
  token: string;
  requireCandidateUpdates: boolean;
  requireTaskCoordination: boolean;
}): Promise<AuthenticatedMcpClient> {
  validateIdentity(options.id, options.projectId);
  const registry = await readRegistry(options.registryPath, false);
  const client = registry.clients.find(candidate => candidate.id === options.id);
  const tokenLooksValid = TOKEN.test(options.token) && options.token.length <= 128;
  const candidateDigest = Buffer.from(tokenDigest(tokenLooksValid ? options.token : ''), 'hex');
  const expectedDigest = Buffer.from(client?.tokenHash ?? '0'.repeat(64), 'hex');
  const tokenMatches = timingSafeEqual(candidateDigest, expectedDigest);
  if (!client || !tokenMatches || !tokenLooksValid || client.revokedAt !== null
    || client.projectId !== options.projectId
    || options.requireCandidateUpdates && !client.permissions.candidateUpdates
    || options.requireTaskCoordination && !client.permissions.taskCoordination) {
    throw new Error('The configured MCP client credential is invalid or lacks the requested project permission.');
  }
  return {
    id: client.id,
    projectId: client.projectId,
    permissions: { ...client.permissions },
    credentialVersion: 1,
  };
}

function cliError(): Error {
  return new Error('Use threadpack mcp-client issue|list|rotate|revoke --registry <file> [options].');
}

export async function runMcpClientCommand(arguments_: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: arguments_, allowPositionals: true, options: {
      registry: { type: 'string' }, id: { type: 'string' }, 'project-id': { type: 'string' },
      'allow-candidate-updates': { type: 'boolean' }, 'allow-task-coordination': { type: 'boolean' }, help: { type: 'boolean' },
    } });
  } catch { throw cliError(); }

  if (parsed.values.help) {
    process.stdout.write([
      'Manage local bearer credentials for MCP stdio clients.',
      '  threadpack mcp-client issue --registry <file> --id <id> --project-id <id> [--allow-candidate-updates] [--allow-task-coordination]',
      '  threadpack mcp-client list --registry <file>',
      '  threadpack mcp-client rotate --registry <file> --id <id>',
      '  threadpack mcp-client revoke --registry <file> --id <id>',
      'Tokens are printed once. The registry stores only token hashes. Use the token in the client process environment.',
    ].join('\n') + '\n');
    return;
  }

  const [action] = parsed.positionals;
  const registryPath = typeof parsed.values.registry === 'string' && parsed.values.registry.trim()
    ? resolve(parsed.values.registry) : '';
  if (!registryPath || parsed.positionals.length !== 1) throw cliError();

  if (action === 'issue' && typeof parsed.values.id === 'string' && typeof parsed.values['project-id'] === 'string') {
    const issued = await issueMcpClient({
      registryPath,
      id: parsed.values.id,
      projectId: parsed.values['project-id'],
      allowCandidateUpdates: parsed.values['allow-candidate-updates'] === true,
      allowTaskCoordination: parsed.values['allow-task-coordination'] === true,
    });
    process.stdout.write(`${JSON.stringify({ ...issued.client, token: issued.token, tokenDelivery: 'one-time-output' }, null, 2)}\n`);
    return;
  }
  if (action === 'list' && !parsed.values.id && !parsed.values['project-id']
    && !parsed.values['allow-candidate-updates'] && !parsed.values['allow-task-coordination']) {
    process.stdout.write(`${JSON.stringify(await listMcpClients(registryPath), null, 2)}\n`);
    return;
  }
  if (action === 'rotate' && typeof parsed.values.id === 'string'
    && !parsed.values['project-id'] && !parsed.values['allow-candidate-updates'] && !parsed.values['allow-task-coordination']) {
    const rotated = await rotateMcpClientToken(registryPath, parsed.values.id);
    process.stdout.write(`${JSON.stringify({ ...rotated.client, token: rotated.token, tokenDelivery: 'one-time-output' }, null, 2)}\n`);
    return;
  }
  if (action === 'revoke' && typeof parsed.values.id === 'string'
    && !parsed.values['project-id'] && !parsed.values['allow-candidate-updates'] && !parsed.values['allow-task-coordination']) {
    const revoked = await revokeMcpClient(registryPath, parsed.values.id);
    const { tokenHash: _tokenHash, ...publicClient } = revoked;
    process.stdout.write(`${JSON.stringify(publicClient, null, 2)}\n`);
    return;
  }
  throw cliError();
}
