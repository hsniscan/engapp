// The vocabulary counter (v0.2 İP8 "Sayaç"): "~3.450 kelime · B2'ye ~620 kelime kaldı", a
// level ladder, and an explanation sheet with the numbers behind it. Home and Statistics.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { LevelOverview } from '@/data';
import { LEVELS, levelIndex } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { formatNumber } from '@/features/stats/format';
import { Button, buttonClasses, cn, Dialog, DialogClose, Icon, Skeleton, Surface } from '@/ui';
import { levelDative, pct, useLevelOverview, useOfferVisible } from './levelText';

const THRESHOLD = 0.8;

/**
 * Six columns, A1 → C2, each filled to the share of that level's words the user knows. The
 * dashed line is the 80 % a level needs; the user's level is named in ink, the rest muted.
 * Levels up to the user's are solid accent, the ones above a lighter step of the same hue.
 */
export function LevelLadder({
  level,
  ratios,
  size = 'md',
  className,
}: {
  level: CefrLevel;
  ratios: Record<CefrLevel, number>;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const { t } = useTranslation();
  const own = levelIndex(level);
  return (
    <ol
      aria-label={t('level.ladderLabel')}
      className={cn('grid grid-cols-6 gap-1.5 sm:gap-2', className)}
      data-testid="level-ladder"
    >
      {LEVELS.map((b, i) => {
        const r = Math.max(0, Math.min(1, ratios[b] ?? 0));
        return (
          <li key={b} className="flex flex-col items-center gap-1.5" title={`${b}: %${pct(r)}`}>
            <span className="sr-only">{t('level.ladderItem', { level: b, pct: pct(r) })}</span>
            <span
              aria-hidden="true"
              className={cn(
                'relative w-full overflow-hidden rounded-[5px] bg-surface-sunken',
                size === 'md' ? 'h-14' : 'h-14 sm:h-32',
              )}
            >
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 rounded-t-[4px] transition-[height] duration-(--duration-large) ease-standard motion-reduce:transition-none',
                  i <= own ? 'bg-accent' : 'bg-accent/40',
                )}
                style={{ height: `${r * 100}%` }}
              />
              <span
                className="absolute inset-x-0 border-t border-dashed border-fg/45"
                style={{ bottom: `${THRESHOLD * 100}%` }}
              />
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'tabular text-xs leading-none',
                i === own ? 'font-semibold text-fg' : 'text-fg-muted',
              )}
            >
              {b}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const flatRatios = (o: LevelOverview) =>
  Object.fromEntries(LEVELS.map((b) => [b, o.ratios[b].ratio])) as Record<CefrLevel, number>;

/** "B2'ye ~620 kelime kaldı" / "B2 kelimelerinin %80'ini biliyorsun" / "En üst seviye". */
function useNextLine(o: LevelOverview): string {
  const { t } = useTranslation();
  const { next, toNext } = o.vocab;
  if (!next) return t('level.atTop');
  if (!toNext) return t('level.reachedNext', { next });
  return t('level.toNext', { next, nextTo: levelDative(next), count: formatNumber(toNext) });
}

export function VocabExplainDialog({
  overview: o,
  open,
  onOpenChange,
}: {
  overview: LevelOverview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { vocab } = o;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('level.explainTitle')}
      footer={
        <DialogClose asChild>
          <Button>{t('level.changeOk')}</Button>
        </DialogClose>
      }
    >
      <div className="flex flex-col gap-4 text-[0.9375rem] text-fg">
        <p>{t('level.explainBody')}</p>
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th scope="col" className="py-2 pr-2 font-medium">
                {t('level.colLevel')}
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">
                {t('level.colSize')}
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">
                {t('level.colRatio')}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t('level.colKnown')}
              </th>
            </tr>
          </thead>
          <tbody>
            {vocab.bands.map((b) => (
              <tr
                key={b.level}
                className={cn('border-b border-border', b.level === o.level && 'font-semibold')}
              >
                <th scope="row" className="py-1.5 pr-2 text-left font-[inherit]">
                  {b.level}
                </th>
                <td className="py-1.5 pr-2 text-right">{formatNumber(b.size)}</td>
                <td className="py-1.5 pr-2 text-right">%{pct(b.ratio)}</td>
                <td className="py-1.5 text-right">{formatNumber(Math.round(b.known))}</td>
              </tr>
            ))}
            {vocab.outside > 0 && (
              <tr className="border-b border-border">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  {t('level.rowOutside')}
                </th>
                <td colSpan={2} />
                <td className="py-1.5 text-right">{formatNumber(vocab.outside)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <th scope="row" className="py-2 pr-2 text-left">
                {t('level.rowTotal')}
              </th>
              <td colSpan={2} />
              <td className="py-2 text-right">~{formatNumber(vocab.estimate)}</td>
            </tr>
          </tbody>
        </table>
        {vocab.outside > 0 && (
          <p className="text-fg-muted">{t('level.explainOutside', { count: vocab.outside })}</p>
        )}
        {vocab.next && vocab.nextRatio !== null && (
          <p>{t('level.explainNext', { next: vocab.next, pct: pct(vocab.nextRatio) })}</p>
        )}
        <p className="text-sm text-fg-muted">{t('level.explainRounding')}</p>
      </div>
    </Dialog>
  );
}

/** Before a test or a chosen level the counter has nothing to stand on: offer the test. */
function VocabCta({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Surface
      as="section"
      aria-labelledby="vocab-cta-title"
      padding="none"
      className={cn('flex flex-col gap-4 p-5 sm:p-6', className)}
      data-testid="vocab-cta"
    >
      <div className="flex flex-col gap-1">
        <h2 id="vocab-cta-title" className="font-serif text-xl font-semibold text-fg">
          {t('level.ctaTitle')}
        </h2>
        <p className="text-[0.9375rem] text-fg-muted">{t('level.ctaBody')}</p>
      </div>
      <Link to="/level-test" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
        {t('level.ctaAction')}
        <Icon name="chevron-right" size={18} />
      </Link>
    </Surface>
  );
}

/**
 * The counter tile. "Nasıl hesaplanıyor?" opens the explanation. `wide` (Statistics): the
 * figures on the left, a taller ladder on the right from 640 px.
 */
export function VocabTile({ className, wide }: { className?: string; wide?: boolean }) {
  const overview = useLevelOverview();
  const offered = useOfferVisible();
  if (!overview) {
    return (
      <Surface padding="none" className={cn('p-5 sm:p-6', className)} aria-busy="true">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="mt-5 h-14 w-full" />
      </Surface>
    );
  }
  // While the home screen offers the test, a second invitation would only repeat it.
  if (!overview.hasBasis) return offered ? null : <VocabCta className={className} />;
  return <VocabCounter overview={overview} className={className} wide={wide} />;
}

function VocabCounter({
  overview: o,
  className,
  wide,
}: {
  overview: LevelOverview;
  className?: string;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const nextLine = useNextLine(o);
  const nextRatio = o.vocab.nextRatio ?? 1;
  const ladder = (
    <LevelLadder
      level={o.level}
      ratios={flatRatios(o)}
      size={wide ? 'lg' : 'md'}
      className={wide ? 'mt-5 sm:mt-0' : 'mt-5'}
    />
  );
  return (
    <Surface
      as="section"
      aria-labelledby="vocab-title"
      padding="none"
      className={cn(
        'relative p-5 sm:p-6',
        wide && 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-center sm:gap-x-10',
        className,
      )}
      data-testid="vocab-tile"
    >
      <div className="flex flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="vocab-title" className="font-serif text-lg font-semibold text-fg">
            {t('level.vocabTitle')}
          </h2>
          <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-accent-text">
            {t('level.vocabLevel', { level: o.level })}
          </span>
        </div>
        <p className="mt-3 flex items-baseline gap-2">
          <span
            className="tabular font-serif text-5xl leading-none font-semibold tracking-[-0.02em] text-fg"
            data-testid="vocab-estimate"
          >
            ~{formatNumber(o.vocab.estimate)}
          </span>
          <span className="font-serif text-xl text-fg-muted">{t('level.vocabUnit')}</span>
        </p>
        <p className="mt-1 text-sm text-fg-muted">{t('level.vocabCaption')}</p>

        {!wide && ladder}

        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-medium text-fg" data-testid="vocab-next">
              {nextLine}
            </span>
            {o.vocab.next && (
              <span className="tabular text-sm text-fg-muted">%{pct(nextRatio)} / %80</span>
            )}
          </div>
          {o.vocab.next && (
            <div
              aria-hidden="true"
              className="relative h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-(--duration-medium) ease-standard motion-reduce:transition-none"
                style={{ width: `${Math.min(1, nextRatio / THRESHOLD) * 100}%` }}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-mx-2 mt-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-2 text-sm font-medium text-accent-text hover:bg-hover"
          >
            <Icon name="info" size={16} />
            {t('level.vocabMore')}
          </button>
        </div>
      </div>
      {wide && ladder}
      <VocabExplainDialog overview={o} open={open} onOpenChange={setOpen} />
    </Surface>
  );
}
