import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Kbd } from './Kbd';
import { ratingLook, ratings, type Rating } from './rating';

export interface RatingButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  rating: Rating;
  /** Overrides the rating's own label (practice rounds: "Bilemedim" / "Bildim"). */
  label?: string;
  /** Next interval preview, e.g. "10 dk", "3 g". Always shown: meaning never relies on colour. */
  interval?: string;
  /** Keyboard shortcut hint (1–4), shown on devices with a keyboard. */
  shortcut?: string;
  /** Optional third line, e.g. a stage change ("↑ Öğrenildi") or "Bir daha dokun". */
  note?: ReactNode;
  /**
   * 'sm' (48 px) under a "Devam" button that applies the suggested rating (v0.5.3 A3); the
   * buttons are then all tinted, İyi included, so the eye goes to the suggestion. Default 'md'.
   */
  size?: 'md' | 'sm';
}

/**
 * One answer button, from the one rating map (`ratingLook`): tinted fill + coloured label for
 * Tekrar/Zor/Kolay, the filled pine button for İyi. 64 px tall, interval under the label.
 */
export function RatingButton({
  rating,
  label: labelOverride,
  interval,
  shortcut,
  note,
  size = 'md',
  className,
  ...rest
}: RatingButtonProps) {
  const { t } = useTranslation();
  const label = labelOverride ?? t(`rating.${rating}`);
  const small = size === 'sm';
  const good = rating === 'good' && !small;
  return (
    <button
      type="button"
      className={cn(
        'group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-2',
        small ? 'min-h-12 py-1' : 'min-h-16 py-2',
        'transition-[background-color,filter,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-45',
        small && rating === 'good' ? ratingLook.good.tonal : ratingLook[rating].button,
        className,
      )}
      {...rest}
    >
      <span className="text-ui font-semibold">{label}</span>
      {interval && (
        <span className={cn('tabular text-caption', !good && 'text-fg-muted')}>
          <span className="sr-only">{t('rating.nextReview')} </span>
          {interval}
        </span>
      )}
      {note != null && <span className="text-caption leading-tight font-semibold">{note}</span>}
      {shortcut && (
        <span aria-hidden="true" className="absolute top-1.5 right-1.5 hidden md:pointer-fine:flex">
          <Kbd size="sm">{shortcut}</Kbd>
        </span>
      )}
    </button>
  );
}

export interface RatingBarProps {
  onRate: (rating: Rating) => void;
  /** Interval preview per rating ("1 dk", "2 g"). */
  intervals?: Partial<Record<Rating, string>>;
  /** Show the 1–4 key hints (desktop). */
  shortcuts?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The answer bar under the card back: four equal buttons in one row (8 px gaps), sticky above
 * the safe area on phones. Group label "Ne kadar iyi hatırladın?".
 */
export function RatingBar({ onRate, intervals, shortcuts, disabled, className }: RatingBarProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('rating.group')}
      className={cn('grid grid-cols-4 gap-2', className)}
    >
      {ratings.map((r, i) => (
        <RatingButton
          key={r}
          rating={r}
          interval={intervals?.[r]}
          shortcut={shortcuts ? String(i + 1) : undefined}
          disabled={disabled}
          onClick={() => onRate(r)}
        />
      ))}
    </div>
  );
}
