import * as RadixToast from '@radix-ui/react-toast';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { getToasts, subscribeToasts, toast, type ToastTone } from './toast-store';

const toneIcon: Record<ToastTone, IconName | null> = {
  neutral: null,
  success: 'check',
  warn: 'alert',
  danger: 'alert',
};
const toneColor: Record<ToastTone, string> = {
  neutral: '',
  success: 'text-success-text',
  warn: 'text-warn-text',
  danger: 'text-danger-text',
};

/** Mount once near the root. Renders toasts queued with `toast()`. */
export function Toaster() {
  const { t } = useTranslation();
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <RadixToast.Provider swipeDirection="down" label={t('a11y.notifications')}>
      {items.map((item) => {
        const tone = item.tone ?? 'neutral';
        const icon = toneIcon[tone];
        return (
          <RadixToast.Root
            key={item.id}
            open={item.open}
            duration={item.duration ?? 5000}
            onOpenChange={(open) => {
              if (!open) toast.dismiss(item.id);
            }}
            type={tone === 'danger' ? 'foreground' : 'background'}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-3 rounded-card bg-fg py-3 pr-2 pl-4 text-fg-inverse shadow-overlay',
              'data-[state=open]:animate-toast-in data-[state=closed]:animate-fade-out',
              'data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y) data-[swipe=end]:animate-fade-out',
            )}
          >
            {icon && (
              <span
                className={cn(
                  'mt-0.5 flex size-5 items-center justify-center rounded-full bg-fg-inverse',
                  toneColor[tone],
                )}
              >
                <Icon name={icon} size={16} strokeWidth={2} />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
              <RadixToast.Title className="text-[0.9375rem] font-medium">
                {item.title}
              </RadixToast.Title>
              {item.description && (
                <RadixToast.Description className="text-sm opacity-80">
                  {item.description}
                </RadixToast.Description>
              )}
            </div>
            {item.action && (
              <RadixToast.Action
                altText={item.action.altText ?? item.action.label}
                onClick={item.action.onClick}
                className="h-9 shrink-0 rounded-control px-3 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-fg-inverse"
              >
                {item.action.label}
              </RadixToast.Action>
            )}
            <RadixToast.Close
              aria-label={t('a11y.dismiss')}
              className="flex size-9 shrink-0 items-center justify-center rounded-control opacity-70 hover:opacity-100 focus-visible:outline-fg-inverse"
            >
              <Icon name="x" size={18} />
            </RadixToast.Close>
          </RadixToast.Root>
        );
      })}
      <RadixToast.Viewport
        className={cn(
          'fixed inset-x-0 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none',
          'bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+12px)] md:right-6 md:bottom-6 md:left-auto md:mx-0 md:px-0',
        )}
      />
    </RadixToast.Provider>
  );
}
