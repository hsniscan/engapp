// Settings → Çalışma: "Algoritmayı hafızama göre ayarla" and the retention helper
// (v0.3 İP4, docs/decisions/0022). Logic lives in domain/fsrsOptimizer.ts and domain/workload.ts.
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adoptFsrsParams,
  db,
  loadOptimizerLogs,
  logError,
  markFsrsOptRun,
  revertFsrsParams,
} from '@/data';
import { MIN_REVIEWS, normalizeParams, type OptimizeResult } from '@/domain/fsrsOptimizer';
import { CardState, type Settings } from '@/domain/types';
import { changePct, expectedDailyReviews, RETENTION_CHOICES } from '@/domain/workload';
import { SettingsRow } from '@/features/settings/SettingsLayout';
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
        <div className="text-[0.9375rem] font-medium text-fg">{t('fsrsOpt.title')}</div>
        <p className="text-sm text-fg-muted">{t('fsrsOpt.body')}</p>
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
          <p className="text-sm text-fg-muted">
            {t('fsrsOpt.needMore', { min: nf.format(MIN_REVIEWS), count: nf.format(counts.total) })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted" aria-live="polite">
            {personal ? t('fsrsOpt.personalActive') : t('fsrsOpt.defaultActive')}
            {settings.fsrs_opt_at != null &&
              ` ${t('fsrsOpt.lastRun', { date: df.format(new Date(settings.fsrs_opt_at)) })}`}
          </p>
          {suggested && run.kind === 'idle' && (
            <p className="rounded-control bg-accent-soft px-3 py-2 text-sm text-accent-text">
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
              <p className="text-sm text-fg-muted">
                {t('fsrsOpt.running', { pct: Math.round(run.progress * 100) })}{' '}
                {t('fsrsOpt.runningHint')}
              </p>
            </div>
          )}

          {run.kind === 'done' && <ResultNote result={run.result} />}
          {run.kind === 'failed' && (
            <p role="alert" className="text-sm text-danger-text">
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
      <p className="text-sm text-fg" aria-live="polite" data-testid="fsrs-result">
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
      className="flex flex-col gap-1 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
      aria-live="polite"
      data-testid="fsrs-result"
    >
      <p className="font-medium">{t('fsrsOpt.adopted', { gain })}</p>
      <p>{workload}</p>
      <p>{t('fsrsOpt.adoptedRevert')}</p>
    </div>
  );
}

/** Expected reviews per day at 85 / 90 / 95 % for the cards studied so far. */
export function RetentionHelper({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const stabilities = useLiveQuery(async () => {
    const out: number[] = [];
    await db.cards.each((c) => {
      if (c.deleted_at === null && !c.suspended && c.state !== CardState.New) out.push(c.stability);
    });
    return out;
  }, []);
  if (!stabilities) return null;
  const w = normalizeParams(settings.fsrs_params);
  const current = Math.round(settings.request_retention * 100);
  return (
    <SettingsRow stack>
      <div className="flex flex-col gap-1">
        <div className="text-[0.9375rem] font-medium text-fg">{t('fsrsOpt.helper.title')}</div>
        <p className="text-sm text-fg-muted">{t('fsrsOpt.helper.hint')}</p>
      </div>
      {stabilities.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('fsrsOpt.helper.empty')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" data-testid="retention-helper">
          {RETENTION_CHOICES.map((r) => {
            const pct = Math.round(r * 100);
            const n = Math.round(expectedDailyReviews(stabilities, w, r, settings.daily_new_limit));
            const active = pct === current;
            return (
              <li
                key={r}
                className={cn(
                  'flex min-w-0 flex-col gap-0.5 rounded-control border px-3 py-2',
                  active ? 'border-accent bg-accent-soft' : 'border-border',
                )}
              >
                <span className={cn('text-sm', active ? 'text-accent-text' : 'text-fg-muted')}>
                  {t('fsrsOpt.helper.retention', { pct })}
                </span>
                <span className="font-serif text-lg font-semibold text-fg tabular-nums">
                  {t('fsrsOpt.helper.reviews', { count: nf.format(n) })}
                </span>
                {active && (
                  <span className="text-xs text-accent-text">{t('fsrsOpt.helper.current')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsRow>
  );
}
