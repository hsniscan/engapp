import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { IconButton } from './IconButton';

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered with asChild). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row, right-aligned on wide screens, stacked full-width on phones. */
  footer?: ReactNode;
  /**
   * 'responsive' (default): bottom sheet below 640 px, centred dialog above.
   * 'sheet': always a bottom sheet. 'dialog': always centred.
   */
  variant?: 'responsive' | 'sheet' | 'dialog';
  hideClose?: boolean;
  className?: string;
}

const placement = {
  responsive:
    'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet border-t pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out ' +
    'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[min(calc(100vw-2rem),30rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:pb-6 sm:[--sheet-offset:12px] sm:data-[state=open]:animate-pop-in sm:data-[state=closed]:animate-pop-out',
  sheet:
    'inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-full max-w-xl rounded-t-sheet border-t pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:border-x data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out',
  dialog:
    'top-1/2 left-1/2 w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border pb-6 data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
} as const;

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  variant = 'responsive',
  hideClose,
  className,
}: DialogProps) {
  const { t } = useTranslation();
  const isSheetish = variant !== 'dialog';
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-y-auto border-border bg-surface-raised px-5 pt-5 text-fg shadow-overlay sm:px-6 sm:pt-6',
            'focus-visible:outline-none',
            placement[variant],
            className,
          )}
        >
          {isSheetish && (
            <div
              aria-hidden="true"
              className={cn(
                'mx-auto -mt-2 mb-3 h-1 w-9 shrink-0 rounded-full bg-border-strong/40',
                variant === 'responsive' && 'sm:hidden',
              )}
            />
          )}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1.5">
              <RadixDialog.Title className="font-serif text-xl leading-snug font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-[0.9375rem] text-fg-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            {!hideClose && (
              <RadixDialog.Close asChild>
                <IconButton
                  icon="x"
                  label={t('common.close')}
                  tooltip={false}
                  className="-mt-1 sm:-mr-2"
                />
              </RadixDialog.Close>
            )}
          </div>
          {children && <div className="mt-5">{children}</div>}
          {footer && (
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Wrap a footer button to close the dialog when clicked. */
export const DialogClose = RadixDialog.Close;
