import { describe, expect, it } from 'vitest';
import { DELETE_CONFIRM_WORD, isDeleteConfirmation } from './deletion';

describe('isDeleteConfirmation', () => {
  it.each(['SİL', 'sil', 'Sil', 'SIL', '  SİL ', 'si̇l'.normalize('NFC') === 'sil' ? 'sil' : 'SİL'])(
    'accepts %j',
    (s) => expect(isDeleteConfirmation(s)).toBe(true),
  );
  it.each(['', 'sı', 'sıl', 'SILL', 'delete', 'sil!', 'S İ L'])('refuses %j', (s) =>
    expect(isDeleteConfirmation(s)).toBe(false),
  );
  it('accepts the word the dialog shows', () => {
    expect(isDeleteConfirmation(DELETE_CONFIRM_WORD)).toBe(true);
  });
});
