// /metin-olustur — "Kelimelerimle metin oluştur" (v0.5.1, decision 0056; the owner's own idea).
//
//   1  Kelimeleri seç   three suggestion lists (due, hard, newest) and a search; 3–8 words
//   2  Metni ayarla     form (hikâye, diyalog, haber, e-posta), length, difficulty, topics
//   3  Oluştur          ai-story writes it (~10 s); it opens in the reader with the words marked
//                       and three questions at the end
//
// Guests can pick (it is their own words, on this device) and are told that writing the text
// needs an account. The pick is kept in sessionStorage, so signing in does not lose it.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { logError } from '@/data';
import {
  createPickedStory,
  loadPicker,
  pickedTextsToday,
  type PickerData,
} from '@/data/pickedStory';
import {
  MAX_PICKS,
  MIN_PICKS,
  searchPickable,
  validPick,
  type PickWord,
  type StoryGenre,
  type StoryLength,
} from '@/domain/pickedStory';
import { READING_DIFFICULTIES, readerPath, type ReadingDifficulty } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { openAddSheet } from '@/features/add/addSheetStore';
import { SignInNeeded } from '@/features/add/SignInNeeded';
import { useAuth } from '@/features/auth/session';
import { storyError, type StoryError } from '@/features/story/storyError';
import {
  Button,
  EmptyState,
  Icon,
  Page,
  SegmentedControl,
  Skeleton,
  Spinner,
  TextField,
  buttonClasses,
  cn,
} from '@/ui';

const GENRES: readonly StoryGenre[] = ['story', 'dialogue', 'news', 'email'];
const LENGTHS: readonly StoryLength[] = ['short', 'medium'];
/** The server's default daily limit for picked texts (DEFAULT_PICKED_DAILY_LIMIT). */
const DAILY = 5;
const DRAFT_KEY = 'engapp.compose.draft';

interface Draft {
  picks: PickWord[];
  genre: StoryGenre;
  length: StoryLength;
  difficulty: ReadingDifficulty | null;
  topics: string[] | null;
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (!Array.isArray(d.picks)) return null;
    return {
      picks: d.picks.slice(0, MAX_PICKS),
      genre: GENRES.includes(d.genre as StoryGenre) ? (d.genre as StoryGenre) : 'story',
      length: LENGTHS.includes(d.length as StoryLength) ? (d.length as StoryLength) : 'short',
      difficulty: READING_DIFFICULTIES.includes(d.difficulty as ReadingDifficulty)
        ? (d.difficulty as ReadingDifficulty)
        : null,
      topics: Array.isArray(d.topics) ? d.topics.filter((x) => typeof x === 'string') : null,
    };
  } catch {
    return null;
  }
}

function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode: the pick simply is not kept.
  }
}

type Run = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: StoryError };

