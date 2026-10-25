// Temporary (never merged): failure reasons of image-v2 rows and a sample of stored ones, as annotations.
import { gzipSync } from 'node:zlib';
import { serviceClient } from './lib/image-env.ts';
const db = serviceClient();
const rej = await db.from('lexicon_images').select('checks').eq('prompt_version', 'image-v2').eq('status', 'rejected').limit(1000);
if (rej.error) throw new Error(rej.error.message);
const reasons: Record<string, number> = {};
for (const r of rej.data as { checks: Record<string, unknown> }[]) {
  const c = r.checks;
  const k = String(c.problem ?? (c.sanitize ? 'sanitize:' + c.sanitize : c.answer ? 'answer:' + c.answer : 'other'));
  reasons[k] = (reasons[k] ?? 0) + 1;
}
console.log(`::notice title=reasons::${JSON.stringify(reasons)}`);
const ok = await db.from('lexicon_images').select('svg, alt_tr, checks, lexicon_senses!inner(lexicon_terms!inner(lemma))').eq('prompt_version', 'image-v2').eq('status', 'review').limit(24);
if (ok.error) throw new Error(ok.error.message);
const bad = await db.from('lexicon_images').select('svg, alt_tr, checks, lexicon_senses!inner(lexicon_terms!inner(lemma))').eq('prompt_version', 'image-v2').eq('status', 'rejected').neq('svg', '').limit(12);
const z = gzipSync(JSON.stringify({ ok: ok.data, bad: bad.data })).toString('base64');
const parts = z.match(/.{1,3900}/g) ?? [];
parts.slice(0, 40).forEach((p, i) => console.log(`::notice title=d-${i + 1}of${parts.length}::${p}`));
