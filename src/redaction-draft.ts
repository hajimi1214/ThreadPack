import { validateCustomSecrets } from './core';

export interface RedactionDraft { values: string[]; valid: boolean }

/** Match the exact-line input used by the workbench; retain meaningful spaces. */
export function parseRedactionDraft(text: string): RedactionDraft {
  try {
    return { values: validateCustomSecrets(text.split(/\r?\n/).filter(value => value.trim())), valid: true };
  } catch {
    // Do not reflect invalid submitted text through validation diagnostics.
    return { values: [], valid: false };
  }
}

export function isRedactionDraftDirty(text: string, applied?: string[]): boolean {
  const draft = parseRedactionDraft(text);
  if (!draft.valid) return true;
  try {
    const current = validateCustomSecrets(applied);
    if (draft.values.length !== current.length) return true;
    // Rule order does not alter matching or aliases; duplicates are normalized.
    const values = new Set(current);
    return draft.values.some(value => !values.has(value));
  } catch { return true; }
}
