// Builds small Anki packages for tests and for the committed fixtures
// (scripts/anki-fixtures.ts → tests/fixtures/anki/). Our own data only: no third-party decks.
// The SQLite layout follows Anki's schema 11 (collection.anki2 / .anki21) and schema 18
// (collection.anki21b, zstd-compressed, note types in protobuf-config tables). Only the
// columns the importer reads carry meaningful values; the rest hold Anki's defaults.
import type JSZipType from 'jszip';
import type { Database, SqlJsStatic } from 'sql.js';
import type { AnkiCollection, AnkiFormat } from '../../../domain/anki.ts';
import { encodeProto } from '../../../domain/ankiProto.ts';

export interface FixtureRevlog {
  /** Review time, ms since the epoch. */
  id: number;
  ease: number;
  /** 0 learn, 1 review, 2 relearn, 3 cram, 4 manual. */
  type: number;
  /** Answer time in ms. */
  time?: number;
}

export interface FixtureCard {
  id: number;
  ord: number;
  /** -1 suspended, 0 new, 2 review. */
  queue?: number;
  revlog?: FixtureRevlog[];
}

export interface FixtureNote {
  id: number;
  mid: number;
  fields: string[];
  tags?: string[];
  cards: FixtureCard[];
}

export interface FixtureNoteType {
  id: number;
  name: string;
  kind?: 'normal' | 'cloze';
  fields: string[];
  templates: { name: string; front: string; back?: string }[];
}

export interface FixtureDeck {
  noteTypes: FixtureNoteType[];
  notes: FixtureNote[];
  /** Written to col.conf / the config table (default 2). */
  schedVer?: number;
  /** Media files by archive entry name ("0", "1", …). */
  media?: Record<string, { name: string; data: Uint8Array }>;
}

export interface BuildLibs {
  JSZip: typeof JSZipType;
  SQL: SqlJsStatic;
  /** zstd compression (node:zlib zstdCompressSync in tests and the script); anki21b only. */
  zstdCompress?: (data: Uint8Array) => Uint8Array;
}

const DECK_ID = 1;
const NOW_S = 1_760_000_000;

const NOTES_SQL = `
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);`;

const COL_SQL = `CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);`;

function fillRows(db: Database, deck: FixtureDeck): void {
  const note = db.prepare('insert into notes values (?,?,?,?,?,?,?,?,?,?,?)');
  const card = db.prepare('insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const rev = db.prepare('insert into revlog values (?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (const n of deck.notes) {
    note.run([n.id, `g${n.id}`, n.mid, NOW_S, -1, n.tags?.length ? ` ${n.tags.join(' ')} ` : '', n.fields.join('\x1f'), n.fields[0] ?? '', 0, 0, '']);
    for (const c of n.cards) {
      const reviewed = (c.revlog?.length ?? 0) > 0;
      const queue = c.queue ?? (reviewed ? 2 : 0);
      card.run([c.id, n.id, DECK_ID, c.ord, NOW_S, -1, reviewed ? 2 : 0, queue, reviewed ? 100 : n.id % 100000, reviewed ? 10 : 0, reviewed ? 2500 : 0, c.revlog?.length ?? 0, 0, 0, 0, 0, 0, '']);
      for (const r of c.revlog ?? []) rev.run([r.id, c.id, -1, r.ease, 1, 0, 2500, r.time ?? 4000, r.type]);
    }
  }
  db.exec('COMMIT');
  note.free();
  card.free();
  rev.free();
}

function legacyModels(deck: FixtureDeck): string {
  const models: Record<string, unknown> = {};
  for (const nt of deck.noteTypes) {
    models[String(nt.id)] = {
      id: nt.id,
      name: nt.name,
      type: nt.kind === 'cloze' ? 1 : 0,
      mod: NOW_S,
      usn: -1,
      sortf: 0,
      did: DECK_ID,
      flds: nt.fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20 })),
      tmpls: nt.templates.map((t, ord) => ({ name: t.name, ord, qfmt: t.front, afmt: t.back ?? '{{FrontSide}}<hr id=answer>', did: null })),
      css: '.card { font-family: arial; }',
      latexPre: '',
      latexPost: '',
      tags: [],
      vers: [],
      req: [],
    };
  }
  return JSON.stringify(models);
}

