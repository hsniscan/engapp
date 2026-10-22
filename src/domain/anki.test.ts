import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BASIC_REVERSED, collectionOf, largeDeck, sampleDeck } from '../features/anki/testing/buildApkg';
import {
  ankiFieldText,
  ankiLogId,
  countMedia,
  guessMapping,
  isValidMapping,
  matchLexiconSense,
  planAnkiImport,
  previewNote,
  revlogRating,
  summarizeAnki,
  templateDirections,
  type AnkiMappings,
  type AnkiNoteType,
} from './anki';
import { encodeProto, protoNumber, protoString, readProtoFields } from './ankiProto';
import { isUuid, uuidv7Time } from './ids';

const NOW = 1_800_000_000_000;
const basic = (fields: string[], fronts: string[]): AnkiNoteType => ({
  id: '1',
  name: 'Basic',
  kind: 'normal',
  fields,
  templates: fronts.map((front, ord) => ({ ord, name: `Card ${ord + 1}`, front })),
});
const mappingsOf = (col: ReturnType<typeof collectionOf>): AnkiMappings =>
  Object.fromEntries(col.noteTypes.map((nt) => [nt.id, guessMapping(nt)]));

describe('ankiFieldText', () => {
  it('strips markup, media and cloze markers and decodes entities', () => {
    expect(ankiFieldText('She was <b>reluctant</b>&nbsp;to leave.')).toBe('She was reluctant to leave.');
    expect(ankiFieldText('apple <img src="apple.jpg">')).toBe('apple');
    expect(ankiFieldText('elma [sound:apple.mp3]')).toBe('elma');
    expect(ankiFieldText('vazgeçmek<br>bırakmak', '; ')).toBe('vazgeçmek; bırakmak');
    expect(ankiFieldText('<div>one</div><div>two</div>', '; ')).toBe('one; two');
    expect(ankiFieldText('The {{c1::weather::noun}} is nice')).toBe('The weather is nice');
    expect(ankiFieldText('a &lt;b&gt; &amp; &#39;c&#x27; &rsquo;')).toBe("a <b> & 'c' '");
    expect(ankiFieldText('<style>.x{color:red}</style>word')).toBe('word');
    expect(ankiFieldText('  ')).toBe('');
  });

  it('counts media references', () => {
    expect(countMedia('apple <img src="a.jpg"> [sound:a.mp3] <audio src="b.ogg">')).toBe(3);
    expect(countMedia('plain')).toBe(0);
  });

  it('never returns markup for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = ankiFieldText(s);
        expect(out).toBe(out.trim());
        expect(out).not.toMatch(/\s{2}/);
      }),
    );
  });
});

describe('mapping', () => {
  it('guesses from field names, else the first two fields', () => {
    expect(guessMapping(basic(['Front', 'Back', 'Example'], ['{{Front}}']))).toEqual({ term: 0, meaning: 1, sentence: 2 });
    expect(guessMapping(basic(['Türkçe', 'İngilizce', 'Örnek cümle'], ['{{İngilizce}}']))).toEqual({ term: 1, meaning: 0, sentence: 2 });
    expect(guessMapping(basic(['A', 'B'], ['{{A}}']))).toEqual({ term: 0, meaning: 1, sentence: null });
    expect(guessMapping(basic(['Only'], ['{{Only}}']))).toBeNull();
    expect(guessMapping({ ...basic(['Text', 'Extra'], ['{{cloze:Text}}']), kind: 'cloze' })).toBeNull();
  });

  it('validates a mapping', () => {
    const nt = basic(['Front', 'Back', 'Example'], ['{{Front}}']);
    expect(isValidMapping(nt, { term: 0, meaning: 1, sentence: null })).toBe(true);
    expect(isValidMapping(nt, { term: 0, meaning: 0, sentence: null })).toBe(false);
    expect(isValidMapping(nt, { term: 0, meaning: 1, sentence: 1 })).toBe(false);
    expect(isValidMapping(nt, { term: 0, meaning: 3, sentence: null })).toBe(false);
  });

  it('previews a note as it will be imported', () => {
    const note = { id: 1, mid: '1', tags: [], fields: ['give <i>up</i>', 'vazgeçmek<br>bırakmak', 'He gave up.'] };
    expect(previewNote(note, { term: 0, meaning: 1, sentence: 2 })).toEqual({ term: 'give up', meaning: 'vazgeçmek; bırakmak', sentence: 'He gave up.' });
    expect(previewNote(note, { term: 0, meaning: 1, sentence: null }).sentence).toBeNull();
  });

  it('tells the recognition template from the production template', () => {
    const m = { term: 0, meaning: 1, sentence: null };
    // Reversed order in Anki: card 1 asks the Turkish side.
    expect([...templateDirections(basic(['Front', 'Back'], ['{{Back}}', '{{Front}}']), m)]).toEqual([
      [0, 'production'],
      [1, 'recognition'],
    ]);
    // Filters, sections and type-in fields.
    expect([...templateDirections(basic(['Front', 'Back'], ['{{#Front}}{{text:Front}}{{/Front}}', '{{Back}}<br>{{type:Front}}']), m)]).toEqual([
      [0, 'recognition'],
    ]);
    // Fronts that show both or neither: first = recognition, second = production.
    expect([...templateDirections(basic(['Front', 'Back'], ['{{Front}} {{Back}}', 'Q']), m)]).toEqual([
      [0, 'recognition'],
      [1, 'production'],
    ]);
    // A third template that repeats a direction is ignored.
    expect(templateDirections(basic(['Front', 'Back'], ['{{Front}}', '{{Back}}', '{{Front}}!']), m).size).toBe(2);
  });
});

