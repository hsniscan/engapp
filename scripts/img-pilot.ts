/**
 * Picture pilot (v0.4 İP2, decision 0030): draws N (default 50) random concrete senses now,
 * one by one through the instant path with the renderer (image-v1 on Opus with the server-side
 * fallback, sanitizer, contrast, coverage, imagecheck-v1), and stores every picture as
 * 'review' for the owner to judge in the review screen. Prints each picture's cost and the
 * total; --out also writes the report as JSON. Run by .github/workflows/images.yml (job=pilot).
 *
 *   node scripts/img-pilot.ts [--n 50] [--min-zipf 3] [--out pilot.json]
 *
 * Candidates: nouns, verbs and adjectives with zipf >= --min-zipf and no picture yet. Senses not
 * yet scored are scored with visual-v1 first; only scores >= 2 are drawn. Everything stays
 * inside the monthly picture budget.
 *
 * Environment: as scripts/img-batch.ts. Secrets are never printed.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runPilot, type PilotCandidate } from './lib/image-jobs.ts';
import { haveClaudeKey, jobDepsFromEnv, log } from './lib/image-env.ts';

const POS = ['noun', 'verb', 'adjective'];
const POOL = 1500;

interface SenseRow {
  id: string;
  pos: string;
  meaning_tr: string;
  visualizability: number | null;
  lexicon_terms: { lemma: string } | { lemma: string }[];
}

async function candidates(db: SupabaseClient, minZipf: number): Promise<PilotCandidate[]> {
  const taken = new Set<string>();
  const imgs = await db
    .from('lexicon_images')
    .select('sense_id')
    .neq('status', 'rejected')
    .limit(20000);
  if (imgs.error) throw new Error(`lexicon_images: ${imgs.error.message}`);
  for (const r of imgs.data as { sense_id: string }[]) taken.add(r.sense_id);

  // Sense ids are random UUIDs: reading on from a random id is a random sample.
  const page = async (from: string | null) => {
    let q = db
      .from('lexicon_senses')
      .select('id, pos, meaning_tr, visualizability, lexicon_terms!inner(lemma)')
      .in('pos', POS)
      .gte('lexicon_terms.zipf', minZipf)
      .or('visualizability.is.null,visualizability.gte.2')
      .order('id')
      .limit(POOL);
    if (from) q = q.gte('id', from);
    const r = await q;
    if (r.error) throw new Error(`lexicon_senses: ${r.error.message}`);
    return r.data as unknown as SenseRow[];
  };
  let rows = await page(randomUUID());
  if (rows.length < POOL) rows = [...rows, ...(await page(null))];
  const seen = new Set<string>();
  const out: PilotCandidate[] = [];
  for (const r of rows) {
    if (seen.has(r.id) || taken.has(r.id)) continue;
    seen.add(r.id);
    const term = Array.isArray(r.lexicon_terms) ? r.lexicon_terms[0] : r.lexicon_terms;
    if (!term) continue;
    out.push({
      sense_id: r.id,
      lemma: term.lemma,
      pos: r.pos,
      gloss_tr: r.meaning_tr,
      visualizability: r.visualizability,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      n: { type: 'string', default: '50' },
      'min-zipf': { type: 'string', default: '3' },
      out: { type: 'string' },
    },
  });
  const n = Number(values.n);
  const minZipf = Number(values['min-zipf']);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('--n must be 1..500');
  if (!Number.isFinite(minZipf)) throw new Error('--min-zipf must be a number');
  if (!haveClaudeKey()) return;
  const deps = await jobDepsFromEnv();
  const pool = await candidates(deps.db, minZipf);
  log('pilot candidates', { candidates: pool.length, n });
  const report = await runPilot(deps, pool, { n });

  console.log('\nlemma                pos        outcome     tries  cost USD');
  for (const l of report.lines) {
    console.log(
      `${l.lemma.padEnd(20)} ${l.pos.padEnd(10)} ${(l.outcome + (l.problem ? `:${l.problem}` : '')).padEnd(11)} ${String(l.attempts).padStart(5)}  ${l.cost_usd.toFixed(4)}`,
    );
  }
  const images = report.lines.filter((l) => l.outcome === 'image').length;
  console.log(
    `\n${images}/${report.lines.length} pictures stored for review. ` +
      `visual-v1 ${report.visualCostUsd.toFixed(4)} + drawings ${report.drawCostUsd.toFixed(4)} = ` +
      `total ${report.totalCostUsd.toFixed(4)} USD` +
      (images ? ` (${(report.drawCostUsd / images).toFixed(4)} per stored picture)` : '') +
      `. Stopped: ${report.stopped}.`,
  );
  if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
  log('budget', { ...(await deps.store.budgetStatus()), cap_usd_now: deps.capUsd });
}

main().catch((e: unknown) => {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