const DECKS_JSON = JSON.stringify({
  [DECK_ID]: { id: DECK_ID, name: 'Default', mod: NOW_S, usn: -1, collapsed: false, dyn: 0, conf: 1, desc: '' },
});

function schema11(SQL: SqlJsStatic, deck: FixtureDeck, ver: number): Uint8Array {
  const db = new SQL.Database();
  db.exec(COL_SQL + NOTES_SQL);
  const conf = JSON.stringify({ schedVer: deck.schedVer ?? 2, nextPos: 1, curDeck: DECK_ID });
  db.run('insert into col values (1,?,?,?,?,0,0,0,?,?,?,?,?)', [NOW_S, NOW_S * 1000, NOW_S * 1000, ver, conf, legacyModels(deck), DECKS_JSON, '{}', '{}']);
  fillRows(db, deck);
  const out = db.export();
  db.close();
  return out;
}

function schema18(SQL: SqlJsStatic, deck: FixtureDeck): Uint8Array {
  const db = new SQL.Database();
  db.exec(
    COL_SQL +
      NOTES_SQL +
      `CREATE TABLE notetypes (id integer primary key, name text not null, mtime_secs integer not null, usn integer not null, config blob not null);
       CREATE TABLE fields (ntid integer not null, ord integer not null, name text not null, config blob not null, primary key (ntid, ord));
       CREATE TABLE templates (ntid integer not null, ord integer not null, name text not null, mtime_secs integer not null, usn integer not null, config blob not null, primary key (ntid, ord));
       CREATE TABLE config (KEY text not null primary key, usn integer not null, mtime_secs integer not null, val blob not null);
       CREATE TABLE decks (id integer primary key, name text not null, mtime_secs integer not null, usn integer not null, common blob not null, kind blob not null);`,
  );
  db.run("insert into col values (1,?,?,?,18,0,0,0,'','','','','')", [NOW_S, NOW_S * 1000, NOW_S * 1000]);
  db.run("insert into config values ('schedVer', 0, ?, ?)", [NOW_S, new TextEncoder().encode(String(deck.schedVer ?? 2))]);
  db.run("insert into decks values (?, 'Default', ?, 0, ?, ?)", [DECK_ID, NOW_S, new Uint8Array(), new Uint8Array()]);
  for (const nt of deck.noteTypes) {
    db.run('insert into notetypes values (?,?,?,0,?)', [nt.id, nt.name, NOW_S, encodeProto([[1, nt.kind === 'cloze' ? 1 : 0], [3, '.card { font-family: arial; }']])]);
    nt.fields.forEach((name, ord) => db.run('insert into fields values (?,?,?,?)', [nt.id, ord, name, encodeProto([[3, 'Arial'], [4, 20]])]));
    nt.templates.forEach((t, ord) =>
      db.run('insert into templates values (?,?,?,?,0,?)', [nt.id, ord, t.name, NOW_S, encodeProto([[1, t.front], [2, t.back ?? '{{FrontSide}}<hr id=answer>']])]),
    );
  }
  fillRows(db, deck);
  const out = db.export();
  db.close();
  return out;
}

/** The note a new-format package carries in collection.anki2 for Anki versions that cannot read it. */
const PLACEHOLDER: FixtureDeck = {
  noteTypes: [{ id: 1, name: 'Basic', fields: ['Front', 'Back'], templates: [{ name: 'Card 1', front: '{{Front}}' }] }],
  notes: [{ id: 1_700_000_000_000, mid: 1, fields: ['Please update to the latest Anki version, then import the .colpkg/.apkg file again.', ''], cards: [{ id: 1_700_000_000_000, ord: 0 }] }],
};

