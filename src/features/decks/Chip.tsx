import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn, Icon, type IconName } from '@/ui';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Toggle chips announce their state with aria-pressed. Leave undefined for a plain action. */
  pressed?: boolean;
  icon?: IconName;
  children: ReactNode;
  /** Secondary text after the label, e.g. a count. */
  meta?: ReactNode;
}

/**
 * A compact pill used for deck shortcuts and multi-select filters. 36 px tall with a 44 px
 * hit area; selected chips use the accent tint and a check mark, so state never relies on
 * colour alone.
 */
export function Chip({ pressed, icon, children, meta, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "relative inline-flex h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        'transition-[background-color,border-color,color] duration-(--duration-micro) ease-standard',
        'disabled:cursor-not-allowed disabled:opacity-45',
        pressed
          ? 'border-accent bg-accent-soft font-medium text-accent-text'
          : 'border-border bg-surface text-fg hover:border-border-strong',
        className,
      )}
      {...rest}
    >
      {pressed ? (
        <Icon name="check" size={16} className="-ml-0.5 shrink-0" />
      ) : (
        icon && <Icon name={icon} size={16} className="-ml-0.5 shrink-0 text-fg-muted" />
      )}
      <span className="truncate">{children}</span>
      {meta !== undefined && meta !== null && (
        <span className={cn('tabular shrink-0', pressed ? 'text-accent-text' : 'text-fg-muted')}>
          {meta}
        </span>
      )}
    </button>
  );
}
