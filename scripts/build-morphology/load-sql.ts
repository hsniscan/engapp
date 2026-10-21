/**
 * SQL that loads the reference data into Supabase (service role / database owner only):
 * ref_sources, ref_morphemes, ref_word_morphemes, ref_families from the built morphology
 * file, and the hand-written false friends into lexicon_pair_notes.
 *
 *   node scripts/build-morphology/load-sql.ts > /tmp/ref.sql
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/ref.sql
 *
 * One transaction; the ref_* tables are replaced, curated pair notes are upserted by their
 * content key and the ones removed from the list are retired (never deleted, so a later
 * per-user feedback row keeps its target). AI pair notes are not touched.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { parseFalseFriendTable } from '../../src/domain/pairNotes.ts';

const lit = (v: string | null | undefined): string => (v == null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const jsonLit = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`;

const name = readdirSync('public/data').find((f) => /^morphology-[0-9a-f]{10}\.json$/.test(f));
if (!name) throw new Error('run scripts/build-morphology/index.ts first');
const data = JSON.parse(readFileSync(`public/data/${name}`, 'utf8')) as {
  morphemes: {
    id: string;
    form: string;
    kind: string;
    origin: string;
    gloss_en: string;
    tr: string;
    words: number;
    ai: { meaning_tr: string; note_tr: string | null; model: string; prompt_version: string } | null;
  }[];
  families: string[][];
  words: [string, string, number, number[]][];
};
const sources = JSON.parse(readFileSync('data/reference/morphology.sources.json', 'utf8')) as {
  output: { sha256: string };
  sources: { name: string; version: string; url: string; sha256: string; license: string; attribution: string }[];
};
const version = `morphology-${sources.output.sha256.slice(0, 10)}`;

const out: string[] = ['begin;', 'set local statement_timeout = 0;'];

out.push('delete from public.ref_sources;');
for (const [i, s] of sources.sources.entries()) {
  const key = ['wordfreq', 'morphynet', 'wiktionary'][i] ?? `source-${i}`;
  out.push(
    `insert into public.ref_sources (key, name, version, url, sha256, license, attribution) values (${[key, s.name, s.version, s.url, s.sha256, s.license, s.attribution].map(lit).join(', ')});`,
  );
}

out.push('delete from public.ref_families;', 'delete from public.ref_word_morphemes;', 'delete from public.ref_morphemes;');
for (const m of data.morphemes) {
  const tr = m.ai
    ? { meaning: m.ai.meaning_tr, note: m.ai.note_tr, source: 'ai', model: m.ai.model, prompt_version: m.ai.prompt_version }
    : { meaning: m.tr, note: null, source: 'curated' };
  out.push(
    `insert into public.ref_morphemes (id, form, kind, origin, gloss_en, meanings, word_count, source_version) values (${lit(m.id)}, ${lit(m.form)}, ${lit(m.kind)}, ${lit(m.origin)}, ${lit(m.gloss_en)}, ${jsonLit({ tr })}, ${m.words}, ${lit(version)});`,
  );
}

const rows = (table: string, cols: string, values: string[]) => {
  for (let i = 0; i < values.length; i += 1000)
    out.push(`insert into public.${table} (${cols}) values\n${values.slice(i, i + 1000).join(',\n')};`);
};
const wm: string[] = [];
const fam: string[] = [];
const pos = new Map(data.words.map(([w, p]) => [w, p]));
for (const [w, , , ms] of data.words) ms.forEach((m, j) => wm.push(`(${lit(w)}, ${lit(data.morphemes[m]!.id)}, ${j})`));
for (const f of data.families) f.forEach((w, rank) => fam.push(`(${lit(w)}, ${lit(f[0]!)}, ${lit(pos.get(w) || null)}, ${rank})`));
rows('ref_word_morphemes', 'lemma_norm, morpheme_id, position', wm);
rows('ref_families', 'lemma_norm, family_id, pos, rank', fam);

const md = readFileSync('data/reference/false-friends.en-tr.md', 'utf8');
const { notes, errors } = parseFalseFriendTable(md);
if (errors.length) throw new Error(`false-friends.en-tr.md:\n${errors.join('\n')}`);
const keys: string[] = [];
for (const n of notes) {
  const contentKey = n.key.split('|')[1]!;
  keys.push(`(${lit(n.term_norm)}, ${lit(contentKey)})`);
  out.push(
    `insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated) values (${lit(n.term_norm)}, 'en-tr', 'false_friend', ${lit(contentKey)}, ${jsonLit(n.content)}, true)
  on conflict (lang_pair, kind, term_norm, coalesce(sense_id, '00000000-0000-0000-0000-000000000000'::uuid), content_key)
  do update set content = excluded.content, curated = true, status = 'active'
  where lexicon_pair_notes.content is distinct from excluded.content or lexicon_pair_notes.status <> 'active';`,
  );
}
out.push(
  `update public.lexicon_pair_notes set status = 'retired'
  where curated and kind = 'false_friend' and lang_pair = 'en-tr' and sense_id is null and status = 'active'
    and (term_norm, content_key) not in (values ${keys.join(', ')});`,
);
out.push('commit;');
process.stdout.write(`${out.join('\n')}\n`);
