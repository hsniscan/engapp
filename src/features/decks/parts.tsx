// Small shared pieces of the Desteler screens (DecksMine / DecksDiscover / DeckDetail / DecksBank
// boards): the back bar, progress bars and ring, status pills, frequency dots.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn, Icon } from '@/ui';
import { freqDots, MARK, nf } from './deckUi';

/** "‹ Geri" bar of a pushed screen, with the parent's name in the middle. */
export function BackBar({ to, parent, actions }: { to: string; parent: string; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-2 pt-2">
      <Link
        to={to}
        className="inline-flex h-11 items-center gap-1 justify-self-start rounded-control px-3 text-base text-accent-text hover:bg-hover"
      >
        <Icon name="chevron-left" size={20} />
        {t('deckHub.back')}
      </Link>
      <span className="text-sm text-fg-muted">{parent}</span>
      <div className="flex justify-self-end">{actions}</div>
    </div>
  );
}

/** A thin horizontal bar of segments (widths in %), on a track. */
export function SegBar({
  parts,
  label,
  height = 8,
  track = MARK.track,
  gap = 2,
  className,
}: {
  parts: { value: number; color: string }[];
  label: string;
  height?: number;
  track?: string;
  gap?: number;
  className?: string;
}) {
  const total = Math.max(
    1,
    parts.reduce((n, p) => n + p.value, 0),
  );
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('flex overflow-hidden rounded-full', className)}
      style={{ height, background: track, gap }}
    >
      {parts.map((p, i) =>
        p.value > 0 ? (
          <span key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ) : null,
      )}
    </div>
  );
}

/** Progress of a deck against its full size: learned, then in progress, on a track. */
export function ProgressBar2({
  total,
  first,
  second,
  label,
  height = 8,
  firstColor = MARK.learned,
  secondColor = MARK.studying,
  track,
}: {
  total: number;
  first: number;
  second: number;
  label: string;
  height?: number;
  firstColor?: string;
  secondColor?: string;
  track?: string;
}) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div
      role="img"
      aria-label={label}
      className="flex gap-0.5 overflow-hidden rounded-full"
      style={{ height, background: track ?? MARK.track }}
    >
      {first > 0 && <span style={{ width: w(first), background: firstColor }} />}
      {second > 0 && <span style={{ width: w(second), background: secondColor }} />}
    </div>
  );
}

/** The ring of the detail screens: segments clockwise from the top, a big % in the middle. */
export function Ring({
  segments,
  total,
  center,
  caption,
}: {
  segments: { value: number; color: string }[];
  total: number;
  center: string;
  caption: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const lens = segments.map((s) => (total ? (s.value / total) * c : 0));
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="relative size-[124px] shrink-0">
      <svg aria-hidden="true" width="124" height="124" viewBox="0 0 124 124">
        <circle cx="62" cy="62" r={r} fill="none" strokeWidth="12" style={{ stroke: MARK.track }} />
        {segments.map((s, i) =>
          lens[i]! > 0 ? (
            <circle
              key={i}
              cx="62"
              cy="62"
              r={r}
              fill="none"
              strokeWidth="12"
              strokeDasharray={`${lens[i]} ${c}`}
              strokeDashoffset={-starts[i]!}
              transform="rotate(-90 62 62)"
              style={{ stroke: s.color }}
            />
          ) : null,
        )}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular font-serif text-[30px] leading-none font-semibold text-fg">
          {center}
        </span>
        <span className="text-xs text-fg-muted">{caption}</span>
      </span>
    </div>
  );
}

/** One legend row next to the ring. */
export function LegendRow({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="tabular min-w-10 font-serif text-xl font-semibold text-fg">{nf.format(value)}</span>
      <span className="text-sm text-fg-muted">{label}</span>
    </li>
  );
}

export type PillTone = 'success' | 'accent' | 'outline' | 'warn' | 'neutral';

const PILL: Record<PillTone, string> = {
  success: 'bg-success-soft text-success-text',
  accent: 'bg-accent-soft text-accent-text',
  outline: 'border border-border text-fg-muted',
  warn: 'bg-warn-soft text-warn-text',
  neutral: 'bg-surface-sunken text-fg-muted',
};

/** Status at the end of a word row (fixed width so the column lines up). */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex w-[5.75rem] shrink-0 items-center justify-center rounded-md py-1 text-xs font-semibold',
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Small grey level pill ("B1"). */
export function LevelPill({ level, className }: { level: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-[5px] bg-surface-sunken px-1.5 py-0.5 text-xs font-semibold text-fg-muted',
        className,
      )}
    >
      {level}
    </span>
  );
}

export function FreqDots({ zipf }: { zipf: number | null }) {
  const { t } = useTranslation();
  const n = freqDots(zipf);
  return (
    <span role="img" aria-label={t('deckHub.bank.freq', { n })} className="flex shrink-0 gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="size-[5px] rounded-full"
          style={{ background: i <= n ? MARK.learned : MARK.faint }}
        />
      ))}
    </span>
  );
}

/** A pill-shaped toggle used for filters (aria-pressed). */
export function FilterChip({
  pressed,
  onClick,
  children,
  tone = 'ink',
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** ink: pressed = dark filled; accent: pressed = accent-soft with an accent border. */
  tone?: 'ink' | 'accent';
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors',
        pressed
          ? tone === 'ink'
            ? 'border-fg bg-fg font-semibold text-fg-inverse'
            : 'border-accent bg-accent-soft font-semibold text-accent-text'
          : 'border-border bg-surface text-fg hover:border-border-strong',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Inline line icons from the boards that the icon set does not have. */
export function Glyph({ name, size = 20 }: { name: 'download' | 'rules' | 'tag' | 'themes' | 'search'; size?: number }) {
  const d = {
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    rules: 'M4 6h16M7 12h10M10 18h4',
    tag: 'M3 12V4h8l9 9-8 8z',
    themes: 'M14 17h6M17 14v6',
    search: 'M16 16l4 4',
  }[name];
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
      {name === 'tag' && <circle cx="7.5" cy="8" r="1.2" />}
      {name === 'themes' && (
        <>
          <circle cx="7" cy="7" r="3" />
          <circle cx="17" cy="7" r="3" />
          <circle cx="7" cy="17" r="3" />
        </>
      )}
      {name === 'search' && <circle cx="11" cy="11" r="6.5" />}
    </svg>
  );
}
