import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { CardView } from '@/data';
import { type PracticeRound, summarizeRound } from '@/domain/practice';
import type { Id } from '@/domain/types';
import { type PracticeParams, practiceHref } from '@/features/extra/links';
import { formatDuration } from '@/features/stats/format';
import { Button, buttonClasses, duration, ease, Icon } from '@/ui';

export interface PracticeSummaryProps {
  round: PracticeRound;
  views: ReadonlyMap<Id, CardView>;
  timeMs: number;
  params: PracticeParams;
}

function meaningOf(view: CardView): string {
  const senses = view.sense ? [view.sense] : view.senses;
  return senses
    .map((s) => s.meaning_tr_override?.trim() || s.meaning_tr)
    .filter(Boolean)
    .join(', ');
}

export function PracticeSummary({ round, views, timeMs, params }: PracticeSummaryProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const s = summarizeRound(round);
  const hardest = s.hardest.map((id) => views.get(id)).filter((v): v is CardView => !!v);

  const item = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: duration.large, ease: ease.standard, delay: 0.06 * i },
        };

  const stats = [
    { label: t('practice.summary.cards'), value: String(s.cards) },
    { label: t('practice.summary.known'), value: `${s.knownFirstTry}/${s.cards}` },
    { label: t('practice.summary.time'), value: formatDuration(timeMs) },
  ];

  return (
    <section
      aria-labelledby="practice-summary-title"
      className="mx-auto flex w-full max-w-xl flex-col px-4 pt-8 pb-10 sm:px-6 md:pt-14"
    >
      <motion.div {...item(0)} className="flex flex-col items-center text-center">
        <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Icon name="check" size={26} strokeWidth={2} />
        </span>
        <h1
          id="practice-summary-title"
          className="font-serif text-3xl font-semibold tracking-[-0.01em] md:text-4xl"
        >
          {t('practice.summary.title')}
        </h1>
        <p className="mt-2 text-[0.9375rem] text-fg-muted">{t('practice.summary.scheduleSame')}</p>
      </motion.div>

      <motion.dl
        {...item(1)}
        className="mt-8 grid grid-cols-3 divide-x divide-border rounded-card border border-border bg-surface"
      >
        {stats.map((x) => (
          <div key={x.label} className="flex flex-col items-center gap-1 px-2 py-5">
            <dt className="text-sm text-fg-muted">{x.label}</dt>
            <dd className="tabular font-serif text-3xl leading-none font-semibold">{x.value}</dd>
          </div>
        ))}
      </motion.dl>

      <motion.div {...item(2)} className="mt-4 rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm text-fg-muted">{t('practice.summary.hardest')}</h2>
        {hardest.length === 0 ? (
          <p className="mt-2 text-[0.9375rem] text-fg">{t('practice.summary.allKnown')}</p>
        ) : (
          <ol className="mt-2 flex flex-col divide-y divide-border">
            {hardest.map((v) => (
              <li key={v.card.id} className="flex items-baseline gap-3 py-2.5">
                <span lang="en" className="shrink-0 font-serif text-lg font-semibold text-fg">
                  {v.note.term}
                </span>
                <span className="min-w-0 truncate text-[0.9375rem] text-fg-muted">
                  {meaningOf(v)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </motion.div>

      <motion.div {...item(3)} className="mt-8 flex flex-col gap-2">
        <Button size="lg" fullWidth onClick={() => void navigate(practiceHref(params))}>
          {t('practice.summary.again')}
        </Button>
        <Link to="/more" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
          {t('practice.backToMore')}
        </Link>
        <Link to="/" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
          {t('review.backHome')}
        </Link>
      </motion.div>
    </section>
  );
}
