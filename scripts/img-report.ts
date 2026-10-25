// Read-only summary of the pictures: how many are in each status, the counts that size the
// watercolour redraw (senses by visualizability, requests by state, pictures by prompt version
// and status), and every review decision (lemma, decision, reason). For the owner's review;
// prints no user data.
//
//   node scripts/img-report.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IMAGE_PROMPT_VERSION,
  IMAGE_PROMPT_VERSION_FLAT,
  IMAGE_STATUSES,
} from '../supabase/functions/_shared/image-contract.ts';
import { log, serviceClient } from './lib/image-env.ts';

async function main(): Promise<void> {
  const db = serviceClient();
  const imgs = await db.from('lexicon_images').select('status').limit(50000);
  if (imgs.error) throw new Error(`lexicon_images: ${imgs.error.message}`);
  const byStatus: Record<string, number> = {};
  for (const r of imgs.data as { status: string }[])
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  log('pictures by status', byStatus);
  await redrawSize(db);

  const fb = await db
    .from('image_feedback')
    .select('decision, reason, sense_id')
    .order('created_at')
    .limit(5000);
  if (fb.error) throw new Error(`image_feedback: ${fb.error.message}`);
  await report(
    fb.data as { decision: string; reason: string | null; sense_id: string }[],
    async (ids) => {
      const s = await db
        .from('lexicon_senses')
        .select('id, lexicon_terms!inner(lemma)')
        .in('id', ids);
      if (s.error) throw new Error(`lexicon_senses: ${s.error.message}`);
      type Row = { id: string; lexicon_terms: { lemma: string } | { lemma: string }[] };
      return new Map(
        (s.data as unknown as Row[]).map((r) => [
          r.id,
          Array.isArray(r.lexicon_terms)
            ? (r.lexicon_terms[0]?.lemma ?? '?')
            : r.lexicon_terms.lemma,
        ]),
      );
    },
  );
}

/**
 * Counts that size the watercolour redraw: senses by visualizability, requests by state,
 * pictures by prompt version and status. Exact head counts (no rows are fetched), so they are
 * not capped by the API's row limit.
 */
async function redrawSize(db: SupabaseClient): Promise<void> {
  const count = async (
    table: string,
    filter: (q: CountQuery) => CountQuery = (q) => q,
  ): Promise<number> => {
    const r = await filter(db.from(table).select('*', { count: 'exact', head: true }));
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.count ?? 0;
  };

  const byScore: Record<string, number> = {
    null: await count('lexicon_senses', (q) => q.is('visualizability', null)),
  };
  for (const n of [0, 1, 2, 3])
    byScore[n] = await count('lexicon_senses', (q) => q.eq('visualizability', n));
  log('senses by visualizability', byScore);

  const byState: Record<string, number> = {};
  for (const s of ['queued', 'submitted', 'done', 'skipped'])
    byState[s] = await count('image_requests', (q) => q.eq('state', s));
  log('requests by state', byState);

  const byVersion: Record<string, Record<string, number>> = {};
  for (const v of [IMAGE_PROMPT_VERSION_FLAT, IMAGE_PROMPT_VERSION, 'other']) byVersion[v] = {};
  for (const s of IMAGE_STATUSES) {
    const all = await count('lexicon_images', (q) => q.eq('status', s));
    let known = 0;
    for (const v of [IMAGE_PROMPT_VERSION_FLAT, IMAGE_PROMPT_VERSION]) {
      const n = await count('lexicon_images', (q) => q.eq('status', s).eq('prompt_version', v));
      byVersion[v]![s] = n;
      known += n;
    }
    byVersion.other![s] = all - known;
  }
  log('pictures by prompt version and status', byVersion);
}

// The filter builder of a head count (only the filters used above).
type CountQuery = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

async function report(
  rows: { decision: string; reason: string | null; sense_id: string }[],
  lemmas: (ids: string[]) => Promise<Map<string, string>>,
): Promise<void> {
  const names = await lemmas([...new Set(rows.map((r) => r.sense_id))]);
  const byDecision: Record<string, number> = {};
  for (const r of rows) byDecision[r.decision] = (byDecision[r.decision] ?? 0) + 1;
  log('review decisions', byDecision);
  for (const r of rows) {
    if (r.decision === 'approve') continue;
    console.log(
      `${(names.get(r.sense_id) ?? '?').padEnd(20)} ${r.decision.padEnd(13)} ${r.reason ?? ''}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
