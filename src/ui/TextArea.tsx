import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { Field, controlClasses, type FieldOwnProps } from './Field';

export interface TextAreaProps extends FieldOwnProps, ComponentPropsWithRef<'textarea'> {
  fieldClassName?: string;
}

export function TextArea({
  label,
  hint,
  error,
  optional,
  hideLabel,
  id,
  className,
  fieldClassName,
  rows = 4,
  ...rest
}: TextAreaProps) {
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
        <textarea
          id={inputId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(controlClasses, 'min-h-24 resize-y px-3 py-2.5 leading-relaxed', className)}
          {...rest}
        />
      )}
    </Field>
  );
}
