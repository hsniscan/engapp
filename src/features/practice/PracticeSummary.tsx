// End of a practice round (v0.5.2 "Çam", ADR 0066): the summary frame of the study session.
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { CardView } from '@/data';
import { type PracticeRound, summarizeRound } from '@/domain/practice';
import type { Id } from '@/domain/types';
import { type PracticeParams, practiceHref } from '@/features/extra/links';
import { formatDuration } from '@/features/stats/format';
import {
  Button,
  buttonClasses,
  Card,
  duration,
  ease,
  Icon,
  ListGroup,
  ListRow,
  ProgressRing,
  SectionHeader,
  StatRow,
  StatTile,
} from '@/ui';

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
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: duration.medium, ease: ease.standard, delay: 0.05 * i },
        };

  return (
    <section
      aria-labelledby="practice-summary-title"
      className="mx-auto flex w-full max-w-(--page-reading) flex-col gap-8 px-4 pt-4 pb-10 sm:px-6 md:pt-10"
    >
      <motion.div {...item(0)} className="flex flex-col items-center gap-4 text-center">
        <ProgressRing value={1} max={1} size={96} label={t('practice.summary.title')}>
          <Icon name="check" size={36} strokeWidth={2} className="text-accent-text" />
        </ProgressRing>
        <div className="flex flex-col gap-1.5">
          <h1 id="practice-summary-title" className="text-page font-semibold text-fg md:text-page-lg">
            {t('practice.summary.title')}
          </h1>
          <p className="text-ui text-fg-muted">{t('practice.summary.scheduleSame')}</p>
        </div>
      </motion.div>

      <motion.div {...item(1)}>
        <StatRow>
          <StatTile bare label={t('practice.summary.cards')} value={String(s.cards)} />
          <StatTile bare label={t('practice.summary.known')} value={`${s.knownFirstTry}/${s.cards}`} />
          <StatTile bare label={t('practice.summary.time')} value={formatDuration(timeMs)} />
        </StatRow>
      </motion.div>

      <motion.section {...item(2)} aria-labelledby="practice-hardest">
        <SectionHeader id="practice-hardest" title={t('practice.summary.hardest')} />
        {hardest.length === 0 ? (
          <Card>
            <p className="text-ui text-fg">{t('practice.summary.allKnown')}</p>
          </Card>
        ) : (
          <ListGroup>
            {hardest.map((v) => (
              <ListRow key={v.card.id} term title={v.note.term} description={meaningOf(v)} />
            ))}
          </ListGroup>
        )}
      </motion.section>

      <motion.div {...item(3)} className="flex flex-col gap-2">
        <Button size="lg" fullWidth onClick={() => void navigate(practiceHref(params))}>
          {t('practice.summary.again')}
        </Button>
        <Link to="/study/more" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
          {t('practice.backToMore')}
        </Link>
        <Link to="/" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
          {t('review.summary.finish')}
        </Link>
      </motion.div>
    </section>
  );
}
