// Goals on the continuity tab (v0.3 İP7): progress rings for the goals the user set, and the
// dialog that sets them with a suggestion each (domain/goals.ts: 80th percentile of the last
// 8 weeks, rounded). The user decides; nothing is set without them.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getGoalsView, type GoalsView, logError, setGoals, updateGoals } from '@/data';
import { CEFR_ORDER } from '@/domain/deckFilter';
import {
  DAY_MINUTES_LIMITS,
  GOAL_KEYS,
  GOAL_LIMITS,
  type GoalKey,
  type GoalProgress,
  type Goals,
} from '@/domain/goals';
import type { CefrLevel } from '@/domain/types';
import { formatNumber } from '@/features/stats/format';
import { Button, Dialog, Select, Surface, TextField, toast } from '@/ui';

export function GoalsSection() {
  const { t } = useTranslation();
  const view = useLiveQuery(() => getGoalsView(Date.now()), []);
  const [open, setOpen] = useState(false);
  if (!view) return null;
  const hasGoals = view.progress.length > 0;
  return (
    <Surface as="section" aria-labelledby="goals-title" padding="lg" data-testid="goals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="goals-title" className="font-serif text-xl font-semibold">
          {t('goals.title')}
        </h2>
        <Button variant={hasGoals ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
          {hasGoals ? t('goals.change') : t('goals.set')}
        </Button>
      </div>
      {hasGoals ? (
        <ul className="mt-5 grid grid-cols-1 gap-5 min-[400px]:grid-cols-3">
          {view.progress.map((p) => (
            <GoalRing key={p.key} progress={p} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.9375rem] text-fg-muted">{t('goals.intro')}</p>
      )}
      {open ? <GoalsDialog view={view} onClose={() => setOpen(false)} /> : null}
    </Surface>
  );
}

const R = 26;
const CIRC = 2 * Math.PI * R;

function GoalRing({ progress: p }: { progress: GoalProgress }) {
  const { t } = useTranslation();
  const label = t(`goals.short.${p.key}`);
  const value = t(`goals.unit.${p.key}`, { count: p.value });
  const target = t(`goals.unit.${p.key}`, { count: p.target });
  return (
    <li className="flex items-center gap-3 min-[400px]:flex-col min-[400px]:text-center">
      <svg
        viewBox="0 0 64 64"
        className="size-16 shrink-0 -rotate-90"
        role="img"
        aria-label={t('goals.ringLabel', { label, value: formatNumber(p.value), target })}
      >
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" className="stroke-border" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - p.ratio)}
          className={p.ratio > 0 ? 'stroke-accent-text' : 'stroke-transparent'}
        />
      </svg>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-fg-muted">{label}</span>
        <span className="tabular text-[0.9375rem] font-medium text-fg">
          {value} / {target}
          {p.met ? <span className="ml-1.5 text-accent-text">· {t('goals.met')}</span> : null}
        </span>
      </div>
    </li>
  );
}

type NumberKey = GoalKey | 'day_minutes';
type Draft = Record<NumberKey, string>;

/** The number fields, in the dialog's order: the home's daily minutes, then the report's goals. */
const NUMBER_KEYS: readonly NumberKey[] = ['day_minutes', ...GOAL_KEYS];
const LIMITS: Record<NumberKey, { min: number; max: number; step: number }> = {
  ...GOAL_LIMITS,
  day_minutes: DAY_MINUTES_LIMITS,
};
/** Select value for "no target level set" (Radix Select items cannot have an empty value). */
const AUTO_LEVEL = 'auto';

function validate(key: NumberKey, raw: string): number | null | 'invalid' {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  const { min, max, step } = LIMITS[key];
  if (!Number.isInteger(n) || n < min || n > max || n % step !== 0) return 'invalid';
  return n;
}

/** Levels the user can aim for: those above the current one, and the stored one if any. */
function targetOptions(level: CefrLevel, stored: CefrLevel | null | undefined): CefrLevel[] {
  const above = CEFR_ORDER.slice(CEFR_ORDER.indexOf(level) + 1);
  return CEFR_ORDER.filter((l) => above.includes(l) || l === stored);
}

export function GoalsDialog({ view, onClose }: { view: GoalsView; onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => {
    const d = {} as Draft;
    for (const k of NUMBER_KEYS) d[k] = view.goals[k] ? String(view.goals[k]) : '';
    return d;
  });
  const [target, setTarget] = useState<string>(view.goals.target_level ?? AUTO_LEVEL);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const parsed = NUMBER_KEYS.map((k) => [k, validate(k, draft[k])] as const);
  const invalid = parsed.some(([, v]) => v === 'invalid');
  const levels = targetOptions(view.level, view.goals.target_level);

  // Every goal this dialog knows is written (null clears one), so a goal it does not show
  // survives; "clear all" (null) removes them all.
  const save = (goals: Goals | null) => {
    setSaving(true);
    (goals ? updateGoals(goals) : setGoals(null))
      .then(() => {
        toast({ title: goals ? t('goals.saved') : t('goals.cleared'), tone: 'success' });
        onClose();
      })
      .catch((e: unknown) => void logError(e, 'goals.save'))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('goals.dialogTitle')}
      description={t('goals.dialogDescription')}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={() => save(null)}>
            {t('goals.clearAll')}
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              setTried(true);
              if (invalid) return;
              const goals: Goals = {
                target_level: target === AUTO_LEVEL ? null : (target as CefrLevel),
              };
              for (const [k, v] of parsed) goals[k] = typeof v === 'number' ? v : null;
              save(goals);
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Select
          label={t('goals.target_level')}
          value={target}
          onValueChange={setTarget}
          hint={t('goals.targetLevelHint', { level: view.level })}
          options={[
            { value: AUTO_LEVEL, label: t('goals.targetLevelAuto') },
            ...levels.map((l) => ({ value: l, label: `${l} · ${t(`settings.levels.${l}`)}` })),
          ]}
        />
        {NUMBER_KEYS.map((k) => {
          const { min, max, step } = LIMITS[k];
          const bad = tried && validate(k, draft[k]) === 'invalid';
          const error = bad
            ? step > 1
              ? t('goals.rangeStep', { min, max, step })
              : t('goals.range', { min, max })
            : undefined;
          if (k === 'day_minutes')
            return (
              <TextField
                key={k}
                label={t('goals.day_minutes')}
                inputMode="numeric"
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                error={error}
                hint={t('goals.dayMinutesHint')}
              />
            );
          const sug = view.suggestions[k];
          return (
            <div key={k} className="flex flex-col gap-1.5">
              <TextField
                label={t(`goals.${k}`)}
                inputMode="numeric"
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                error={error}
                hint={`${t('goals.suggestion', { value: t(`goals.unit.${k}`, { count: sug.value }) })} ${
                  sug.basis === 'history'
                    ? t('goals.suggestionHistory', { count: sug.weeks })
                    : t('goals.suggestionDefault')
                }`}
              />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setDraft({ ...draft, [k]: String(sug.value) })}
                aria-label={`${t('goals.useSuggestion')}: ${t(`goals.${k}`)}`}
              >
                {t('goals.useSuggestion')}
              </Button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
