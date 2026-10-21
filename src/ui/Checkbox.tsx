import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean | 'indeterminate';
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  /** Hide the label visually (e.g. row selection in a list); still announced. */
  hideLabel?: boolean;
}

export function Checkbox({ label, description, className, hideLabel, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cn('flex min-h-11 items-start gap-3', className)}>
      <RadixCheckbox.Root
        id={id}
        className={cn(
          'peer relative mt-3 flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-surface text-accent-fg',
          'transition-colors duration-(--duration-micro)',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
          "disabled:opacity-45 after:absolute after:-inset-3 after:content-['']",
        )}
        {...rest}
      >
        <RadixCheckbox.Indicator className="flex">
          {rest.checked === 'indeterminate' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <Icon name="check" size={16} strokeWidth={2.4} />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className={cn('flex flex-col py-2.5', hideLabel && 'sr-only')}>
        <span className="text-[0.9375rem] text-fg">{label}</span>
        {description && <span className="text-sm text-fg-muted">{description}</span>}
      </label>
    </div>
  );
}
