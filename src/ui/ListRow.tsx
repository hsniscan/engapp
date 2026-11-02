import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type IconTileTone = 'neutral' | 'accent' | 'warn' | 'danger';

export interface IconTileProps {
  icon: IconName;
  tone?: IconTileTone;
  size?: 'sm' | 'md';
  className?: string;
}

const tileTones: Record<IconTileTone, string> = {
  neutral: 'bg-surface-sunken text-fg-muted',
  accent: 'bg-accent-soft text-accent-text',
  warn: 'bg-warn-soft text-warn-text',
  danger: 'bg-danger-soft text-danger-text',
};

/** An icon in a soft rounded well (list leading, shortcut tiles). Decorative. */
export function IconTile({ icon, tone = 'neutral', size = 'md', className }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center',
        size === 'md' ? 'size-10 rounded-md' : 'size-8 rounded-sm',
        tileTones[tone],
        className,
      )}
    >
      <Icon name={icon} size={size === 'md' ? 20 : 18} />
    </span>
  );
}

interface ListRowBase {
  title: ReactNode;
  description?: ReactNode;
  /** Leading: an icon (drawn as an IconTile) or any node (avatar, StagePill, word). */
  leadingIcon?: IconName;
  leadingTone?: IconTileTone;
  leading?: ReactNode;
  /** Right-side value text (e.g. "12", "Açık"). */
  meta?: ReactNode;
  /** Right-side control (Switch, Badge, IconButton). Replaces the chevron. */
  trailing?: ReactNode;
  /** Title in Literata with lang="en" (rows that show an English word). */
  term?: boolean;
  destructive?: boolean;
  className?: string;
}

type ListRowAs =
  | ({ to: string; onClick?: never } & ListRowBase)
  | ({ onClick: () => void; to?: never; disabled?: boolean } & ListRowBase)
  | ({ to?: never; onClick?: never } & ListRowBase);

export type ListRowProps = ListRowAs;

/**
 * One row of a list: min 56 px, 16 px gutters, leading · title/description · meta · trailing.
 * A `to` makes it a Link and an `onClick` a button (both get a chevron unless `trailing`).
 */
export function ListRow(props: ListRowProps) {
  const {
    title,
    description,
    leadingIcon,
    leadingTone,
    leading,
    meta,
    trailing,
    term,
    destructive,
    className,
  } = props;
  const interactive =
    'to' in props && props.to ? 'link' : 'onClick' in props && props.onClick ? 'button' : null;
  const body = (
    <>
      {leadingIcon ? <IconTile icon={leadingIcon} tone={leadingTone} /> : leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-3">
        <span
          lang={term ? 'en' : undefined}
          className={cn(
            'truncate',
            term ? 'font-serif text-lead font-medium' : 'text-ui font-medium',
            destructive ? 'text-danger-text' : 'text-fg',
          )}
        >
          {title}
        </span>
        {description && <span className="line-clamp-2 text-meta text-fg-muted">{description}</span>}
      </span>
      {meta != null && <span className="tabular shrink-0 text-ui text-fg-muted">{meta}</span>}
      {trailing ??
        (interactive && (
          <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
        ))}
    </>
  );
  const rowClass = cn(
    'flex min-h-14 w-full items-center gap-3 px-4 text-left',
    interactive &&
      'transition-colors duration-(--duration-micro) hover:bg-hover focus-visible:outline-offset-[-2px]',
    className,
  );
  if (interactive === 'link') {
    return (
      <Link to={(props as { to: string }).to} className={rowClass}>
        {body}
      </Link>
    );
  }
  if (interactive === 'button') {
    const p = props as { onClick: () => void; disabled?: boolean };
    return (
      <button
        type="button"
        onClick={p.onClick}
        disabled={p.disabled}
        className={cn(rowClass, 'disabled:opacity-45')}
      >
        {body}
      </button>
    );
  }
  return <div className={rowClass}>{body}</div>;
}

export interface ListGroupProps extends Omit<ComponentPropsWithRef<'ul'>, 'title'> {
  /** Optional small heading above the card (an Eyebrow-style label). */
  label?: ReactNode;
  /** Footnote under the card. */
  footer?: ReactNode;
}

/**
 * Rows grouped on one card with hairline dividers (settings, word lists, deck lists).
 * Children are ListRows; each is wrapped in an <li>.
 */
export function ListGroup({ label, footer, className, children, ...rest }: ListGroupProps) {
  const items = Array.isArray(children) ? children.flat() : [children];
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <p className="px-1 text-caption font-semibold tracking-[0.08em] text-fg-muted uppercase">
          {label}
        </p>
      )}
      <ul
        className={cn(
          'divide-y divide-border overflow-hidden rounded-card border border-border bg-surface',
          className,
        )}
        {...rest}
      >
        {items.filter(Boolean).map((child, i) => (
          <li key={i}>{child}</li>
        ))}
      </ul>
      {footer && <p className="px-1 text-meta text-fg-muted">{footer}</p>}
    </div>
  );
}
