import type { Change, CleanOptions, CleanResult, Conversation } from './types';

export const DEFAULT_OPTIONS: CleanOptions = {
  stripImages: true,
  trimToolOutputs: true,
  toolLimit: 4000,
  deduplicate: true,
  redact: true,
  redactEmails: false,
};

const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).byteLength;
interface Match { start: number; end: number; value: string; category: 'SECRET' | 'EMAIL' }

function addMatches(matches: Match[], content: string, regex: RegExp, category: Match['category']): void {
  for (const match of content.matchAll(regex)) {
    matches.push({ start: match.index, end: match.index + match[0].length, value: match[0], category });
  }
}

function redactContent(content: string, secrets: Map<string, string>, emails: Map<string, string>, scanSecrets: boolean, scanEmails: boolean): { content: string; secretCount: number; emailCount: number } {
  const matches: Match[] = [];
  if (scanSecrets) {
    // Provider-shaped credentials plus contextual assignments. This is a heuristic scanner,
    // not proof that a transcript contains no secrets. No values are logged or exported.
    addMatches(matches, content, /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, 'SECRET');
    addMatches(matches, content, /\b(?:sk-(?:proj-|ant-(?:api\d{2}-)?)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, 'SECRET');
    addMatches(matches, content, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'SECRET');
    for (const match of content.matchAll(/\bBearer[ \t]+([A-Za-z0-9._~+\/-]{8,}=*)/gi)) {
      const value = match[1]!;
      const start = match.index + match[0].indexOf(value);
      matches.push({ start, end: start + value.length, value, category: 'SECRET' });
    }
    const assignments = /\b(?:[A-Za-z][A-Za-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret(?:[_-]?access[_-]?key)?|token|database[_-]?url|connection[_-]?string)\b["']?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\[(?:SECRET|EMAIL)_\d+\]|[^\s,;"'}\]]+))/gi;
    for (const match of content.matchAll(assignments)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      if (value.length < 4 || /^(?:null|true|false|undefined|\[(?:SECRET|EMAIL)_\d+\])$/i.test(value)) continue;
      const start = match.index + match[0].lastIndexOf(value);
      matches.push({ start, end: start + value.length, value, category: 'SECRET' });
    }
  }
  if (scanEmails) addMatches(matches, content, /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\b/g, 'EMAIL');

  // Prefer a containing match (e.g. an assignment around a provider token).
  // Nonoverlapping replacements preserve the rest of the message exactly.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let result = '';
  let secretCount = 0;
  let emailCount = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    const map = match.category === 'SECRET' ? secrets : emails;
    let alias = map.get(match.value);
    if (!alias) { alias = `[${match.category}_${map.size + 1}]`; map.set(match.value, alias); }
    result += content.slice(cursor, match.start) + alias;
    cursor = match.end;
    if (match.category === 'SECRET') secretCount++; else emailCount++;
  }
  return { content: result + content.slice(cursor), secretCount, emailCount };
}

function stripImages(content: string): { content: string; count: number } {
  let count = 0;
  // A raw newline terminates a data URI. Treating all subsequent alphabetic
  // lines as base64 would destroy ordinary prose after an attachment.
  const cleaned = content.replace(/data:image\/[A-Za-z0-9.+-]+;base64,(?:[A-Za-z0-9+/=_-]|\\[rn])+/g, () => {
    count++;
    return '[Inline image removed by ThreadPack]';
  });
  return { content: cleaned, count };
}

function trimTool(content: string, limit: number): string {
  if (content.length <= limit) return content;
  let removed = content.length - limit;
  let marker = '';
  let available = 0;
  // The marker occupies part of the budget, so compute the omitted character
  // count from the retained text rather than just the difference in lengths.
  for (let n = 0; n < 3; n++) {
    marker = `\n\n[ThreadPack: ${removed.toLocaleString('en-US')} characters omitted from tool output; head and tail retained]\n\n`;
    available = Math.max(0, limit - marker.length);
    removed = content.length - available;
  }
  const head = Math.ceil(available * 0.65);
  const tail = available - head;
  return content.slice(0, head) + marker + (tail ? content.slice(-tail) : '');
}

export function cleanConversation(conversation: Conversation, options: CleanOptions): CleanResult {
  if (!conversation || !Array.isArray(conversation.messages)) throw new Error('A conversation with messages is required.');
  if (!Number.isFinite(options.toolLimit) || options.toolLimit < 200 || options.toolLimit > 1_000_000) {
    throw new Error('Tool output limit must be between 200 and 1,000,000 characters.');
  }
  const changes: Change[] = [];
  const warnings: string[] = [];
  const seenTools = new Map<string, string>();
  const secrets = new Map<string, string>();
  const emails = new Map<string, string>();
  let beforeBytes = 0;
  let afterBytes = 0;
  let imagesRemoved = 0;
  let outputsTrimmed = 0;
  let duplicatesRemoved = 0;
  let secretsRedacted = 0;
  let emailsRedacted = 0;
  const messages = conversation.messages.map((message) => {
    const original = message.content;
    beforeBytes += bytes(original);
    let content = original;
    const change = (kind: Change['kind'], count: number, previous: string): void => {
      if (count) changes.push({ messageId: message.id, kind, count, removedBytes: Math.max(0, bytes(previous) - bytes(content)) });
    };
    if (options.stripImages) {
      const previous = content;
      const stripped = stripImages(content);
      content = stripped.content;
      imagesRemoved += stripped.count;
      change('image', stripped.count, previous);
    }
    // Deduplicate before trimming/redaction so unrelated outputs never become identical
    // merely because their differing middle/credentials were removed.
    if (message.role === 'tool' && options.deduplicate && content.length > 0) {
      const first = seenTools.get(content);
      if (first) {
        const previous = content;
        content = `[ThreadPack: duplicate tool output omitted; identical to message ${first}]`;
        duplicatesRemoved++;
        change('duplicate', 1, previous);
      } else seenTools.set(content, message.id);
    }
    if (options.redact || options.redactEmails) {
      const previous = content;
      const redacted = redactContent(content, secrets, emails, options.redact, options.redactEmails);
      content = redacted.content;
      secretsRedacted += redacted.secretCount;
      emailsRedacted += redacted.emailCount;
      if (redacted.secretCount) change('secret', redacted.secretCount, previous);
      if (redacted.emailCount) change('email', redacted.emailCount, previous);
    }
    // Scan the complete retained output before trimming. A head/tail cut can
    // remove a PEM header or credential prefix and leave sensitive suffixes
    // that no longer match the original redaction rule.
    if (message.role === 'tool' && options.trimToolOutputs && content.length > options.toolLimit) {
      const previous = content;
      content = trimTool(content, Math.floor(options.toolLimit));
      outputsTrimmed++;
      change('tool', 1, previous);
    }
    afterBytes += bytes(content);
    return { ...message, content };
  });
  if (outputsTrimmed || duplicatesRemoved || imagesRemoved) warnings.push('This is a lossy, normalized copy for review and handoff. Keep the original export; the copy is not a resumable agent session.');
  if (options.redact || options.redactEmails) warnings.push('Redaction uses local patterns and can miss secrets or personal information. Review the export before sharing.');
  const titleResult = redactContent(conversation.title, secrets, emails, options.redact, options.redactEmails);
  const sourceResult = redactContent(conversation.source, secrets, emails, options.redact, options.redactEmails);
  const metadataSecretCount = titleResult.secretCount + sourceResult.secretCount;
  const metadataEmailCount = titleResult.emailCount + sourceResult.emailCount;
  secretsRedacted += metadataSecretCount;
  emailsRedacted += metadataEmailCount;
  if (metadataSecretCount || metadataEmailCount) warnings.push('Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.');
  return {
    conversation: { ...conversation, title: titleResult.content, source: sourceResult.content, messages },
    changes,
    stats: { beforeBytes, afterBytes, removedBytes: Math.max(0, beforeBytes - afterBytes), imagesRemoved, outputsTrimmed, duplicatesRemoved, secretsRedacted, emailsRedacted },
    warnings,
  };
}
