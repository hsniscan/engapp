import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { Field, controlClasses, type FieldOwnProps } from './Field';
import { Icon, type IconName } from './Icon';

export interface TextFieldProps
  extends FieldOwnProps, Omit<ComponentPropsWithRef<'input'>, 'size'> {
  leadingIcon?: IconName;
  fieldClassName?: string;
}

export function TextField({
  label,
  hint,
  error,
  optional,
  hideLabel,
  leadingIcon,
  id,
  className,
  fieldClassName,
  ...rest
}: TextFieldProps) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      className={fieldClassName}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <div className="relative">
          {leadingIcon && (
            <Icon
              name={leadingIcon}
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
            />
          )}
          <input
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(controlClasses, 'h-11 px-3', leadingIcon && 'pl-10', className)}
            {...rest}
          />
        </div>
      )}
    </Field>
  );
}
