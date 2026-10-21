import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** One primary action (and at most one secondary). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-border text-fg-muted">
          <Icon name={icon} size={24} />
        </div>
      )}
      <h2 className="font-serif text-xl font-semibold text-fg">{title}</h2>
      {description && <p className="mt-2 max-w-xs text-[0.9375rem] text-fg-muted">{description}</p>}
      {action && <div className="mt-6 flex flex-col items-center gap-2">{action}</div>}
    </div>
  );
}
