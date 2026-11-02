export type Rating = 'again' | 'hard' | 'good' | 'easy';

/** Display order of the answer buttons (FSRS grades 1–4). */
export const ratings: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

/**
 * THE rating colour map (review Y-1): answer bar, session summary, stats legends and docs all
 * read it. Tekrar = rust · Zor = ochre · İyi = pine (the accent; the one filled button, the
 * expected answer) · Kolay = slate blue.
 *   button: the answer button's fill + label colour
 *   dot:    a swatch/bar segment (summary, charts)
 *   text:   the label on a neutral surface
 */
export const ratingLook: Record<Rating, { button: string; dot: string; text: string }> = {
  again: {
    button: 'bg-rating-again-soft text-rating-again-text hover:brightness-[0.97]',
    dot: 'bg-rating-again',
    text: 'text-rating-again-text',
  },
  hard: {
    button: 'bg-rating-hard-soft text-rating-hard-text hover:brightness-[0.97]',
    dot: 'bg-rating-hard',
    text: 'text-rating-hard-text',
  },
  good: {
    button: 'bg-accent text-accent-fg hover:bg-accent-hover',
    dot: 'bg-rating-good',
    text: 'text-rating-good-text',
  },
  easy: {
    button: 'bg-rating-easy-soft text-rating-easy-text hover:brightness-[0.97]',
    dot: 'bg-rating-easy',
    text: 'text-rating-easy-text',
  },
};
