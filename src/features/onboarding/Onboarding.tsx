// First-run onboarding (v0.5.1, ADR 0058): one guided path instead of two equal buttons.
// Welcome → a short level test (skippable) → interests → a ready deck → the first session.
// Adding words by hand stays as a quiet secondary link on every step. Shown on Bugün in place of
// the empty-state welcome, only to a brand-new user (domain/onboarding.ts).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, logError, setMeta } from '@/data';
import { STAGE_RULE_NOTICE_KEY } from '@/data/db';
import { useAuth } from '@/features/auth/session';
import { addSuggestedDeck } from '@/data/deckHub';
import { nextOnboardingStep, ONBOARDING_STEPS, type OnboardingStep } from '@/domain/onboarding';
import { deckWords, suggestedKey, type SuggestedSpec } from '@/domain/suggestedDecks';
import type { TopicKey } from '@/domain/topics';
import { openAddSheet } from '@/features/add/addSheetStore';
import { specTitle, useBankData, useWordBankDownload } from '@/features/decks/suggested';
import { OFFER_DISMISSED_KEY } from '@/features/leveltest/levelText';
import { saveFirstInterests, skipInterests } from '@/features/profile/actions';
import { TopicChips } from '@/features/profile/TopicChips';
import { formatNumber } from '@/features/stats/format';
import { Badge, Button, cn, Logo, ProgressBar, Skeleton, toast } from '@/ui';
import { finishOnboarding, setOnboardingStep } from './state';

/** Where the first session starts: today's word study. */
export const FIRST_SESSION_HREF = '/study?mode=word';

export function Onboarding({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();
  useEffect(() => {
    // A new user learns the counting rule as it is: the "rule changed" note is not for them.
    void setMeta(STAGE_RULE_NOTICE_KEY, true).catch(
      (e: unknown) => void logError(e, 'onboarding.ruleNote'),
    );
  }, []);
  const index = ONBOARDING_STEPS.indexOf(step);
  const go = (s: OnboardingStep) => setOnboardingStep(s);
  const next = () => {
    const n = nextOnboardingStep(step);
    if (n) go(n);
  };
  return (
    <div className="mx-auto flex w-full max-w-(--page-reading) flex-col gap-6 px-4 pt-6 pb-10 sm:px-6 md:pt-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Logo size={index === 0 ? 48 : 32} wordmark={false} />
          <h1
            className={cn(
              'min-w-0 flex-1 font-semibold text-fg',
              index === 0 ? 'text-title' : 'text-ui text-fg-muted',
            )}
          >
            {t('onboarding.title')}
          </h1>
          {index > 0 && (
            <span className="tabular text-meta text-fg-muted" data-testid="onboarding-step">
              {t('onboarding.stepOf', { n: index, total: ONBOARDING_STEPS.length - 1 })}
            </span>
          )}
        </div>
        {index > 0 && (
          <ProgressBar
            value={index}
            max={ONBOARDING_STEPS.length - 1}
            label={t('onboarding.progressLabel')}
          />
        )}
      </header>
      {step === 'welcome' && <Welcome onStart={next} />}
      {step === 'level' && <LevelStep onSkip={next} />}
      {step === 'interests' && <InterestsStep onDone={next} />}
      {step === 'deck' && <DeckStep />}
    </div>
  );
}

function ManualLink() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => {
        finishOnboarding();
        openAddSheet();
      }}
      aria-haspopup="dialog"
      className="mx-auto inline-flex min-h-11 items-center rounded-control px-3 text-meta text-fg-muted underline decoration-1 underline-offset-2 hover:bg-hover hover:text-fg"
    >
      {t('onboarding.manual')}
    </button>
  );
}

