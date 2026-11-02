// Turkish suffixes after a number written in digits ("%91'ini", "%96'sını"). The suffix
// follows how the number is read aloud: its last spoken word decides the vowel harmony and
// whether a buffer consonant is needed (v0.5.2, ADR 0063). Pure.

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

/** The last word of `n` read aloud in Turkish (91 → "bir", 90 → "doksan", 100 → "yüz"). */
export function lastSpokenWord(n: number): string {
  const v = Math.abs(Math.trunc(n));
  if (v === 0) return 'sıfır';
  if (v % 10) return ONES[v % 10]!;
  if (v % 100) return TENS[(v % 100) / 10]!;
  if (v % 1000) return 'yüz';
  if (v % 1_000_000) return 'bin';
  if (v % 1_000_000_000) return 'milyon';
  return 'milyar';
}

const VOWELS = 'aıoueiöü';

/** The four-way harmony vowel (ı, i, u, ü) after the word's last vowel. */
function highVowel(word: string): 'ı' | 'i' | 'u' | 'ü' {
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word[i]!;
    if ('aı'.includes(c)) return 'ı';
    if ('ei'.includes(c)) return 'i';
    if ('ou'.includes(c)) return 'u';
    if ('öü'.includes(c)) return 'ü';
  }
  return 'i';
}

const endsInVowel = (word: string) => VOWELS.includes(word.at(-1) ?? '');

/** Possessive "-(s)I": %91'i, %96'sı, %90'ı ("metnin %91'i"). */
export function possessiveSuffix(n: number): string {
  const w = lastSpokenWord(n);
  const v = highVowel(w);
  return endsInVowel(w) ? `s${v}` : v;
}

/** Possessive + accusative "-(s)InI": %91'ini, %96'sını, %93'ünü ("metnin %91'ini biliyorsun"). */
export function possessiveAccusativeSuffix(n: number): string {
  const v = highVowel(lastSpokenWord(n));
  return `${possessiveSuffix(n)}n${v}`;
}
