// Golden set of smart extraction (plan acceptance criterion 5, decision 0018): the five texts
// in data/golden/extract/, the model's answers recorded by scripts/golden-extract.ts, replayed
// through the real ai-extract pipeline (validation, level rule on the reference data) and the
// device's selection rule. The report docs/quality/golden-extract.md is a file snapshot:
// `pnpm vitest run golden -u` rewrites it after a new recording; otherwise the test fails when
// the report and the recordings disagree.
import clientLevels from '../../data/levels/client-levels.tsv?raw';
import expectedJson from '../../data/golden/extract/expected.json';
import { describe, expect, it } from 'vitest';
import type { AiProvider } from '../../supabase/functions/_shared/ai-provider';
import {
  EXTRACT_PROMPT_VERSION,
  type ExtractCandidate,
} from '../../supabase/functions/_shared/contracts';
import { runExtract, sha256Hex } from '../../supabase/functions/_shared/extract';
import { MemoryAiStore } from '../../supabase/functions/_shared/testing/memory-store';
import { levelBand, occurrenceCounter, planCandidates, type CandidateFacts } from './candidates';
import { chunkText, looksLikeVocabularyList } from './chunking';
import { levelRank, parseClientLevels } from './level';
import { normalizeTerm } from './normalize';
import type { CefrLevel } from './types';

