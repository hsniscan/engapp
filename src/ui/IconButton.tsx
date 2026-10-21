import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: IconName;
  /** Accessible name; also shown as a tooltip on pointer devices. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary';
  /** 'md' = 44 px target. 'sm' = 36 px visual with a 44 px hit area. */
  size?: 'sm' | 'md';
  tooltip?: boolean;
  /** For toggle buttons (e.g. play audio). */
  pressed?: boolean;
}

const variants = {
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
  secondary: 'border border-border bg-surface text-fg hover:border-border-strong',
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
} as const;

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  tooltip = true,
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-control',
        'transition-[background-color,color,transform] duration-(--duration-micro) ease-standard',
        'motion-safe:active:scale-95 disabled:pointer-events-none disabled:opacity-45',
        size === 'md' ? 'size-11' : "size-9 after:absolute after:-inset-1 after:content-['']",
        variants[variant],
        pressed && 'bg-accent-soft text-accent-text',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'md' ? 20 : 18} />
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
