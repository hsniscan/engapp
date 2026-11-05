/**
 * Builds the phrasal-verb and collocation list of the Kelime Bankası (v0.5.3 C4, decision
 * 0074) and stores it in public.ref_phrases, where the word-bank job (word_bank_pending)
 * picks it up. Free: no model call. Run by .github/workflows/word-bank.yml (job `phrases`).
 *
 *   node scripts/build-phrases.ts --corpus <file> [--corpus <file> ...] [--wiki <file>]
 *       [--wiktionary <titles.txt>] [--phrasal 500] [--collocations 300] [--out <dir>]
 *       [--upload] [--dry-run]
 *
 *   --corpus      plain sentences, one per line (Tatoeba's eng_sentences.tsv works as is: the
 *                 text is the last tab-separated field)
 *   --wiki        a Simple English Wikipedia dump (XML, unpacked), counted line by line
 *   --wiktionary  the category's titles, one per line; without it they are fetched from the
 *                 Wiktionary API (Category:English phrasal verbs)
 *   --out         writes phrasal-verbs.tsv and collocations.tsv there (for a person to read)
 *   --upload      stores the rows (ref_phrases_put, replacing the previous build's rows that
 *                 have no bank row yet). Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { parseLevelIndex } from './lib/example-match.ts';
import { log, serviceClient } from './lib/image-env.ts';
import {
  COLLOCATION_VERBS,
  CollocationCounter,
  collocationStats,
  parseCategoryPage,
  PhrasalCounter,
  phrasalVerbOf,
  posPredicate,
  rankCollocations,
  rankPhrasals,
  sentences,
  wikiText,
  type CorpusTotals,
  type PhraseRow,
} from './lib/phrases.ts';

const CATEGORY = 'Category:English phrasal verbs';
const UA = 'EngappContentBuilder/1.0 (https://github.com/hsniscan/engapp; content job)';

async function wiktionaryTitles(): Promise<string[]> {
  const out: string[] = [];
  let next: string | null = null;
  for (let page = 0; page < 40; page++) {
    const url = new URL('https://en.wiktionary.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmnamespace: '0',
      cmlimit: '500',
      format: 'json',
      ...(next ? { cmcontinue: next } : {}),
    }).toString();
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`Wiktionary API: HTTP ${res.status}`);
    const p = parseCategoryPage(await res.json());
    out.push(...p.titles);
    if (!p.next) break;
    next = p.next;
  }
  return out;
}

async function eachLine(path: string, fn: (line: string) => void, max = Infinity): Promise<number> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    fn(line);
    if (++n >= max) {
      rl.close();
      break;
    }
  }
  return n;
}

function toTsv(rows: readonly PhraseRow[]): string {
  return [
    '# Engapp phrase list (decision 0074). lemma, pos, cefr, zipf, corpus count, source.',
    ...rows.map((r) => [r.lemma_norm, r.pos, r.cefr, r.zipf, r.corpus_count, r.source].join('\t')),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      corpus: { type: 'string', multiple: true, default: [] },
      wiki: { type: 'string' },
      wiktionary: { type: 'string' },
      levels: { type: 'string', default: 'data/levels/client-levels.tsv' },
      phrasal: { type: 'string', default: '500' },
      collocations: { type: 'string', default: '300' },
      'wiki-lines': { type: 'string', default: '6000000' },
      out: { type: 'string' },
      upload: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (values.corpus.length === 0 && !values.wiki) throw new Error('give at least one --corpus or --wiki');
  const levelFile = readFileSync(values.levels, 'utf8');
  const levels = parseLevelIndex(levelFile);
  const isVerb = posPredicate(levelFile, 'v');
  const isNoun = posPredicate(levelFile, 'n');

  const titles = values.wiktionary
    ? readFileSync(values.wiktionary, 'utf8').split('\n')
    : await wiktionaryTitles();
  // Entries the lists already have (a handful of rare phrasal verbs, compound nouns).
  const listed = new Set([...levels.keys()].filter((k) => k.includes(' ')));
  const phrasals = [...new Set(titles.map((t) => phrasalVerbOf(t, isVerb)).filter((t): t is string => !!t))].filter(
    (p) => !listed.has(p),
  );
  log('phrasal verb candidates', { titles: titles.length, phrasal_verbs: phrasals.length });

  // One counter pair per corpus: rates are averaged over the corpora.
  const pv: PhrasalCounter[] = [];
  const co: CollocationCounter[] = [];
  for (const path of values.corpus) {
    const p = new PhrasalCounter(phrasals);
    const c = new CollocationCounter(COLLOCATION_VERBS, isNoun);
    const n = await eachLine(path, (line) => {
      const text = line.includes('\t') ? line.slice(line.lastIndexOf('\t') + 1) : line;
      p.add(text);
      c.add(text);
    });
    log('corpus counted', { path, lines: n, words: p.words });
    pv.push(p);
    co.push(c);
  }
  if (values.wiki) {
    const p = new PhrasalCounter(phrasals);
    const c = new CollocationCounter(COLLOCATION_VERBS, isNoun);
    const n = await eachLine(
      values.wiki,
      (line) => {
        const text = wikiText(line);
        if (!text) return;
        for (const s of sentences(text)) {
          p.add(s);
          c.add(s);
        }
      },
      Number(values['wiki-lines']),
    );
    log('wiki counted', { path: values.wiki, lines: n, words: p.words });
    pv.push(p);
    co.push(c);
  }

  const version = `phrases-${new Date().toISOString().slice(0, 10)}`;
  const totals = new Map<string, CorpusTotals>(
    phrasals.map((ph) => [ph, { counts: pv.map((p) => p.counts.get(ph) ?? 0), words: pv.map((p) => p.words) }]),
  );
  const phrasalRows = rankPhrasals(totals, levels, {
    size: Number(values.phrasal),
    minCount: 5,
    version,
  });
  const collocationRows = rankCollocations(collocationStats(co), levels, {
    size: Number(values.collocations),
    minCount: 8,
    minLogDice: 6,
    version,
    exclude: new Set([...listed, ...phrasals]),
  });
  const byLevel = (rows: PhraseRow[]) =>
    rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.cefr]: (m[r.cefr] ?? 0) + 1 }), {});
  log('phrase list built', {
    phrasal_verbs: phrasalRows.length,
    phrasal_by_level: byLevel(phrasalRows),
    phrasal_top: phrasalRows.slice(0, 15).map((r) => r.lemma_norm),
    collocations: collocationRows.length,
    collocations_by_level: byLevel(collocationRows),
    collocations_top: collocationRows.slice(0, 15).map((r) => r.lemma_norm),
  });
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, 'phrasal-verbs.tsv'), toTsv(phrasalRows));
    writeFileSync(join(values.out, 'collocations.tsv'), toTsv(collocationRows));
  }
  if (!values.upload || values['dry-run']) return;
  const rows = [...phrasalRows, ...collocationRows];
  const { data, error } = await serviceClient().rpc('ref_phrases_put', { p_rows: rows, p_replace: true });
  if (error) throw new Error(`ref_phrases_put: ${error.message}`);
  log('phrase list stored', data as Record<string, unknown>);
}

main().catch((e: unknown) => {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
