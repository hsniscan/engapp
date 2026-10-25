// İlerleme → Genel: "Öğrendiğin kelimeler" (learning model, plan/ogrenme-modeli.md §2.4–2.5).
// The headline counts words whose recognition card is Öğrenildi or Kalıcı; the bar shows every
// started word by stage; "Zaten bildiğin kelimeler" stands apart and never adds to the count.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn, Icon, Skeleton, Surface } from '@/ui';
import { formatNumber } from './format';
import { useWordStages, type WordStageCounts } from './useWordStages';

const STAGES = ['learning', 'consolidating', 'learned', 'mastered'] as const;
type Stage = (typeof STAGES)[number];

const SWATCH: Record<Stage, string> = {
  learning: 'bg-border-strong',
  consolidating: 'bg-accent-text/55',
  learned: 'bg-accent',
  mastered: 'bg-success',
};

export function StagesSection() {
  const { t } = useTranslation();
  const s = useWordStages();
  if (!s) {
    return (
      <Surface padding="lg" aria-busy="true">
        <Skeleton lines={4} />
      </Surface>
    );
  }
  const started = STAGES.reduce((n, k) => n + s[k], 0);
  return (
    <section
      aria-labelledby="stages-title"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:p-6"
      data-testid="word-stages"
    >
      <div className="flex flex-col gap-1">
        <h2 id="stages-title" className="font-serif text-[1.1875rem] font-semibold text-fg">
          {t('stats.overview.stagesTitle')}
        </h2>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="tabular font-serif text-5xl leading-none font-semibold tracking-[-0.02em] text-fg"
            data-testid="learned-total"
          >
            {formatNumber(s.learnedTotal)}
          </span>
          {s.weekDelta > 0 && (
            <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-sm font-semibold text-success-text">
              {t('stats.overview.weekDelta', { count: s.weekDelta })}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{t('stats.overview.stagesRule')}</p>
      </div>

      {started === 0 ? (
        <p className="text-[0.9375rem] text-fg-muted">{t('stats.overview.stagesEmpty')}</p>
      ) : (
        <StageBar s={s} total={started} />
      )}

      {s.active > 0 && (
        <p className="text-sm text-fg">{t('stats.overview.active', { count: s.active })}</p>
      )}

      <Link
        to="/settings/bilinen-kelimeler"
        className="-mx-2 flex min-h-12 items-center gap-3 rounded-control border-t border-border px-2 pt-3.5 text-fg hover:bg-hover"
        data-testid="already-known"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-semibold">
            {t('stats.overview.alreadyKnown')}:{' '}
            <span className="tabular">{formatNumber(s.alreadyKnown)}</span>
          </span>
          <span className="text-[0.8125rem] text-fg-muted">
            {t('stats.overview.alreadyKnownHint')}
          </span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
      </Link>
    </section>
  );
}

function StageBar({ s, total }: { s: WordStageCounts; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        {STAGES.filter((k) => s[k] > 0).map((k) => (
          <span key={k} className={cn('h-full', SWATCH[k])} style={{ flexGrow: s[k] }} />
        ))}
      </div>
      <ul
        aria-label={t('stats.overview.stagesBarLabel')}
        className="grid grid-cols-2 gap-x-4 gap-y-2.5"
      >
        {STAGES.map((k) => (
          <li
            key={k}
            className="flex min-w-0 items-start gap-2"
            title={t(`stats.overview.stageHint.${k}`)}
          >
            <span
              aria-hidden="true"
              className={cn('mt-1.5 size-2.5 shrink-0 rounded-[3px]', SWATCH[k])}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-fg-muted">{t(`stats.overview.stage.${k}`)}</span>
              <span className="tabular text-[0.9375rem] font-semibold text-fg">
                {formatNumber(s[k])}
                <span className="sr-only">
                  {' '}
                  ({Math.round((s[k] / total) * 100)}%) · {t(`stats.overview.stageHint.${k}`)}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
