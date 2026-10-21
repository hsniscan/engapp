import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface TabItem {
  value: string;
  label: string;
  icon?: IconName;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}

/** Underlined tabs, editorial style. Tabs stretch to equal widths on narrow screens. */
export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  return (
    <RadixTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      className={cn('flex flex-col', className)}
    >
      <RadixTabs.List aria-label={label} className="flex border-b border-border">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'relative -mb-px flex min-h-11 flex-1 whitespace-nowrap items-center justify-center gap-2 px-3 text-[0.9375rem] font-medium text-fg-muted sm:flex-none',
              'transition-colors duration-(--duration-micro) hover:text-fg disabled:opacity-45',
              'border-b-2 border-transparent data-[state=active]:border-fg data-[state=active]:text-fg',
              'focus-visible:outline-offset-[-2px]',
            )}
          >
            {item.icon && <Icon name={item.icon} size={18} />}
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content
          key={item.value}
          value={item.value}
          className="pt-5 focus-visible:outline-offset-4 data-[state=active]:animate-fade-in"
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
