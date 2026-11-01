import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** One primary action (and at most one secondary). */
  action?: ReactNode;
  /**
   * plain: centred on the page (default) · card: on a surface card · placeholder: a dashed
   * slot inside a list ("İlk desteni oluştur") · error: same layout, danger-tinted icon.
   */
  tone?: 'plain' | 'card' | 'placeholder' | 'error';
  /** Smaller padding/title, for an empty section inside a page. */
  compact?: boolean;
  className?: string;
}

/** Empty, offline and error states: icon well · title · one sentence · one action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'plain',
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-5 py-8' : 'px-6 py-12',
        tone === 'card' && 'rounded-card border border-border bg-surface',
        tone === 'placeholder' && 'rounded-card border border-dashed border-border-strong/60',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-4 flex items-center justify-center rounded-full',
            compact ? 'size-11' : 'size-14',
            tone === 'error' ? 'bg-danger-soft text-danger-text' : 'bg-accent-soft text-accent-text',
          )}
        >
          <Icon name={icon} size={compact ? 20 : 24} />
        </div>
      )}
      <h2 className={cn('font-semibold text-fg', compact ? 'text-lead' : 'text-title')}>{title}</h2>
      {description && <p className="mt-1.5 max-w-xs text-ui text-fg-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-col items-center gap-2">{action}</div>}
    </div>
  );
}
