// "Kelimelerin" on Bugün (v0.5.2 "Çam", docs/design.md §4.1): the words learned under the
// stricter rule (recalled on three separate days, holding for two weeks), recall over the last
// 30 days and the stage bar (Öğreniyor … Kalıcı) from the one stage scale.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatNumber, formatPercent } from '@/features/stats/format';
import type { WordStages } from '@/features/stats/useWordStages';
import { buttonClasses, Card, SectionHeader, StageBar } from '@/ui';

const STAGES = ['learning', 'consolidating', 'learned', 'mastered'] as const;

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
  const extra = [
    stages.weekDelta > 0 ? t('today.learnedWeek', { count: stages.weekDelta }) : null,
    stages.active > 0 ? t('today.learnedActive', { count: stages.active }) : null,
  ].filter(Boolean);
  const metGoal = retention !== null && retention >= retentionGoal - 0.005;

  return (
    <section aria-labelledby="words-title" data-testid="home-words">
      <SectionHeader
        id="words-title"
        title={t('today.wordsTitle')}
        action={
          <Link to="/progress" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            {t('today.details')}
            <span className="sr-only">: {t('today.wordsTitle')}</span>
          </Link>
        }
      />
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-2">
            <span className="tabular text-heading font-semibold text-fg" data-testid="learned-total">
              {formatNumber(stages.learnedTotal)}
            </span>
            <span className="text-meta text-fg-muted">
              {t('today.learnedLabel')}{' '}
              {t('today.learnedOf', { count: totalWords, total: formatNumber(totalWords) })}
            </span>
          </p>
          {extra.length > 0 && <p className="text-meta text-fg-muted">{extra.join(' · ')}</p>}
        </div>
        <StageBar stages={STAGES} counts={stages} />
        <p className="text-meta text-fg-muted">{t('today.learnedRule')}</p>
        <p className="flex justify-between gap-3 border-t border-border pt-3 text-meta text-fg-muted">
          <span>{t('today.recallLabel')}</span>
          <span>
            <span className="tabular font-semibold text-fg">
              {retention === null ? '—' : formatPercent(retention)}
            </span>{' '}
            <span className={metGoal ? 'text-success-text' : undefined}>
              · {t('today.recallGoal', { goal: formatPercent(retentionGoal) })}
            </span>
          </span>
        </p>
      </Card>
    </section>
  );
}
