import { countOptimizerReviews, getSettings, type ReviewCounts } from '@/data';
import { MIN_REVIEWS, shouldSuggest } from '@/domain/fsrsOptimizer';
import type { Settings } from '@/domain/types';
import { useNow } from '@/features/settings/useNow';
import { usePausedLiveQuery } from '@/features/settings/usePausedLiveQuery';

export interface OptimizerStatus {
  settings: Settings;
  counts: ReviewCounts;
  /** Enough reviews to run at all. */
  enough: boolean;
  /** The app suggests a run now (first time at 1 000 reviews, then monthly). */
  suggested: boolean;
  /** Personal parameters are in use ("Eski ayara dön" is offered). */
  personal: boolean;
}

/** Live: review counts and whether a run is suggested. undefined while loading. */
export function useOptimizerStatus(): OptimizerStatus | undefined {
  const now = Math.floor(useNow() / 3_600_000) * 3_600_000;
  return usePausedLiveQuery(async () => {
    const settings = await getSettings();
    const counts = await countOptimizerReviews(settings.fsrs_opt_at);
    return {
      settings,
      counts,
      enough: counts.total >= MIN_REVIEWS,
      suggested: shouldSuggest({
        reviews: counts.total,
        reviewsSinceLastRun: counts.sinceLastRun,
        lastRunAt: settings.fsrs_opt_at,
        now,
      }),
      personal: settings.fsrs_params !== null,
    };
  }, [now]);
}
