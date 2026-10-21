import * as RadixSwitch from '@radix-ui/react-switch';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
}

/** A settings row: label (and description) on the left, switch on the right. The whole row is the target. */
export function Switch({ label, description, className, ...rest }: SwitchProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="flex flex-1 flex-col py-2">
        <span className="text-[0.9375rem] text-fg">{label}</span>
        {description && (
          <span id={descId} className="text-sm text-fg-muted">
            {description}
          </span>
        )}
      </label>
      <RadixSwitch.Root
        id={id}
        aria-describedby={descId}
        className={cn(
          'group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-border-strong/70 bg-surface-sunken',
          'transition-colors duration-(--duration-micro) ease-standard',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45',
          "after:absolute after:-inset-2 after:content-['']",
        )}
        {...rest}
      >
        <RadixSwitch.Thumb
          className={cn(
            'block size-5 translate-x-[3px] rounded-full bg-surface-raised shadow-[0_1px_2px_var(--shadow-color)] ring-1 ring-border-strong/40',
            'transition-transform duration-(--duration-micro) ease-standard motion-reduce:transition-none',
            'data-[state=checked]:translate-x-[23px] data-[state=checked]:ring-0',
          )}
        />
      </RadixSwitch.Root>
    </div>
  );
}
