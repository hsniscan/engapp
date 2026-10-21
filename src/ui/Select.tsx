import * as RadixSelect from '@radix-ui/react-select';
import { cn } from './cn';
import { Field, controlClasses, type FieldOwnProps } from './Field';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldOwnProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  name,
  id,
  className,
  ...field
}: SelectProps) {
  return (
    <Field id={id} {...field} className={className}>
      {({ id: triggerId, describedBy, invalid }) => (
        <RadixSelect.Root
          value={value}
          defaultValue={defaultValue}
          onValueChange={onValueChange}
          disabled={disabled}
          name={name}
        >
          <RadixSelect.Trigger
            id={triggerId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              controlClasses,
              'flex h-11 items-center justify-between gap-2 px-3 text-left data-[placeholder]:text-fg-subtle',
            )}
          >
            <RadixSelect.Value placeholder={placeholder} />
            <RadixSelect.Icon className="text-fg-muted">
              <Icon name="chevron-down" size={18} />
            </RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content
              position="popper"
              sideOffset={6}
              className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-card border border-border bg-surface-raised shadow-overlay data-[state=open]:animate-pop-in"
            >
              <RadixSelect.Viewport className="p-1">
                {options.map((opt) => (
                  <RadixSelect.Item
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                    className="relative flex min-h-11 cursor-pointer items-center rounded-[6px] py-2 pr-3 pl-9 text-[0.9375rem] text-fg outline-none select-none data-[disabled]:opacity-45 data-[highlighted]:bg-hover data-[state=checked]:font-medium"
                  >
                    <RadixSelect.ItemIndicator className="absolute left-2.5 text-accent-text">
                      <Icon name="check" size={18} />
                    </RadixSelect.ItemIndicator>
                    <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      )}
    </Field>
  );
}
