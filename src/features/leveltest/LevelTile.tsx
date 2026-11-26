// The level tile on İlerleme: the user's level, a level ladder and how much of the next level
// they know. The ladder is also used on the level test result.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { LevelOverview } from '@/data';
import { LEVELS, levelIndex } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import {
  Badge,
  buttonClasses,
  Card,
  cn,
  Icon,
  ListGroup,
  ListRow,
  ProgressBar,
  Skeleton,
} from '@/ui';
import { pct, useLevelOverview, useOfferVisible } from './levelText';

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
                'relative w-full overflow-hidden rounded-sm bg-surface-sunken',
                size === 'md' ? 'h-14' : 'h-14 sm:h-32',
              )}
            >
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 rounded-t-xs transition-[height] duration-(--duration-large) ease-standard motion-reduce:transition-none',
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
                'tabular text-caption',
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

/** Before a test or a chosen level there is no level to show: offer the test. */
function LevelCta({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Card
      as="section"
      aria-labelledby="level-cta-title"
      className={cn('flex flex-col gap-4', className)}
      data-testid="level-cta"
    >
      <div className="flex flex-col gap-1">
        <h2 id="level-cta-title" className="text-title font-semibold text-fg">
          {t('level.ctaTitle')}
        </h2>
        <p className="text-ui text-fg-muted">{t('level.ctaBody')}</p>
      </div>
      <Link to="/level-test" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
        {t('level.ctaAction')}
        <Icon name="chevron-right" size={18} />
      </Link>
    </Card>
  );
}

/** The level tile (İlerleme). */
export function LevelTile({
  className,
  measureRow,
}: {
  className?: string;
  /**
   * While the home screen offers the test, show a quiet "Seviyeni ölç" row instead of nothing
   * (İlerleme, review d7: the home offer is not on that page).
   */
  measureRow?: boolean;
}) {
  const { t } = useTranslation();
  const overview = useLevelOverview();
  const offered = useOfferVisible();
  if (!overview) {
    return (
      <Card className={className} aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-5 h-14 w-full" />
      </Card>
    );
  }
  // While the home screen offers the test, a second invitation would only repeat it.
  if (!overview.hasBasis) {
    if (!offered) return <LevelCta className={className} />;
    if (!measureRow) return null;
    return (
      <div className={className} data-testid="level-measure">
        <ListGroup>
          <ListRow
            to="/level-test"
            leadingIcon="chart"
            title={t('level.measureRow')}
            description={t('level.measureRowHint')}
          />
        </ListGroup>
      </div>
    );
  }
  return <LevelSummary overview={overview} className={className} />;
}

function LevelSummary({ overview: o, className }: { overview: LevelOverview; className?: string }) {
  const { t } = useTranslation();
  const ratios = flatRatios(o);
  const next = LEVELS[levelIndex(o.level) + 1] ?? null;
  const nextRatio = next ? ratios[next] : null;
  const nextLine =
    !next || nextRatio === null
      ? t('level.atTop')
      : nextRatio >= THRESHOLD
        ? t('level.reachedNext', { next })
        : t('level.nextShare', { next, pct: pct(nextRatio) });
  return (
    <Card
      as="section"
      aria-labelledby="level-tile-title"
      className={cn('flex flex-col', className)}
      data-testid="level-tile"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="level-tile-title" className="text-title font-semibold text-fg">
          {t('level.tileTitle')}
        </h2>
        <Badge tone="accent">{o.level}</Badge>
      </div>
      <LevelLadder level={o.level} ratios={ratios} className="mt-5" />
      <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui font-medium text-fg" data-testid="level-next">
            {nextLine}
          </span>
          {next && nextRatio !== null && (
            <span className="tabular text-meta text-fg-muted">%{pct(nextRatio)} / %80</span>
          )}
        </div>
        {next && nextRatio !== null && (
          <>
            <ProgressBar value={Math.min(1, nextRatio / THRESHOLD) * 100} label={nextLine} />
            <p className="text-meta text-fg-muted">{t('level.updateHint')}</p>
          </>
        )}
      </div>
    </Card>
  );
}
