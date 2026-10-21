import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-(--duration-micro) ease-standard ' +
  'motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary:
    'border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-hover',
  ghost: 'text-fg hover:bg-hover',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
};

// sm is visually 36 px but its hit area is extended to 44 px.
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
  md: 'h-11 px-4 text-[0.9375rem]',
  lg: 'h-14 px-6 text-base',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Button classes, for links and router NavLinks that should look like buttons. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className);
}
