// In-memory ExampleStore with the semantics of the SQL side (unique (sense_id, text_key),
// active rows only from find). Tests and the Playwright fake backend only.

import type { LevelBand, LexiconExampleRow } from '../examples-contracts.ts';
import type { ExampleStore, NewExample } from '../examples-store.ts';
import { exampleTextKey } from '../examples.ts';

export class MemoryExampleStore implements ExampleStore {
  rows: (LexiconExampleRow & { model: string | null; prompt_version: string; seq: number })[] = [];
  calls: string[] = [];
  private seq = 0;

  async findExamples(senseIds: string[], band: LevelBand | null): Promise<LexiconExampleRow[]> {
    this.calls.push('findExamples');
    const ids = new Set(senseIds);
    return this.rows
      .filter((r) => ids.has(r.sense_id) && r.status === 'active' && (band === null || r.level_band === band))
      .map(({ model: _m, prompt_version: _p, seq: _s, ...r }) => structuredClone(r));
  }

  async insertExamples(items: NewExample[]): Promise<LexiconExampleRow[]> {
    this.calls.push('insertExamples');
    const out: LexiconExampleRow[] = [];
    for (const it of items) {
      const key = exampleTextKey(it.text_en);
      if (this.rows.some((r) => r.sense_id === it.sense_id && exampleTextKey(r.text_en) === key)) continue;
      this.seq++;
      const row = {
        id: `ex-${String(this.seq).padStart(4, '0')}`,
        sense_id: it.sense_id,
        context: it.context,
        level_band: it.level_band,
        text_en: it.text_en,
        span: it.span,
        translations: { ...it.translations },
        status: 'active' as const,
        updated_at: 1_761_000_000_000 + this.seq,
        model: it.model,
        prompt_version: it.prompt_version,
        seq: this.seq,
      };
      this.rows.push(row);
      const { model: _m, prompt_version: _p, seq: _s, ...pub } = row;
      out.push(structuredClone(pub));
    }
    return out;
  }

  /** Rows with server_seq > since, in order (lexicon_examples_pull without the user filter). */
  pull(since: number, limit = 500): { rows: LexiconExampleRow[]; next_seq: number; has_more: boolean } {
    const all = this.rows.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return {
      rows: page.map(({ model: _m, prompt_version: _p, seq: _s, ...r }) => structuredClone(r)),
      next_seq: page.length ? page[page.length - 1]!.seq : since,
      has_more: all.length > limit,
    };
  }
}
