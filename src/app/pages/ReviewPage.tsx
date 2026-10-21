import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  CardFace,
  FlipCard,
  IconButton,
  ProgressBar,
  RatingButton,
  ratings,
} from '@/ui';
import { sampleCards, sampleIntervals, type SampleCard } from './sampleCards';

export function CardFront({ card }: { card: SampleCard }) {
  const { t } = useTranslation();
  return (
    <CardFace>
      <Badge tone="outline">{card.pos}</Badge>
      <p
        lang="en"
        className="font-serif text-4xl leading-tight font-semibold tracking-[-0.01em] text-fg sm:text-display"
      >
        {card.term}
      </p>
      <p lang="en" className="font-serif text-lg text-fg-muted">
        {card.ipa}
      </p>
      <IconButton
        icon="speaker"
        label={t('common.listen')}
        variant="ghost"
        className="mt-1"
        onClick={(e) => e.stopPropagation()}
      />
    </CardFace>
  );
}

export function CardBack({ card }: { card: SampleCard }) {
  return (
    <CardFace className="gap-5">
      <p lang="en" className="font-serif text-xl text-fg-muted">
        {card.term}
      </p>
      <p className="font-serif text-3xl leading-snug font-semibold text-fg">{card.meaning}</p>
      <div className="mt-2 flex max-w-sm flex-col gap-1.5 border-t border-border pt-5">
        <p lang="en" className="font-serif text-lg text-fg italic">
          {card.example}
        </p>
        <p className="text-[0.9375rem] text-fg-muted">{card.exampleTr}</p>
      </div>
    </CardFace>
  );
}

/** Placeholder review session demonstrating the intended layout. Replaced by features/review. */
export function ReviewPage() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = sampleCards[index % sampleCards.length]!;
  const total = 40;

  const next = useCallback(() => {
    setFlipped(false);
    setIndex((i) => i + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [role="menu"]'))
        return;
      if (e.key === ' ' && !flipped) {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, next]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <h1 className="sr-only">{t('review.title')}</h1>
      <div className="mb-5 flex items-center gap-3">
        <ProgressBar
          value={index}
          max={total}
          label={t('a11y.progress')}
          valueText={t('review.progress', { done: index, total })}
        />
        <span className="tabular shrink-0 text-sm text-fg-muted">
          {index} / {total}
        </span>
      </div>

      <FlipCard
        key={index}
        flipped={flipped}
        onFlip={() => setFlipped(true)}
        front={<CardFront card={card} />}
        back={<CardBack card={card} />}
      />

      <div className="mt-auto pt-6 md:mt-0">
        {flipped ? (
          <div role="group" aria-label={t('rating.group')} className="grid grid-cols-4 gap-2">
            {ratings.map((r, i) => (
              <RatingButton
                key={r}
                rating={r}
                interval={sampleIntervals[r]}
                shortcut={String(i + 1)}
                onClick={next}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" fullWidth onClick={() => setFlipped(true)}>
              {t('review.showAnswer')}
            </Button>
            <p className="text-sm text-fg-muted">
              <span className="pointer-fine:hidden">{t('review.tapToFlip')}</span>
              <span className="hidden pointer-fine:inline">{t('review.spaceToFlip')}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
