// Typed confirmation for "Hesabımı ve verilerimi sil" / "Bu cihazdaki verileri sil" (ADR 0035).

/** The word the user types to confirm (shown in the dialog). */
export const DELETE_CONFIRM_WORD = 'SİL';

/**
 * True when `input` is the confirmation word in any letter case. Both Turkish ("sil", "SİL")
 * and plain ASCII typing ("SIL", from a keyboard without İ) are accepted; surrounding spaces
 * are ignored. Anything else, including "sıl", is refused.
 */
export function isDeleteConfirmation(input: string): boolean {
  const s = input.normalize('NFC').trim();
  return s.toLocaleLowerCase('tr') === 'sil' || s.toLocaleLowerCase('en') === 'sil';
}
