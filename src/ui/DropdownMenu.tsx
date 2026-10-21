import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  /** Use 'separator' to draw a divider. */
  kind?: 'item' | 'separator';
  label?: string;
  icon?: IconName;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Keyboard hint shown on the right, e.g. "Z". */
  shortcut?: string;
}

export interface DropdownMenuProps {
  /** The trigger element, usually an IconButton. */
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'center' | 'end';
  label?: string;
}

export function DropdownMenu({ trigger, items, align = 'end', label }: DropdownMenuProps) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={6}
          aria-label={label}
          className="z-50 min-w-52 rounded-card border border-border bg-surface-raised p-1 shadow-overlay data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out"
        >
          {items.map((item, i) =>
            item.kind === 'separator' ? (
              <RadixMenu.Separator key={`sep-${i}`} className="mx-2 my-1 h-px bg-border" />
            ) : (
              <RadixMenu.Item
                key={item.label ?? i}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[6px] px-3 text-[0.9375rem] outline-none select-none',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
                  item.danger
                    ? 'text-danger-text data-[highlighted]:bg-danger-soft'
                    : 'text-fg data-[highlighted]:bg-hover',
                )}
              >
                {item.icon && (
                  <Icon
                    name={item.icon}
                    size={18}
                    className={item.danger ? undefined : 'text-fg-muted'}
                  />
                )}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <kbd className="font-sans text-xs text-fg-muted">{item.shortcut}</kbd>
                )}
              </RadixMenu.Item>
            ),
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
