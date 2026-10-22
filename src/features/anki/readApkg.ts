// Reads an Anki package (.apkg) into plain rows (domain/anki.ts AnkiCollection). Runs in the
// Web Worker (apkg.worker.ts) in the app and directly in tests; the three libraries are
// passed in so this file stays free of bundler-specific loading.
//
// Formats: collection.anki21b (Anki ≥ 2.1.50 "new format": zstd-compressed SQLite, schema 18
// with notetypes / fields / templates tables), collection.anki21 and collection.anki2 (schema
// 11, note types as JSON in col.models). New-format packages also carry a placeholder
// collection.anki2, so anki21b is read first.
import type JSZipType from 'jszip';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import type { AnkiCard, AnkiCollection, AnkiFormat, AnkiNote, AnkiNoteType, AnkiRevlog } from '@/domain/anki';
import { protoNumber, protoString, readProtoFields } from '@/domain/ankiProto';

export type ApkgErrorCode = 'not_apkg' | 'no_collection' | 'unreadable' | 'too_big';

export class ApkgError extends Error {
  readonly code: ApkgErrorCode;
  constructor(code: ApkgErrorCode, message: string = code) {
    super(message);
    this.name = 'ApkgError';
    this.code = code;
  }
}

export interface ApkgLibs {
  JSZip: typeof JSZipType;
  /** zstd decompression (fzstd's `decompress`). */
  zstd: (data: Uint8Array) => Uint8Array;
  SQL: SqlJsStatic;
}

/** Largest collection database accepted after decompression. */
export const MAX_COLLECTION_BYTES = 400 * 1024 * 1024;

const COLLECTIONS: [string, AnkiFormat][] = [
  ['collection.anki21b', 'anki21b'],
  ['collection.anki21', 'anki21'],
  ['collection.anki2', 'anki2'],
];

function rows(db: Database, sql: string): SqlValue[][] {
  const res = db.exec(sql);
  return res[0]?.values ?? [];
}

function hasTable(db: Database, name: string): boolean {
  const stmt = db.prepare("select 1 from sqlite_master where type = 'table' and name = ?");
  try {
    stmt.bind([name]);
    return stmt.step();
  } finally {
    stmt.free();
  }
}

const num = (v: SqlValue | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));
const str = (v: SqlValue | undefined): string =>
  typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : v == null ? '' : String(v);
const bytes = (v: SqlValue | undefined): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array());

interface LegacyModel {
  id?: number | string;
  name?: string;
  type?: number;
  flds?: { name?: string; ord?: number }[];
  tmpls?: { name?: string; ord?: number; qfmt?: string }[];
}

function legacyNoteTypes(db: Database): AnkiNoteType[] {
  const raw = str(rows(db, 'select models from col limit 1')[0]?.[0]);
  if (!raw) return [];
  let models: Record<string, LegacyModel>;
  try {
    models = JSON.parse(raw) as Record<string, LegacyModel>;
  } catch {
    throw new ApkgError('unreadable', 'col.models is not JSON');
  }
  return Object.entries(models).map(([key, m]) => ({
    id: String(m.id ?? key),
    name: m.name ?? '',
    kind: m.type === 1 ? 'cloze' : 'normal',
    fields: [...(m.flds ?? [])].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)).map((f) => f.name ?? ''),
    templates: (m.tmpls ?? []).map((t, i) => ({ ord: t.ord ?? i, name: t.name ?? '', front: t.qfmt ?? '' })),
  }));
}

function newNoteTypes(db: Database): AnkiNoteType[] {
  const fields = new Map<string, { ord: number; name: string }[]>();
  for (const [ntid, ord, name] of rows(db, 'select ntid, ord, name from fields')) {
    const key = String(ntid);
    const list = fields.get(key) ?? [];
    list.push({ ord: num(ord), name: str(name) });
    fields.set(key, list);
  }
  const templates = new Map<string, AnkiNoteType['templates']>();
  for (const [ntid, ord, name, config] of rows(db, 'select ntid, ord, name, config from templates')) {
    const key = String(ntid);
    const list = templates.get(key) ?? [];
    let front = '';
    try {
      front = protoString(readProtoFields(bytes(config)), 1);
    } catch {
      front = '';
    }
    list.push({ ord: num(ord), name: str(name), front });
    templates.set(key, list);
  }
  return rows(db, 'select id, name, config from notetypes').map(([id, name, config]) => {
    const key = String(id);
    let kind = 0;
    try {
      kind = protoNumber(readProtoFields(bytes(config)), 1);
    } catch {
      kind = 0;
    }
    return {
      id: key,
      name: str(name),
      kind: kind === 1 ? 'cloze' : 'normal',
      fields: (fields.get(key) ?? []).sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: templates.get(key) ?? [],
    };
  });
}