export function ComposePage() {
  const { t } = useTranslation();
  const data = useLiveQuery(() => loadPicker(), []);
  const [initial] = useState(readDraft);
  const [step, setStep] = useState<1 | 2>(initial && validPick(initial.picks.length) ? 2 : 1);
  const [picks, setPicks] = useState<PickWord[]>(initial?.picks ?? []);
  const [genre, setGenre] = useState<StoryGenre>(initial?.genre ?? 'story');
  const [length, setLength] = useState<StoryLength>(initial?.length ?? 'short');
  const [difficulty, setDifficulty] = useState<ReadingDifficulty | null>(
    initial?.difficulty ?? null,
  );
  const [topics, setTopics] = useState<string[] | null>(initial?.topics ?? null);

  useEffect(() => {
    writeDraft(picks.length ? { picks, genre, length, difficulty, topics } : null);
  }, [picks, genre, length, difficulty, topics]);

  const headingRef = useRef<HTMLDivElement>(null);
  const go = (s: 1 | 2) => {
    setStep(s);
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  };

  if (data === undefined)
    return (
      <Page title={t('compose.title')} description={t('compose.lead')}>
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </Page>
    );

  if (data.words.length < MIN_PICKS)
    return (
      <Page title={t('compose.title')} description={t('compose.lead')}>
        <EmptyState
          icon="cards"
          title={t('compose.fewTitle')}
          description={t('compose.fewBody', { count: MIN_PICKS })}
          action={
            <Button onClick={() => openAddSheet('word')} leadingIcon="plus">
              {t('compose.fewCta')}
            </Button>
          }
        />
      </Page>
    );

  const toggle = (w: PickWord) =>
    setPicks((list) =>
      list.some((p) => p.note_id === w.note_id)
        ? list.filter((p) => p.note_id !== w.note_id)
        : list.length >= MAX_PICKS
          ? list
          : [...list, w],
    );

  return (
    <Page title={t('compose.title')} description={t('compose.lead')}>
      <div ref={headingRef} className="scroll-mt-20">
        <Steps step={step} />
      </div>
      {step === 1 ? (
        <PickStep data={data} picks={picks} onToggle={toggle} onNext={() => go(2)} />
      ) : (
        <OptionsStep
          data={data}
          picks={picks}
          onToggle={toggle}
          genre={genre}
          setGenre={setGenre}
          length={length}
          setLength={setLength}
          difficulty={difficulty ?? data.difficulty}
          setDifficulty={setDifficulty}
          topics={topics ?? data.interests}
          setTopics={setTopics}
          onBack={() => go(1)}
          onDone={() => writeDraft(null)}
        />
      )}
    </Page>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  const { t } = useTranslation();
  const items = [t('compose.step1'), t('compose.step2'), t('compose.step3')];
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm" aria-label={t('compose.steps')}>
      {items.map((label, i) => {
        const n = i + 1;
        const current = n === step;
        const done = n < step;
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5',
              current ? 'font-semibold text-fg' : 'text-fg-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
                current
                  ? 'bg-accent text-accent-fg'
                  : done
                    ? 'bg-success-soft text-success-text'
                    : 'bg-surface-sunken text-fg-muted',
              )}
            >
              {done ? <Icon name="check" size={13} strokeWidth={3} /> : n}
            </span>
            <span className="truncate">{label}</span>
            {n < items.length && (
              <span aria-hidden="true" className="mx-0.5 h-px w-3 shrink-0 bg-border-strong/50" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WordChip({
  word,
  on,
  full,
  onToggle,
}: {
  word: PickWord;
  on: boolean;
  full: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!on && full}
      onClick={onToggle}
      data-testid="compose-word"
      className={cn(
        'flex max-w-full min-h-11 items-center gap-2 rounded-[14px] border px-3 py-1.5 text-left',
        'transition-colors duration-(--duration-micro) disabled:opacity-50',
        on
          ? 'border-accent bg-accent-soft text-fg'
          : 'border-border bg-surface text-fg hover:border-border-strong',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4.5 shrink-0 items-center justify-center rounded-full border',
          on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong',
        )}
      >
        {on && <Icon name="check" size={11} strokeWidth={3} />}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span lang="en" className="truncate font-serif text-[1.0625rem] font-semibold">
          {word.term}
        </span>
        {word.meaning && (
          <span className="truncate text-[0.8125rem] text-fg-muted">{word.meaning}</span>
        )}
      </span>
    </button>
  );
}

function WordList({
  title,
  words,
  picks,
  onToggle,
  testId,
}: {
  title: string;
  words: PickWord[];
  picks: PickWord[];
  onToggle: (w: PickWord) => void;
  testId: string;
}) {
  const id = `${testId}-title`;
  if (!words.length) return null;
  const full = picks.length >= MAX_PICKS;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5" data-testid={testId}>
      <h2 id={id} className="text-sm font-semibold text-fg-muted">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {words.map((w) => (
          <li key={w.note_id} className="max-w-full">
            <WordChip
              word={w}
              on={picks.some((p) => p.note_id === w.note_id)}
              full={full}
              onToggle={() => onToggle(w)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PickedTray({
  picks,
  onToggle,
  children,
}: {
  picks: PickWord[];
  onToggle: (w: PickWord) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 mt-8 flex flex-col gap-3 border-t border-border bg-canvas px-4 pt-3 pb-3 sm:-mx-6 sm:px-6 md:bottom-0"
      data-testid="compose-tray"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted" aria-live="polite">
          {t('compose.picked', { count: picks.length, max: MAX_PICKS })}
          {picks.length < MIN_PICKS &&
            ` · ${t('compose.pickMore', { count: MIN_PICKS - picks.length })}`}
        </p>
      </div>
      {picks.length > 0 && (
        <ul className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label={t('compose.pickedList')}>
          {picks.map((p) => (
            <li key={p.note_id} className="shrink-0">
              <button
                type="button"
                onClick={() => onToggle(p)}
                aria-label={t('compose.remove', { term: p.term })}
                className="flex h-8 items-center gap-1 rounded-full bg-accent-soft px-3 text-sm font-medium text-accent-text"
              >
                <span lang="en">{p.term}</span>
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

function PickStep({
  data,
  picks,
  onToggle,
  onNext,
}: {
  data: PickerData;
  picks: PickWord[];
  onToggle: (w: PickWord) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const found = useMemo(() => searchPickable(data.words, query), [data.words, query]);
  const { due, hard, recent } = data.suggestions;
  const full = picks.length >= MAX_PICKS;
  return (
    <>
      <div className="flex flex-col gap-6">
        <TextField
          label={t('compose.search')}
          hideLabel
          placeholder={t('compose.searchPlaceholder')}
          leadingIcon="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-testid="compose-search"
        />
        {query.trim() ? (
          found.length ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('compose.searchResults')}>
              {found.map((w) => (
                <li key={w.note_id} className="max-w-full">
                  <WordChip
                    word={w}
                    on={picks.some((p) => p.note_id === w.note_id)}
                    full={full}
                    onToggle={() => onToggle(w)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t('compose.noMatch')}</p>
          )
        ) : (
          <>
            <WordList
              title={t('compose.listDue')}
              words={due}
              picks={picks}
              onToggle={onToggle}
              testId="compose-due"
            />
            <WordList
              title={t('compose.listHard')}
              words={hard}
              picks={picks}
              onToggle={onToggle}
              testId="compose-hard"
            />
            <WordList
              title={t('compose.listRecent')}
              words={recent}
              picks={picks}
              onToggle={onToggle}
              testId="compose-recent"
            />
          </>
        )}
      </div>
      <PickedTray picks={picks} onToggle={onToggle}>
        <Button
          size="lg"
          fullWidth
          trailingIcon="arrow-right"
          disabled={!validPick(picks.length)}
          onClick={onNext}
          data-testid="compose-next"
        >
          {t('compose.next')}
        </Button>
      </PickedTray>
    </>
  );
}

function OptionsStep({
  data,
  picks,
  onToggle,
  genre,
  setGenre,
  length,
  setLength,
  difficulty,
  setDifficulty,
  topics,
  setTopics,
  onBack,
  onDone,
}: {
  data: PickerData;
  picks: PickWord[];
  onToggle: (w: PickWord) => void;
  genre: StoryGenre;
  setGenre: (g: StoryGenre) => void;
  length: StoryLength;
  setLength: (l: StoryLength) => void;
  difficulty: ReadingDifficulty;
  setDifficulty: (d: ReadingDifficulty) => void;
  topics: string[];
  setTopics: (t: string[]) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const today = useLiveQuery(() => pickedTextsToday(), []) ?? 0;
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const make = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setRun({ status: 'error', error: 'offline' });
      return;
    }
    setRun({ status: 'loading' });
    try {
      const id: Id = await createPickedStory({
        picks,
        genre,
        length,
        difficulty,
        interests: topics,
      });
      onDone();
      if (live.current) void navigate(readerPath(id));
    } catch (e) {
      const error = storyError(e);
      if (error === 'generic') void logError(e, 'compose.create');
      if (live.current) setRun({ status: 'error', error });
    }
  };

  if (run.status === 'loading')
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-4 py-12 text-center"
        data-testid="compose-loading"
      >
        <Spinner size={24} />
        <p className="font-serif text-xl font-semibold text-fg">{t('compose.writing')}</p>
        <p className="max-w-xs text-sm text-fg-muted">{t('compose.writingHint')}</p>
      </div>
    );

  const toggleTopic = (k: string) =>
    setTopics(topics.includes(k) ? topics.filter((x) => x !== k) : [...topics, k].slice(0, 3));

  return (
    <>
      <div className="flex flex-col gap-6">
        <SegmentedControl
          legend={t('compose.genre')}
          options={GENRES.map((g) => ({ value: g, label: t(`compose.genres.${g}`) }))}
          value={genre}
          onValueChange={setGenre}
        />
        <SegmentedControl
          legend={t('compose.length')}
          options={LENGTHS.map((l) => ({ value: l, label: t(`compose.lengths.${l}`) }))}
          value={length}
          onValueChange={setLength}
        />
        <SegmentedControl
          legend={t('compose.difficulty')}
          options={READING_DIFFICULTIES.map((d) => ({
            value: d,
            label: t(`reader.difficulty.${d}`),
          }))}
          value={difficulty}
          onValueChange={setDifficulty}
        />
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm font-medium text-fg">{t('compose.topic')}</legend>
          {data.interests.length ? (
            <>
              <ul className="flex flex-wrap gap-2">
                {data.interests.map((k) => {
                  const on = topics.includes(k);
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleTopic(k)}
                        className={cn(
                          'flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
                          on
                            ? 'border-accent bg-accent-soft text-accent-text'
                            : 'border-border bg-surface text-fg-muted',
                        )}
                      >
                        {on && <Icon name="check" size={14} strokeWidth={2.5} />}
                        {t(`topics.${k}`, { defaultValue: k })}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-fg-muted">
                {topics.length ? t('compose.topicHint') : t('compose.topicNone')}
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              {t('compose.noInterests')}{' '}
              <Link
                to="/settings/ilgi-alanlari"
                className="font-medium text-accent-text underline-offset-4 hover:underline"
              >
                {t('compose.setInterests')}
              </Link>
            </p>
          )}
        </fieldset>
      </div>

      <PickedTray picks={picks} onToggle={onToggle}>
        {run.status === 'error' && (
          <p role="alert" className="text-sm text-danger-text" data-testid="compose-error">
            {t(`compose.errors.${run.error}`, { count: DAILY })}
          </p>
        )}
        {auth.status === 'signed_in' ? (
          <>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" onClick={onBack} leadingIcon="arrow-left">
                {t('compose.back')}
              </Button>
              <Button
                size="lg"
                className="flex-1"
                leadingIcon="pencil"
                disabled={!validPick(picks.length)}
                onClick={() => void make()}
                data-testid="compose-make"
              >
                {run.status === 'error' ? t('compose.retry') : t('compose.make')}
              </Button>
            </div>
            <p className="text-center text-xs text-fg-muted">
              {t('compose.limit', { count: DAILY, used: Math.min(today, DAILY) })}
            </p>
          </>
        ) : auth.status === 'guest' ? (
          <>
            <SignInNeeded
              title={t('compose.signInTitle')}
              body={t('compose.signInBody')}
              testId="compose-signin"
            />
            <button
              type="button"
              onClick={onBack}
              className={buttonClasses({ variant: 'ghost', className: 'self-start' })}
            >
              {t('compose.back')}
            </button>
          </>
        ) : auth.status === 'unavailable' ? (
          <p className="text-sm text-fg-muted">{t('compose.unavailable')}</p>
        ) : null}
      </PickedTray>
    </>
  );
}
