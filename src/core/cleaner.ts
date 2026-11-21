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
interface Match { start: number; end: number; category: 'SECRET' | 'EMAIL' | 'CUSTOM' }
interface RedactionMaps { SECRET: Map<string, string>; EMAIL: Map<string, string>; CUSTOM: Map<string, string> }

export const CUSTOM_SECRET_LIMITS = { maxItems: 50, minCharacters: 3, maxCharacters: 1000 } as const;

/** Preserve literal whitespace; errors deliberately contain no submitted values. */
export function validateCustomSecrets(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CUSTOM_SECRET_LIMITS.maxItems) {
    throw new Error('Custom redactions must be a list containing at most 50 values.');
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error('Each custom redaction must be a nonblank string containing 3 to 1,000 characters.');
    }
    let characters = 0;
    for (const _character of item) {
      characters++;
      if (characters > CUSTOM_SECRET_LIMITS.maxCharacters) break;
    }
    if (characters < CUSTOM_SECRET_LIMITS.minCharacters || characters > CUSTOM_SECRET_LIMITS.maxCharacters) {
      throw new Error('Each custom redaction must be a nonblank string containing 3 to 1,000 characters.');
    }
    unique.add(item);
  }
  return [...unique];
}

function* regexMatches(content: string, regex: RegExp, category: Match['category']): Generator<Match> {
  for (const match of content.matchAll(regex)) {
    yield { start: match.index, end: match.index + match[0].length, category };
  }
}

function* literalMatches(content: string, value: string): Generator<Match> {
  let cursor = 0;
  for (;;) {
    const start = content.indexOf(value, cursor);
    if (start < 0) return;
    yield { start, end: start + value.length, category: 'CUSTOM' };
    // Include crossing occurrences, such as "aba" at both ends of "ababa".
    cursor = start + 1;
  }
}

function* bearerMatches(content: string): Generator<Match> {
  for (const match of content.matchAll(/\bBearer[ \t]+([A-Za-z0-9._~+\/-]{8,}=*)/gi)) {
    const value = match[1]!;
    const start = match.index + match[0].indexOf(value);
    yield { start, end: start + value.length, category: 'SECRET' };
  }
}

