import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  children: ReactNode;
  /** Toggle/filter state (aria-pressed). Leave undefined for an action chip. */
  selected?: boolean;
  icon?: IconName;
  /** Trailing count, e.g. "Kelime 12". */
  count?: number;
}

/**
 * Filter or quick-choice chip: 36 px pill with a 44 px hit area. Use for filters (Keşfet),
 * quick choices (goal minutes), study modes on the Today card. Not for navigation between
 * views — that is SegmentedControl (2–3 views) or Tabs (page sections).
 */
export function Chip({
  children,
  selected,
  icon,
  count,
  className,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'hit-44 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-meta font-semibold whitespace-nowrap',
        'transition-[background-color,border-color,color] duration-(--duration-micro) ease-standard',
        'disabled:pointer-events-none disabled:opacity-45',
        selected
          ? 'border border-transparent bg-fg text-fg-inverse'
          : 'border border-border bg-surface text-fg hover:border-border-strong/60 hover:bg-surface-hover',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
      {count != null && (
        <span className={cn('tabular', selected ? 'opacity-75' : 'text-fg-muted')}>{count}</span>
      )}
    </button>
  );
}

export interface ChipRowProps {
  /** Accessible name of the group. */
  label: string;
  children: ReactNode;
  /** Bleed to the screen edges on phones (default). false inside a padded card. */
  bleed?: boolean;
  className?: string;
}

/** One row of chips that scrolls sideways on phones (never wraps, never truncates a chip). */
export function ChipRow({ label, children, bleed = true, className }: ChipRowProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'no-scrollbar flex snap-x gap-2 overflow-x-auto py-1 sm:flex-wrap sm:overflow-visible',
        bleed && '-mx-4 px-4 sm:mx-0 sm:px-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
