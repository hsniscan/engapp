// Bulk picture priority (v0.4 İP9, decision 0037). The nightly job queues senses in this order:
//
//   1. senses in any user's cards: an app admin's (the owner's) first, then by number of users
//   2. senses within the owner's CEFR level ±1, most frequent first (wordfreq Zipf)
//   3. the rest of the 5,000 most frequent lemmas, most frequent first
//
// Anything else is not queued automatically (a user can still ask for a picture). Only senses
// with visualizability >= VISUAL_AUTO_MIN are queued at all. The SQL twin is
// public.image_auto_priority (supabase/migrations/20261026001010_image_priority.sql); the
// tests here and in supabase/tests/database/31_image_priority.test.sql pin the same numbers.
//
// The other queue priorities (20261025000200_images.sql) stay above these: an admin redraw
// 4000, a user request 3000 + 100 per user.

import type { Cefr } from './cefr.ts';

/** How many of the most frequent lemmas the bulk run covers (tier 3). */
export const BULK_TOP_LEMMAS = 5000;

export const AUTO_PRIORITY = {
  adminCards: 2000,
  anyCards: 1000,
  ownerBand: 500,
  topLemmas: 100,
} as const;

const CEFR_ORDER: readonly Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export interface PriorityInput {
  /** The sense is in at least one app admin's live cards. */
  inAdminCards: boolean;
  /** Distinct users with the sense in their live cards. */
  users: number;
  /** The sense's resolved level (null: not resolved yet). */
  cefr: Cefr | null;
  /** The admins' own levels (settings.level); empty: unknown. */
  ownerLevels: readonly Cefr[];
  /** Zipf of the lemma: lexicon_terms.zipf, else the reference data; null: unknown. */
  zipf: number | null;
  /**
   * The lemma is among the BULK_TOP_LEMMAS most frequent. True for every lemma while no
   * frequency data is loaded, so the queue still fills (decision 0037).
   */
  inTop: boolean;
}

/** Within ±1 level of any of the owner levels. */
export function inOwnerBand(cefr: Cefr | null, ownerLevels: readonly Cefr[]): boolean {
  if (!cefr) return false;
  const i = CEFR_ORDER.indexOf(cefr);
  return ownerLevels.some((o) => Math.abs(CEFR_ORDER.indexOf(o) - i) <= 1);
}

const freqPoints = (zipf: number | null) =>
  zipf === null || !Number.isFinite(zipf) ? 0 : Math.max(0, Math.min(90, Math.round(zipf * 10)));

/** The auto-queue priority of a sense, or null when it is not queued automatically. */
export function autoPriority(p: PriorityInput): number | null {
  const users = Math.max(0, Math.min(999, p.users));
  if (p.inAdminCards) return AUTO_PRIORITY.adminCards + users;
  if (users > 0) return AUTO_PRIORITY.anyCards + users;
  if (inOwnerBand(p.cefr, p.ownerLevels)) return AUTO_PRIORITY.ownerBand + freqPoints(p.zipf);
  if (p.inTop) return AUTO_PRIORITY.topLemmas + freqPoints(p.zipf);
  return null;
}
