// İlerleme → Genel: "Öğrendiğin kelimeler" (learning model, plan/ogrenme-modeli.md §2.4–2.5).
// The headline counts words whose recognition card is Öğrenildi or Kalıcı; the bar shows every
// started word by stage in the ONE stage scale; "Zaten bildiğin kelimeler" stands apart and
// never adds to the count.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge, Card, cn, Icon, SectionHeader, Skeleton, StageBar, stageBg } from '@/ui';
import { formatNumber } from './format';
import { useWordStages } from './useWordStages';

const STAGES = ['learning', 'consolidating', 'learned', 'mastered'] as const;

export function StagesSection() {
  const { t } = useTranslation();
  const s = useWordStages();
  if (!s) {
    return (
      <Card padding="lg" aria-busy="true">
        <Skeleton lines={4} />
      </Card>
    );
  }
  const started = STAGES.reduce((n, k) => n + s[k], 0);
  return (
    <section aria-labelledby="stages-title" data-testid="word-stages">
      <SectionHeader id="stages-title" title={t('stats.overview.stagesTitle')} />
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular text-numeral font-semibold text-fg" data-testid="learned-total">
              {formatNumber(s.learnedTotal)}
            </span>
            {s.weekDelta > 0 && (
              <Badge tone="accent">{t('stats.overview.weekDelta', { count: s.weekDelta })}</Badge>
            )}
          </p>
          <p className="text-meta text-fg-muted">{t('stats.overview.stagesRule')}</p>
        </div>

        {started === 0 ? (
          <p className="text-ui text-fg-muted">{t('stats.overview.stagesEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <StageBar counts={s} stages={STAGES} legend={false} />
            <ul
              aria-label={t('stats.overview.stagesBarLabel')}
              className="grid grid-cols-2 gap-x-4 gap-y-3"
            >
              {STAGES.map((k) => (
                <li
                  key={k}
                  className="flex min-w-0 items-start gap-2"
                  title={t(`stats.overview.stageHint.${k}`)}
                >
                  <span
                    aria-hidden="true"
                    className={cn('mt-1 size-2.5 shrink-0 rounded-full', stageBg[k])}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-meta text-fg-muted">{t(`ui.stage.${k}`)}</span>
                    <span className="tabular text-ui font-semibold text-fg">
                      {formatNumber(s[k])}
                      <span className="sr-only">
                        {' '}
                        ({Math.round((s[k] / started) * 100)}%) ·{' '}
                        {t(`stats.overview.stageHint.${k}`)}
                      </span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.active > 0 && (
          <p className="text-meta text-fg">{t('stats.overview.active', { count: s.active })}</p>
        )}

        <Link
          to="/settings/bilinen-kelimeler"
          className="-mx-4 -mb-4 flex min-h-14 items-center gap-3 rounded-b-card border-t border-border px-4 py-3 text-fg hover:bg-hover sm:-mx-5 sm:-mb-5 sm:px-5"
          data-testid="already-known"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-ui font-medium">
              {t('stats.overview.alreadyKnown')}:{' '}
              <span className="tabular">{formatNumber(s.alreadyKnown)}</span>
            </span>
            <span className="text-meta text-fg-muted">{t('stats.overview.alreadyKnownHint')}</span>
          </span>
          <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
        </Link>
      </Card>
    </section>
  );
}
