// "Çalışma türleri": one tile per study mode with what is due today (board Main), or
// "Bugünlük bitti" once a mode is done (board HomeDone).
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { StudyMode, StudyModeCount } from '@/features/review/studyModes';
import { cn } from '@/ui';
import { HomeIcon, type HomeIconName } from './homeIcons';

const MODES: { mode: StudyMode; icon: HomeIconName; tone: string }[] = [
  { mode: 'word', icon: 'word', tone: 'bg-accent-soft text-accent-text' },
  { mode: 'production', icon: 'production', tone: 'bg-success-soft text-success-text' },
  { mode: 'cloze', icon: 'cloze', tone: 'bg-warn-soft text-warn-text' },
];

export function StudyTypes({
  counts,
  answered,
  finishedHero,
}: {
  counts: Record<StudyMode, StudyModeCount>;
  /** Answers given today per mode: an empty mode is "done" only when it was studied. */
  answered: Record<StudyMode, number>;
  /** The word study is done for today (the header counts the modes still waiting). */
  finishedHero: boolean;
}) {
  const { t } = useTranslation();
  const waiting = MODES.filter(({ mode }) => counts[mode].due + counts[mode].newCount > 0).length;
  return (
    <section aria-labelledby="study-types-title" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
        <h2 id="study-types-title" className="font-serif text-[1.1875rem] font-semibold">
          {t('today.typesTitle')}
        </h2>
        <span className="text-[0.8125rem] text-fg-muted">
          {finishedHero
            ? waiting > 0
              ? t('today.typesWaiting', { count: waiting })
              : t('today.typesAllDone')
            : t('today.typesDue')}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-2.5">
        {MODES.map(({ mode, icon, tone }) => {
          const n = counts[mode].due + counts[mode].newCount;
          const finished = n === 0;
          const studied = answered[mode] > 0;
          const unit = mode === 'cloze' ? t('today.unitSentence') : t('today.unitCard');
          return (
            <li key={mode} className="flex">
              <Link
                to={`/study?mode=${mode}`}
                data-testid={`study-type-${mode}`}
                aria-label={
                  finished
                    ? t(studied ? 'today.typeDoneLabel' : 'today.typeNoneLabel', {
                        mode: t(`today.mode.${mode}`),
                      })
                    : t('today.typeLabel', {
                        mode: t(`today.mode.${mode}`),
                        hint: t(`today.modeHintLong.${mode}`),
                        count: n,
                        unit,
                      })
                }
                className="flex min-h-37 flex-1 flex-col gap-2 rounded-[18px] border border-border bg-surface px-3 pt-3.5 pb-3 text-fg transition-colors duration-(--duration-micro) hover:border-border-strong"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-9 items-center justify-center rounded-[11px]',
                    finished && studied ? 'bg-success-soft text-success-text' : tone,
                  )}
                >
                  <HomeIcon
                    name={finished && studied ? 'check' : icon}
                    size={19}
                    strokeWidth={finished && studied ? 2 : 1.7}
                  />
                </span>
                <span className="flex flex-col gap-px">
                  <span className="text-[0.9375rem] leading-tight font-semibold">
                    {t(`today.mode.${mode}`)}
                  </span>
                  <span className="text-xs text-fg-muted">{t(`today.modeHint.${mode}`)}</span>
                </span>
                {finished ? (
                  <span
                    className={cn(
                      'mt-auto text-sm font-semibold',
                      studied ? 'text-success-text' : 'text-fg-muted',
                    )}
                  >
                    {studied ? t('today.typeDone') : t('today.typeNone')}
                  </span>
                ) : (
                  <span className="mt-auto flex items-baseline gap-1">
                    <span className="tabular font-serif text-2xl leading-none font-semibold">
                      {n}
                    </span>
                    <span className="text-[0.8125rem] text-fg-muted">{unit}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
