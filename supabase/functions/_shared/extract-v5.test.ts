// @vitest-environment node
// extract-v5 (v0.3 İP2, decision 0020): topics per chunk and false friends per new sense in
// the same call; false friends stored in the shared pair notes.
import { describe, expect, it, vi } from 'vitest';
import type { AiProvider } from './ai-provider.ts';
import { EXTRACT_PROMPT_VERSION, extractResponse } from './contracts.ts';
import { cleanFalseFriend, runExtract, sha256Hex, type ExtractDeps } from './extract.ts';
import { EXTRACT_RESPONSE_SCHEMA, EXTRACT_SYSTEM_PROMPT } from './prompts.ts';
import { cleanChunkTopics, EXTRACT_TOPIC_KEYS } from './topics-contract.ts';
import { CHUNK, GOOD_EXTRACT } from './testing/gemini-fixtures.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { MemoryPairNoteStore } from './testing/memory-pair-note-store.ts';
import { EXTRACT_V5 } from './testing/v03-fixtures.ts';

function scripted(...outputs: unknown[]) {
  let i = 0;
  const provider: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async () => ({
      data: outputs[Math.min(i++, outputs.length - 1)],
      model: 'fake-model',
      attempts: 1,
      usage: null,
    })),
  };
  return provider;
}

async function body(text = CHUNK, level = 'B1') {
  return { text, chunk_hash: await sha256Hex(text), level };
}

function deps(store: MemoryAiStore, provider: AiProvider, pairNotes?: MemoryPairNoteStore, userId = 'u1'): ExtractDeps {
  return { userId, store, provider: () => provider, dailyLimit: 200, ...(pairNotes ? { pairNotes } : {}) };
}

describe('extract-v5', () => {
  it('is the current prompt and asks for topics and false friends in the same call', () => {
    expect(EXTRACT_PROMPT_VERSION).toBe('extract-v5');
    expect(EXTRACT_SYSTEM_PROMPT).toContain(`from this list: ${EXTRACT_TOPIC_KEYS.join(', ')}`);
    expect(EXTRACT_SYSTEM_PROMPT).toContain('- false_friend_tr: null in most cases.');
    expect(EXTRACT_RESPONSE_SCHEMA.required).toEqual(['topics', 'candidates']);
    expect(Object.keys(EXTRACT_RESPONSE_SCHEMA.properties)[0]).toBe('topics');
    expect(EXTRACT_RESPONSE_SCHEMA.properties.candidates.items.required).toContain('false_friend_tr');
  });

  it('returns the chunk topics and stores a checked false friend in the shared pair notes', async () => {
    const store = new MemoryAiStore();
    const pairNotes = new MemoryPairNoteStore();
    const provider = scripted(EXTRACT_V5);
    const res = await runExtract(await body(), deps(store, provider, pairNotes));
    expect(extractResponse.parse(res)).toBeTruthy();
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    // Unknown keys dropped, "Daily life" read as daily_life, at most two.
    expect(res.topics).toEqual(['daily_life', 'business']);
    // Only "bank" (river) ~ "banka" passes: "bırakmak" is the meaning itself, "dönemeç" does not sound like "turn down".
    expect(pairNotes.rows).toHaveLength(1);
    const bank = res.candidates.find((c) => c.term === 'bank')!;
    expect(pairNotes.rows[0]).toMatchObject({
      kind: 'false_friend',
      lang_pair: 'en-tr',
      term_norm: 'bank',
      sense_id: bank.lexicon.id,
      content_key: 'banka',
      model: 'fake-model',
      prompt_version: 'extract-v5',
      curated: false,
      content: {
        tr_word: 'banka',
        en_meaning_tr: 'kıyı',
        tr_meaning_tr: 'para kurumu',
        tr_meaning_en: null,
        strength: 'partial',
        note_tr: "Bu anlamda 'bank' kıyı demektir, banka değil.",
      },
    });
    expect(bank.false_friend).toMatchObject({ id: pairNotes.rows[0]!.id, tr_word: 'banka', strength: 'partial' });
    expect(res.candidates.filter((c) => c.false_friend).map((c) => c.term)).toEqual(['bank']);
    // The user's sentence never goes into the shared note.
    expect(JSON.stringify(pairNotes.rows)).not.toContain('Sunday');
  });

  it('a chunk cache hit returns the same topics and false friends without a model call', async () => {
    const store = new MemoryAiStore();
    const pairNotes = new MemoryPairNoteStore();
    const provider = scripted(EXTRACT_V5);
    const first = await runExtract(await body(), deps(store, provider, pairNotes));
    const hit = await runExtract(await body(), deps(store, provider, pairNotes));
    expect(hit.cache_hit).toBe(true);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(hit.topics).toEqual(first.topics);
    expect(hit.candidates.map((c) => c.false_friend)).toEqual(first.candidates.map((c) => c.false_friend));
  });

  it('an extract-v4 style answer (no topics, no false_friend_tr) still works', async () => {
    const store = new MemoryAiStore();
    const pairNotes = new MemoryPairNoteStore();
    const res = await runExtract(await body(), deps(store, scripted(GOOD_EXTRACT), pairNotes));
    expect(res.topics).toEqual([]);
    expect(res.candidates).toHaveLength(3);
    expect(res.candidates.every((c) => c.false_friend === null)).toBe(true);
    expect(pairNotes.rows).toHaveLength(0);
  });

  it('a known sense never writes a false friend', async () => {
    const store = new MemoryAiStore();
    const pairNotes = new MemoryPairNoteStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const known = {
      topics: ['nature'],
      candidates: [
        {
          ...GOOD_EXTRACT.candidates[1]!,
          known_sense: 's1',
          pos: null,
          gloss_en: null,
          meaning_tr: null,
          ipa: null,
          cefr_guess: null,
          false_friend_tr: { tr_word: 'banka', tr_meaning_tr: 'para kurumu', strength: 'full', note_tr: null },
        },
      ],
    };
    const res = await runExtract(await body(), deps(store, scripted(known), pairNotes));
    expect(res.counts.known_sense).toBe(1);
    expect(pairNotes.rows).toHaveLength(0);
    expect(res.topics).toEqual(['nature']);
  });

  it('works without a pair-note store (no false friends) and when the store fails', async () => {
    const res = await runExtract(await body(), deps(new MemoryAiStore(), scripted(EXTRACT_V5)));
    expect(res.candidates.every((c) => c.false_friend === null)).toBe(true);
    const broken = new MemoryPairNoteStore();
    broken.insertNotes = () => Promise.reject(new Error('db down'));
    broken.findNotes = () => Promise.reject(new Error('db down'));
    const ok = await runExtract(await body(), deps(new MemoryAiStore(), scripted(EXTRACT_V5), broken));
    expect(ok.candidates).toHaveLength(3);
  });
});