function StepCard({
  title,
  body,
  children,
  testId,
}: {
  title: string;
  body: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="flex flex-col gap-6"
      data-testid={testId}
    >
      <div className="flex flex-col gap-2">
        <h2 id={`${testId}-title`} className="text-page font-semibold text-fg">
          {title}
        </h2>
        <p className="text-lead text-fg-muted">{body}</p>
      </div>
      {children}
    </section>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const steps = [
    t('onboarding.welcome.step1'),
    t('onboarding.welcome.step2'),
    t('onboarding.welcome.step3'),
    t('onboarding.welcome.step4'),
  ];
  return (
    <>
      <StepCard
        testId="onboarding-welcome"
        title={t('onboarding.welcome.title')}
        body={t('onboarding.welcome.body')}
      >
        <ol className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
          {steps.map((s, i) => (
            <li key={s} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-meta font-semibold text-accent-text"
              >
                {i + 1}
              </span>
              <p className="text-ui text-fg">{s}</p>
            </li>
          ))}
        </ol>
        <Button size="lg" fullWidth onClick={onStart}>
          {t('onboarding.welcome.start')}
        </Button>
        <HaveAccount />
      </StepCard>
      <ManualLink />
    </>
  );
}

/**
 * "Zaten hesabım var · Giriş yap" (v0.5.2, B3): an existing user on a new phone signs in
 * instead of building a guest deck that would then have to be merged. The onboarding is not
 * finished here: once the account's words and interests arrive, it is no longer needed.
 */
function HaveAccount() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  if (!auth.available || auth.status === 'signed_in') return null;
  const signIn = async () => {
    setBusy(true);
    try {
      await auth.signIn();
    } catch (e) {
      void logError(e, 'onboarding.signIn');
      toast({ title: t('onboarding.welcome.signInFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-1 text-meta text-fg-muted">
      {t('onboarding.welcome.haveAccount')}
      <Button variant="ghost" size="sm" loading={busy} onClick={() => void signIn()} data-testid="onboarding-signin">
        {t('onboarding.welcome.signIn')}
      </Button>
    </p>
  );
}

function LevelStep({ onSkip }: { onSkip: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <StepCard
        testId="onboarding-level"
        title={t('onboarding.level.title')}
        body={t('onboarding.level.body')}
      >
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              // The test's "Devam" returns to Bugün: the flow goes on with interests.
              setOnboardingStep('interests');
              void navigate('/level-test');
            }}
          >
            {t('onboarding.level.start')}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              void setMeta(OFFER_DISMISSED_KEY, true).catch(
                (e: unknown) => void logError(e, 'onboarding.levelSkip'),
              );
              onSkip();
            }}
          >
            {t('onboarding.level.skip')}
          </Button>
        </div>
      </StepCard>
      <ManualLink />
    </>
  );
}

function InterestsStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<ReadonlySet<TopicKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const save = async (skip: boolean) => {
    setBusy(true);
    const ok = skip ? await skipInterests() : await saveFirstInterests([...picked]);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <>
      <StepCard
        testId="onboarding-interests"
        title={t('onboarding.interests.title')}
        body={t('onboarding.interests.body')}
      >
        <TopicChips
          labelledBy="onboarding-interests-title"
          compact
          selected={picked}
          onToggle={(topic, on) =>
            setPicked((s) => {
              const n = new Set(s);
              if (on) n.add(topic);
              else n.delete(topic);
              return n;
            })
          }
        />
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth disabled={busy} onClick={() => void save(false)}>
            {picked.size
              ? t('onboarding.interests.save', { count: picked.size })
              : t('onboarding.interests.continue')}
          </Button>
          {picked.size === 0 && (
            <Button variant="ghost" fullWidth disabled={busy} onClick={() => void save(true)}>
              {t('onboarding.interests.skip')}
            </Button>
          )}
        </div>
      </StepCard>
      <ManualLink />
    </>
  );
}

function DeckStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { download, retry } = useWordBankDownload();
  const data = useBankData();
  // B10: a level that was never measured is not "your level".
  const measured = useLiveQuery(async () => (await getSettings()).level_source !== 'default', []);
  const specs = useMemo<SuggestedSpec[]>(
    () => [
      { kind: 'top', size: 500 },
      { kind: 'top', size: 100 },
      { kind: 'levelPos', level: data?.level ?? 'B1', pos: 'verb' },
    ],
    [data?.level],
  );
  const decks = useMemo(
    () =>
      data
        ? specs
            .map((spec) => ({ spec, words: deckWords(data.entries, spec) }))
            .filter((d) => d.words.length > 0)
        : [],
    [data, specs],
  );
  const [chosen, setChosen] = useState<string>(suggestedKey({ kind: 'top', size: 500 }));
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);

  const start = async () => {
    const deck = decks.find((d) => suggestedKey(d.spec) === chosen) ?? decks[0];
    if (!deck || adding) return;
    setAdding({ done: 0, total: deck.words.length });
    try {
      await addSuggestedDeck(deck.words, specTitle(t, deck.spec), {
        onProgress: (done, total) => setAdding({ done, total }),
      });
      finishOnboarding();
      void navigate(FIRST_SESSION_HREF);
    } catch (e) {
      void logError(e, 'onboarding.deck');
      toast({ title: t('deckHub.suggested.addFailed'), tone: 'danger' });
      setAdding(null);
    }
  };

  let body: ReactNode;
  if (!data || (data.entries.length === 0 && download === 'running')) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">{t('onboarding.deck.loading')}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  } else if (decks.length === 0) {
    body = (
      <div className="flex flex-col gap-3" data-testid="onboarding-deck-offline">
        <p className="text-ui text-fg">{t('onboarding.deck.offline')}</p>
        <Button variant="secondary" onClick={retry}>
          {t('onboarding.deck.retry')}
        </Button>
        {/* Offline, a new user is not stuck here: the app (the library, adding by hand) works. */}
        <Button variant="ghost" onClick={finishOnboarding} data-testid="onboarding-skip-offline">
          {t('onboarding.deck.skipOffline')}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="sr-only">{t('onboarding.deck.title')}</legend>
          {decks.map(({ spec, words }, i) => {
            const key = suggestedKey(spec);
            const on = key === chosen;
            return (
              <label
                key={key}
                className={cn(
                  'flex min-h-16 cursor-pointer items-center gap-3 rounded-card border px-4 py-3 transition-colors duration-(--duration-micro) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  on
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface hover:bg-surface-hover',
                )}
              >
                <input
                  type="radio"
                  name="onboarding-deck"
                  value={key}
                  checked={on}
                  disabled={adding !== null}
                  onChange={() => setChosen(key)}
                  className="size-5 shrink-0 accent-(--color-accent)"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-ui font-semibold text-fg">
                    {specTitle(t, spec)}
                  </span>
                  <span className="text-meta text-fg-muted">
                    {t(
                      `onboarding.deck.hint.${i === 0 ? 'top500' : i === 1 ? 'top100' : measured ? 'verbs' : 'verbsLevel'}`,
                      {
                        count: words.length,
                        value: formatNumber(words.length),
                        level: spec.kind === 'levelPos' ? spec.level : '',
                      },
                    )}
                  </span>
                </span>
                {i === 0 && (
                  <Badge tone={on ? 'outline' : 'accent'} className="shrink-0">
                    {t('onboarding.deck.recommended')}
                  </Badge>
                )}
              </label>
            );
          })}
        </fieldset>
        <p className="text-meta text-fg-muted">{t('onboarding.deck.pace')}</p>
        <Button size="lg" fullWidth loading={adding !== null} onClick={() => void start()}>
          {adding
            ? t('onboarding.deck.adding', {
                done: formatNumber(adding.done),
                total: formatNumber(adding.total),
              })
            : t('onboarding.deck.start')}
        </Button>
      </>
    );
  }

  return (
    <>
      <StepCard
        testId="onboarding-deck"
        title={t('onboarding.deck.title')}
        body={t('onboarding.deck.body')}
      >
        {body}
      </StepCard>
      <ManualLink />
    </>
  );
}
