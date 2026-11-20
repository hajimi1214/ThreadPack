export interface HandoffNoteFields {
  goal: string;
  decisions: string;
  constraints: string;
  nextSteps: string;
}

/** Only the four owned note fields count; pins and other metadata do not. */
export function hasNonblankNotes(notes: HandoffNoteFields): boolean {
  return (['goal', 'decisions', 'constraints', 'nextSteps'] as const).some(key =>
    Object.prototype.hasOwnProperty.call(notes, key) && typeof notes[key] === 'string' && notes[key].trim().length > 0);
}
