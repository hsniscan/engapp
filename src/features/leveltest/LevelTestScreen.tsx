// Level test screen (/level-test, immersive): intro → yes/no words with made-up words and a few
// meaning questions → result. Works offline: the question bank is a lazy chunk that the PWA
// precaches, and everything is saved locally first (level_tests syncs later).
// Keyboard: 1 / ← Bilmiyorum, 2 / → Biliyorum, Backspace undo; meaning questions 1–4, 0.
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { countOutsideWords, getKnownTermKeys, getSettings, logError, saveLevelTest } from '@/data';
import {
  type Answer,
  answeredCount,
  createTest,
  currentQuestion,
  type LevelTestBank,
  progress,
  answerQuestion,
  scoreTest,
  type TestState,
} from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { requestSync } from '@/sync';
import { Button, cn, Icon, Kbd, ProgressBar, Skeleton, Spinner, toast } from '@/ui';
import { LevelResult, type LevelTestOutcome } from './LevelResult';

const loadBank = () =>
  import('../../../data/level-test/bank.json').then((m) => m.default as unknown as LevelTestBank);

const KEY_SCOPE_IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]';

type Phase =
  | { kind: 'intro' }
  | { kind: 'test'; state: TestState; history: TestState[]; startedAt: number }
  | { kind: 'saving' }
  | { kind: 'result'; outcome: LevelTestOutcome };

/** React Router keeps the history index in history.state: false when the test was opened directly. */
const canGoBack = () => ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

/** A fresh test for every navigation ("Testi yeniden çöz" to the same URL too). */
export function LevelTestRoute() {
  const location = useLocation();
  return <LevelTestScreen key={location.key} />;
}

