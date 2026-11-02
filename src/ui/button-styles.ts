import { cn } from './cn';

/**
 * primary: the one main action of a screen (filled pine). secondary: outlined, for a peer
 * action. tonal: soft pine, for a recommended-but-not-main action (e.g. "Ekle" in the rail).
 * ghost: text-only, toolbars and "Vazgeç". danger: destructive confirmation only.
 * Rule: at most ONE primary per screen region (docs/design.md → Buttons).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold ' +
  'transition-[background-color,border-color,color,transform] duration-(--duration-micro) ease-standard ' +
  'motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-busy:cursor-progress';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary:
    'border border-border-strong/45 bg-surface text-fg hover:border-border-strong hover:bg-surface-hover',
  tonal: 'bg-accent-soft text-accent-text hover:bg-selected',
  ghost: 'text-fg hover:bg-hover',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
};

// sm is visually 36 px but its hit area is extended to 44 px. md = 44 px. lg = 52 px (sticky CTAs).
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-meta after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
  md: 'h-11 px-4.5 text-ui',
  lg: 'h-13 px-6 text-body',
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
