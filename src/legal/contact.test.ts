import { describe, expect, it } from 'vitest';
import { privacyEn } from './privacy.en';
import { privacyTr } from './privacy.tr';
import { CONTACT_FALLBACK_URL, contactEmail, contactVariant, contactVariants } from './contact';

describe('contact', () => {
  it('reads a valid VITE_CONTACT_EMAIL only', () => {
    expect(contactEmail({ VITE_CONTACT_EMAIL: '' })).toBeNull();
    expect(contactEmail({ VITE_CONTACT_EMAIL: 'not an address' })).toBeNull();
    expect(contactEmail({ VITE_CONTACT_EMAIL: ' a@b.co ' })).toBe('a@b.co');
  });

  it('picks the [[email]] / [[noemail]] variant', () => {
    expect(contactVariant('[[email]] write to {{email}}', true)).toBe('write to {{email}}');
    expect(contactVariant('[[email]] write to {{email}}', false)).toBeNull();
    expect(contactVariant('[[noemail]] use the app', false)).toBe('use the app');
    expect(contactVariant('[[noemail]] use the app', true)).toBeNull();
    expect(contactVariant('plain', false)).toBe('plain');
    expect(contactVariants(['a', '[[email]] b', '[[noemail]] c'], false)).toEqual(['a', 'c']);
  });

  it('without an address points to the in-app deletion page, never a public tracker', () => {
    expect(CONTACT_FALLBACK_URL).toBe('/hesap-sil');
  });

  for (const doc of [privacyTr, privacyEn]) {
    it(`${doc.lang}: without an address no shown text asks people to write to one`, () => {
      const shown = [
        ...contactVariants(doc.intro, false),
        ...doc.sections.flatMap((s) =>
          s.blocks.flatMap((b) => ('p' in b ? contactVariants([b.p], false) : contactVariants(b.ul, false))),
        ),
      ];
      expect(shown.filter((t) => t.includes('{{email}}'))).toEqual([]);
      expect(shown.join(' ')).toContain('/hesap-sil');
    });
  }
});
