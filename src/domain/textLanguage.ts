// Is a text the user brought in English? Word extraction (yapay zekâ) only makes sense for an
// English text: a Turkish paragraph pasted into "Metin ekle" spent an ai-extract call and came
// back with "0 aday" (review 2026-11-26 #8). Pure and cheap: common function words of each
// language and the letters only Turkish uses, no model. It errs towards "English": a word list,
// a short note or an English text with Turkish names is never stopped.

export type TextLanguageGuess = 'en' | 'tr' | 'other';

const EN_STOPWORDS = new Set(
  (
    'the a an and or but of to in on at by for with from into about as is are was were be been ' +
    'being am do does did have has had will would can could should may might must not no this ' +
    'that these those it its i you he she we they me him her us them my your his our their ' +
    "what which who when where why how there here than then so if because very just all some " +
    "any more most also only up out over after before don't it's i'm"
  ).split(' '),
);

/** Turkish function words; none of them is an English word. */
const TR_STOPWORDS = new Set(
  (
    've bir bu şu da de ki için ile çok ne gibi daha ama fakat ben sen biz siz onlar mi mı mu mü ' +
    'var yok olarak kadar sonra önce şey her değil ya veya diye olan oldu olur ise hem bile ' +
    'çünkü nasıl neden niye nerede şimdi bugün yine artık hiç bunu şunu onu bana sana ona bizim ' +
    'sizin onların benim senin onun içinde üzerinde gibi göre doğru herkes hepsi biraz zaten ' +
    'cok icin degil sey simdi'
  ).split(' '),
);

/** Letters an English text has only in names and loanwords. */
const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/u;
/** Other non-English Latin letters (German, French, Spanish, …). */
const OTHER_LETTERS = /[äßàâæèéêëîïñœùûÿáíóúãõ]/iu;

/** Too few words to tell; such a text is let through. */
const MIN_WORDS = 6;

/**
 * Guesses the language of a text: 'tr' when Turkish function words and Turkish letters clearly
 * outweigh English function words, 'other' when the text is mostly not in Latin script or is
 * full of other accented letters with almost no English function words, else 'en'.
 */
export function guessTextLanguage(text: string): TextLanguageGuess {
  const words = (text.slice(0, 20_000).match(/[\p{L}'’]+/gu) ?? []).map((w) =>
    w.replace(/’/g, "'"),
  );
  if (words.length < MIN_WORDS) return 'en';
  const letters = words.join('');
  const latin = (letters.match(/\p{Script=Latin}/gu) ?? []).length;
  if (latin / letters.length < 0.5) return 'other';

  let en = 0;
  let tr = 0;
  let trLetters = 0;
  let otherLetters = 0;
  for (const w of words) {
    // English words with English case rules ("I", "It"), Turkish ones with Turkish rules ("Bir").
    if (EN_STOPWORDS.has(w.toLowerCase())) en++;
    if (TR_STOPWORDS.has(w.toLocaleLowerCase('tr'))) tr++;
    if (TR_LETTERS.test(w)) trLetters++;
    else if (OTHER_LETTERS.test(w)) otherLetters++;
  }
  const n = words.length;
  const trScore = tr + trLetters * 0.5;
  if (trScore >= 3 && trScore > en * 2 && en / n < 0.15) return 'tr';
  // Many accented words ("Über", "Ängste", "été") and almost no English function words.
  if ((otherLetters + trLetters) / n > 0.1 && en / n < 0.05) return 'other';
  return 'en';
}

/**
 * Does a typed term look Turkish rather than English? True when it has a letter only Turkish
 * uses (ç ğ ı İ ö ş ü, any case): "çalışmak", "ÇOK", "şemsiye". An English word with such a
 * letter ("façade", "über") is rare, and callers only act on it when nothing on the device
 * knows the word, so the check never blocks a real entry (review 2026-11-26, ekle.md #9).
 */
export function looksTurkishTerm(term: string): boolean {
  return TR_LETTERS.test(term);
}