describe('revlogRating', () => {
  it('maps answers and skips cramming and manual changes', () => {
    expect(revlogRating({ ease: 1, type: 0 }, 2)).toBe(1);
    expect(revlogRating({ ease: 4, type: 1 }, 2)).toBe(4);
    expect(revlogRating({ ease: 3, type: 2 }, 2)).toBe(3);
    expect(revlogRating({ ease: 3, type: 3 }, 2)).toBeNull();
    expect(revlogRating({ ease: 0, type: 4 }, 2)).toBeNull();
    expect(revlogRating({ ease: 0, type: 1 }, 2)).toBeNull();
  });

  it('reads the v1 scheduler three-button learning answers', () => {
    expect(revlogRating({ ease: 2, type: 0 }, 1)).toBe(3);
    expect(revlogRating({ ease: 3, type: 2 }, 1)).toBe(4);
    expect(revlogRating({ ease: 2, type: 1 }, 1)).toBe(2);
  });
});

describe('ankiLogId', () => {
  it('is a UUID v7 at the review time, stable per (card, revlog)', () => {
    const id = ankiLogId('0190a1b2-0000-7000-8000-000000000001', 1_750_000_123_456);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(uuidv7Time(id)).toBe(1_750_000_123_456);
    expect(ankiLogId('0190a1b2-0000-7000-8000-000000000001', 1_750_000_123_456)).toBe(id);
    expect(ankiLogId('0190a1b2-0000-7000-8000-000000000002', 1_750_000_123_456)).not.toBe(id);
  });

  it('does not collide', () => {
    const ids = new Set<string>();
    for (let c = 0; c < 50; c++) for (let r = 0; r < 200; r++) ids.add(ankiLogId(`card-${c}`, 1_700_000_000_000 + r * 1000));
    expect(ids.size).toBe(50 * 200);
  });
});

describe('summarizeAnki', () => {
  it('counts notes, cards, answers and media, with three preview notes per type', () => {
    const s = summarizeAnki(collectionOf(sampleDeck()));
    expect(s).toMatchObject({ notes: 7, cards: 13, reviews: 22 - 4, mediaFiles: 2 });
    expect(s.noteTypes.map((n) => [n.name, n.noteCount, n.samples.length])).toEqual([
      ['Basic (and reversed card)', 6, 3],
      ['Cloze', 1, 1],
    ]);
    expect(s.noteTypes[0]!.mapping).toEqual({ term: 0, meaning: 1, sentence: 2 });
    expect(s.noteTypes[1]!.mapping).toBeNull();
  });
});

