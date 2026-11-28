import { useMemo, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { TranslationKey } from '../i18n';

type ClientTarget = 'codex' | 'claude-code' | 'workbuddy' | 'generic';

interface Props {
  projectId: string;
  t: Record<TranslationKey, string>;
}

function jsonConfiguration(command: string, args: string[], tokenEnvironment?: string, token?: string): string {
  return JSON.stringify({ mcpServers: { threadpack: {
    command,
    args,
    ...(tokenEnvironment && token ? { env: { [tokenEnvironment]: token } } : {}),
  } } }, null, 2);
}

function tomlString(value: string): string {
  const escapes: Record<string, string> = {
    '\\': '\\\\', '"': '\\"', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r',
  };
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, character => escapes[character]
    ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${escaped}"`;
}

function codexConfiguration(command: string, args: string[], tokenEnvironment?: string, token?: string): string {
  const configuration = `[mcp_servers.threadpack]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]`;
  return tokenEnvironment && token
    ? `${configuration}\n\n[mcp_servers.threadpack.env]\n${tokenEnvironment} = ${tomlString(token)}`
    : configuration;
}

export default function McpSetupGuide({ projectId, t }: Props) {
  const [target, setTarget] = useState<ClientTarget>('codex');
  const [command, setCommand] = useState('threadpack');
  const [backupPath, setBackupPath] = useState('');
  const [inboxPath, setInboxPath] = useState('');
  const [connectionLogPath, setConnectionLogPath] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientRegistryPath, setClientRegistryPath] = useState('');
  const [clientToken, setClientToken] = useState('');
  const [clientTokenEnvironment, setClientTokenEnvironment] = useState('THREADPACK_CLIENT_TOKEN');
  const [authenticateClient, setAuthenticateClient] = useState(false);
  const [allowCandidates, setAllowCandidates] = useState(false);
  const [allowTaskCoordination, setAllowTaskCoordination] = useState(false);
  const [copied, setCopied] = useState(false);
  const authenticated = authenticateClient || allowCandidates || allowTaskCoordination;
  const resolvedClientId = clientId.trim() || target;
  const args = useMemo(() => {
    const result = ['mcp', '--backup', backupPath.trim(), '--project-id', projectId];
    if (inboxPath.trim()) result.push('--inbox', inboxPath.trim());
    if (connectionLogPath.trim()) result.push('--connection-log', connectionLogPath.trim());
    if (authenticated) {
      result.push('--client-id', resolvedClientId, '--client-registry', clientRegistryPath.trim(),
        '--client-token-env', clientTokenEnvironment.trim(), ...(allowCandidates ? ['--allow-candidate-updates'] : []),
        ...(allowTaskCoordination ? ['--allow-task-coordination'] : []));
    } else result.push('--read-only');
    return result;
  }, [allowCandidates, allowTaskCoordination, authenticated, backupPath, clientRegistryPath, clientTokenEnvironment, connectionLogPath, inboxPath, projectId, resolvedClientId]);
  const configuration = useMemo(() => target === 'codex'
    ? codexConfiguration(command.trim() || 'threadpack', args, authenticated ? clientTokenEnvironment.trim() : undefined, clientToken)
    : jsonConfiguration(command.trim() || 'threadpack', args, authenticated ? clientTokenEnvironment.trim() : undefined, clientToken),
  [args, authenticated, clientToken, clientTokenEnvironment, command, target]);
  const authReady = !authenticated || (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(resolvedClientId)
      && !!clientRegistryPath.trim() && /^THREADPACK_[A-Z0-9_]{1,54}$/.test(clientTokenEnvironment.trim())
      && /^[A-Za-z0-9_-]{43}$/.test(clientToken));
  const ready = !!command.trim() && !!backupPath.trim() && authReady;

  async function copyConfiguration() {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(configuration);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <details className="mcp-setup-guide">
    <summary>{t.mcpSetupTitle}</summary>
    <div className="mcp-setup-content">
      <p>{t.mcpSetupIntro}</p>
      <div className="mcp-setup-fields">
        <label><span>{t.mcpSetupClient}</span><select value={target} onChange={event => setTarget(event.target.value as ClientTarget)}>
          <option value="codex">Codex · config.toml</option>
          <option value="claude-code">Claude Code · .mcp.json</option>
          <option value="workbuddy">WorkBuddy · mcp.json</option>
          <option value="generic">Generic · mcpServers JSON</option>
        </select></label>
        <label><span>{t.mcpSetupCommand}</span><input value={command} onChange={event => setCommand(event.target.value)} autoComplete="off" /></label>
        <label><span>{t.mcpSetupBackup}</span><input value={backupPath} onChange={event => setBackupPath(event.target.value)} placeholder={t.mcpSetupBackupPlaceholder} autoComplete="off" /></label>
        <label><span>{t.mcpSetupInbox}</span><input value={inboxPath} onChange={event => setInboxPath(event.target.value)} placeholder={t.mcpSetupInboxPlaceholder} autoComplete="off" /></label>
        <label><span>{t.mcpSetupConnectionLog}</span><input value={connectionLogPath} onChange={event => setConnectionLogPath(event.target.value)} placeholder={t.mcpSetupConnectionLogPlaceholder} autoComplete="off" /></label>
      </div>
      <p className="mcp-setup-note">{t.mcpSetupPathNote} <code>{projectId}</code></p>
      <fieldset className="mcp-setup-permissions">
        <legend>{t.mcpSetupIdentity}</legend>
        <label><input type="checkbox" checked={authenticateClient} onChange={event => setAuthenticateClient(event.target.checked)} />{t.mcpSetupUseIdentity}</label>
      </fieldset>
      {authenticated && <div className="mcp-setup-fields">
        <label><span>{t.mcpSetupClientId}</span><input value={clientId} onChange={event => setClientId(event.target.value)} placeholder={target} autoComplete="off" /></label>
        <label><span>{t.mcpSetupRegistry}</span><input value={clientRegistryPath} onChange={event => setClientRegistryPath(event.target.value)} placeholder={t.mcpSetupRegistryPlaceholder} autoComplete="off" /></label>
        <label><span>{t.mcpSetupTokenEnv}</span><input value={clientTokenEnvironment} onChange={event => setClientTokenEnvironment(event.target.value)} autoComplete="off" /></label>
        <label><span>{t.mcpSetupToken}</span><input type="password" value={clientToken} onChange={event => setClientToken(event.target.value)} autoComplete="new-password" /></label>
        <p className="mcp-setup-note">{t.mcpSetupTokenWarning}</p>
      </div>}
      <fieldset className="mcp-setup-permissions">
        <legend>{t.mcpSetupPermissions}</legend>
        <label><input type="checkbox" checked={allowCandidates} onChange={event => setAllowCandidates(event.target.checked)} />{t.mcpSetupCandidatePermission}</label>
        <label><input type="checkbox" checked={allowTaskCoordination} onChange={event => setAllowTaskCoordination(event.target.checked)} />{t.mcpSetupTaskPermission}</label>
      </fieldset>
      {(allowCandidates || allowTaskCoordination) && <p className="mcp-setup-note">{t.mcpSetupWriteWarning}</p>}
      <label className="mcp-setup-output-label"><span>{t.mcpSetupSnippet}</span><textarea aria-label={t.mcpSetupSnippet} readOnly value={ready ? configuration : authenticated && !authReady ? t.mcpSetupFillAuth : t.mcpSetupFillPaths} rows={target === 'codex' ? 5 : 9} /></label>
      <button className="button secondary small" disabled={!ready} onClick={() => void copyConfiguration()}><Copy size={13} />{copied ? t.mcpSetupCopied : t.mcpSetupCopy}</button>
      <p className="mcp-setup-note"><ExternalLink size={12} /> {t.mcpSetupUnverified}</p>
    </div>
  </details>;
}
