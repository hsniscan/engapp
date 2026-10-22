// Scheduler constants, in a module of their own so the optimizer worker can use them without
// pulling in zod (domain/fsrs.ts validates settings with it).
export const FSRS_CONFIG = {
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'] as const,
  relearning_steps: ['10m'] as const,
} as const;
