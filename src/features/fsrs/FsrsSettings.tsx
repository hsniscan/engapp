// Settings → Çalışma: "Algoritmayı hafızama göre ayarla" and the retention helper
// (v0.3 İP4, docs/decisions/0022). Logic lives in domain/fsrsOptimizer.ts and domain/forecast.ts
// (the helper runs İlerleme's 30-day forecast at each target, data/load.ts).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adoptFsrsParams,
  getWorkloadInput,
  loadOptimizerLogs,
  logError,
  markFsrsOptRun,
  revertFsrsParams,
} from '@/data';
import { MIN_REVIEWS, type OptimizeResult } from '@/domain/fsrsOptimizer';
import type { Settings } from '@/domain/types';
import { changePct, RETENTION_CHOICES } from '@/domain/workload';
import { useRetentionWorkloads } from '@/features/load/useWorkload';
import { SettingsRow } from '@/features/settings/SettingsLayout';
import { usePausedLiveQuery } from '@/features/settings/usePausedLiveQuery';
import { Button, cn, ProgressBar, toast } from '@/ui';
import { OptimizerUnavailableError, runOptimizer } from './runOptimizer';
import { useOptimizerStatus } from './useOptimizerStatus';

const nf = new Intl.NumberFormat('tr-TR');
const df = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' });

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; result: OptimizeResult }
  | { kind: 'failed'; offline: boolean };

/** Workload change below this (percent) reads as "about the same". */
const SAME_WORKLOAD_PCT = 2;

