// Word bank rows for e2e tests and screenshots, built from the shipped reference lists
// (data/levels/ref-word-levels.tsv: lemma, part of speech, level, source) with the word
// frequency from data/levels/client-levels.tsv. Meanings are placeholders except a few common
// words: the real meanings live on the server (public.word_bank), never in the repository.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { SUPABASE_URL } from './backend.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../data/levels');

const MEANINGS: Record<string, string> = {
  time: 'zaman, vakit',
  people: 'insanlar',
  year: 'yıl',
  way: 'yol, yöntem',
  day: 'gün',
  thing: 'şey',
  man: 'adam',
  world: 'dünya',
  life: 'hayat',
  make: 'yapmak',
  know: 'bilmek',
  think: 'düşünmek',
  see: 'görmek',
  get: 'almak, elde etmek',
  go: 'gitmek',
  want: 'istemek',
  good: 'iyi',
  new: 'yeni',
  first: 'ilk',
  only: 'yalnızca',
  well: 'iyi',
  back: 'geri',
  really: 'gerçekten',
  government: 'hükümet',
  provide: 'sağlamak',
  however: 'ancak, yine de',
  available: 'mevcut, müsait',
  likely: 'muhtemel, olası',
  significant: 'önemli, kayda değer',
  suggest: 'önermek',
  achieve: 'başarmak, elde etmek',
  avoid: 'kaçınmak',
  announce: 'duyurmak, açıklamak',
  afford: 'gücü yetmek',
  argue: 'tartışmak, savunmak',
  complain: 'şikâyet etmek',
  encourage: 'cesaretlendirmek',
  admit: 'kabul etmek, itiraf etmek',
  arrange: 'düzenlemek, ayarlamak',
  ignore: 'görmezden gelmek',
  persuade: 'ikna etmek',
  postpone: 'ertelemek',
  reluctant: 'isteksiz',
  vivid: 'canlı',
  journey: 'yolculuk',
  threat: 'tehdit',
  barely: 'zar zor',
  eventually: 'sonunda',
  actually: 'aslında',
  opinion: 'görüş',
};

export interface BankRowSeed {
  lemma_norm: string;
  pos: string;
  lemma: string;
  cefr: string;
  list_source: 'cefrj' | 'octanove';
  zipf: number | null;
  lexicon_term_id: null;
  senses: { meaning_tr: string; example_en: string; example_tr: string; sense_id: null }[];
  retired: false;
  server_seq: number;
}

let cached: BankRowSeed[] | null = null;

/** Every reference-list word as a bank row (~10 000), in server_seq order. */
export function referenceBankRows(): BankRowSeed[] {
  if (cached) return cached;
  const zipf = new Map<string, number>();
  for (const line of readFileSync(join(DIR, 'client-levels.tsv'), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, z] = line.split('\t');
    if (lemma && z) zipf.set(lemma, Number(z));
  }
  const rows: BankRowSeed[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(join(DIR, 'ref-word-levels.tsv'), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, pos, cefr, source] = line.split('\t');
    if (!lemma || !pos || !cefr || !/^[ABC][12]$/.test(cefr)) continue;
    const key = `${lemma}|${pos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meaning = MEANINGS[lemma] ?? `${lemma} (anlam)`;
    rows.push({
      lemma_norm: lemma,
      pos,
      lemma,
      cefr,
      list_source: source === 'octanove' ? 'octanove' : 'cefrj',
      zipf: zipf.get(lemma) ?? null,
      lexicon_term_id: null,
      senses: [
        {
          meaning_tr: meaning,
          example_en: `We talked about ${lemma} yesterday.`,
          example_tr: `Dün ${meaning} hakkında konuştuk.`,
          sense_id: null,
        },
      ],
      retired: false,
      server_seq: rows.length + 1,
    });
  }
  cached = rows;
  return rows;
}

/** Serves public.word_bank like PostgREST (server_seq > after, ascending, limit). */
export async function serveWordBank(page: Page, rows: readonly BankRowSeed[]): Promise<void> {
  await page.route(`${SUPABASE_URL}/rest/v1/word_bank**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    const url = new URL(req.url());
    const after = Number((url.searchParams.get('server_seq') ?? 'gt.0').replace('gt.', ''));
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(rows.filter((r) => r.server_seq > after).slice(0, limit)),
    });
  });
}
