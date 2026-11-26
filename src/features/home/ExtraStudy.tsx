// "Ekstra çalışma" on Bugün (ADR 0079): the optional study modes — Üretim, Boşluk doldurma and
// Dikte — as one list under the Today card. They are not part of the daily study: Bugün's
// card, "Bugünlük tamam" and the day's new words count Kelime çalışma alone.
import { useTranslation } from 'react-i18next';
import { MODE_ICON, modeText } from '@/features/review/modeText';
import { modeLeft, type TodayStudy } from '@/features/review/studyModes';
import { ListGroup, ListRow, SectionHeader } from '@/ui';

export function ExtraStudy({ study }: { study: TodayStudy }) {
  const { t } = useTranslation();
  if (study.extraModes.length === 0) return null;
  return (
    <section aria-labelledby="extra-study-title" data-testid="extra-study">
      <SectionHeader
        id="extra-study-title"
        title={t('extraStudy.title')}
        description={t('extraStudy.body')}
      />
      <ListGroup>
        {study.extraModes.map((m) => {
          const c = study.counts[m];
          const n = modeLeft(c);
          const locked = study.locked.includes(m);
          return (
            <ListRow
              key={m}
              to={`/study?mode=${m}`}
              testId={`extra-study-${m}`}
              leadingIcon={MODE_ICON[m]}
              title={modeText(t, m, 'name')}
              description={locked ? modeText(t, m, 'note') : modeText(t, m, 'dir')}
              meta={
                n > 0 ? t('today.chipCount', { count: n }) : locked ? null : t('extraStudy.none')
              }
            />
          );
        })}
      </ListGroup>
    </section>
  );
}
