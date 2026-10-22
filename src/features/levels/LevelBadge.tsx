import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WordLevel } from '@/domain/level';
import { cn } from '@/ui';
import { useLevelLabel } from './levelText';

const base =
  'tabular inline-flex h-5 shrink-0 items-center rounded-[4px] px-1.5 text-[0.6875rem] leading-none font-semibold tracking-[0.04em] whitespace-nowrap';

/** Solid for a list, frequency or the user's own level; dashed for an AI guess. */
function tone(level: WordLevel): string {
  if (level.source === 'user') return 'bg-accent-soft text-accent-text ring-1 ring-inset ring-accent/35';
  if (level.source === 'ai') return 'border border-dashed border-border-strong text-fg-muted';
  return 'bg-surface-sunken text-fg-muted ring-1 ring-inset ring-border';
}

/** A small A1–C2 badge. Not interactive (use LevelButton inside clickable rows' neighbours). */
export function LevelBadge({ level, className }: { level: WordLevel; className?: string }) {
  const label = useLevelLabel(level);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-level={level.cefr}
      data-level-source={level.source}
      className={cn(base, tone(level), className)}
    >
      {level.cefr}
    </span>
  );
}

/** The badge as a button (opens the explanation). Keeps a 44 px touch target around the small badge. */
export const LevelButton = forwardRef<
  HTMLButtonElement,
  { level: WordLevel } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>
>(function LevelButton({ level, className, ...rest }, ref) {
  const { t } = useTranslation();
  const label = useLevelLabel(level);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t('wordLevel.explainButton', { label })}
      data-level={level.cefr}
      data-level-source={level.source}
      className={cn(
        'group -m-2.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control p-2.5',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          base,
          tone(level),
          'transition-colors duration-(--duration-micro) group-hover:text-fg',
        )}
      >
        {level.cefr}
      </span>
    </button>
  );
});
