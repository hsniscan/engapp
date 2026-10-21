export { duration, ease, type MotionTier } from './motion';

/** Every semantic colour token. Use as Tailwind utilities (`bg-surface`, `text-fg-muted`)
 *  or as CSS variables (`var(--surface)`). */
export const colorTokens = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-sunken',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'fg-inverse',
  'accent',
  'accent-hover',
  'accent-fg',
  'accent-text',
  'accent-soft',
  'focus',
  'success',
  'success-text',
  'success-soft',
  'warn',
  'warn-text',
  'warn-soft',
  'danger',
  'danger-hover',
  'danger-fg',
  'danger-text',
  'danger-soft',
  'rating-again',
  'rating-again-text',
  'rating-again-soft',
  'rating-hard',
  'rating-hard-text',
  'rating-hard-soft',
  'rating-good',
  'rating-good-text',
  'rating-good-soft',
  'rating-easy',
  'rating-easy-text',
  'rating-easy-soft',
  'heat-empty',
  'heat-active',
  'heat-completed',
] as const;

export type ColorToken = (typeof colorTokens)[number];

/** Browser chrome colour (meta theme-color) per resolved theme = the canvas colour. */
export const themeColor = {
  light: '#f5f2ec',
  dark: '#1a1917',
} as const;