const TEXTS = import.meta.glob<string>('../../data/golden/extract/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const RECORDINGS = import.meta.glob<Recording>('../../data/golden/extract/recorded/*.json', {
  import: 'default',
  eager: true,
});
const textOf = (id: string) => TEXTS[`../../data/golden/extract/${id}.txt`];
const recordingOf = (id: string, level: string) =>
  RECORDINGS[`../../data/golden/extract/recorded/${id}.${level}.json`];

interface Expected {
  criteria: { same_min: number; next_max: number };
  levels: CefrLevel[];
  texts: Record<string, { known: string[]; list_entries?: number }>;
}
interface Recording {
  text: string;
  level: string;
  prompt_version: string;
  model: string | null;
  recorded_at: string;
  outputs: unknown[];
}

const expected = expectedJson as Expected;

/**
 * Prompt versions whose selection rules (WHAT TO SELECT, VOCABULARY LISTS) are the same as
 * the current one's, so their recordings still measure the selection. extract-v5 only added
 * `topics` and `false_friend_tr` to the answer (decision 0020); the v4 recordings lack those
 * fields, which the pipeline treats as "none". A version that changes the selection must
 * list only itself here and be recorded again (`scripts/golden-extract.ts record`).
 */
const SAME_SELECTION: Record<string, readonly string[]> = {
  'extract-v5': ['extract-v5', 'extract-v4'],
};
const levels = parseClientLevels(clientLevels);

/** The reference data the server reads (ref_word_levels / ref_word_freq ≈ the client file). */
function store(): MemoryAiStore {
  const s = new MemoryAiStore();
  s.refMinZipf = levels.minZipf;
  s.refs = new Proxy(new Map(), {
    get(target, prop) {
      if (prop === 'has') return (k: string) => levels.lookup(k) !== undefined;
      if (prop === 'get') return (k: string) => levels.lookup(k);
      return Reflect.get(target, prop) as unknown;
    },
  });
  return s;
}

interface Row {
  term: string;
  cefr: CefrLevel | null;
  source: string | null;
  bucket: string;
  selected: boolean;
}
interface Run {
  id: string;
  level: CefrLevel;
  rec: Recording;
  candidates: number;
  rows: Row[];
}

async function replay(id: string, level: CefrLevel): Promise<Run> {
  const rec = recordingOf(id, level)!;
  const outputs = [...rec.outputs];
  const provider: AiProvider = {
    name: 'replay',
    generateJson: () =>
      Promise.resolve({
        data: outputs.shift(),
        model: rec.model ?? 'replay',
        attempts: 1,
        usage: null,
      }),
  };
  const full = textOf(id)!.normalize('NFC');
  const s = store();
  const found: { c: ExtractCandidate; list: boolean }[] = [];
  const seen = new Set<string>();
  for (const chunk of chunkText(full)) {
    const text = chunk.normalize('NFC');
    const res = await runExtract(
      { text, chunk_hash: await sha256Hex(text), level },
      { userId: 'golden', store: s, provider: () => provider, dailyLimit: 1000 },
    );
    for (const c of res.candidates) {
      if (seen.has(c.lexicon.id)) continue;
      seen.add(c.lexicon.id);
      found.push({ c, list: looksLikeVocabularyList(text) });
    }
  }
  const known = new Set(expected.texts[id]!.known.map(normalizeTerm));
  const count = occurrenceCounter(full);
  const facts: CandidateFacts[] = found.map(({ c, list }, i) => ({
    id: String(i),
    key: normalizeTerm(c.term),
    cefr: c.lexicon.cefr ?? null,
    occurrences: count(c.term, c.surface),
    zipf: c.lexicon.zipf ?? null,
    hasNote: known.has(normalizeTerm(c.term)),
    fromList: list,
    order: i,
  }));
  const plan = planCandidates(facts, level);
  const rows = plan.rows.map((p) => {
    const { c } = found[Number(p.id)]!;
    return {
      term: c.term,
      cefr: c.lexicon.cefr ?? null,
      source: c.lexicon.cefr_source ?? null,
      bucket: p.bucket,
      selected: p.selected,
    };
  });
  return { id, level, rec, candidates: found.length, rows };
}

function metrics(run: Run) {
  const sel = run.rows.filter((r) => r.selected);
  const band = (r: Row) => levelBand(r.cefr, run.level);
  const above = sel.filter(
    (r) => r.cefr !== null && levelRank(r.cefr) > levelRank(run.level) + 1,
  ).length;
  return {
    selected: sel.length,
    same: sel.filter((r) => band(r) === 'same').length,
    next: sel.filter((r) => band(r) === 'next').length,
    lower: sel.filter((r) => band(r) === 'lower').length,
    above,
    knownSelected: sel.filter((r) => expected.texts[run.id]!.known.includes(normalizeTerm(r.term)))
      .length,
    buckets: Object.fromEntries(
      ['for_you', 'easy', 'known', 'too_hard'].map((b) => [
        b,
        run.rows.filter((r) => r.bucket === b).length,
      ]),
    ) as Record<string, number>,
  };
}

const ids = Object.keys(expected.texts);
const runs: Run[] = [];

describe('golden set: smart extraction (criterion 5)', () => {
  it('has a recording for every text and level, made with a prompt that selects like the current one', () => {
    for (const id of ids)
      for (const level of expected.levels)
        expect(SAME_SELECTION[EXTRACT_PROMPT_VERSION], `${id}.${level}`).toContain(
          recordingOf(id, level)?.prompt_version,
        );
  });

  for (const id of ids)
    for (const level of expected.levels)
      it(`${id} at ${level}`, async () => {
        const run = await replay(id, level);
        runs.push(run);
        const m = metrics(run);
        const { same_min, next_max } = expected.criteria;
        expect(m.above, 'nothing above the next level').toBe(0);
        expect(m.knownSelected, 'nothing the learner knows').toBe(0);
        if (m.selected > 0) {
          expect(m.same / m.selected).toBeGreaterThanOrEqual(same_min);
          expect(m.next / m.selected).toBeLessThanOrEqual(next_max);
        }
        const entries = expected.texts[id]!.list_entries;
        if (entries) expect(run.candidates, 'a list yields every entry').toBe(entries);
        else expect(m.selected, 'a text at this level offers something').toBeGreaterThan(0);
      });

  it('over the whole set: ≥ 55 % at the level, ≤ 10 % one above, none higher; the report is current', async () => {
    for (const level of expected.levels) {
      const all = runs.filter((r) => r.level === level).map(metrics);
      const sel = all.reduce((n, m) => n + m.selected, 0);
      expect(sel).toBeGreaterThan(0);
      expect(all.reduce((n, m) => n + m.same, 0) / sel).toBeGreaterThanOrEqual(0.55);
      expect(all.reduce((n, m) => n + m.next, 0) / sel).toBeLessThanOrEqual(0.1);
    }
    await expect(report()).toMatchFileSnapshot('../../docs/quality/golden-extract.md');
  });
});

const pct = (n: number, d: number) => (d === 0 ? '–' : `${Math.round((100 * n) / d)} %`);

function report(): string {
  const sorted = [...runs].sort(
    (a, b) => a.id.localeCompare(b.id) || a.level.localeCompare(b.level),
  );
  const first = sorted[0]!.rec;
  const lines: string[] = [
    '# Golden set: smart extraction',
    '',
    'Plan acceptance criterion 5 (v0.2 İP4, decision 0018). Generated by',
    '`pnpm vitest run golden -u` from the recordings in `data/golden/extract/recorded/`',
    '(made with `node scripts/golden-extract.ts record`); do not edit by hand.',
    '',
    `Prompt \`${first.prompt_version}\`, model \`${first.model}\`, recorded ${first.recorded_at.slice(0, 10)}.`,
    'Levels: the server rule (`resolveLevel`) on the client level file (CEFR-J / Octanove /',
    'wordfreq) with the model\'s `cefr_guess`; "known" words are simulated notes from',
    '`expected.json`. Selection: `planCandidates` (domain/candidates.ts).',
    '',
    '| Text | Level | Candidates | Pre-selected | At level | +1 | Lower | Above +1 | Known selected | Senin için / Kolay / Biliyorsun / Üstünde |',
    '| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |',
  ];
  const totals: Record<
    string,
    { sel: number; same: number; next: number; lower: number; above: number; known: number }
  > = {};
  for (const run of sorted) {
    const m = metrics(run);
    const t = (totals[run.level] ??= { sel: 0, same: 0, next: 0, lower: 0, above: 0, known: 0 });
    t.sel += m.selected;
    t.above += m.above;
    t.known += m.knownSelected;
    t.same += m.same;
    t.next += m.next;
    t.lower += m.lower;
    lines.push(
      `| ${run.id} | ${run.level} | ${run.candidates} | ${m.selected} | ${pct(m.same, m.selected)} | ${pct(m.next, m.selected)} | ${pct(m.lower, m.selected)} | ${m.above} | ${m.knownSelected} | ${m.buckets.for_you} / ${m.buckets.easy} / ${m.buckets.known} / ${m.buckets.too_hard} |`,
    );
  }
  for (const [level, t] of Object.entries(totals))
    lines.push(
      `| **all** | **${level}** | | **${t.sel}** | **${pct(t.same, t.sel)}** | **${pct(t.next, t.sel)}** | **${pct(t.lower, t.sel)}** | **${t.above}** | **${t.known}** | |`,
    );
  lines.push('', '## Candidates', '');
  const fmt = (r: Row) => `${r.term} (${r.cefr ?? '?'}${r.source === 'ai' ? '*' : ''})`;
  for (const run of sorted) {
    lines.push(`### ${run.id} · ${run.level}`, '');
    const groups: [string, Row[]][] = [
      ['Pre-selected', run.rows.filter((r) => r.selected)],
      ['Senin için, not selected', run.rows.filter((r) => r.bucket === 'for_you' && !r.selected)],
      ['Kolay', run.rows.filter((r) => r.bucket === 'easy')],
      ['Biliyorsun', run.rows.filter((r) => r.bucket === 'known')],
      ['Above the next level', run.rows.filter((r) => r.bucket === 'too_hard')],
    ];
    for (const [name, list] of groups)
      if (list.length) lines.push(`- ${name}: ${list.map(fmt).join(', ')}`);
    lines.push('');
  }
  lines.push(
    '`*` = level from the AI guess (bounded by frequency); otherwise list, frequency or words.',
    '',
  );
  return lines.join('\n');
}
