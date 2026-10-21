import * as RadixSlider from '@radix-ui/react-slider';
import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn';

export interface SliderProps {
  label: ReactNode;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Formats the visible value and aria-valuetext, e.g. v => `%${v}`. */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  label,
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  format = String,
  disabled,
  className,
}: SliderProps) {
  const id = useId();
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span id={`${id}-label`} className="text-sm font-medium text-fg">
          {label}
        </span>
        <output htmlFor={id} className="tabular text-sm text-fg-muted">
          {format(current)}
        </output>
      </div>
      <RadixSlider.Root
        id={id}
        value={[current]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => {
          if (v === undefined) return;
          if (value === undefined) setInner(v);
          onValueChange?.(v);
        }}
        className="relative flex h-11 w-full touch-none items-center select-none data-[disabled]:opacity-45"
      >
        <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-border">
          <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-labelledby={`${id}-label`}
          aria-valuetext={format(current)}
          className="relative block size-6 rounded-full border border-border-strong/60 bg-surface-raised shadow-[0_1px_3px_var(--shadow-color)] transition-transform duration-(--duration-micro) motion-safe:active:scale-110 after:absolute after:-inset-2.5 after:content-['']"
        />
      </RadixSlider.Root>
    </div>
  );
}
