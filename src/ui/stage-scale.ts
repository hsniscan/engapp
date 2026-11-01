/**
 * Word stages as the UI draws them. Mirrors `WordStage` in src/domain/stages.ts (kept as a
 * string union here so src/ui stays independent of the domain layer).
 * ONE colour per stage, everywhere (docs/design.md → Stage scale).
 */
export type UiStage = 'new' | 'learning' | 'consolidating' | 'learned' | 'mastered';

export const uiStages: readonly UiStage[] = [
  'new',
  'learning',
  'consolidating',
  'learned',
  'mastered',
];

/** Background utility for a stage swatch/segment. */
export const stageBg: Record<UiStage, string> = {
  new: 'bg-stage-new',
  learning: 'bg-stage-learning',
  consolidating: 'bg-stage-consolidating',
  learned: 'bg-stage-learned',
  mastered: 'bg-stage-mastered',
};

/** CSS colour of a stage (SVG strokes, inline styles). */
export const stageColor: Record<UiStage, string> = {
  new: 'var(--stage-new)',
  learning: 'var(--stage-learning)',
  consolidating: 'var(--stage-consolidating)',
  learned: 'var(--stage-learned)',
  mastered: 'var(--stage-mastered)',
};
