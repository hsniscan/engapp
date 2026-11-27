import * as RadixTabs from '@radix-ui/react-tabs';
import { type ReactNode, useState } from 'react';
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

/**
 * Underlined tabs for SECTIONS of one page (İlerleme: Genel / Kelimeler / Takvim). Tabs
 * stretch to equal widths on narrow screens. Views of a list → SegmentedControl; filters → Chip.
 */
export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  // Radix focuses the trigger from its mousedown handler, and Chromium treats that scripted
  // focus as :focus-visible, so a tapped tab showed the focus box over its underline. A tap
  // hides the ring until a key is pressed or focus leaves the tab list; keyboard focus shows it.
  const [pointer, setPointer] = useState(false);
  return (
    <RadixTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      className={cn('flex flex-col', className)}
    >
      <RadixTabs.List
        aria-label={label}
        className="group/tabs flex border-b border-border"
        data-pointer={pointer || undefined}
        onPointerDown={() => setPointer(true)}
        onKeyDown={() => setPointer(false)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPointer(false);
        }}
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'relative -mb-px flex min-h-11 flex-auto items-center justify-center gap-2 px-3 py-1 text-center text-ui leading-tight font-semibold text-fg-muted sm:flex-none',
              'transition-colors duration-(--duration-micro) hover:text-fg disabled:opacity-45',
              'border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:text-fg',
              'focus-visible:outline-offset-[-2px] group-data-pointer/tabs:focus-visible:outline-none',
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