/** Build an .apkg in one of the three collection formats. */
export async function buildApkg(deck: FixtureDeck, format: AnkiFormat, libs: BuildLibs): Promise<Uint8Array> {
  const zip = new libs.JSZip();
  // A fixed date keeps the committed fixtures byte-for-byte reproducible.
  const add = (name: string, data: Uint8Array | string) => zip.file(name, data, { date: new Date(Date.UTC(2026, 0, 1)) });
  const media = deck.media ?? {};
  const mediaMap = Object.fromEntries(Object.entries(media).map(([k, v]) => [k, v.name]));
  if (format === 'anki21b') {
    if (!libs.zstdCompress) throw new Error('anki21b needs zstdCompress');
    add('collection.anki21b', libs.zstdCompress(schema18(libs.SQL, deck)));
    add('collection.anki2', schema11(libs.SQL, PLACEHOLDER, 11));
    // New-format media index: zstd-compressed protobuf (entries: field 1 = name).
    const entries = Object.values(mediaMap).map((name) => encodeProto([[1, name]]));
    add('media', libs.zstdCompress(encodeProto(entries.map((e) => [1, e] as [number, Uint8Array]))));
    add('meta', encodeProto([[1, 3]]));
  } else if (format === 'anki21') {
    add('collection.anki21', schema11(libs.SQL, deck, 11));
    add('collection.anki2', schema11(libs.SQL, PLACEHOLDER, 11));
    add('media', JSON.stringify(mediaMap));
  } else {
    add('collection.anki2', schema11(libs.SQL, deck, 11));
    add('media', JSON.stringify(mediaMap));
  }
  for (const [entry, file] of Object.entries(media)) add(entry, file.data);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------- sample decks

export const BASIC_REVERSED: FixtureNoteType = {
  id: 1_600_000_000_001,
  name: 'Basic (and reversed card)',
  fields: ['Front', 'Back', 'Example'],
  templates: [
    { name: 'Card 1', front: '{{Front}}' },
    { name: 'Card 2', front: '{{Back}}' },
  ],
};

export const CLOZE: FixtureNoteType = {
  id: 1_600_000_000_002,
  name: 'Cloze',
  kind: 'cloze',
  fields: ['Text', 'Back Extra'],
  templates: [{ name: 'Cloze', front: '{{cloze:Text}}' }],
};

const DAY = 86_400_000;

/**
 * The committed fixture deck: 6 notes of a basic-and-reversed type (one with an image and a
 * sound, one suspended, one duplicate term, one new) and one cloze note (not imported).
 */
export function sampleDeck(base = 1_750_000_000_000): FixtureDeck {
  const id = (n: number) => base + n * 1000;
  const learned = (cardId: number, start: number): FixtureRevlog[] => [
    { id: start, ease: 3, type: 0, time: 5200 },
    { id: start + 10 * 60_000, ease: 3, type: 0, time: 3100 },
    { id: start + 1 * DAY, ease: 3, type: 1, time: 2800 },
    { id: start + 4 * DAY, ease: 1, type: 1, time: 9000 },
    { id: start + 4 * DAY + 10 * 60_000, ease: 3, type: 2, time: 4000 },
    { id: start + 9 * DAY, ease: 4, type: 1, time: 75_000 },
    { id: start + 20 * DAY, ease: 3, type: 3, time: 2000 }, // filtered deck: skipped
    { id: start + 21 * DAY + (cardId % 7), ease: 0, type: 4, time: 0 }, // manual: skipped
  ];
  return {
    noteTypes: [BASIC_REVERSED, CLOZE],
    notes: [
      {
        id: id(1),
        mid: BASIC_REVERSED.id,
        fields: ['reluctant', 'isteksiz, gönülsüz', 'She was <b>reluctant</b> to leave.'],
        tags: ['adjectives', 'b2'],
        cards: [
          { id: id(1) + 1, ord: 0, revlog: learned(1, base + 1 * DAY) },
          { id: id(1) + 2, ord: 1, revlog: [{ id: base + 2 * DAY + 777, ease: 2, type: 0, time: 6000 }] },
        ],
      },
      {
        id: id(2),
        mid: BASIC_REVERSED.id,
        fields: ['give up', 'vazgeçmek<br>bırakmak', ''],
        cards: [
          { id: id(2) + 1, ord: 0, revlog: learned(2, base + 3 * DAY) },
          { id: id(2) + 2, ord: 1 },
        ],
      },
      {
        id: id(3),
        mid: BASIC_REVERSED.id,
        fields: ['apple <img src="apple.jpg">', 'elma [sound:apple.mp3]', ''],
        tags: ['food'],
        cards: [
          { id: id(3) + 1, ord: 0, queue: -1, revlog: [{ id: base + 5 * DAY + 333, ease: 3, type: 0, time: 3000 }] },
          { id: id(3) + 2, ord: 1, queue: -1 },
        ],
      },
      {
        id: id(4),
        mid: BASIC_REVERSED.id,
        fields: ['bank', 'banka', 'I went to the bank.'],
        cards: [
          { id: id(4) + 1, ord: 0, revlog: [{ id: base + 6 * DAY, ease: 3, type: 0, time: 3000 }] },
          { id: id(4) + 2, ord: 1 },
        ],
      },
      {
        id: id(5),
        mid: BASIC_REVERSED.id,
        fields: ['bank', 'kıyı (nehir)', 'We sat on the river bank.'],
        cards: [
          { id: id(5) + 1, ord: 0, revlog: [{ id: base + 7 * DAY + 1234, ease: 1, type: 0, time: 3000 }] },
          { id: id(5) + 2, ord: 1, revlog: [{ id: base + 7 * DAY + 5000, ease: 3, type: 0, time: 3000 }] },
        ],
      },
      {
        id: id(6),
        mid: BASIC_REVERSED.id,
        fields: ['thorough', 'titiz, eksiksiz', ''],
        cards: [
          { id: id(6) + 1, ord: 0 },
          { id: id(6) + 2, ord: 1 },
        ],
      },
      {
        id: id(7),
        mid: CLOZE.id,
        fields: ['The {{c1::weather}} is nice.', ''],
        cards: [{ id: id(7) + 1, ord: 0, revlog: [{ id: base + 8 * DAY, ease: 3, type: 0, time: 3000 }] }],
      },
    ],
    media: {
      '0': { name: 'apple.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
      '1': { name: 'apple.mp3', data: new Uint8Array([0x49, 0x44, 0x33]) },
    },
  };
}

/**
 * A large deck for the performance test: `notes` basic-and-reversed notes, each with a
 * recognition card of ~`reviewsPerNote` answers and a production card with a few.
 */
export function largeDeck(notes: number, reviewsPerNote: number, base = 1_700_000_000_000): FixtureDeck {
  const out: FixtureNote[] = [];
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < notes; i++) {
    const noteId = base + i * 10_000;
    const start = noteId + DAY;
    const rec: FixtureRevlog[] = [];
    let t = start;
    let gap = DAY;
    for (let r = 0; r < reviewsPerNote; r++) {
      const ease = rnd() < 0.1 ? 1 : rnd() < 0.15 ? 2 : rnd() < 0.9 ? 3 : 4;
      rec.push({ id: t, ease, type: r < 2 ? 0 : 1, time: Math.round(2000 + rnd() * 8000) });
      gap = ease === 1 ? DAY : gap * 2;
      t += Math.min(gap, 60 * DAY) + Math.round(rnd() * 3_600_000);
    }
    const prodReviews = Math.max(0, Math.floor(reviewsPerNote / 4));
    const prod: FixtureRevlog[] = Array.from({ length: prodReviews }, (_, r) => ({
      id: start + 5_000 + r * 3 * DAY,
      ease: 3,
      type: r < 2 ? 0 : 1,
      time: 4000,
    }));
    out.push({
      id: noteId,
      mid: BASIC_REVERSED.id,
      fields: [`word${i}`, `kelime ${i}`, ''],
      tags: [`set${i % 10}`],
      cards: [
        { id: noteId + 1, ord: 0, revlog: rec },
        { id: noteId + 2, ord: 1, revlog: prod },
      ],
    });
  }
  return { noteTypes: [BASIC_REVERSED], notes: out };
}

/** The collection readApkg returns for a fixture deck, without building the archive. */
export function collectionOf(deck: FixtureDeck, format: AnkiFormat = 'anki21'): AnkiCollection {
  return {
    format,
    schedVer: deck.schedVer ?? 2,
    noteTypes: deck.noteTypes.map((nt) => ({
      id: String(nt.id),
      name: nt.name,
      kind: nt.kind ?? 'normal',
      fields: nt.fields,
      templates: nt.templates.map((t, ord) => ({ ord, name: t.name, front: t.front })),
    })),
    notes: deck.notes.map((n) => ({ id: n.id, mid: String(n.mid), tags: n.tags ?? [], fields: n.fields })),
    cards: deck.notes.flatMap((n) =>
      n.cards.map((c) => ({ id: c.id, nid: n.id, ord: c.ord, queue: c.queue ?? ((c.revlog?.length ?? 0) > 0 ? 2 : 0) })),
    ),
    revlog: deck.notes
      .flatMap((n) => n.cards.flatMap((c) => (c.revlog ?? []).map((r) => ({ id: r.id, cid: c.id, ease: r.ease, type: r.type, time: r.time ?? 4000 }))))
      .sort((a, b) => a.id - b.id),
    mediaFiles: Object.keys(deck.media ?? {}).length,
  };
}
