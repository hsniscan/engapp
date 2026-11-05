// The four answer buttons of the study session (v0.5.2 "Çam": the shared RatingButton and the one
// rating map, ADR 0066): Tekrar · Zor · İyi · Kolay, each with when the card comes back ("10 dk",
// "yarın", "3 gün") and, when the answer changes the card's stage, a third line ("↑ Öğrenildi"). After a typed answer one button is
// marked as our suggestion; any button can still be chosen. When the check said the answer was
// wrong (suggestion Tekrar), Zor / İyi / Kolay need a second tap (or key press) so one stray tap
// cannot send a forgotten word months away (ADR 0055).
//
// v0.5.3 A3 (ADR 0071): with a suggestion, one big "Devam" button applies it (Enter does too),
// in the suggested rating's own colour, and the four buttons sit smaller and all tinted under
// it, so the eye goes to the suggestion and not always to İyi. Typed and choice cards: 2 taps.
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { Rating as R, type RatingValue } from '@/domain/types';
import { cn, Icon, Kbd, RatingButton, ratingLook, ratings, type Rating } from '@/ui';
import { ratingLines, ratingValue } from './study';

/** The ring around the suggested (or armed) button, in the rating's own label colour. */
const ring: Record<Rating, string> = {
  again: 'ring-rating-again-text',
  hard: 'ring-rating-hard-text',
  good: 'ring-accent-text',
  easy: 'ring-rating-easy-text',
};

export interface RatingBarProps {
  view: CardView;
  onAnswer: (rating: RatingValue, viaKeyboard: boolean) => void;
  /** Our suggestion after a typed answer or a choice. */
  suggested?: RatingValue | null;
  /**
   * Show the big "Devam" button for the suggestion (default true when there is one). False
   * keeps the four big buttons and only marks the suggestion (a self-rated card's pace hint).
   */
  primary?: boolean;
}

export const RatingBar = forwardRef<HTMLDivElement, RatingBarProps>(function RatingBar(
  { view, onAnswer, suggested, primary = true },
  ref,
) {
  const { t } = useTranslation();
  const qid = useId();
  const hintId = useId();
  const suggestedName = suggested ? ratings.find((r) => ratingValue[r] === suggested) : undefined;
  const guarded = suggested === R.Again;
  const devam = !!suggestedName && primary;
  const [armed, setArmed] = useState<RatingValue | null>(null);
  const armedRef = useRef<RatingValue | null>(null);
  const arm = (value: RatingValue) => {
    armedRef.current = value;
    setArmed(value);
  };
  const armedName = armed ? ratings.find((r) => ratingValue[r] === armed) : undefined;

  const press = (value: RatingValue, viaKeyboard: boolean) => {
    if (guarded && value !== R.Again && armed !== value) {
      arm(value);
      return;
    }
    onAnswer(value, viaKeyboard);
  };

  // Keys 2-4 go through the same confirmation (the session's own key handler skips an event
  // this one has handled).
  useEffect(() => {
    if (!guarded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (!(e.key >= '2' && e.key <= '4')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      const value = Number(e.key) as RatingValue;
      if (armedRef.current === value) onAnswer(value, true);
      else {
        armedRef.current = value;
        setArmed(value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [guarded, onAnswer]);

  // Enter applies the suggestion ("Devam ↵"); a focused button keeps its own Enter.
  useEffect(() => {
    if (!devam || !suggested) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key !== 'Enter') return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      onAnswer(suggested, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [devam, suggested, onAnswer]);

  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <p id={qid} className="text-center text-meta text-fg-muted">
        {t('rating.group')}
        {suggestedName && (
          <span id={hintId}>
            {' · '}
            {t('study.suggested')}{' '}
            <strong className="font-semibold text-fg">{t(`rating.${suggestedName}`)}</strong>
          </span>
        )}
      </p>
      {guarded && (
        <p className="text-center text-meta text-fg-muted" role="status" data-testid="rating-confirm">
          {armedName
            ? t('study.confirmRating', { rating: t(`rating.${armedName}`) })
            : t('study.wrongHint')}
        </p>
      )}
      {devam && suggestedName && (
        <button
          type="button"
          data-testid="rating-continue"
          data-rating={suggestedName}
          onClick={(e) => onAnswer(suggested!, e.detail === 0)}
          className={cn(
            'relative flex min-h-14 w-full items-center justify-center gap-2 rounded-control px-4 text-ui font-semibold',
            'transition-[background-color,filter,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.98]',
            ratingLook[suggestedName].button,
            suggestedName !== 'good' && cn('ring-2 ring-inset', ring[suggestedName]),
          )}
        >
          <span>{t('study.continueWith', { rating: t(`rating.${suggestedName}`) })}</span>
          {(() => {
            const { interval, change } = ratingLines(view, suggested!, t);
            return (
              <span className="tabular text-meta font-normal">
                <span className="sr-only">{t('rating.nextReview')} </span>
                {[interval, change].filter(Boolean).join(' · ')}
              </span>
            );
          })()}
          <Icon name="arrow-right" size={20} />
          <span aria-hidden="true" className="absolute right-3 hidden md:pointer-fine:flex">
            <Kbd size="sm">↵</Kbd>
          </span>
        </button>
      )}
      <div role="group" aria-labelledby={qid} className="grid grid-cols-4 gap-2">
        {ratings.map((r, i) => {
          const value = ratingValue[r];
          const { interval, change } = ratingLines(view, value, t);
          const isSuggested = value === suggested;
          const isArmed = armed === value;
          return (
            <RatingButton
              key={r}
              rating={r}
              interval={interval}
              shortcut={String(i + 1)}
              size={devam ? 'sm' : 'md'}
              note={isArmed ? t('study.confirmTap') : devam ? undefined : (change ?? undefined)}
              data-rating={r}
              aria-describedby={isSuggested ? hintId : undefined}
              data-armed={isArmed || undefined}
              onClick={(e) => press(value, e.detail === 0)}
              className={cn(
                'min-w-0 px-1',
                (isArmed || (isSuggested && !devam)) && cn('ring-2 ring-offset-2 ring-offset-canvas', ring[r]),
              )}
            />
          );
        })}
      </div>
    </div>
  );
});
