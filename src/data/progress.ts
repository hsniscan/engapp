// Progress tracking ("Gelişim", v0.3 İP5), data side. Reads cards, notes, senses, sources,
// review logs and lexicon levels; writes nothing. The rule and every number live in
// domain/retention.ts; this module only gathers the facts per card. The weekly report (İP7)
// calls loadRetentionInput and then the domain functions directly.
import type { DayKey } from '../domain/day';
import type { LevelData } from '../domain/level';
import { noteLevel } from '../domain/level';
import {
  biggestGapNoteIds,
  buildProgressReport,
  collectRetention,
  makeDayOf,
  pictureRecallComparison,
  type PictureRecall,
  type ProgressReport,
  type RetentionCardFacts,
  type RetentionData,
} from '../domain/retention';
import { dayKeyOf } from '../domain/day';
import type { Id, LexiconSense, Millis, Sense } from '../domain/types';
import { db } from './db';
import { groupLogs } from './history';
import { levelDataNow } from './levelData';
import { dayConfig, getSettings } from './settings';

export interface RetentionInput {
  data: RetentionData;
  /** Live cards of live notes. */
  facts: Map<Id, RetentionCardFacts>;
  /** Today's local day key. */
  today: DayKey;
  /** Titles of live sources, for group labels. */
  sourceTitles: Map<Id, string>;
  /** Display terms of live notes. */
  terms: Map<Id, string>;
}

/**
 * Everything the retention functions need. Levels use the client level file when it is
 * loaded (`levelData`, default levelDataNow()); before that only stored levels and the user's
 * own levels count.
 */
export async function loadRetentionInput(
  now: Millis = Date.now(),
  levelData: LevelData | null = levelDataNow(),
): Promise<RetentionInput> {
  return db.transaction(
    'r',
    [db.settings, db.cards, db.notes, db.senses, db.sources, db.review_logs, db.lexicon_cache],
    async () => {
      const settings = await getSettings(now);
      const cfg = dayConfig(settings);
      const [cards, notes, senses, sources, logs] = await Promise.all([
        db.cards.filter((c) => c.deleted_at === null).toArray(),
        db.notes.filter((n) => n.deleted_at === null).toArray(),
        db.senses.filter((s) => s.deleted_at === null).toArray(),
        db.sources.filter((s) => s.deleted_at === null).toArray(),
        db.review_logs.toArray(),
      ]);
      const lexIds = [
        ...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x)),
      ];
      const lexRows = lexIds.length ? await db.lexicon_cache.bulkGet(lexIds) : [];
      const lexicon = new Map(lexRows.filter((r): r is LexiconSense => !!r).map((r) => [r.id, r]));

      const sensesByNote = new Map<Id, Sense[]>();
      const senseById = new Map<Id, Sense>();
      for (const s of senses) {
        senseById.set(s.id, s);
        const list = sensesByNote.get(s.note_id);
        if (list) list.push(s);
        else sensesByNote.set(s.note_id, [s]);
      }
      for (const list of sensesByNote.values()) list.sort((a, b) => a.sense_no - b.sense_no);
      const topicsBySource = new Map(sources.map((s) => [s.id, s.topics ?? []]));
      const notesById = new Map(notes.map((n) => [n.id, n]));

      const noteFacts = new Map<Id, Omit<RetentionCardFacts, 'card_type'>>();
      const factsOf = (
        noteId: Id,
        own: readonly Sense[],
        withLevel = true,
      ): Omit<RetentionCardFacts, 'card_type'> => {
        const topics = new Set<string>();
        const sourceIds = new Set<Id>();
        const pos = new Set<string>();
        for (const s of own) {
          if (s.source_id && topicsBySource.has(s.source_id)) {
            sourceIds.add(s.source_id);
            for (const t of topicsBySource.get(s.source_id)!) topics.add(t);
          }
          const p = s.pos?.trim().toLowerCase();
          if (p) pos.add(p);
        }
        const note = notesById.get(noteId)!;
        return {
          note_id: noteId,
          term_type: note.term_type,
          level: withLevel
            ? (noteLevel(note, sensesByNote.get(noteId) ?? [], (id) => lexicon.get(id), levelData)
                ?.cefr ?? null)
            : null,
          topics: [...topics],
          sources: [...sourceIds],
          pos: [...pos],
        };
      };

      const facts = new Map<Id, RetentionCardFacts>();
      for (const card of cards) {
        if (!notesById.has(card.note_id)) continue;
        // A sense card (production, cloze) belongs to its sense; recognition to the whole note.
        // The level is the note's (as the app shows it) for every card.
        let nf = noteFacts.get(card.note_id);
        if (!nf)
          noteFacts.set(
            card.note_id,
            (nf = factsOf(card.note_id, sensesByNote.get(card.note_id) ?? [])),
          );
        const sense = card.sense_id ? senseById.get(card.sense_id) : undefined;
        const base = sense ? { ...factsOf(card.note_id, [sense], false), level: nf.level } : nf;
        facts.set(card.id, { ...base, card_type: card.card_type, sense_id: card.sense_id });
      }

      const live = new Set(facts.keys());
      const byCard = groupLogs(logs.filter((l) => live.has(l.card_id)));
      return {
        data: collectRetention(byCard.values(), makeDayOf(cfg)),
        facts,
        today: dayKeyOf(now, cfg),
        sourceTitles: new Map(sources.map((s) => [s.id, s.title])),
        terms: new Map(notes.map((n) => [n.id, n.term])),
      };
    },
  );
}

export interface ProgressView {
  report: ProgressReport;
  /** Titles of the sources that appear in the source groups. */
  sourceTitles: Record<Id, string>;
  /** Notes for the "biggest gaps" practice round, largest gap first. */
  gapNoteIds: Id[];
  /** Terms of the first few gap notes, for the sentence under the button. */
  gapTerms: string[];
  /** v0.4 İP8: recall with vs. without a picture card, over the report's window. */
  picture: PictureRecall;
}

/** The whole "Gelişim" tab. */
export async function getProgressView(
  now: Millis = Date.now(),
  levelData: LevelData | null = levelDataNow(),
): Promise<ProgressView> {
  const input = await loadRetentionInput(now, levelData);
  const report = buildProgressReport(input.data, input.facts, { now, today: input.today });
  const sourceTitles: Record<Id, string> = {};
  for (const g of report.groups.source) {
    const title = input.sourceTitles.get(g.key);
    if (title) sourceTitles[g.key] = title;
  }
  const gapNoteIds = biggestGapNoteIds(report.gap);
  return {
    report,
    sourceTitles,
    gapNoteIds,
    gapTerms: gapNoteIds.slice(0, 3).map((id) => input.terms.get(id) ?? ''),
    picture: pictureRecallComparison(input.data, input.facts, report.window),
  };
}