describe('cleanFalseFriend', () => {
  it('keeps a look-alike with another meaning, refuses loanwords, translations and junk', () => {
    expect(cleanFalseFriend({ tr_word: '"Aktüel"', tr_meaning_tr: 'güncel', strength: 'full', note_tr: null }, 'actually', 'aslında, gerçekte')).toEqual({
      tr_word: 'aktüel',
      tr_meaning_tr: 'güncel',
      strength: 'full',
      note_tr: null,
    });
    expect(cleanFalseFriend({ tr_word: 'mağaza', tr_meaning_tr: 'dükkân', strength: 'weird', note_tr: '' }, 'magazine', 'dergi')).toMatchObject({
      tr_word: 'mağaza',
      strength: 'full',
    });
    // A borrowed word with the same meaning is not a trap.
    expect(cleanFalseFriend({ tr_word: 'televizyon', tr_meaning_tr: 'televizyon', strength: 'full', note_tr: null }, 'television', 'televizyon')).toBeNull();
    // A translation does not sound like the English word.
    expect(cleanFalseFriend({ tr_word: 'takvim', tr_meaning_tr: 'ajanda', strength: 'full', note_tr: null }, 'calendar', 'takvim')).toBeNull();
    expect(cleanFalseFriend({ tr_word: 'https://x.com', tr_meaning_tr: 'güncel', strength: 'full', note_tr: null }, 'actually', 'aslında')).toBeNull();
    expect(cleanFalseFriend({ tr_word: 'aktüel' }, 'actually', 'aslında')).toBeNull();
    expect(cleanFalseFriend(null, 'actually', 'aslında')).toBeNull();
    // A bad note only drops the note.
    expect(cleanFalseFriend({ tr_word: 'aktüel', tr_meaning_tr: 'güncel', strength: 'full', note_tr: 'x'.repeat(400) }, 'actually', 'aslında')?.note_tr).toBeNull();
  });

  it('cleanChunkTopics accepts only known keys, two at most', () => {
    expect(cleanChunkTopics(['Technology', 'cooking', 'daily-life', 'law'])).toEqual(['technology', 'daily_life']);
    expect(cleanChunkTopics('technology')).toEqual([]);
    expect(cleanChunkTopics([1, null, 'health', 'health'])).toEqual(['health']);
  });
});
