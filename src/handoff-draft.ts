import type { RecentSelectionMode } from './core';

export const MAX_HANDOFF_DRAFT_BYTES = 256 * 1024;
const NOTE_KEYS = ['goal', 'decisions', 'constraints', 'nextSteps'] as const;
const BUDGETS = [6000, 12000, 24000, 48000] as const;

export interface HandoffDraft {
  format: 'threadpack-handoff-draft';
  version: 1;
  source: { format: string; fingerprint: string; messageCount: number };
  notes: Record<typeof NOTE_KEYS[number], string>;
  pinnedMessages: { number: number; fingerprint: string }[];
  recentCount: number;
  recentMode: RecentSelectionMode;
  maxCharacters: typeof BUDGETS[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

export function parseHandoffDraft(text: string): HandoffDraft {
  if (new TextEncoder().encode(text).byteLength > MAX_HANDOFF_DRAFT_BYTES) throw new Error('invalid-draft');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('invalid-draft'); }
  if (!isRecord(value) || !hasOnlyKeys(value, ['format', 'version', 'source', 'notes', 'pinnedMessages', 'recentCount', 'recentMode', 'maxCharacters'])
    || value.format !== 'threadpack-handoff-draft' || value.version !== 1) throw new Error('invalid-draft');

  const source = value.source;
  const notes = value.notes;
  const pinnedMessages = value.pinnedMessages;
  if (!isRecord(source) || !hasOnlyKeys(source, ['format', 'fingerprint', 'messageCount'])
    || typeof source.format !== 'string' || source.format.length < 1 || source.format.length > 200
    || typeof source.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(source.fingerprint)
    || !Number.isSafeInteger(source.messageCount) || (source.messageCount as number) < 0 || (source.messageCount as number) > 100_000_000
    || !isRecord(notes) || !hasOnlyKeys(notes, NOTE_KEYS)
    || NOTE_KEYS.some(key => typeof notes[key] !== 'string' || (notes[key] as string).length > 12000)
    || !Array.isArray(pinnedMessages) || pinnedMessages.length > (source.messageCount as number)
    || pinnedMessages.some(item => !isRecord(item) || !hasOnlyKeys(item, ['number', 'fingerprint'])
      || !Number.isSafeInteger(item.number) || (item.number as number) < 1 || (item.number as number) > (source.messageCount as number)
      || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint))
    || !Number.isSafeInteger(value.recentCount) || (value.recentCount as number) < 0 || (value.recentCount as number) > 100
    || value.recentMode !== 'source' && value.recentMode !== 'timestamp'
    || !BUDGETS.includes(value.maxCharacters as typeof BUDGETS[number])) throw new Error('invalid-draft');

  const pinNumbers = pinnedMessages.map(item => (item as { number: number }).number);
  if (new Set(pinNumbers).size !== pinNumbers.length) throw new Error('invalid-draft');
  return value as unknown as HandoffDraft;
}

export function serializeHandoffDraft(draft: HandoffDraft): string {
  const text = JSON.stringify(draft, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_HANDOFF_DRAFT_BYTES) throw new Error('invalid-draft');
  return text;
}

export async function sha256Fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
