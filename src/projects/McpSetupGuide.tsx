import { useMemo, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { TranslationKey } from '../i18n';

type ClientTarget = 'codex' | 'claude-code' | 'workbuddy' | 'generic';

interface Props {
  projectId: string;
  t: Record<TranslationKey, string>;
}

function jsonConfiguration(command: string, args: string[]): string {
  return JSON.stringify({ mcpServers: { threadpack: { command, args } } }, null, 2);
}

function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}` + '"';
}

function codexConfiguration(command: string, args: string[]): string {
  return `[mcp_servers.threadpack]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]`;
}

export default function McpSetupGuide({ projectId, t }: Props) {
  const [target, setTarget] = useState<ClientTarget>('codex');
  const [command, setCommand] = useState('threadpack');
  const [backupPath, setBackupPath] = useState('');
  const [inboxPath, setInboxPath] = useState('');
  const [allowCandidates, setAllowCandidates] = useState(false);
  const [allowTaskCoordination, setAllowTaskCoordination] = useState(false);
  const [copied, setCopied] = useState(false);
  const args = useMemo(() => {
    const result = ['mcp', '--backup', backupPath.trim(), '--project-id', projectId];
    if (inboxPath.trim()) result.push('--inbox', inboxPath.trim());
    if (allowCandidates || allowTaskCoordination) {
      result.push('--client-id', target, ...(allowCandidates ? ['--allow-candidate-updates'] : []),
        ...(allowTaskCoordination ? ['--allow-task-coordination'] : []));
    } else result.push('--read-only');
    return result;
  }, [allowCandidates, allowTaskCoordination, backupPath, inboxPath, projectId, target]);
  const configuration = useMemo(() => target === 'codex'
    ? codexConfiguration(command.trim() || 'threadpack', args)
    : jsonConfiguration(command.trim() || 'threadpack', args), [args, command, target]);
  const ready = !!command.trim() && !!backupPath.trim();

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
      </div>
      <p className="mcp-setup-note">{t.mcpSetupPathNote} <code>{projectId}</code></p>
      <fieldset className="mcp-setup-permissions">
        <legend>{t.mcpSetupPermissions}</legend>
        <label><input type="checkbox" checked={allowCandidates} onChange={event => setAllowCandidates(event.target.checked)} />{t.mcpSetupCandidatePermission}</label>
        <label><input type="checkbox" checked={allowTaskCoordination} onChange={event => setAllowTaskCoordination(event.target.checked)} />{t.mcpSetupTaskPermission}</label>
      </fieldset>
      {(allowCandidates || allowTaskCoordination) && <p className="mcp-setup-note">{t.mcpSetupWriteWarning}</p>}
      <label className="mcp-setup-output-label"><span>{t.mcpSetupSnippet}</span><textarea aria-label={t.mcpSetupSnippet} readOnly value={ready ? configuration : t.mcpSetupFillPaths} rows={target === 'codex' ? 5 : 9} /></label>
      <button className="button secondary small" disabled={!ready} onClick={() => void copyConfiguration()}><Copy size={13} />{copied ? t.mcpSetupCopied : t.mcpSetupCopy}</button>
      <p className="mcp-setup-note"><ExternalLink size={12} /> {t.mcpSetupUnverified}</p>
    </div>
  </details>;
}