export function LevelTestScreen() {
  const { t } = useTranslation();
  const [bank, setBank] = useState<LevelTestBank | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const settings = useLiveQuery(() => getSettings(), []);

  useEffect(() => {
    let live = true;
    loadBank()
      .then((b) => live && setBank(b))
      .catch((e: unknown) => {
        void logError(e, 'levelTest.bank');
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const start = () => {
    if (!bank) return;
    // The first block is at the user's current level (B1 until measured); the test moves from there.
    const level: CefrLevel = settings?.level ?? 'B1';
    setPhase({
      kind: 'test',
      state: createTest(bank, level, randomSeed()),
      history: [],
      startedAt: Date.now(),
    });
  };

  /** `before`: the test as it was before the last answer, to go back to if saving fails. */
  const finish = async (
    state: TestState,
    before: Extract<Phase, { kind: 'test' }>,
    from: CefrLevel,
  ) => {
    const { startedAt } = before;
    setPhase({ kind: 'saving' });
    try {
      const extra = await countOutsideWords();
      const result = scoreTest(state.items, bank!.band_sizes, extra);
      await saveLevelTest({
        items: state.items,
        level: result.level,
        ratios: result.ratios,
        reliable: result.reliable,
        falseAlarm: result.falseAlarm,
        vocabEstimate: result.vocabEstimate,
        bankVersion: state.bankVersion,
        durationMs: Date.now() - startedAt,
      });
      requestSync(0);
      const known = result.reliable ? await getKnownTermKeys() : new Set<string>();
      const marked = state.items.filter(
        (i) => !i.pseudo && i.answer === 'yes' && i.mc_ok !== false && known.has(i.w),
      ).length;
      setPhase({
        kind: 'result',
        outcome: {
          result,
          from,
          marked,
          questions: answeredCount(state),
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (e) {
      void logError(e, 'levelTest.save');
      toast({ title: t('levelTest.saveFailed'), tone: 'danger' });
      setPhase(before);
    }
  };

  const answer = (a: Answer) => {
    if (phase.kind !== 'test' || !bank) return;
    const next = answerQuestion(bank, phase.state, a);
    if (next === phase.state) return;
    if (next.done) {
      void finish(next, phase, settings?.level ?? 'B1');
      return;
    }
    setPhase({ ...phase, state: next, history: [...phase.history, phase.state].slice(-20) });
  };

  const undo = () => {
    if (phase.kind !== 'test' || phase.history.length === 0) return;
    const prev = phase.history[phase.history.length - 1]!;
    setPhase({ ...phase, state: prev, history: phase.history.slice(0, -1) });
  };

  if (phase.kind === 'result') {
    return (
      <Frame>
        <LevelResult outcome={phase.outcome} />
      </Frame>
    );
  }

  if (phase.kind === 'saving') {
    return (
      <Frame>
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 text-fg-muted"
          role="status"
        >
          <Spinner />
          <p>{t('levelTest.saving')}</p>
        </div>
      </Frame>
    );
  }

  if (phase.kind === 'intro') {
    return (
      <Frame>
        <Intro ready={!!bank} failed={loadFailed} onStart={start} />
      </Frame>
    );
  }

  return (
    <Frame>
      <TestView
        state={phase.state}
        canUndo={phase.history.length > 0}
        onAnswer={answer}
        onUndo={undo}
      />
    </Frame>
  );
}

function Intro({
  ready,
  failed,
  onStart,
}: {
  ready: boolean;
  failed: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const points = [
    t('levelTest.introPoint1'),
    t('levelTest.introPoint2'),
    t('levelTest.introPoint3'),
    t('levelTest.introPoint4'),
  ];
  return (
    <div className="flex flex-1 flex-col pt-6 md:pt-12">
      <p className="text-sm font-medium tracking-wide text-accent-text uppercase">
        {t('levelTest.title')}
      </p>
      <h2 className="mt-2 font-serif text-3xl leading-tight font-semibold text-fg md:text-4xl">
        {t('levelTest.introTitle')}
      </h2>
      <p className="mt-3 text-[0.9375rem] text-fg-muted">{t('levelTest.introBody')}</p>
      <ol className="mt-8 flex flex-col gap-5">
        {points.map((p, i) => (
          <li key={p} className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-serif text-base font-semibold text-fg-muted"
            >
              {i + 1}
            </span>
            <p className="pt-1 text-[0.9375rem] text-fg">{p}</p>
          </li>
        ))}
      </ol>
      {failed && (
        <p role="alert" className="mt-6 text-[0.9375rem] text-danger-text">
          {t('levelTest.loadFailed')}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-10">
        <Button
          size="lg"
          fullWidth
          onClick={onStart}
          disabled={!ready}
          aria-busy={!ready && !failed}
        >
          {t('levelTest.start')}
          <Icon name="chevron-right" size={20} />
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => void (canGoBack() ? navigate(-1) : navigate('/'))}
        >
          {t('levelTest.notNow')}
        </Button>
      </div>
    </div>
  );
}

function TestView({
  state,
  canUndo,
  onAnswer,
  onUndo,
}: {
  state: TestState;
  canUndo: boolean;
  onAnswer: (a: Answer) => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const q = currentQuestion(state);
  const handlers = useRef({ onAnswer, onUndo, q });
  useLayoutEffect(() => {
    handlers.current = { onAnswer, onUndo, q };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(KEY_SCOPE_IGNORE)) return;
      const { onAnswer, onUndo, q } = handlers.current;
      if (!q) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        onUndo();
        return;
      }
      if (q.kind === 'word') {
        if (e.key === '1' || e.key === 'ArrowLeft') onAnswer({ kind: 'word', known: false });
        else if (e.key === '2' || e.key === 'ArrowRight') onAnswer({ kind: 'word', known: true });
        else return;
        e.preventDefault();
      } else {
        const n = Number(e.key);
        if (e.key === '0') onAnswer({ kind: 'meaning', choice: -1 });
        else if (n >= 1 && n <= q.options.length) onAnswer({ kind: 'meaning', choice: n - 1 });
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!q) {
    return <Skeleton className="h-60 w-full" />;
  }
  const done = answeredCount(state);
  const step = `${state.items.length}:${q.kind}`;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <ProgressBar
          value={Math.round(progress(state) * 100)}
          label={t('a11y.progress')}
          valueText={t('levelTest.progress', { done })}
        />
        <span
          aria-hidden="true"
          className="tabular min-w-8 shrink-0 pl-1 text-right text-sm text-fg-muted"
        >
          {done}
        </span>
      </div>

      <div
        key={step}
        className="flex min-h-[min(40dvh,20rem)] flex-1 flex-col items-center justify-center gap-3 px-2 text-center motion-safe:animate-fade-in"
        data-testid="level-question"
        data-kind={q.kind}
        data-step={step}
      >
        <p className="text-sm text-fg-muted">
          {q.kind === 'word' ? t('levelTest.question') : t('levelTest.meaningQuestion')}
        </p>
        <p
          lang="en"
          className="font-serif text-[2.75rem] leading-tight font-semibold tracking-[-0.01em] break-words text-fg sm:text-6xl"
          data-testid="level-word"
        >
          {q.w}
        </p>
      </div>

      <div className="pt-6 pb-1">
        {q.kind === 'word' ? (
          <div role="group" aria-label={t('levelTest.question')} className="grid grid-cols-2 gap-3">
            <AnswerButton
              tone="no"
              shortcut="1"
              onClick={() => onAnswer({ kind: 'word', known: false })}
            >
              {t('levelTest.unknown')}
            </AnswerButton>
            <AnswerButton
              tone="yes"
              shortcut="2"
              onClick={() => onAnswer({ kind: 'word', known: true })}
            >
              {t('levelTest.known')}
            </AnswerButton>
          </div>
        ) : (
          <div
            role="group"
            aria-label={t('levelTest.meaningGroup', { word: q.w })}
            className="flex flex-col gap-2"
          >
            {q.options.map((o, i) => (
              <button
                key={o}
                type="button"
                onClick={() => onAnswer({ kind: 'meaning', choice: i })}
                className="relative flex min-h-14 items-center gap-3 rounded-control border border-border bg-surface px-4 text-left text-base text-fg transition-[background-color,transform] duration-(--duration-micro) ease-standard hover:border-border-strong hover:bg-surface-hover motion-safe:active:scale-[0.98]"
              >
                <span aria-hidden="true" className="hidden md:pointer-fine:inline-flex">
                  <Kbd size="sm">{i + 1}</Kbd>
                </span>
                <span lang="tr">{o}</span>
              </button>
            ))}
            <Button
              variant="ghost"
              fullWidth
              onClick={() => onAnswer({ kind: 'meaning', choice: -1 })}
            >
              {t('levelTest.meaningUnsure')}
            </Button>
          </div>
        )}
        <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} className="-ml-3">
            <Icon name="undo" size={16} />
            {t('levelTest.undo')}
          </Button>
          <p className="hidden text-xs text-fg-subtle md:pointer-fine:block">
            {q.kind === 'word' ? t('levelTest.keysWord') : t('levelTest.keysMeaning')}
          </p>
        </div>
      </div>
    </>
  );
}

function AnswerButton({
  tone,
  shortcut,
  onClick,
  children,
}: {
  tone: 'yes' | 'no';
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex min-h-20 items-center justify-center rounded-card px-3 text-lg font-semibold select-none',
        'transition-[background-color,border-color,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.97]',
        tone === 'yes'
          ? 'bg-accent text-accent-fg hover:bg-accent-hover'
          : 'border border-border-strong/70 bg-surface text-fg hover:bg-surface-hover',
      )}
    >
      {children}
      <span aria-hidden="true" className="absolute right-2 bottom-2 hidden md:pointer-fine:flex">
        <Kbd
          size="sm"
          className={
            tone === 'yes' ? 'border-accent-fg/40 bg-transparent text-accent-fg' : undefined
          }
        >
          {shortcut}
        </Kbd>
      </span>
    </button>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-5">
      <h1 className="sr-only">{t('levelTest.title')}</h1>
      {children}
    </div>
  );
}
