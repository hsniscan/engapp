// "Dinleyerek çalış" on /study/more (v0.5 İP9, ADR 0051): today's Dikte cards and the
// hands-free round ("Eller serbest"), which never changes the schedule. The Dikte link shows
// only when it has cards today (v0.5.1: no "Dikte'de bugün kart yok" line here).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MoreStudyOverview } from '@/data';
import { HANDS_FREE_SIZES, handsFreeHref } from '@/domain/handsFree';
import type { PracticeSource } from '@/domain/practice';
import { modeLeft, useTodayStudy } from '@/features/review/studyModes';
import { buttonClasses, Icon, SegmentedControl, Surface } from '@/ui';

export function ListenSection({ data }: { data: MoreStudyOverview }) {
  const { t } = useTranslation();
  const today = useTodayStudy();
  const [size, setSize] = useState<number>(HANDS_FREE_SIZES[0]);
  const dictation = today?.dictation ? modeLeft(today.counts.dictation) : 0;
  // The words heard: the hard ones first, else the recent ones.
  const source: PracticeSource | null =
    data.practice.hard > 0 ? 'hard' : data.practice.recent > 0 ? 'recent' : null;
  return (
    <Surface as="section" aria-labelledby="more-listen" padding="none" className="p-5 sm:p-6">
      <h2 id="more-listen" className="font-serif text-xl font-semibold text-fg">
        {t('modes.handsFree.moreTitle')}
      </h2>
      <p className="mt-1 text-[0.9375rem] text-fg-muted">{t('modes.handsFree.moreBody')}</p>
      <div className="mt-5 flex flex-col gap-4">
        {dictation > 0 && (
          <Link
            to="/study?mode=dictation"
            data-testid="more-dictation"
            className={buttonClasses({ variant: 'secondary', fullWidth: true })}
          >
            {t('modes.handsFree.moreDictation', { count: dictation })}
            <Icon name="chevron-right" size={18} />
          </Link>
        )}
        {source ? (
          <>
            <SegmentedControl
              legend={t('more.sizeLegend')}
              options={HANDS_FREE_SIZES.map((n) => ({ value: String(n), label: t('more.size', { count: n }) }))}
              value={String(size)}
              onValueChange={(v) => setSize(Number(v))}
            />
            <Link
              to={handsFreeHref(source, size)}
              data-testid="more-hands-free"
              className={buttonClasses({ variant: 'secondary', fullWidth: true })}
            >
              {t('modes.handsFree.moreStart')}
            </Link>
          </>
        ) : (
          <p className="text-[0.9375rem] text-fg">{t('more.practiceNone')}</p>
        )}
      </div>
    </Surface>
  );
}
