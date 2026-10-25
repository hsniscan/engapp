// "Kelimelerin" (board Main): the words learned under the stricter rule (a word counts once it
// was recalled on three separate days and holds for two weeks), the stage bar, and recall.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatNumber, formatPercent } from '@/features/stats/format';
import type { WordStages } from '@/features/stats/useWordStages';
import { cn } from '@/ui';
import { HomeIcon } from './homeIcons';

const STAGES = [
  { key: 'learning', color: 'bg-stage-learning', strong: false },
  { key: 'consolidating', color: 'bg-stage-consolidating', strong: false },
  { key: 'learned', color: 'bg-stage-learned', strong: true },
  { key: 'mastered', color: 'bg-stage-mastered', strong: true },
] as const;

export function WordsCard({
  stages,
  totalWords,
  retention,
  retentionGoal,
}: {
  stages: WordStages;
  totalWords: number;
  /** Recall over the last 30 days (null: too few answers). */
  retention: number | null;
  retentionGoal: number;
}) {
  const { t } = useTranslation();
  const anyStage = STAGES.some((s) => stages[s.key] > 0);
  const label = STAGES.map((s) =>
    t('today.stageCount', { stage: t(`today.stage.${s.key}`), count: stages[s.key] }),
  ).join(', ');
  const extra = [
    stages.weekDelta > 0 ? t('today.learnedWeek', { count: stages.weekDelta }) : null,
    stages.active > 0 ? t('today.learnedActive', { count: stages.active }) : null,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby="words-title"
      className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface px-4.5 py-4"
      data-testid="home-words"
    >
      <div className="flex items-center justify-between">
        <h2 id="words-title" className="font-serif text-[1.1875rem] font-semibold">
          {t('today.wordsTitle')}
        </h2>
        <Link
          to="/progress"
          className="-my-3 flex min-h-11 items-center text-sm text-accent-text hover:underline"
          aria-label={t('today.wordsMoreLabel')}
        >
          {t('today.details')}
        </Link>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[0.8125rem] text-fg-muted">{t('today.learnedLabel')}</span>
        <span className="flex items-baseline gap-2">
          <span
            className="tabular font-serif text-[2.5rem] leading-[1.05] font-semibold"
            data-testid="learned-total"
          >
            {formatNumber(stages.learnedTotal)}
          </span>
          <span className="text-sm text-fg-muted">
            {t('today.learnedOf', { count: totalWords, total: formatNumber(totalWords) })}
          </span>
        </span>
        {extra.length > 0 && (
          <span className="text-[0.8125rem] text-fg-muted">{extra.join(' · ')}</span>
        )}
      </div>
      <div
        role="img"
        aria-label={t('today.stagesLabel', { list: label })}
        className="flex h-2.5 gap-[3px]"
      >
        {anyStage ? (
          STAGES.filter((s) => stages[s.key] > 0).map((s) => (
            <span
              key={s.key}
              className={cn('rounded-[5px]', s.color)}
              style={{ flex: stages[s.key] }}
            />
          ))
        ) : (
          <span className="flex-1 rounded-[5px] bg-surface-sunken" />
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm" aria-hidden="true">
        {STAGES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-[3px]', s.color)} />
            <span className={cn('flex-1', s.strong ? 'text-fg' : 'text-fg-muted')}>
              {t(`today.stage.${s.key}`)}
            </span>
            <span className="tabular font-semibold">{formatNumber(stages[s.key])}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.8125rem] leading-[1.45] text-fg-muted">
        <HomeIcon name="info" size={16} strokeWidth={1.8} className="mt-0.5 text-fg-subtle" />
        <span>{t('today.learnedRule')}</span>
      </p>
      <div className="flex justify-between gap-3 border-t border-surface-sunken pt-3 text-[0.8125rem] text-fg-muted">
        <span>{t('today.recallLabel')}</span>
        <span>
          <strong className="font-semibold text-fg">
            {retention === null ? '—' : formatPercent(retention)}
          </strong>{' '}
          <span
            className={cn(
              retention !== null && retention >= retentionGoal - 0.005 && 'text-success-text',
            )}
          >
            · {t('today.recallGoal', { goal: formatPercent(retentionGoal) })}
          </span>
        </span>
      </div>
    </section>
  );
}