describe('planAnkiImport', () => {
  it('turns notes into notes and senses and keeps every card and answer accounted for', () => {
    const col = collectionOf(sampleDeck());
    const plan = planAnkiImport(col, mappingsOf(col), NOW);
    expect(plan.notes.map((n) => [n.term, n.senses.map((s) => s.meaning_tr)])).toEqual([
      ['reluctant', ['isteksiz, gönülsüz']],
      ['give up', ['vazgeçmek; bırakmak']],
      ['apple', ['elma']],
      ['bank', ['banka', 'kıyı (nehir)']],
      ['thorough', ['titiz, eksiksiz']],
    ]);
    const c = plan.counts;
    expect(c).toEqual({
      notes: 7,
      skippedNoteType: 1,
      skippedEmpty: 0,
      sameInFile: 0,
      cards: 13,
      cardsMapped: 11,
      cardsIgnored: 1,
      cardsMerged: 1,
      logs: 16,
      logsSkipped: 6,
      suspended: 2,
      media: 2,
    });
    expect(c.cardsMapped + c.cardsIgnored + c.cardsMerged).toBe(c.cards);
    expect(c.logs + c.logsSkipped).toBe(col.revlog.length);

    const reluctant = plan.notes[0]!;
    expect(reluctant.tags).toEqual(['adjectives', 'b2']);
    expect(reluctant.senses[0]).toMatchObject({ source_sentence: 'She was reluctant to leave.', span: [8, 17] });
    expect(reluctant.recognition!.logs.map((l) => l.rating)).toEqual([3, 3, 3, 1, 3, 4]);
    expect(reluctant.recognition!.logs.at(-1)!.duration_ms).toBe(60_000);
    expect(reluctant.recognition!.created_at).toBeLessThanOrEqual(reluctant.recognition!.logs[0]!.reviewed_at);
    expect(plan.notes[2]!.recognition!.suspended).toBe(true);
    const bank = plan.notes[3]!;
    expect(bank.senses[1]!.production!.logs).toHaveLength(1);
    expect(bank.senses[1]!.source_sentence).toBe('We sat on the river bank.');
  });

  it('leaves out note types the user turned off and empty notes', () => {
    const deck = sampleDeck();
    deck.notes[5]!.fields[1] = '<img src="x.png">';
    const col = collectionOf(deck);
    const plan = planAnkiImport(col, { ...mappingsOf(col), [String(BASIC_REVERSED.id)]: null }, NOW);
    expect(plan.notes).toHaveLength(0);
    expect(plan.counts.skippedNoteType).toBe(7);
    expect(plan.counts.cardsIgnored).toBe(13);
    const plan2 = planAnkiImport(col, mappingsOf(col), NOW);
    expect(plan2.counts.skippedEmpty).toBe(1);
  });

  it('counts the same term with the same meaning once', () => {
    const deck = sampleDeck();
    deck.notes[4]!.fields[1] = 'Banka';
    const col = collectionOf(deck);
    const plan = planAnkiImport(col, mappingsOf(col), NOW);
    expect(plan.counts.sameInFile).toBe(1);
    expect(plan.notes.find((n) => n.term === 'bank')!.senses).toHaveLength(1);
  });

  it('drops answers in the future', () => {
    const col = collectionOf(sampleDeck());
    const plan = planAnkiImport(col, mappingsOf(col), 1_750_000_000_000 + 4 * 86_400_000);
    expect(plan.counts.logs + plan.counts.logsSkipped).toBe(col.revlog.length);
    expect(plan.notes.flatMap((n) => n.recognition?.logs ?? []).every((l) => l.reviewed_at <= 1_750_000_000_000 + 4 * 86_400_000)).toBe(true);
  });

  it('plans 1 000 notes with 20 000 answers quickly', () => {
    const col = collectionOf(largeDeck(1000, 16));
    const t = performance.now();
    const plan = planAnkiImport(col, mappingsOf(col), NOW);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(plan.notes).toHaveLength(1000);
    expect(plan.counts.cardsMapped).toBe(2000);
    expect(plan.counts.logs).toBe(col.revlog.length);
  });
});

describe('matchLexiconSense', () => {
  it('links only a sense with the same Turkish meaning', () => {
    const senses = [
      { id: 'a', meaning_tr: 'banka' },
      { id: 'b', meaning_tr: 'kıyı, kenar' },
    ];
    expect(matchLexiconSense('kıyı', senses)?.id).toBe('b');
    expect(matchLexiconSense('Banka', senses)?.id).toBe('a');
    expect(matchLexiconSense('yığın', senses)).toBeNull();
    expect(matchLexiconSense('kıyı (nehir)', senses)?.id).toBe('b');
  });
});

describe('ankiProto', () => {
  it('round-trips the fields the reader needs', () => {
    const fields = readProtoFields(encodeProto([[1, 1], [3, 'x'.repeat(300)], [1, '{{Front}} çğü'], [2, '{{Back}}'], [9, 1_700_000_000_000]]));
    expect(protoNumber(fields, 1)).toBe(1);
    expect(fields.get(1)).toHaveLength(2);
    expect(protoString(readProtoFields(encodeProto([[1, '{{Front}} çğü'], [2, '{{Back}}']])), 1)).toBe('{{Front}} çğü');
    expect(protoString(fields, 2)).toBe('{{Back}}');
    expect(protoNumber(fields, 9)).toBe(1_700_000_000_000);
    expect(protoString(fields, 4)).toBe('');
    expect(() => readProtoFields(new Uint8Array([0x0a, 0x05, 0x41]))).toThrow();
  });
});
