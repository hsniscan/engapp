// "Bugünün okuması" on Bugün (v0.5 İP1): a quiet card. Continue the text left unfinished;
// otherwise the library text that best fits the user's difficulty (İP5), which opens itself in
// the reader (v0.5.1); otherwise an invitation to paste a text. The library's data code is
// loaded on demand (it stays out of the start-up bundle, decision 0053).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { lastUnfinishedText, logError, readingDifficultyOf } from '@/data';
import type { GradedSummary } from '@/data/library';
import { readerPath } from '@/domain/texts';
import { gradedReaderPath } from '@/features/library/openReading';
import { openAddSheet } from '@/features/add/addSheetStore';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { TodayStoryRow } from '@/features/story/TodayStoryRow';
import { Button } from '@/ui';

const SUGGEST_DELAY_MS = 1500;

function useSuggestion(enabled: boolean): GradedSummary | null | undefined {
  const { settings } = useAppSettings();
  const difficulty = settings ? readingDifficultyOf(settings) : null;
  const [state, setState] = useState<{ key: string; value: GradedSummary | null } | null>(null);
  useEffect(() => {
    if (!enabled || !difficulty) return;
    let live = true;
    // Scoring the library reads every card: wait until Bugün itself has painted.
    const timer = setTimeout(() => {
      import('@/data/library')
        .then((m) => m.suggestedGradedTexts(difficulty, 1))
        .then((list) => live && setState({ key: difficulty, value: list[0] ?? null }))
        .catch((e: unknown) => {
          void logError(e, 'reader.today.suggest');
          if (live) setState({ key: difficulty, value: null });
        });
    }, SUGGEST_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, difficulty]);
  if (!enabled) return null;
  return state && state.key === difficulty ? state.value : undefined;
}

export function TodayReadingCard() {
  const { t } = useTranslation();
  const last = useLiveQuery(() => lastUnfinishedText(), []);
  const suggestion = useSuggestion(last === null);
  if (last === undefined || (last === null && suggestion === undefined)) return null;

  const frame = (body: React.ReactNode) => (
    <section
      aria-labelledby="today-reading"
      className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface px-4 py-4"
      data-testid="today-reading"
    >
      <h2
        id="today-reading"
        className="text-[0.8125rem] font-semibold tracking-wide text-fg-muted uppercase"
      >
        {t('reader.today.title')}
      </h2>
      {body}
      <TodayStoryRow hideTextId={last?.id ?? null} />
    </section>
  );

  if (last) {
    const pct = last.body.length ? Math.round((last.progress_offset / last.body.length) * 100) : 0;
    return frame(
      <Link to={readerPath(last.id)} className="group flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            lang="en"
            className="truncate font-serif text-lg font-semibold text-fg group-hover:underline"
          >
            {last.title}
          </span>
          <span className="text-sm text-fg-muted">
            {pct > 0 ? t('reader.today.continue', { pct }) : t('reader.today.start')}
          </span>
        </span>
        <span className="text-sm font-medium text-accent-text">{t('reader.today.open')}</span>
      </Link>,
    );
  }
  if (suggestion) {
    return frame(
      <Link to={gradedReaderPath(suggestion.id)} className="group flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            lang="en"
            className="truncate font-serif text-lg font-semibold text-fg group-hover:underline"
          >
            {suggestion.title}
          </span>
          <span className="text-sm text-fg-muted">
            {t('reader.today.suggested', { level: suggestion.level, count: suggestion.words })}
          </span>
        </span>
        <span className="text-sm font-medium text-accent-text">{t('reader.today.open')}</span>
      </Link>,
    );
  }
  return frame(
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 flex-1 text-[0.9375rem] text-fg-muted">{t('reader.today.empty')}</p>
      <Button variant="secondary" size="sm" onClick={() => openAddSheet()}>
        {t('reader.today.paste')}
      </Button>
    </div>,
  );
}
