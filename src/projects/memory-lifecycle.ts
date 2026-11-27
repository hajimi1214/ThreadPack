import type { MemoryStatus } from './memory-types';

export const TERMINAL_MEMORY_STATUSES: readonly MemoryStatus[] = ['rejected', 'superseded', 'expired', 'revoked'];

export function isTerminalMemoryStatus(status: MemoryStatus): boolean {
  return TERMINAL_MEMORY_STATUSES.includes(status);
}

export function effectiveMemoryStatus(status: MemoryStatus, expiresAt: number | undefined, now = Date.now()): MemoryStatus {
  return !isTerminalMemoryStatus(status) && expiresAt !== undefined && expiresAt <= now ? 'expired' : status;
}

export function normalizeMemoryClaimText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function sameMemoryClaimText(first: string, second: string): boolean {
  return normalizeMemoryClaimText(first) === normalizeMemoryClaimText(second);
}

export function canReviewMemoryStatusTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  if (isTerminalMemoryStatus(from)) return false;
  if (from === to) return true;
  if (to === 'confirmed') return ['proposed', 'needs-review', 'confirmed'].includes(from);
  if (to === 'needs-review') return ['proposed', 'confirmed'].includes(from);
  if (to === 'rejected') return ['proposed', 'needs-review', 'confirmed'].includes(from);
  if (to === 'revoked') return from === 'confirmed';
  return false;
}
