// The one note frame of Bugün (v0.5.2 "Çam", ADR 0066): load, streak protection, the counting
// rule, the FSRS offer, interests, the level test. A flat card with an icon tile, a 15 px title,
// a short body and optional actions (tonal / secondary / ghost; the Today card keeps the screen's
// only primary button) or a close button.
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, cn, IconButton, IconTile, type IconName } from '@/ui';

export interface HomeNoteProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Id of the title (the section is labelled by it). */
  titleId: string;
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** warn: something needs attention (load warning); default calm. */
  tone?: 'calm' | 'warn';
  onClose?: () => void;
}

export function HomeNote({
  titleId,
  icon,
  title,
  children,
  actions,
  tone = 'calm',
  onClose,
  className,
  ...rest
}: HomeNoteProps) {
  const { t } = useTranslation();
  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      className={cn('flex flex-col gap-4', onClose && 'pr-2 sm:pr-3', className)}
      {...rest}
    >
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tone={tone === 'warn' ? 'warn' : 'accent'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <h2 id={titleId} className="text-ui font-semibold text-fg">
            {title}
          </h2>
          {children && (
            <div className="flex flex-col gap-1 text-meta text-fg-muted">{children}</div>
          )}
        </div>
        {onClose && (
          <IconButton
            icon="x"
            label={t('common.close')}
            tooltip={false}
            size="sm"
            className="-mt-1 shrink-0"
            onClick={onClose}
          />
        )}
      </div>
      {actions && (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{actions}</div>
      )}
    </Card>
  );
}
