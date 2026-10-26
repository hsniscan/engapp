// One-off data repairs that run once per device, when the browser is idle. Each one writes
// through the normal actions, so the fixed rows sync to the other devices.
import { stripListEntry } from '../../supabase/functions/_shared/listEntry';
import { isDuplicateSense, meaningAlternatives } from '../../supabase/functions/_shared/text';
import { normalizeTerm } from '../domain/normalize';
import { effectiveLogs } from '../domain/recompute';
import type { Id, Millis, Sense } from '../domain/types';
import { editSense, softDeleteSense, type SensePatch } from './actions';
import { db } from './db';
import { logsByCard } from './history';
import { getMeta, setMeta } from './meta';
import { scanWhere } from './scan';

const LIST_PREFIX_DONE = 'repair_list_prefix_v1';

/**
 * Senses imported from a word list before ai-extract cut the list prefix carry it in their
 * sentence ("1988 trailer I own a trailer."), which also blanks the headword in the cloze card.
 * Returns the number of senses fixed.
 */
export async function repairListEntrySentences(now: Millis = Date.now()): Promise<number> {
  if (await getMeta<boolean>(LIST_PREFIX_DONE)) return 0;
  const senses = await db.senses
    .filter((s) => s.deleted_at === null && !!s.source_sentence && /^\s*\d/.test(s.source_sentence))
    .toArray();
  const notes = await db.notes.bulkGet([...new Set(senses.map((s) => s.note_id))]);
  const termOf = new Map(notes.flatMap((n) => (n ? [[n.id, n.term] as const] : [])));
  let fixed = 0;
  for (const s of senses) {
    const term = termOf.get(s.note_id);
    if (!term || !s.source_sentence) continue;
    const clean = stripListEntry(s.source_sentence, term, s.span);
    if (clean.sentence === s.source_sentence || !clean.span) continue;
    await editSense(
      s.id,
      { source_sentence: clean.sentence, span: clean.span, source_sentence_tr: s.source_sentence_tr },
      now,
    );
    fixed++;
  }
  await setMeta(LIST_PREFIX_DONE, true);
  return fixed;
}

const DUPLICATE_SENSES_DONE = 'repair_duplicate_senses_v1';

const meaningOf = (s: Sense): string => s.meaning_tr_override?.trim() || s.meaning_tr;

/**
 * Two live senses of one note that are the same sense: the same part of speech and an
 * overlapping Turkish meaning ("davet" / "davetiye, davet"), or two imported senses (both
 * from the lexicon) with the same example sentence.
 */
function sameSense(a: Sense, b: Sense): boolean {
  if (isDuplicateSense({ pos: a.pos, meaning_tr: meaningOf(a) }, { pos: b.pos, meaning_tr: meaningOf(b) })) return true;
  return (
    !!a.lexicon_sense_id &&
    !!b.lexicon_sense_id &&
    !!a.source_sentence &&
    !!b.source_sentence &&
    normalizeTerm(a.source_sentence) === normalizeTerm(b.source_sentence)
  );
}

/** b's meaning says more than a's: its alternatives strictly contain a's. */
function addsInformation(a: Sense, b: Sense): boolean {
  const ta = meaningAlternatives(meaningOf(a));
  const tb = new Set(meaningAlternatives(meaningOf(b)));
  return tb.size > ta.length && ta.every((x) => tb.has(x));
}

/**
 * Notes that got the same sense twice (e.g. "invitation": "davetiye, davet" and "davet" with
 * the same example sentence, after a word list was imported again). Within a note, a
 * duplicate sense whose cards have no review history (undone answers do not count) is
 * soft-deleted with its cards. The kept sense takes the duplicate's meaning only when that
 * says more ("davetiye, davet" over "davet"), and its sentence translation when it has none.
 * A sense whose cards were studied is never deleted; two studied duplicates are left as they
 * are. sense_no is only a sort order, so the gap is not renumbered. Writes go through the
 * normal actions, so they sync. Runs once per device; returns the number of senses removed.
 */
export async function repairDuplicateSenses(now: Millis = Date.now()): Promise<number> {
  if (await getMeta<boolean>(DUPLICATE_SENSES_DONE)) return 0;
  const live = await scanWhere(db.senses, (s) => s.deleted_at === null);
  const byNote = new Map<Id, Sense[]>();
  for (const s of live) {
    const list = byNote.get(s.note_id);
    if (list) list.push(s);
    else byNote.set(s.note_id, [s]);
  }
  // A contrast card ("affect ↔ effect", v0.3 İP6) has one sense per term on purpose, often
  // with the same Turkish meaning: never a duplicate.
  const contrast = new Set(
    (await db.notes.bulkGet([...byNote.keys()])).flatMap((n) => (n?.term_type === 'contrast' ? [n.id] : [])),
  );
  const groups = [...byNote.entries()].filter(([id, g]) => g.length > 1 && !contrast.has(id)).map(([, g]) => g);

  const senseIds = groups.flat().map((s) => s.id);
  const cards = senseIds.length ? await db.cards.where('sense_id').anyOf(senseIds).toArray() : [];
  const logs = await logsByCard(cards.map((c) => c.id));
  const studied = new Set<Id>();
  for (const c of cards) {
    if (c.sense_id && (c.reps > 0 || effectiveLogs(logs.get(c.id) ?? []).length > 0)) studied.add(c.sense_id);
  }

  let removed = 0;
  for (const group of groups) {
    group.sort((a, b) => a.sense_no - b.sense_no || (a.id < b.id ? -1 : 1));
    const kept: Sense[] = [];
    for (const s of group) {
      const k = kept.findIndex((x) => sameSense(x, s));
      if (k < 0) {
        kept.push(s);
        continue;
      }
      let keep = kept[k]!;
      let drop = s;
      if (studied.has(drop.id)) {
        if (studied.has(keep.id)) {
          kept.push(s); // both studied: leave them alone
          continue;
        }
        [keep, drop] = [drop, keep];
      } else if (!studied.has(keep.id) && !keep.source_sentence && drop.source_sentence) {
        [keep, drop] = [drop, keep]; // neither studied: keep the one with an example sentence
      }

      const patch: SensePatch = {};
      if (!keep.meaning_tr_override && addsInformation(keep, drop)) {
        // A lexicon sense keeps the shared meaning; the user's wording is an override.
        if (keep.lexicon_sense_id) patch.meaning_tr_override = meaningOf(drop);
        else patch.meaning_tr = meaningOf(drop);
      }
      if (
        !keep.source_sentence_tr &&
        drop.source_sentence_tr &&
        keep.source_sentence &&
        drop.source_sentence &&
        normalizeTerm(keep.source_sentence) === normalizeTerm(drop.source_sentence)
      ) {
        patch.source_sentence_tr = drop.source_sentence_tr;
      }
      await softDeleteSense(drop.id, now);
      if (Object.keys(patch).length) keep = await editSense(keep.id, patch, now);
      kept[k] = keep;
      removed++;
    }
  }
  await setMeta(DUPLICATE_SENSES_DONE, true);
  return removed;
}
