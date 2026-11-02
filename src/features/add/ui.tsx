// Small building blocks shared by the Ekle screens (v0.5.2 "Çam", ADR 0068): the large two-line
// choice, a quiet notice, and the sticky bottom bar of capture/preview screens. Built only from
// design tokens and `@/ui`, so every Ekle screen looks the same.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { cn, Icon, IconTile, Spinner, TabHeader, type IconName } from '@/ui';
import { openAddSheet } from './addSheetStore';

/**
 * The frame of every screen behind the (+) sheet (docs/design.md §4.11): `PageFrame reading`
 * with the source as title and a back link "‹ Ekle" that returns to where the sheet was opened
 * and opens it again (on a cold start, e.g. a PWA shortcut, it opens the sheet over Bugün).
 * Pass `back` for a sub-step whose parent is a page (a job preview → the jobs list).
 */
export function AddFlowPage({
  title,
  description,
  actions,
  back,
  width = 'reading',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  width?: 'reading' | 'wide';
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pt-6 pb-10 sm:px-6 md:pt-10 lg:px-10',
        width === 'wide' ? 'max-w-(--page-wide)' : 'max-w-(--page-reading)',
      )}
    >
      {back ? null : <BackToAdd />}
      <TabHeader title={title} description={description} actions={actions} back={back} />
      {children}
    </div>
  );
}

/** "‹ Ekle": back to the previous screen with the Add sheet open again. */
export function BackToAdd() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => {
    // 'default' = the first entry of this session: nothing in the app to go back to.
    if (location.key !== 'default') void navigate(-1);
    else void navigate('/', { replace: true });
    // After the route change has rendered, so the sheet opens over the page it came from.
    window.setTimeout(() => openAddSheet(), 0);
  };
  return (
    <button
      type="button"
      onClick={back}
      data-testid="add-back"
      className="-ml-2 mb-2 inline-flex h-11 w-fit items-center gap-1 rounded-control pr-3 pl-1 text-ui font-medium text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name="chevron-left" size={20} />
      {t('add.backToSheet')}
    </button>
  );
}

/**
 * A large choice: icon, title and one hint line. `primary` is the screen's one filled action
 * (pine); the others are flat cards with a neutral icon well.
 */
export function ChoiceButton({
  primary,
  icon,
  title,
  hint,
  loading,
  disabled,
  onClick,
  testId,
}: {
  primary?: boolean;
  icon: IconName;
  title: string;
  hint?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-testid={testId}
      className={cn(
        'flex min-h-16 w-full items-center gap-3 rounded-card px-4 py-3 text-left',
        'transition-[background-color,border-color,transform] duration-(--duration-micro) ease-standard',
        'disabled:opacity-60 motion-safe:active:scale-[0.99]',
        primary
          ? 'bg-accent text-accent-fg hover:bg-accent-hover'
          : 'border border-border bg-surface text-fg hover:border-border-strong/60 hover:bg-surface-hover',
      )}
    >
      {primary ? (
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center">
          {loading ? <Spinner size={20} /> : <Icon name={icon} size={22} />}
        </span>
      ) : loading ? (
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center">
          <Spinner size={20} />
        </span>
      ) : (
        <IconTile icon={icon} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui font-semibold">{title}</span>
        {hint && (
          <span className={cn('text-meta', primary ? 'text-accent-fg' : 'text-fg-muted')}>
            {hint}
          </span>
        )}
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 opacity-70" />
    </button>
  );
}

/** One quiet line on a sunken well: "not on this device", "nothing found", an error. */
export function Notice({
  children,
  tone = 'muted',
  className,
  testId,
}: {
  children: ReactNode;
  tone?: 'muted' | 'danger';
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'rounded-inner bg-surface-sunken px-4 py-3 text-ui',
        tone === 'danger' ? 'text-danger-text' : 'text-fg-muted',
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * The sticky bottom bar of a capture/preview screen (surface, hairline top): above the tab bar
 * on phones, at the bottom of the page from 768 px. Bleeds to the page gutters.
 */
export function StickyBar({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 mt-6 border-t border-border bg-surface px-4 py-3 sm:-mx-6 sm:px-6 md:bottom-0 lg:-mx-10 lg:px-10',
        className,
      )}
    >
      {children}
    </div>
  );
}
