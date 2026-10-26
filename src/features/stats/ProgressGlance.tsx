// İlerleme at the top of Profil (v0.5.1, ADR 0057): İlerleme left the tab bar for Keşfet, so
// Profil opens with a short summary (streak, words learned, recall, the last seven days) and
// "Tümünü gör" to the full /progress page.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getHeatmap, getStreakSummary } from '@/data';
import { cn, Icon, Skeleton } from '@/ui';
import { formatNumber, formatPercent } from './format';

export function ProgressGlance() {
  const { t } = useTranslation();
  const data = useLiveQuery(async () => {
    const [streak, weeks] = await Promise.all([getStreakSummary(), getHeatmap(Date.now(), 2)]);
    const days = weeks.flat().filter((c) => !c.future).slice(-7);
    return { streak, days };
  }, []);
  const active = data?.days.filter((d) => d.reviews > 0).length ?? 0;

  return (
    <section
      aria-labelledby="profile-progress"
      className="flex flex-col gap-3.5 rounded-card border border-border bg-surface px-[1.125rem] pt-2 pb-[1.125rem]"
      data-testid="profile-progress"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="profile-progress" className="font-serif text-[1.1875rem] font-semibold text-fg">
          {t('progressGlance.title')}
        </h2>
        <Link
          to="/progress"
          aria-label={t('progressGlance.seeAllLabel')}
          className="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-control px-2 text-sm font-medium text-accent-text hover:bg-hover"
        >
          {t('progressGlance.seeAll')}
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {!data ? (
        <Skeleton className="h-20 w-full" />
      ) : data.streak.totalActiveDays === 0 ? (
        <p className="text-[0.9375rem] text-fg-muted">{t('progressGlance.none')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Stat
              label={t('progressGlance.streak')}
              value={t('progressGlance.streakValue', { count: data.streak.currentStreak })}
            />
            <Stat
              label={t('progressGlance.learned')}
              value={t('progressGlance.learnedValue', {
                count: data.streak.learnedCards,
                formatted: formatNumber(data.streak.learnedCards),
              })}
            />
            <Stat
              label={t('progressGlance.retention')}
              value={data.streak.retentionRate === null ? '—' : formatPercent(data.streak.retentionRate)}
            />
          </dl>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-[0.8125rem] text-fg-muted">{t('progressGlance.week')}</span>
            <ol
              role="img"
              aria-label={t('progressGlance.weekLabel', { count: active })}
              className="flex gap-1.5"
            >
              {data.days.map((d) => (
                <li
                  key={d.date}
                  className={cn(
                    'size-4 rounded-[4px]',
                    d.reviews > 0 ? 'bg-accent' : 'border border-border bg-surface-sunken',
                  )}
                />
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd className="tabular truncate font-serif text-[1.375rem] leading-tight font-semibold text-fg">{value}</dd>
    </div>
  );
}
