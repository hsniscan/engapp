import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './Icon';

export interface FieldOwnProps {
  label: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error message; marks the control invalid. */
  error?: ReactNode;
  /** Shows "İsteğe bağlı" next to the label. Required is the norm, optional is marked. */
  optional?: boolean;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
}

export interface FieldIds {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/** Label + hint + error frame shared by text inputs, select and textarea. */
export function Field({
  id: idProp,
  label,
  hint,
  error,
  optional,
  hideLabel,
  className,
  children,
}: FieldOwnProps & {
  id?: string;
  className?: string;
  children: (ids: FieldIds) => ReactNode;
}) {
  const { t } = useTranslation();
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn(
          'flex items-baseline justify-between gap-2 text-sm font-medium text-fg',
          hideLabel && 'sr-only',
        )}
      >
        <span>{label}</span>
        {optional && (
          <span className="text-xs font-normal text-fg-muted">{t('common.optional')}</span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger-text">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>{error}</span>
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-sm text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export const controlClasses =
  'w-full rounded-control border border-border-strong/70 bg-surface text-base text-fg ' +
  'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-(--duration-micro) ' +
  'hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 ' +
  'focus-visible:outline-focus/30 aria-invalid:border-danger disabled:opacity-50 disabled:cursor-not-allowed';