function* assignmentMatches(content: string): Generator<Match> {
  const assignments = /\b(?:[A-Za-z][A-Za-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret(?:[_-]?access[_-]?key)?|token|database[_-]?url|connection[_-]?string)\b["']?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\[(?:SECRET|EMAIL|CUSTOM)_\d+\]|[^\s,;"'}\]]+))/gi;
  for (const match of content.matchAll(assignments)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value.length < 4 || /^(?:null|true|false|undefined|\[(?:SECRET|EMAIL|CUSTOM)_\d+\])$/i.test(value)) continue;
    const start = match.index + match[0].lastIndexOf(value);
    yield { start, end: start + value.length, category: 'SECRET' };
  }
}

/** Read authority offsets without decoding or reserializing any source text. */
function* urlAuthorities(content: string): Generator<{ start: number; end: number }> {
  const terminator = /[\s/?#<>"`\\]/;
  for (const scheme of content.matchAll(/(?:^|[^a-z\d+.-])[a-z][a-z\d+.-]*:\/\//gi)) {
    const start = scheme.index + scheme[0].length;
    let end = start;
    while (end < content.length && !terminator.test(content[end]!)) end++;
    yield { start, end };
  }
}

function* urlCredentialMatches(content: string): Generator<Match> {
  for (const authority of urlAuthorities(content)) {
    // The last literal @ separates the host, including passwords with raw @.
    // Percent-encoded delimiters remain part of the original user information.
    const authorityText = content.slice(authority.start, authority.end);
    const at = authorityText.lastIndexOf('@');
    if (at <= 0) continue;
    const userInfo = authorityText.slice(0, at);
    if (/^\[(?:SECRET|EMAIL|CUSTOM)_\d+\]$/.test(userInfo)) continue;
    yield { start: authority.start, end: authority.start + at, category: 'SECRET' };
  }
}

function* emailMatches(content: string): Generator<Match> {
  const authorities = urlAuthorities(content);
  let authority = authorities.next();
  // Consume complete ASCII email-like tokens so a failed address cannot be
  // retried from a suffix after an @ or other local-part character.
  const tokens = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]+/g;
  const domainPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  for (const token of content.matchAll(tokens)) {
    const candidate = token[0].replace(/^'+/, '');
    const at = candidate.indexOf('@');
    if (at < 1 || at !== candidate.lastIndexOf('@')) continue;
    const local = candidate.slice(0, at);
    const domain = candidate.slice(at + 1).replace(/[.!?']+$/, '');
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) continue;
    if (!domainPattern.test(domain) || !/[A-Za-z]/.test(domain.slice(domain.lastIndexOf('.') + 1))) continue;
    const start = token.index + token[0].length - candidate.length;
    const end = start + at + 1 + domain.length;
    while (!authority.done && authority.value.end <= start) authority = authorities.next();
    // Also skip URL authorities when secret redaction was explicitly disabled.
    if (!authority.done && authority.value.start < end && authority.value.end > start) continue;
    yield { start, end, category: 'EMAIL' };
  }
}

/** Merge sorted match streams without allocating one object per occurrence up front. */
function* orderedMatches(sources: Generator<Match>[]): Generator<Match> {
  const heap: { match: Match; source: Generator<Match> }[] = [];
  const before = (a: Match, b: Match): boolean => a.start < b.start || (a.start === b.start && a.end > b.end);
  const push = (entry: { match: Match; source: Generator<Match> }): void => {
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!before(entry.match, heap[parent]!.match)) break;
      heap[index] = heap[parent]!;
      index = parent;
    }
    heap[index] = entry;
  };
  for (const source of sources) {
    const next = source.next();
    if (!next.done) push({ match: next.value, source });
  }
  while (heap.length) {
    const first = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1]!.match, heap[child]!.match)) child++;
        if (!before(heap[child]!.match, last.match)) break;
        heap[index] = heap[child]!;
        index = child;
      }
      heap[index] = last;
    }
    yield first.match;
    const next = first.source.next();
    if (!next.done) push({ match: next.value, source: first.source });
  }
}

