import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
  /** Text-line skeletons: renders n lines, the last one shorter. */
  lines?: number;
}

/** Loading placeholder. Decorative; pair with aria-busy on the region being loaded. */
export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn(
              'h-3.5 animate-shimmer rounded-sm bg-surface-sunken',
              i === lines - 1 ? 'w-3/5' : 'w-full',
            )}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn('h-4 animate-shimmer rounded-sm bg-surface-sunken', className)}
    />
  );
}
