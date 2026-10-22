import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getLevelOverview, getMeta, logError, type LevelOverview } from '@/data';
import type { CefrLevel, Millis } from '@/domain/types';

/**
 * Turkish dative of a level, as it is read aloud: "B1'e" (bir → e), "B2'ye" (iki → ye).
 * Passed to i18n as {{nextTo}}; the English strings use {{next}}.
 */
export const levelDative = (level: CefrLevel): string =>
  `${level}'${level.endsWith('1') ? 'e' : 'ye'}`;

const dateFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
/** "21 Ekim 2026" */
export const formatDate = (ms: Millis): string => dateFmt.format(new Date(ms));

/** 0.834 → 83 */
export const pct = (ratio: number): number => Math.round(Math.max(0, Math.min(1, ratio)) * 100);

/**
 * The level overview (level, source, vocabulary counter) for the home screen, statistics and
 * settings. The overview reads every note, card and log, so it is not a live query itself: it
 * is recomputed when the settings row, a level test or a known word changes, and on mount.
 */
export function useLevelOverview(): LevelOverview | undefined {
  const signature = useLiveQuery(async () => {
    const [s, tests, known, learned] = await Promise.all([
      db.settings.get('settings'),
      db.level_tests.count(),
      db.known_terms.count(),
      db.notes.count(),
    ]);
    return `${s?.hlc ?? ''}|${tests}|${known}|${learned}`;
  }, []);
  const [overview, setOverview] = useState<LevelOverview>();
  useEffect(() => {
    if (signature === undefined) return;
    let live = true;
    getLevelOverview()
      .then((o) => {
        if (live) setOverview(o);
      })
      .catch((e: unknown) => void logError(e, 'level.overview'));
    return () => {
      live = false;
    };
  }, [signature]);
  return overview;
}

/** Device-local: the user closed the level-test offer ("Gerek yok"). */
export const OFFER_DISMISSED_KEY = 'level_test_offer_dismissed';

/**
 * The home screen offers the test until the user takes one, chooses a level by hand or says
 * no. Tests and the level sync, so a test on another device hides the offer here too.
 */
export function useOfferVisible(): boolean | undefined {
  return useLiveQuery(async () => {
    const [settings, tests, dismissed] = await Promise.all([
      db.settings.get('settings'),
      db.level_tests.count(),
      getMeta<boolean>(OFFER_DISMISSED_KEY),
    ]);
    return !dismissed && tests === 0 && (settings?.level_source ?? 'default') === 'default';
  }, []);
}
