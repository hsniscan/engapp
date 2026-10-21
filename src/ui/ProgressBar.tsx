import { cn } from './cn';

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name, e.g. "İlerleme". */
  label: string;
  /** Human text for screen readers, e.g. "12 / 40 kart". */
  valueText?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Determinate progress. The fill eases between values (medium tier); reduced motion snaps. */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  size = 'sm',
  className,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn(
        'w-full overflow-hidden rounded-full bg-border',
        size === 'sm' ? 'h-1' : 'h-2',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-(--duration-medium) ease-standard motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
