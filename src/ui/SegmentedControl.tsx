import { useId } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name of the group (a visible legend unless hideLegend). */
  legend: string;
  hideLegend?: boolean;
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  className?: string;
  name?: string;
}

/**
 * A single choice among 2–4 options (e.g. theme: Sistem / Açık / Koyu), or switching between
 * 2–3 views of the same place (Destelerim / Kelime Bankası). 44 px segments.
 * Built on native radio inputs: arrow keys, form semantics and screen readers work for free.
 */
export function SegmentedControl<V extends string>({
  legend,
  hideLegend,
  options,
  value,
  onValueChange,
  className,
  name,
}: SegmentedControlProps<V>) {
  const autoName = useId();
  const groupName = name ?? autoName;
  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)}>
      <legend className={cn('mb-1.5 text-meta font-semibold text-fg', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <div className="flex gap-1 rounded-control bg-surface-sunken p-1">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <label
              key={opt.value}
              className={cn(
                'relative flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 text-ui font-semibold whitespace-nowrap',
                'transition-[background-color,color,box-shadow] duration-(--duration-micro) ease-standard',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
                selected ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={opt.value}
                checked={selected}
                onChange={() => onValueChange(opt.value)}
                className="sr-only"
              />
              {opt.icon && <Icon name={opt.icon} size={16} />}
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
