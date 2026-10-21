/**
 * Motion tiers, mirrored from the CSS custom properties in src/index.css.
 * micro: press, selection · medium: card flip, page transition · large: session summary.
 */
export const duration = {
  micro: 0.12,
  medium: 0.28,
  large: 0.52,
} as const;

/** cubic-bezier control points, for `motion` transitions. */
export const ease = {
  standard: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export type MotionTier = keyof typeof duration;
