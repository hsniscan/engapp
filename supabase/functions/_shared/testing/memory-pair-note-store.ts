// In-memory PairNoteStore with the semantics of the SQL side (unique (pair, kind, term,
// sense, content key), active rows only from find). Tests and the Playwright fake backend only.

import type {
  LexiconPairNoteRow,
  NewPairNote,
  PairNoteKind,
  PairNoteStore,
} from '../pair-notes.ts';

type Stored = LexiconPairNoteRow & { model: string | null; prompt_version: string | null };

export class MemoryPairNoteStore implements PairNoteStore {
  rows: Stored[] = [];
  calls: string[] = [];
  private seq = 0;

  async findNotes(senseIds: string[], kind: PairNoteKind): Promise<LexiconPairNoteRow[]> {
    this.calls.push('findNotes');
    const ids = new Set(senseIds);
    return this.rows
      .filter((r) => r.sense_id !== null && ids.has(r.sense_id) && r.kind === kind && r.status === 'active')
      .map(pub);
  }

  async insertNotes(items: NewPairNote[]): Promise<LexiconPairNoteRow[]> {
    this.calls.push('insertNotes');
    const out: LexiconPairNoteRow[] = [];
    for (const it of items) {
      const dup = this.rows.some(
        (r) =>
          r.lang_pair === it.lang_pair &&
          r.kind === it.kind &&
          r.term_norm === it.term_norm &&
          r.sense_id === it.sense_id &&
          r.content_key === it.content_key,
      );
      if (dup) continue;
      this.seq++;
      const row: Stored = {
        id: `pn-${String(this.seq).padStart(4, '0')}`,
        term_norm: it.term_norm,
        sense_id: it.sense_id,
        lang_pair: it.lang_pair,
        kind: it.kind,
        content_key: it.content_key,
        content: structuredClone(it.content),
        curated: false,
        status: 'active',
        updated_at: 1_761_000_000_000 + this.seq,
        model: it.model,
        prompt_version: it.prompt_version,
      };
      this.rows.push(row);
      out.push(pub(row));
    }
    return out;
  }
}

function pub(r: Stored): LexiconPairNoteRow {
  const { model: _m, prompt_version: _p, ...rest } = r;
  return structuredClone(rest);
}
