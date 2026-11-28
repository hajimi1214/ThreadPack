import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export const MAX_MCP_CONNECTION_LOG_BYTES = 4 * 1024 * 1024;

export interface McpConnectionLogStatus {
  state: 'disabled' | 'ready' | 'new';
  bytes: number;
}

export interface McpConnectionLogger {
  record(event: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

const LOG_FORMAT = 'threadpack_mcp_connection_log';
const LOG_EVENTS = new Set(['server_started', 'client_initialize_received', 'client_initialized', 'rpc_request', 'tool_call', 'server_stopped']);

function normalizePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return normalizePath(await realpath(absolute));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    const parent = await realpath(dirname(absolute));
    return normalizePath(resolve(parent, basename(absolute)));
  }
}

async function inspectTarget(path: string, protectedPaths: string[]): Promise<{
  absolutePath: string;
  existingBytes: number;
  existingInfo?: Awaited<ReturnType<typeof lstat>>;
}> {
  const absolutePath = resolve(path);
  if (!path.trim() || !basename(absolutePath)) {
    throw new Error('Choose a separate MCP connection log file in an existing directory.');
  }

  const existingInfo = await lstat(absolutePath).catch(cause => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  });
  if (existingInfo && (!existingInfo.isFile() || existingInfo.isSymbolicLink())) {
    throw new Error('The MCP connection log must be a regular file, not a link or directory.');
  }
  if (existingInfo && process.platform !== 'win32' && (existingInfo.mode & 0o077) !== 0) {
    throw new Error('The MCP connection log has overly broad permissions. Restrict it to the current user before use.');
  }
  if (existingInfo && existingInfo.size > MAX_MCP_CONNECTION_LOG_BYTES) {
    throw new Error('The MCP connection log exceeds 4 MiB. Rotate it before starting the MCP server.');
  }
  if (existingInfo && existingInfo.size > 0) {
    const existingFile = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const [openedInfo, currentInfo] = await Promise.all([existingFile.stat(), lstat(absolutePath)]);
      if (currentInfo.isSymbolicLink() || openedInfo.dev !== existingInfo.dev || openedInfo.ino !== existingInfo.ino
        || currentInfo.dev !== openedInfo.dev || currentInfo.ino !== openedInfo.ino) {
        throw new Error('The MCP connection log changed during inspection. Rotate it before use.');
      }
      const content = await existingFile.readFile();
      if (content.byteLength !== openedInfo.size || content[content.byteLength - 1] !== 0x0a) {
        throw new Error('The MCP connection log ends with an incomplete record or changed during inspection. Rotate it before use.');
      }
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
      catch { throw new Error('The MCP connection log is not valid UTF-8. Rotate it before use.'); }
      for (const line of text.slice(0, -1).split('\n')) {
        let record: unknown;
        try { record = JSON.parse(line) as unknown; }
        catch { throw new Error('The MCP connection log contains an invalid JSONL record. Rotate it before use.'); }
        if (!record || typeof record !== 'object' || Array.isArray(record)
          || (record as Record<string, unknown>).format !== LOG_FORMAT
          || (record as Record<string, unknown>).version !== 1
          || typeof (record as Record<string, unknown>).event !== 'string'
          || !LOG_EVENTS.has((record as Record<string, unknown>).event as string)
          || typeof (record as Record<string, unknown>).timestamp !== 'string') {
          throw new Error('The MCP connection log has an unsupported record. Rotate it before use.');
        }
      }
    } finally {
      await existingFile.close();
    }
  }

  const logPath = await canonicalPath(absolutePath);
  for (const protectedPath of protectedPaths) {
    if (logPath === await canonicalPath(protectedPath)) {
      throw new Error('The MCP connection log must be separate from the project backup and update inbox.');
    }
    if (existingInfo) {
      const protectedInfo = await lstat(protectedPath).catch(cause => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw cause;
      });
      if (protectedInfo && existingInfo.dev === protectedInfo.dev && existingInfo.ino === protectedInfo.ino) {
        throw new Error('The MCP connection log must be separate from the project backup and update inbox.');
      }
    }
  }
  return { absolutePath, existingBytes: existingInfo?.size ?? 0, ...(existingInfo ? { existingInfo } : {}) };
}

export async function inspectMcpConnectionLog(path: string | undefined, protectedPaths: string[]): Promise<McpConnectionLogStatus> {
  if (path === undefined) return { state: 'disabled', bytes: 0 };
  const target = await inspectTarget(path, protectedPaths);
  return { state: target.existingInfo ? 'ready' : 'new', bytes: target.existingBytes };
}

export async function openMcpConnectionLogger(
  path: string | undefined,
  protectedPaths: string[],
  onFailure: () => void,
): Promise<McpConnectionLogger | undefined> {
  if (path === undefined) return undefined;
  const target = await inspectTarget(path, protectedPaths);
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
  let file: FileHandle | undefined;
  try {
    file = await open(target.absolutePath, flags, 0o600);
    if (!target.existingInfo && process.platform !== 'win32') await file.chmod(0o600);
    const [openedInfo, currentInfo] = await Promise.all([file.stat(), lstat(target.absolutePath)]);
    if (!openedInfo.isFile() || !currentInfo.isFile() || currentInfo.isSymbolicLink()
      || openedInfo.dev !== currentInfo.dev || openedInfo.ino !== currentInfo.ino) {
      throw new Error('The MCP connection log changed while it was being opened.');
    }
    if (openedInfo.size > MAX_MCP_CONNECTION_LOG_BYTES) {
      throw new Error('The MCP connection log exceeds 4 MiB. Rotate it before starting the MCP server.');
    }
  } catch (cause) {
    await file?.close().catch(() => {});
    throw new Error('ThreadPack could not safely open the configured MCP connection log.', { cause });
  }
  const logFile = file;

  let enabled = true;
  const disable = async () => {
    if (!enabled) return;
    enabled = false;
    onFailure();
    await logFile.close().catch(() => {});
  };

  return {
    async record(event) {
      if (!enabled) return;
      const line = Buffer.from(`${JSON.stringify({ ...event, format: LOG_FORMAT, version: 1 })}\n`, 'utf8');
      try {
        const currentSize = (await logFile.stat()).size;
        if (currentSize + line.byteLength > MAX_MCP_CONNECTION_LOG_BYTES) {
          await disable();
          return;
        }
        let written = 0;
        while (written < line.byteLength) {
          const result = await logFile.write(line, written, line.byteLength - written, null);
          if (result.bytesWritten === 0) throw new Error('The MCP connection log write was incomplete.');
          written += result.bytesWritten;
        }
      } catch {
        await disable();
      }
    },
    async close() {
      if (!enabled) return;
      enabled = false;
      await logFile.close();
    },
  };
}
