import type { ComponentPropsWithRef } from 'react';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-styles';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks. The label stays for screen readers. */
  loading?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 16 : 18;
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize === 18 ? 16 : iconSize} />
      ) : (
        leadingIcon && <Icon name={leadingIcon} size={iconSize} />
      )}
      {children}
      {trailingIcon && !loading && <Icon name={trailingIcon} size={iconSize} />}
    </button>
  );
}
