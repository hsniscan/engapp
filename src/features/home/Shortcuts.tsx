// "Kısayollar" on Bugün (v0.5.2 "Çam", docs/design.md §4.1): the hard words (a practice round
// that never moves the plan), last week's report until it is opened, the word bank and the
// goals (minutes today against the daily goal). Goals themselves are set on İlerleme / Ayarlar.
import { useTranslation } from 'react-i18next';
import { practiceHref } from '@/features/extra/links';
import { REPORT_TAB_PARAM } from '@/features/report/links';
import { ListGroup, ListRow, SectionHeader } from '@/ui';
import type { HomeGoals, Shortcuts as ShortcutsData } from './todayQueries';

export const GOALS_EDIT_HREF = '/progress?edit=goals';
export const WORD_BANK_HREF = '/decks?tab=bank';

export function Shortcuts({
  data,
  showHard,
  goals,
  todayMinutes,
}: {
  data: ShortcutsData;
  showHard: boolean;
  goals: HomeGoals | undefined;
  todayMinutes: number;
}) {
  const { t } = useTranslation();
  const hard = showHard ? (data.more?.practice.hard ?? 0) : 0;
  const report = data.report;
  const day = goals?.dayTarget ?? null;
  return (
    <section aria-labelledby="shortcuts-title" data-testid="home-shortcuts">
      <SectionHeader id="shortcuts-title" title={t('today.shortcuts')} />
      <ListGroup>
        {hard > 0 && (
          <ListRow
            to={practiceHref({ source: 'hard', size: 10, tag: null })}
            leadingIcon="alert"
            leadingTone="warn"
            title={t('today.hardTitle')}
            description={t('today.hardBody')}
            meta={hard}
          />
        )}
        {report && (
          <ListRow
            to={`/progress?tab=${REPORT_TAB_PARAM}`}
            leadingIcon="chart"
            leadingTone="accent"
            title={t('today.reportTitle')}
            description={
              report.activeDays > 0
                ? t('today.reportBody', { count: report.activeDays, fresh: report.newCards })
                : t('today.reportBodyEmpty')
            }
          />
        )}
        <ListRow
          to={WORD_BANK_HREF}
          leadingIcon="layers"
          leadingTone="accent"
          title={t('today.bankTitle')}
          description={t('today.bankBody')}
        />
        {day !== null && (
          <ListRow
            to={GOALS_EDIT_HREF}
            leadingIcon="target"
            title={t('today.goalsTitle')}
            description={
              todayMinutes >= day ? t('today.goalTodayDone') : t('today.goalsBody')
            }
            meta={
              <span data-testid="goal-day">
                {t('today.goalProgress', { value: todayMinutes, target: day })}
              </span>
            }
          />
        )}
      </ListGroup>
    </section>
  );
}
