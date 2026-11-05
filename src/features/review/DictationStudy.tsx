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
import { LeechHint } from '@/features/leech';
import { Button, cn, Eyebrow, Term } from '@/ui';
import { Ipa } from './CardFaces';
import type { KindProps } from './kinds';
import { AnswerInput, CardTextButton, LetterDiff, VerdictLine } from './ProductionStudy';
import { playPronunciation, prefetchPronunciations, usePronunciationBusy } from './pronunciation';
import { RatingBar } from './RatingBar';
import { BackExtras, BackRegion, CardHeader, CardSurface, PosBadge } from './StudyCards';
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
    <Button
      variant={primary ? 'tonal' : 'secondary'}
      leadingIcon={slow ? 'slow' : 'speaker'}
      onClick={(e) => {
        e.stopPropagation();
        run(onPress);
      }}
      aria-busy={busy || undefined}
      className={cn('flex-1', busy && 'animate-pulse')}
    >
      {label}
    </Button>
  );
}

export function DictationStudy({ view, speech, revealed, onReveal, onAnswer, ratingRef, frame, slow }: KindProps) {
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
    onReveal(false, 'typed');
  };

  const listenRow = (
    <div className="flex gap-2">
      <ListenButton primary label={t('modes.dictation.replay')} onPress={() => play(false)} />
      <ListenButton slow label={t('modes.dictation.slow')} onPress={() => play(true)} />
    </div>
  );

  if (!revealed) {
    return frame(
      <CardSurface className="min-h-full flex-1" testId="study-front">
        <CardHeader view={view} speak={false} />
        <div className="flex flex-1 flex-col justify-center gap-5 py-6">
          <Eyebrow>{label}</Eyebrow>
          <p className="text-ui text-fg-muted">{t('modes.dictation.prompt')}</p>
          <p
            lang="en"
            data-testid="dictation-sentence"
            className="font-serif text-title font-normal text-fg italic"
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
          <CardTextButton tone="muted" onClick={() => submit('')}>
            {t('study.dontKnow')}
          </CardTextButton>
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
  const suggested = suggestRating(result.verdict, false, { slow });
  return frame(
    <BackRegion>
      <CardSurface className="min-h-full flex-1" testId="study-back">
        <CardHeader view={view} speech={speech} />
        <div className="flex flex-1 flex-col justify-center gap-4 pt-4">
          <VerdictLine check={result} />
          <p lang="en" className="font-serif text-title font-normal text-fg italic">
            {cloze.before}
            <mark
              className={cn(
                'rounded-xs px-1 font-semibold not-italic',
                result.verdict === 'correct'
                  ? 'bg-success-soft text-success-text'
                  : 'bg-accent-soft text-fg',
              )}
            >
              {cloze.answer}
            </mark>
            {cloze.after}
          </p>
          {sentence.tr && (
            <p lang="tr" className="-mt-2 text-ui text-fg-muted">
              {sentence.tr}
            </p>
          )}
          {listenRow}
          {result.verdict !== 'correct' && <LetterDiff check={result} />}
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-2">
              <Term size="title" className="text-fg">
                {note.term}
              </Term>
              <PosBadge view={view} />
            </span>
            {view.sense && (
              <span className="text-lead font-medium text-fg">{meaningOf(view.sense)}</span>
            )}
            <Ipa ipa={note.ipa} />
          </div>
        </div>
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </BackRegion>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} />,
    t('study.scrollCard'),
  );
}
