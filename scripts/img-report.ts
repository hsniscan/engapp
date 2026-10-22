// Read-only summary of the pictures: how many are in each status, and every review decision
// (lemma, decision, reason). For the owner's pilot review; prints no user data.
//
//   node scripts/img-report.ts

import { log, serviceClient } from './lib/image-env.ts';

async function main(): Promise<void> {
  const db = serviceClient();
  const imgs = await db.from('lexicon_images').select('status').limit(50000);
  if (imgs.error) throw new Error(`lexicon_images: ${imgs.error.message}`);
  const byStatus: Record<string, number> = {};
  for (const r of imgs.data as { status: string }[])
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  log('pictures by status', byStatus);

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