function schedulerVersion(db: Database, schema18: boolean): number {
  try {
    if (schema18 && hasTable(db, 'config')) {
      const v = rows(db, "select val from config where key = 'schedVer'")[0]?.[0];
      if (v !== undefined) return Number(JSON.parse(str(v))) || 2;
    }
    const conf = str(rows(db, 'select conf from col limit 1')[0]?.[0]);
    if (conf) {
      const parsed = JSON.parse(conf) as { schedVer?: number };
      if (typeof parsed.schedVer === 'number') return parsed.schedVer;
      return 1; // schema 11 without schedVer: Anki 2.0's scheduler
    }
  } catch {
    // fall through
  }
  return 2;
}

/** Parse an opened collection database. */
export function readCollection(db: Database, format: AnkiFormat, mediaFiles: number): AnkiCollection {
  if (!hasTable(db, 'notes') || !hasTable(db, 'cards')) throw new ApkgError('unreadable', 'not an Anki collection');
  const schema18 = hasTable(db, 'notetypes');
  const noteTypes = schema18 ? newNoteTypes(db) : legacyNoteTypes(db);
  const notes: AnkiNote[] = rows(db, 'select id, mid, tags, flds from notes order by id').map(([id, mid, tags, flds]) => ({
    id: num(id),
    mid: String(mid),
    tags: str(tags).split(/\s+/).filter(Boolean),
    fields: str(flds).split('\x1f'),
  }));
  const cards: AnkiCard[] = rows(db, 'select id, nid, ord, queue from cards order by id').map(([id, nid, ord, queue]) => ({
    id: num(id),
    nid: num(nid),
    ord: num(ord),
    queue: num(queue),
  }));
  const revlog: AnkiRevlog[] = hasTable(db, 'revlog')
    ? rows(db, 'select id, cid, ease, type, time from revlog order by id').map(([id, cid, ease, type, time]) => ({
        id: num(id),
        cid: num(cid),
        ease: num(ease),
        type: num(type),
        time: num(time),
      }))
    : [];
  return { format, schedVer: schedulerVersion(db, schema18), noteTypes, notes, cards, revlog, mediaFiles };
}

/** Read an .apkg (or .colpkg) archive. */
export async function readApkg(data: Uint8Array, libs: ApkgLibs): Promise<AnkiCollection> {
  let zip: JSZipType;
  try {
    zip = await libs.JSZip.loadAsync(data);
  } catch {
    throw new ApkgError('not_apkg', 'not a zip archive');
  }
  const found = COLLECTIONS.find(([name]) => zip.file(name));
  if (!found) throw new ApkgError('no_collection', 'no collection file in the archive');
  const [name, format] = found;
  let db_bytes = await zip.file(name)!.async('uint8array');
  if (format === 'anki21b') {
    try {
      db_bytes = libs.zstd(db_bytes);
    } catch {
      throw new ApkgError('unreadable', 'zstd');
    }
  }
  if (db_bytes.length > MAX_COLLECTION_BYTES) throw new ApkgError('too_big');
  const mediaFiles = Object.keys(zip.files).filter((n) => /^\d+$/.test(n)).length;
  let db: Database;
  try {
    db = new libs.SQL.Database(db_bytes);
  } catch {
    throw new ApkgError('unreadable', 'sqlite');
  }
  try {
    return readCollection(db, format, mediaFiles);
  } catch (e) {
    if (e instanceof ApkgError) throw e;
    throw new ApkgError('unreadable', e instanceof Error ? e.message : String(e));
  } finally {
    db.close();
  }
}
