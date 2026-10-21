// In-memory AiStore with the same semantics as the SQL functions (unique lemma_norm,
// unique (term_id, pos, gloss_key), insert-or-get with the Turkish-meaning re-check, atomic
// daily counter). Tests only.

import type { LexiconEntry } from '../contracts.ts';
import { isSameMeaningTr } from '../text.ts';
import type {
  AiStore,
  CachedChunk,
  LexiconUpsertItem,
  LexiconUpsertResult,
  LexTerm,
  UsageResult,
} from '../store.ts';

interface Term {
  id: string;
  lemma: string;
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
}
interface Sense {
  id: string;
  term_id: string;
  pos: string;
  gloss_en: string;
  gloss_key: string;
  meaning_tr: string;
  ipa: string | null;
  model: string | null;
  updated_at: number;
}

export class MemoryAiStore implements AiStore {
  terms = new Map<string, Term>();
  senses = new Map<string, Sense>();
  cache = new Map<string, CachedChunk>();
  usage = new Map<string, number>();
  calls: string[] = [];
  private seq = 0;

  private id(prefix: string) {
    this.seq++;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  async getChunkCache(userId: string, chunkHash: string, promptVersion: string, level: string) {
    this.calls.push('getChunkCache');
    return this.cache.get([userId, chunkHash, promptVersion, level].join('|')) ?? null;
  }

  async putChunkCache(
    userId: string,
    chunkHash: string,
    promptVersion: string,
    level: string,
    result: unknown,
    model: string | null,
  ) {
    this.calls.push('putChunkCache');
    this.cache.set([userId, chunkHash, promptVersion, level].join('|'), {
      result: structuredClone(result),
      model,
    });
  }

  async consumeAi(userId: string, limit: number): Promise<UsageResult> {
    this.calls.push('consumeAi');
    const used = this.usage.get(userId) ?? 0;
    if (used + 1 > limit) return { allowed: false, used, limit };
    this.usage.set(userId, used + 1);
    return { allowed: true, used: used + 1, limit };
  }

  async findTerms(norms: string[]): Promise<LexTerm[]> {
    this.calls.push('findTerms');
    const set = new Set(norms);
    return [...this.terms.values()]
      .filter((t) => set.has(t.lemma_norm))
      .map((t) => ({
        term_id: t.id,
        lemma: t.lemma,
        lemma_norm: t.lemma_norm,
        term_type: t.term_type,
        senses: [...this.senses.values()]
          .filter((s) => s.term_id === t.id)
          .map((s) => ({
            id: s.id,
            pos: s.pos,
            gloss_en: s.gloss_en,
            gloss_key: s.gloss_key,
            meaning_tr: s.meaning_tr,
            ipa: s.ipa,
            updated_at: s.updated_at,
          })),
      }));
  }

  async upsertLexicon(items: LexiconUpsertItem[]): Promise<LexiconUpsertResult[]> {
    this.calls.push('upsertLexicon');
    return this.upsertSync(items);
  }

  upsertSync(items: LexiconUpsertItem[]): LexiconUpsertResult[] {
    return items.map((it) => {
      if (it.lemma_norm !== it.lemma_norm.toLowerCase().trim())
        throw new Error('lemma_norm not normalised');
      let term = [...this.terms.values()].find((t) => t.lemma_norm === it.lemma_norm);
      const termCreated = !term;
      if (!term) {
        term = {
          id: this.id('term'),
          lemma: it.lemma,
          lemma_norm: it.lemma_norm,
          term_type: it.term_type,
        };
        this.terms.set(term.id, term);
      }
      if (!it.gloss_key)
        return {
          term_id: term.id,
          sense_id: null,
          term_created: termCreated,
          sense_created: false,
        };
      // Same as lexicon_upsert(): the same gloss_key, else (under the lexicon lock) an
      // older sense with the same pos and an overlapping Turkish meaning.
      const ofTerm = [...this.senses.values()].filter((s) => s.term_id === term!.id);
      let sense =
        ofTerm.find((s) => s.pos === it.pos && s.gloss_key === it.gloss_key) ??
        ofTerm.find((s) => s.pos === it.pos && isSameMeaningTr(s.meaning_tr, it.meaning_tr));
      const senseCreated = !sense;
      if (!sense) {
        sense = {
          id: this.id('sense'),
          term_id: term.id,
          pos: it.pos!,
          gloss_en: it.gloss_en!,
          gloss_key: it.gloss_key,
          meaning_tr: it.meaning_tr!,
          ipa: it.ipa ?? null,
          model: it.model ?? null,
          updated_at: 1_761_000_000_000 + this.seq,
        };
        this.senses.set(sense.id, sense);
      }
      return {
        term_id: term.id,
        sense_id: sense.id,
        term_created: termCreated,
        sense_created: senseCreated,
      };
    });
  }

  async getEntries(ids: string[]): Promise<LexiconEntry[]> {
    this.calls.push('getEntries');
    return ids
      .map((id) => this.senses.get(id))
      .filter((s): s is Sense => !!s)
      .map((s) => {
        const t = this.terms.get(s.term_id)!;
        return {
          id: s.id,
          term_id: t.id,
          lemma: t.lemma,
          lemma_norm: t.lemma_norm,
          term_type: t.term_type,
          pos: s.pos,
          gloss_en: s.gloss_en,
          meaning_tr: s.meaning_tr,
          ipa: s.ipa,
          updated_at: s.updated_at,
        };
      });
  }

  /** Seeds a sense directly (test setup). */
  seed(
    lemma: string,
    pos: string,
    gloss_en: string,
    gloss_key: string,
    meaning_tr: string,
    ipa: string | null = null,
  ) {
    return this.upsertSync([
      {
        lemma,
        lemma_norm: lemma.toLowerCase(),
        term_type: lemma.includes(' ') ? 'phrase' : 'word',
        pos,
        gloss_en,
        gloss_key,
        meaning_tr,
        ipa,
      },
    ])[0]!;
  }
}
