// Dikte (v0.5 İP9, ADR 0051): a shared example sentence is read aloud while the screen shows it
// with the term left out; the user types the word they heard. "Tekrar dinle" and "Yavaş dinle"
// replay it. The result shows the letter diff, the whole sentence and the word's meaning, and
// suggests a button; any button can still be chosen. Its own FSRS card: the answer never
// changes the word's stage.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSettings } from '@/data';
import { type AnswerCheck, checkAnswer, suggestRating } from '@/domain/answerCheck';
import { posLabel } from '@/features/cards/labels';
import { LeechHint } from '@/features/leech';
import { cn, Icon } from '@/ui';
import { Ipa } from './CardFaces';
import type { KindProps } from './kinds';
import { AnswerInput, LetterDiff, VerdictLine } from './ProductionStudy';
import { playPronunciation, prefetchPronunciations, usePronunciationBusy } from './pronunciation';
import { RatingBar } from './RatingBar';
import { BackExtras, BackRegion, CardHeader, CardSurface, PrimarySpeak } from './StudyCards';
import { meaningOf, useModeLabel } from './study';

/** "Yavaş dinle": 70 % speed. */
export const SLOW_RATE = 0.7;

/** The page may start audio by itself only after the user touched it (autoplay rules). */
function mayAutoplay(): boolean {
  const ua = (globalThis.navigator as { userActivation?: { hasBeenActive?: boolean } } | undefined)
    ?.userActivation;
  return ua?.hasBeenActive === true;
}

function ListenButton({
  label,
  onPress,
  slow,
  primary,
}: {
  label: string;
  onPress: () => void;
  slow?: boolean;
  primary?: boolean;
}) {
  const { busy, run } = usePronunciationBusy();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        run(onPress);
      }}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[14px] px-3 text-[0.9375rem] font-semibold transition-colors',
        primary
          ? 'bg-accent-soft text-accent-text hover:bg-accent-soft'
          : 'border border-border bg-surface-raised text-fg hover:bg-surface-hover',
        busy && 'animate-pulse',
      )}
    >
      {slow ? (
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 15c0-3.5 3-6 6.5-6S17 11.5 17 15" />
          <path d="M3 15h16.5a1.5 1.5 0 0 0 0-3H18" />
          <circle cx="8" cy="18" r="1" />
          <circle cx="14" cy="18" r="1" />
        </svg>
      ) : (
        <Icon name="speaker" size={20} />
      )}
      {label}
    </button>
  );
}

export function DictationStudy({ view, speech, revealed, onReveal, onAnswer, ratingRef, frame }: KindProps) {
  const { t } = useTranslation();
  const label = useModeLabel(view, true);
  const voice = useLiveQuery(async () => (await getSettings()).voice, []) ?? 'en-US';
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const autoplayed = useRef(false);
  const cloze = view.cloze!;
  const sentence = view.sentence!;
  const { note } = view;

  const play = (slow = false) => {
    playPronunciation(sentence.text, voice, slow ? { rate: SLOW_RATE } : {});
  };

  // Fetch the sentence's audio now; read it once by itself when the page may play sound.
  useEffect(() => {
    prefetchPronunciations([sentence.text], voice);
  }, [sentence.text, voice]);
  useEffect(() => {
    if (revealed || autoplayed.current || !mayAutoplay()) return;
    autoplayed.current = true;
    playPronunciation(sentence.text, voice);
  }, [revealed, sentence.text, voice]);

  const submit = (answer: string) => {
    const a = checkAnswer(answer, cloze.answer);
    const b = checkAnswer(answer, note.term);
    // The base form ("reopen" where the sentence says "reopened") is almost right. No synonyms
    // here: the user heard one particular word.
    setCheck(a.verdict !== 'correct' && b.verdict === 'correct' ? { ...a, verdict: 'close' } : a);
    onReveal(false);
  };

  const listenRow = (
    <div className="flex gap-2.5">
      <ListenButton primary label={t('modes.dictation.replay')} onPress={() => play(false)} />
      <ListenButton slow label={t('modes.dictation.slow')} onPress={() => play(true)} />
    </div>
  );

  if (!revealed) {
    return frame(
      <CardSurface className="min-h-full flex-1 gap-4" testId="study-front">
        <CardHeader view={view} label={label} />
        <div className="flex flex-1 flex-col justify-center gap-4">
          <p className="text-[0.9375rem] text-fg-muted">{t('modes.dictation.prompt')}</p>
          <p
            lang="en"
            data-testid="dictation-sentence"
            className="font-serif text-2xl leading-normal text-fg italic sm:text-[1.5625rem]"
          >
            {cloze.before}
            <span
              className="mx-0.5 inline-block translate-y-[0.15em] border-b-2 border-dashed border-accent-text align-baseline"
              style={{ width: `${Math.max(3, Math.min(14, [...cloze.answer].length)) * 0.62}em` }}
            >
              <span className="sr-only">{t('study.blank')}</span>
            </span>
            {cloze.after}
          </p>
          {listenRow}
          <LeechHint view={view} />
        </div>
        <div className="-mx-2 flex items-center justify-end">
          <button
            type="button"
            onClick={() => submit('')}
            className="flex min-h-11 items-center rounded-control px-2 text-sm text-fg-muted hover:text-fg"
          >
            {t('study.dontKnow')}
          </button>
        </div>
      </CardSurface>,
      <AnswerInput
        value={typed}
        onChange={setTyped}
        onSubmit={() => submit(typed)}
        placeholder={t('modes.dictation.typeAnswer')}
        autoFocus
      />,
    );
  }

  const result = check ?? checkAnswer('', cloze.answer);
  const suggested = suggestRating(result.verdict, false);
  return frame(
    <BackRegion>
      <CardSurface className="gap-3.5" testId="study-back">
        <CardHeader view={view} label={label} />
        <VerdictLine check={result} />
        <p lang="en" className="font-serif text-[1.375rem] leading-snug text-fg italic">
          {cloze.before}
          <mark
            className={cn(
              'rounded-[4px] px-1 font-semibold not-italic',
              result.verdict === 'correct' ? 'bg-success-soft text-success-text' : 'bg-accent-soft text-fg',
            )}
          >
            {cloze.answer}
          </mark>
          {cloze.after}
        </p>
        {sentence.tr && (
          <p lang="tr" className="-mt-1 text-[0.9375rem] text-fg-muted">
            {sentence.tr}
          </p>
        )}
        {listenRow}
        {result.verdict !== 'correct' && <LetterDiff check={result} />}
        <div className="h-px bg-surface-sunken" />
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span lang="en" className="font-serif text-[1.375rem] font-semibold text-fg">
                {note.term}
              </span>
              {view.sense?.pos && (
                <span className="text-[0.8125rem] text-fg-muted italic">{posLabel(t, view.sense.pos)}</span>
              )}
            </span>
            {view.sense && <span className="text-[0.9375rem] text-fg">{meaningOf(view.sense)}</span>}
            <Ipa ipa={note.ipa} />
          </div>
          {note.term_type !== 'affix' && <PrimarySpeak speech={speech} />}
        </div>
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </BackRegion>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} />,
    t('study.scrollCard'),
  );
}
