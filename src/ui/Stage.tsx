import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { stageBg, uiStages, type UiStage } from './stage-scale';

export interface StagePillProps {
  stage: UiStage;
  /** Optional count after the label ("Pekişiyor 12"). */
  count?: number;
  className?: string;
}

/** Stage label with its swatch. The label always carries the meaning (never colour alone). */
export function StagePill({ stage, count, className }: StagePillProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-sunken pr-2.5 pl-2 text-caption font-semibold whitespace-nowrap text-fg-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          stageBg[stage],
          stage === 'new' && 'ring-1 ring-border-strong ring-inset',
        )}
      />
      {t(`ui.stage.${stage}`)}
      {count != null && <span className="tabular text-fg">{count}</span>}
    </span>
  );
}

export interface StageBarProps {
  counts: Partial<Record<UiStage, number>>;
  /** Show the legend with counts under the bar. */
  legend?: boolean;
  /** Which stages to include (default: all five). Bugün shows learning→mastered. */
  stages?: readonly UiStage[];
  className?: string;
}

/**
 * Distribution of words over stages: one 10 px rounded bar of segments (2 px gaps), the same
 * colours as StagePill. Announced as one sentence (role="img").
 */
export function StageBar({ counts, legend = true, stages = uiStages, className }: StageBarProps) {
  const { t } = useTranslation();
  const total = stages.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const list = stages.map((k) => `${t(`ui.stage.${k}`)} ${counts[k] ?? 0}`).join(', ');
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        role="img"
        aria-label={t('ui.stageBar', { list })}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        {total > 0 &&
          stages.map((k) => {
            const n = counts[k] ?? 0;
            if (!n) return null;
            return (
              <span
                key={k}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', stageBg[k])}
                style={{ width: `${(n / total) * 100}%`, minWidth: 6 }}
              />
            );
          })}
      </div>
      {legend && (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5">
          {stages.map((k) => (
            <li key={k} className="flex items-center gap-1.5 text-meta text-fg-muted">
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  stageBg[k],
                  k === 'new' && 'ring-1 ring-border-strong ring-inset',
                )}
              />
              {t(`ui.stage.${k}`)}
              <span className="tabular font-semibold text-fg">{counts[k] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
