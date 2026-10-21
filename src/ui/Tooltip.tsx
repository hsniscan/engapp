import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = RadixTooltip.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Supplementary label for pointer users. Never the only place information lives. */
export function Tooltip({ content, children, side = 'bottom' }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={500}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-60 rounded-sm bg-fg px-2 py-1 text-xs font-medium text-fg-inverse shadow-raised data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
