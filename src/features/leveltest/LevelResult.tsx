// Result of a level test: the level, how near the next one is, the vocabulary estimate, the
// per-level ladder, and a warning (with "use it anyway" / "take it again") when the answers to
// the made-up words or the meaning questions make the result unreliable.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { applyTestLevel, logError } from '@/data';
import { LEVELS, levelIndex, type TestResult } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { formatDuration, formatNumber, formatPercent } from '@/features/stats/format';
import { requestSync } from '@/sync';
import { Button, buttonClasses, cn, Icon, Surface, toast } from '@/ui';
import { levelDative, pct } from './levelText';
import { LevelLadder } from './VocabTile';

export interface LevelTestOutcome {
  result: TestResult;
  /** The user's level before the test. */
  from: CefrLevel;
  /** "Biliyorum" words now in the known words. */
  marked: number;
  questions: number;
  durationMs: number;
}

export function LevelResult({ outcome }: { outcome: LevelTestOutcome }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { result, from } = outcome;
  const [applied, setApplied] = useState(result.reliable);
  const next = LEVELS[levelIndex(result.level) + 1] ?? null;

  const useAnyway = () => {
    applyTestLevel(result.level)
      .then(() => {
        setApplied(true);
        requestSync(0);
        toast({ title: t('levelTest.usedAnyway', { level: result.level }), tone: 'success' });
      })
      .catch((e: unknown) => {
        void logError(e, 'levelTest.apply');
        toast({ title: t('levelTest.saveFailed'), tone: 'danger' });
      });
  };
  const retake = () => void navigate('/level-test', { replace: true });

  return (
    <div
      className="flex flex-1 flex-col gap-5 pt-4 md:pt-8"
      data-testid="level-result"
      data-reliable={result.reliable}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium tracking-wide text-accent-text uppercase">
          {t('levelTest.resultTitle')}
        </p>
        <p className="mt-1 text-[0.9375rem] text-fg-muted">
          {result.reliable ? t('levelTest.resultLevel') : t('levelTest.unreliableLevel')}
        </p>
        <p className="flex items-baseline gap-3">
          <span
            className={cn(
              'tabular font-serif text-7xl leading-none font-semibold tracking-[-0.02em]',
              result.reliable ? 'text-fg' : 'text-fg-muted',
            )}
            data-testid="result-level"
          >
            {result.level}
          </span>
          <span className="font-serif text-2xl text-fg-muted">
            {t(`settings.levels.${result.level}`)}
          </span>
        </p>
        {applied && (
          <p className="mt-3 text-[0.9375rem] font-medium text-fg" role="status">
            {from === result.level
              ? t('levelTest.resultSame', { level: result.level })
              : t('levelTest.resultChanged', { from, to: result.level })}
          </p>
        )}
        {result.reliable && (
          <p className="mt-1 text-[0.9375rem] text-fg-muted">
            {next === null
              ? t('levelTest.atTop')
              : t(
                  result.nearNext
                    ? 'levelTest.nearNext'
                    : pct(result.nextRatio ?? 0) < 10
                      ? 'levelTest.towardNextNone'
                      : 'levelTest.towardNext',
                  { next, nextTo: levelDative(next), pct: pct(result.nextRatio ?? 0) },
                )}
          </p>
        )}
      </div>

      {!result.reliable && result.unreliableReason && (
        <section
          aria-labelledby="unreliable-title"
          className="flex flex-col gap-3 rounded-card border border-warn/40 bg-warn-soft p-4 sm:p-5"
          data-testid="result-unreliable"
        >
          <h2
            id="unreliable-title"
            className="flex items-center gap-2 font-semibold text-warn-text"
          >
            <Icon name="alert" size={18} />
            {t('levelTest.unreliableTitle')}
          </h2>
          <p className="text-[0.9375rem] text-fg">
            {t(`levelTest.unreliable.${result.unreliableReason}`, {
              pct: formatPercent(result.falseAlarm),
            })}
          </p>
          {!applied && (
            <>
              <p className="text-[0.9375rem] text-fg-muted">
                {t('levelTest.unreliableKept', { level: from })}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={retake}>{t('levelTest.retake')}</Button>
                <Button variant="secondary" onClick={useAnyway}>
                  {t('levelTest.useAnyway')}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {(result.reliable || applied) && (
        <Surface padding="none" className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-fg-muted">{t('levelTest.vocab')}</span>
            <span
              className="tabular font-serif text-4xl leading-tight font-semibold text-fg"
              data-testid="result-vocab"
            >
              ~{formatNumber(result.vocabEstimate)}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">{t('levelTest.ladder')}</span>
            <LevelLadder level={result.level} ratios={result.ratios} />
          </div>
        </Surface>
      )}

      {result.reliable && outcome.marked > 0 && (
        <p className="text-sm text-fg-muted">
          {t('levelTest.markedKnown', { count: outcome.marked })}
        </p>
      )}
      <p className="text-xs text-fg-subtle">
        {t('levelTest.duration', {
          count: outcome.questions,
          time: formatDuration(outcome.durationMs),
        })}
      </p>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Link to="/" replace className={buttonClasses({ size: 'lg', fullWidth: true })}>
          {t('levelTest.home')}
        </Link>
        {(result.reliable || applied) && (
          <Button variant="ghost" fullWidth onClick={retake}>
            {t('levelTest.retake')}
          </Button>
        )}
      </div>
    </div>
  );
}