export function FsrsOptimizerRow() {
  const { t } = useTranslation();
  const status = useOptimizerStatus();
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [reverting, setReverting] = useState(false);
  const busy = useRef(false);

  if (!status) return null;
  const { settings, counts, enough, suggested, personal } = status;

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setRun({ kind: 'running', progress: 0 });
    try {
      const logs = await loadOptimizerLogs();
      const result = await runOptimizer(
        {
          logs,
          input: {
            current: settings.fsrs_params,
            request_retention: settings.request_retention,
            daily_new_limit: settings.daily_new_limit,
          },
        },
        (p) => setRun({ kind: 'running', progress: p }),
      );
      if (result.adopted) await adoptFsrsParams(result.params);
      else await markFsrsOptRun();
      setRun({ kind: 'done', result });
    } catch (e) {
      void logError(e, 'fsrs.optimize');
      setRun({ kind: 'failed', offline: e instanceof OptimizerUnavailableError });
    } finally {
      busy.current = false;
    }
  };

  const revert = async () => {
    setReverting(true);
    try {
      await revertFsrsParams();
      setRun({ kind: 'idle' });
      toast({ title: t('fsrsOpt.reverted') });
    } catch (e) {
      void logError(e, 'fsrs.revert');
      toast({ title: t('fsrsOpt.saveFailed'), tone: 'danger' });
    } finally {
      setReverting(false);
    }
  };

  const running = run.kind === 'running';
  return (
    <SettingsRow stack>
      <div className="flex flex-col gap-1" data-testid="fsrs-optimizer">
        <div className="text-ui font-medium text-fg">{t('fsrsOpt.title')}</div>
        <p className="text-meta text-fg-muted">{t('fsrsOpt.body')}</p>
      </div>

      {!enough ? (
        <div className="flex flex-col gap-2">
          <ProgressBar
            value={counts.total}
            max={MIN_REVIEWS}
            label={t('fsrsOpt.title')}
            valueText={t('fsrsOpt.progressText', {
              count: nf.format(counts.total),
              min: nf.format(MIN_REVIEWS),
            })}
          />
          <p className="text-meta text-fg-muted">
            {t('fsrsOpt.needMore', { min: nf.format(MIN_REVIEWS), count: nf.format(counts.total) })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-meta text-fg-muted" aria-live="polite">
            {personal ? t('fsrsOpt.personalActive') : t('fsrsOpt.defaultActive')}
            {settings.fsrs_opt_at != null &&
              ` ${t('fsrsOpt.lastRun', { date: df.format(new Date(settings.fsrs_opt_at)) })}`}
          </p>
          {suggested && run.kind === 'idle' && (
            <p className="rounded-control bg-accent-soft px-3 py-2 text-meta text-accent-text">
              {settings.fsrs_opt_at == null
                ? t('fsrsOpt.suggestFirst', { count: nf.format(counts.total) })
                : t('fsrsOpt.suggestAgain', { count: nf.format(counts.sinceLastRun) })}
            </p>
          )}

          {running && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <ProgressBar
                value={Math.round(run.progress * 100)}
                label={t('fsrsOpt.runningLabel')}
                valueText={t('fsrsOpt.running', { pct: Math.round(run.progress * 100) })}
                size="md"
              />
              <p className="text-meta text-fg-muted">
                {t('fsrsOpt.running', { pct: Math.round(run.progress * 100) })}{' '}
                {t('fsrsOpt.runningHint')}
              </p>
            </div>
          )}

          {run.kind === 'done' && <ResultNote result={run.result} />}
          {run.kind === 'failed' && (
            <p role="alert" className="text-meta text-danger-text">
              {run.offline ? t('fsrsOpt.unavailable') : t('fsrsOpt.failed')}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant={suggested ? 'primary' : 'secondary'}
              onClick={() => void start()}
              loading={running}
              disabled={running || reverting}
            >
              {settings.fsrs_opt_at == null ? t('fsrsOpt.run') : t('fsrsOpt.runAgain')}
            </Button>
            {personal && (
              <Button
                variant="ghost"
                onClick={() => void revert()}
                loading={reverting}
                disabled={running || reverting}
              >
                {t('fsrsOpt.revert')}
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsRow>
  );
}

function ResultNote({ result }: { result: OptimizeResult }) {
  const { t } = useTranslation();
  if (!result.adopted) {
    return (
      <p className="text-meta text-fg" aria-live="polite" data-testid="fsrs-result">
        {result.reason === 'too_few' ? t('fsrsOpt.tooFew') : t('fsrsOpt.kept')}
      </p>
    );
  }
  const gain = Math.max(1, Math.round(result.accuracyGainPct));
  const change = changePct(result.workloadNow, result.workloadNext);
  const pct = Math.round(Math.abs(change));
  const workload =
    pct < SAME_WORKLOAD_PCT
      ? t('fsrsOpt.workloadSame')
      : change < 0
        ? t('fsrsOpt.workloadDown', { pct })
        : t('fsrsOpt.workloadUp', { pct });
  return (
    <div
      className="flex flex-col gap-1 rounded-control bg-success-soft px-3 py-2 text-meta text-success-text"
      aria-live="polite"
      data-testid="fsrs-result"
    >
      <p className="font-medium">{t('fsrsOpt.adopted', { gain })}</p>
      <p>{workload}</p>
      <p>{t('fsrsOpt.adoptedRevert')}</p>
    </div>
  );
}

/**
 * Expected answers per day at 85 / 90 / 95 %: İlerleme's 30-day forecast (reviews, relearning
 * and the word-only new-card budget) run at each target, so the current target's figure is
 * İlerleme's "günde ortalama". The other targets also give the long-run review change (the
 * 30-day figures stay close while the learning ramp caps young cards' intervals).
 */
export function RetentionHelper({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const input = usePausedLiveQuery(() => getWorkloadInput(), []);
  const view = useRetentionWorkloads(input, RETENTION_CHOICES);
  if (!view) return null;
  const current = Math.round(settings.request_retention * 100);
  const hint =
    view.newAvailable > 0 && view.dailyNewLimit > 0
      ? t('fsrsOpt.helper.hintNew', { count: view.dailyNewLimit })
      : t('fsrsOpt.helper.hintNoNew');
  return (
    <SettingsRow stack>
      <div className="flex flex-col gap-1">
        <div className="text-ui font-medium text-fg">{t('fsrsOpt.helper.title')}</div>
        {view.studied > 0 && <p className="text-meta text-fg-muted">{hint}</p>}
      </div>
      {view.studied === 0 ? (
        <p className="text-meta text-fg-muted">{t('fsrsOpt.helper.empty')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" data-testid="retention-helper">
          {view.choices.map(({ retention, perDay, longRunPct }) => {
            const pct = Math.round(retention * 100);
            const active = pct === current;
            const change = Math.round(Math.abs(longRunPct));
            return (
              <li
                key={retention}
                className={cn(
                  'flex min-w-0 flex-col gap-0.5 rounded-control border px-3 py-2',
                  active ? 'border-accent bg-accent-soft' : 'border-border',
                )}
              >
                <span className={cn('text-meta', active ? 'text-accent-text' : 'text-fg-muted')}>
                  {t('fsrsOpt.helper.retention', { pct })}
                </span>
                <span className="text-lead font-semibold text-fg tabular-nums">
                  {t('fsrsOpt.helper.reviews', { count: nf.format(perDay) })}
                </span>
                {active ? (
                  <span className="text-caption text-accent-text">{t('fsrsOpt.helper.current')}</span>
                ) : (
                  <span className="text-caption text-fg-muted">
                    {change < SAME_WORKLOAD_PCT
                      ? t('fsrsOpt.helper.longRunSame')
                      : longRunPct > 0
                        ? t('fsrsOpt.helper.longRunMore', { pct: change })
                        : t('fsrsOpt.helper.longRunFewer', { pct: change })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsRow>
  );
}
