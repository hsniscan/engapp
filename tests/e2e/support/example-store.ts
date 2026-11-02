// In-memory stand-in for public.lexicon_examples in the Playwright fake backend. Since v0.5.2
// (ADR 0061) the app never asks for sentences: they are produced once in bulk and shipped, so
// a test "ships" rows here with add() and the client pulls them (lexicon_examples_pull).

import type { LevelBand, LexiconExampleRow } from '../../../supabase/functions/_shared/examples-contracts.ts';

export interface ShippedExample {
  sense_id: string;
  context: string;
  level_band: LevelBand;
  text_en: string;
  span: [number, number];
  translations: Record<string, string>;
}

export class MemoryExampleStore {
  rows: (LexiconExampleRow & { seq: number })[] = [];
  private seq = 0;

  /** Ships sentences (one sense + text is stored once, like UNIQUE (sense_id, text_key)). */
  add(items: ShippedExample[]): LexiconExampleRow[] {
    const out: LexiconExampleRow[] = [];
    for (const it of items) {
      if (this.rows.some((r) => r.sense_id === it.sense_id && r.text_en === it.text_en)) continue;
      this.seq++;
      const row = {
        ...it,
        id: `ex-${String(this.seq).padStart(4, '0')}`,
        translations: { ...it.translations },
        status: 'active' as const,
        updated_at: 1_761_000_000_000 + this.seq,
        seq: this.seq,
      };
      this.rows.push(row);
      const { seq: _s, ...pub } = row;
      out.push(structuredClone(pub));
    }
    return out;
  }

  /** Rows with server_seq > since, in order (lexicon_examples_pull without the user filter). */
  pull(since: number, limit = 500): { rows: LexiconExampleRow[]; next_seq: number; has_more: boolean } {
    const all = this.rows.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return {
      rows: page.map(({ seq: _s, ...r }) => structuredClone(r)),
      next_seq: page.length ? page[page.length - 1]!.seq : since,
      has_more: all.length > limit,
    };
  }

  /** Active rows of these senses, whatever the cursor (lexicon_examples_find). */
  find(senseIds: string[]): LexiconExampleRow[] {
    const ids = new Set(senseIds.slice(0, 200));
    return this.rows.filter((r) => ids.has(r.sense_id) && r.status === 'active').map(({ seq: _s, ...r }) => structuredClone(r));
  }
}