function redactContent(content: string, maps: RedactionMaps, scanSecrets: boolean, scanEmails: boolean, customSecrets: string[]): { content: string; secretCount: number; emailCount: number; customCount: number; customRuleMatches: number } {
  const sources: Generator<Match>[] = customSecrets.map((value) => literalMatches(content, value));
  if (scanSecrets) {
    // Provider-shaped credentials plus contextual assignments. This is a heuristic scanner,
    // not proof that a transcript contains no secrets. No values are logged or exported.
    sources.push(regexMatches(content, /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, 'SECRET'));
    sources.push(regexMatches(content, /\b(?:sk-(?:proj-|ant-(?:api\d{2}-)?)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, 'SECRET'));
    sources.push(regexMatches(content, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'SECRET'));
    sources.push(bearerMatches(content), assignmentMatches(content), urlCredentialMatches(content));
  }
  if (scanEmails) sources.push(emailMatches(content));

  let cursor = 0;
  let result = '';
  let secretCount = 0;
  let emailCount = 0;
  let customCount = 0;
  let customRuleMatches = 0;
  let cluster: { start: number; end: number; primary: Match } | undefined;
  const priority = { CUSTOM: 2, SECRET: 1, EMAIL: 0 };
  const emit = (): void => {
    if (!cluster) return;
    const category = cluster.primary.category;
    const value = content.slice(cluster.start, cluster.end);
    const map = maps[category];
    let alias = map.get(value);
    if (!alias) { alias = `[${category}_${map.size + 1}]`; map.set(value, alias); }
    result += content.slice(cursor, cluster.start) + alias;
    cursor = cluster.end;
    if (category === 'SECRET') secretCount++;
    else if (category === 'EMAIL') emailCount++;
    else customCount++;
  };
  for (const match of orderedMatches(sources)) {
    if (match.category === 'CUSTOM') customRuleMatches++;
    if (!cluster || match.start >= cluster.end) {
      emit();
      cluster = { start: match.start, end: match.end, primary: match };
      continue;
    }
    // Merge crossing matches so a shorter rule cannot leave a sensitive suffix.
    // The longest individual interval owns the alias; custom wins exact ties.
    cluster.end = Math.max(cluster.end, match.end);
    const length = match.end - match.start;
    const longest = cluster.primary.end - cluster.primary.start;
    if (length > longest || (length === longest && priority[match.category] > priority[cluster.primary.category])) cluster.primary = match;
  }
  emit();
  return { content: result + content.slice(cursor), secretCount, emailCount, customCount, customRuleMatches };
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
  const customSecrets = validateCustomSecrets(options.customSecrets);
  const changes: Change[] = [];
  const warnings: string[] = [];
  const seenTools = new Map<string, string>();
  const maps: RedactionMaps = { SECRET: new Map(), EMAIL: new Map(), CUSTOM: new Map() };
  let beforeBytes = 0;
  let afterBytes = 0;
  let imagesRemoved = 0;
  let outputsTrimmed = 0;
  let duplicatesRemoved = 0;
  let secretsRedacted = 0;
  let emailsRedacted = 0;
  let customRedacted = 0;
  let customRuleMatches = 0;
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
    // Compare unchanged output before any redaction/trim, so distinct raw outputs
    // cannot become "duplicates" merely because their credentials were removed.
    let firstDuplicate: string | undefined;
    if (message.role === 'tool' && options.deduplicate && content.length > 0) {
      firstDuplicate = seenTools.get(content);
      if (!firstDuplicate) seenTools.set(content, message.id);
    }
    if (options.redact || options.redactEmails || customSecrets.length) {
      const previous = content;
      const redacted = redactContent(content, maps, options.redact, options.redactEmails, customSecrets);
      content = redacted.content;
      secretsRedacted += redacted.secretCount;
      emailsRedacted += redacted.emailCount;
      customRedacted += redacted.customCount;
      customRuleMatches += redacted.customRuleMatches;
      if (redacted.secretCount) change('secret', redacted.secretCount, previous);
      if (redacted.emailCount) change('email', redacted.emailCount, previous);
      if (redacted.customCount) change('custom', redacted.customCount, previous);
    }
    // Scan full originals before replacing duplicates, so custom values are
    // counted consistently even when the repeated output is subsequently omitted.
    if (firstDuplicate) {
      const previous = content;
      content = `[ThreadPack: duplicate tool output omitted; identical to message ${firstDuplicate}]`;
      duplicatesRemoved++;
      change('duplicate', 1, previous);
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
  if (options.redact || options.redactEmails || customSecrets.length) warnings.push('Redaction uses local patterns and exact custom values and can miss secrets or personal information. Review the export before sharing.');
  const titleResult = redactContent(conversation.title, maps, options.redact, options.redactEmails, customSecrets);
  const sourceResult = redactContent(conversation.source, maps, options.redact, options.redactEmails, customSecrets);
  const metadataSecretCount = titleResult.secretCount + sourceResult.secretCount;
  const metadataEmailCount = titleResult.emailCount + sourceResult.emailCount;
  const metadataCustomCount = titleResult.customCount + sourceResult.customCount;
  secretsRedacted += metadataSecretCount;
  emailsRedacted += metadataEmailCount;
  customRedacted += metadataCustomCount;
  customRuleMatches += titleResult.customRuleMatches + sourceResult.customRuleMatches;
  if (metadataSecretCount || metadataEmailCount || metadataCustomCount) warnings.push('Sensitive patterns in the conversation title or source label were also redacted. Byte totals describe message bodies only.');
  return {
    conversation: { ...conversation, title: titleResult.content, source: sourceResult.content, messages },
    changes,
    stats: { beforeBytes, afterBytes, removedBytes: Math.max(0, beforeBytes - afterBytes), imagesRemoved, outputsTrimmed, duplicatesRemoved, secretsRedacted, emailsRedacted, customRedacted,
      customRuleMatches, redactionReplacements: secretsRedacted + emailsRedacted + customRedacted },
    warnings,
  };
}
