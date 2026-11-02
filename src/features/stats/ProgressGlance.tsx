// İlerleme at the top of Profil (v0.5.1, ADR 0057; v0.5.2 design 4.14): three numbers
// (Öğrenilen · Seri · Hatırlama, labels under the values) and the last seven days as a
// HeatStrip, with "Tümünü gör" to the full /progress page.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, getHeatmap, getStreakSummary } from '@/data';
import { activityBasics, progressUnlocks } from '@/domain/progressView';
import {
  buttonClasses,
  Card,
  HeatStrip,
  Icon,
  SectionHeader,
  Skeleton,
  StatRow,
  StatTile,
  type HeatLevel,
} from '@/ui';
import { formatNumber, formatPercent } from './format';
import { heatLabel } from './heatLabel';

const LEVELS: HeatLevel[] = ['empty', 'active', 'completed'];

export function ProgressGlance() {
  const { t } = useTranslation();
  const data = useLiveQuery(async () => {
    const [streak, weeks, activity] = await Promise.all([
      getStreakSummary(),
      getHeatmap(Date.now(), 2),
      db.daily_activity.toArray(),
    ]);
    const days = weeks
      .flat()
      .filter((c) => !c.future)
      .slice(-7);
    // Recall shows from the same number of answers as on İlerleme (B8).
    const basics = activityBasics(activity, streak.today);
    const recallOpen =
      progressUnlocks({
        ...basics,
        recognitionAnswers: 0,
        productionAnswers: 0,
        hasReport: false,
      }).find((u) => u.key === 'recall')?.open ?? false;
    return { streak, days, recallOpen };
  }, []);
  const active = data?.days.filter((d) => d.reviews > 0).length ?? 0;

  return (
    <section aria-labelledby="profile-progress" data-testid="profile-progress">
      <SectionHeader
        id="profile-progress"
        title={t('progressGlance.title')}
        action={
          <Link
            to="/progress"
            aria-label={t('progressGlance.seeAllLabel')}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            {t('progressGlance.seeAll')}
            <Icon name="chevron-right" size={16} />
          </Link>
        }
      />
      {!data ? (
        <Card aria-busy="true">
          <Skeleton lines={2} />
        </Card>
      ) : data.streak.totalActiveDays === 0 ? (
        <Card>
          <p className="text-ui text-fg-muted">{t('progressGlance.none')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <StatRow>
            <StatTile
              bare
              value={formatNumber(data.streak.learnedCards)}
              label={t('progressGlance.learned')}
            />
            <StatTile
              bare
              value={formatNumber(data.streak.currentStreak)}
              unit={t('progressGlance.dayUnit')}
              label={t('progressGlance.streak')}
            />
            <StatTile
              bare
              value={
                !data.recallOpen || data.streak.retentionRate === null
                  ? '—'
                  : formatPercent(data.streak.retentionRate)
              }
              label={t('progressGlance.retention')}
            />
          </StatRow>
          <Card className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-ui font-semibold text-fg">{t('progressGlance.week')}</h3>
              <span className="tabular text-meta text-fg-muted">
                {t('progressGlance.weekLabel', { count: active })}
              </span>
            </div>
            <HeatStrip
              label={t('progressGlance.weekLabel', { count: active })}
              days={data.days.map((d) => ({
                level: LEVELS[d.level] ?? 'empty',
                label: heatLabel(t, d),
              }))}
            />
          </Card>
        </div>
      )}
    </section>
  );
}
