// Boşluk doldurma (redesign boards ClozeCard / ClozeResult): a sentence with a blank and four
// choices from the user's own words, or a typed answer. Hints: the first letter and the
// sentence's Turkish. The result marks the right choice and the user's pick, shows the word
// with its meaning and pronunciation, and suggests a button.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AnswerCheck, checkAnswer, suggestRating } from '@/domain/answerCheck';
import { type ClozeChoice, pickClozeChoices } from '@/domain/clozeChoices';
import { firstLetterHint } from '@/domain/recognition';
import { posLabel } from '@/features/cards/labels';
import { LeechHint } from '@/features/leech';
import { cn, Icon } from '@/ui';
import { Ipa, SpeakButton } from './CardFaces';
import type { KindProps } from './kinds';
import { AnswerInput, LetterDiff, VerdictLine } from './ProductionStudy';
import { RatingBar } from './RatingBar';
import { BackExtras, BulbIcon, CardHeader, CardSurface, PrimarySpeak } from './StudyCards';
import { loadChoiceCandidates, meaningOf, useModeLabel } from './study';

/** undefined while loading; null when the collection is too small for choices. */
function useChoices(kp: KindProps): ClozeChoice[] | null | undefined {
  const { view } = kp;
  const [choices, setChoices] = useState<ClozeChoice[] | null | undefined>(undefined);
  const answer = view.cloze?.answer ?? view.note.term;
  const pos = view.sense?.pos ?? null;
  const meaning = view.sense ? meaningOf(view.sense) : null;
  const seed = `${view.card.id}:${view.card.reps}`;
  useEffect(() => {
    let live = true;
    void loadChoiceCandidates().then((pool) => {
      if (!live) return;
      // The pool holds the note's own term too; pickClozeChoices drops it by spelling.
      const others = pool.filter((c) => c.term.toLowerCase() !== view.note.term.toLowerCase());
      setChoices(pickClozeChoices({ term: answer, pos, meaning }, others, seed));
    });
    return () => {
      live = false;
    };
  }, [answer, pos, meaning, seed, view.note.term]);
  return choices;
}

interface Result {
  check: AnswerCheck;
  /** Index of the picked choice (choice mode). */
  picked: number | null;
}

export function ClozeStudy(kp: KindProps) {
  const { view, speech, revealed, onReveal, onAnswer, ratingRef, frame } = kp;
  const { t } = useTranslation();
  const label = useModeLabel(view, false);
  const choices = useChoices(kp);
  const [picked, setPicked] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [trShown, setTrShown] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const cloze = view.cloze!;
  const sentence = view.sentence;
  const typingMode = typing || choices === null;

  const checkTyped = (answer: string): AnswerCheck => {
    const a = checkAnswer(answer, cloze.answer);
    const b = checkAnswer(answer, view.note.term);
    // The base form ("reopen" where the sentence has "reopened") is almost right.
    return a.verdict !== 'correct' && b.verdict === 'correct' ? { ...a, verdict: 'close' } : a;
  };

  const submit = () => {
    if (typingMode) {
      if (!typed.trim()) return;
      setResult({ check: checkTyped(typed), picked: null });
    } else {
      if (picked === null || !choices) return;
      const right = choices[picked]!.correct;
      setResult({
        check: {
          verdict: right ? 'correct' : 'wrong',
          distance: right ? 0 : 1,
          expected: cloze.answer,
          typed: choices[picked]!.term,
        },
        picked,
      });
    }
    onReveal(false);
  };

  const fill = typingMode ? null : picked !== null && choices ? choices[picked]!.term : null;

  if (!revealed) {
    return frame(
      <CardSurface className="min-h-full flex-1 gap-3.5" testId="study-front">
        <CardHeader view={view} label={label} />
        <div className="flex flex-1 flex-col justify-center gap-3.5">
          <p
            lang="en"
            className="font-serif text-2xl leading-normal text-fg italic sm:text-[1.5625rem]"
          >
            {cloze.before}
            {fill ? (
              <span className="mx-0.5 inline-block min-w-[6.5rem] border-b-2 border-dashed border-accent-text px-1 text-center font-semibold text-accent-text not-italic">
                {fill}
              </span>
            ) : (
              <span
                className="mx-0.5 inline-block translate-y-[0.15em] border-b-2 border-dashed border-accent-text align-baseline"
                style={{ width: `${Math.max(3, Math.min(14, cloze.answer.length)) * 0.62}em` }}
              >
                <span className="sr-only">{t('study.blank')}</span>
              </span>
            )}
            {cloze.after}
          </p>
          {hintShown && (
            <p
              className="font-serif text-xl tracking-[0.18em] text-fg-muted"
              data-testid="first-letter"
            >
              <span className="sr-only">{t('review.firstLetter')} </span>
              <span lang="en">{firstLetterHint(cloze.answer)}</span>
            </p>
          )}
          {trShown && sentence?.tr && (
            <p lang="tr" className="text-[0.9375rem] text-fg-muted">
              {sentence.tr}
            </p>
          )}
          <div className="-mx-2 flex items-center justify-between">
            <button
              type="button"
              disabled={hintShown}
              onClick={() => setHintShown(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-accent-text disabled:opacity-50"
            >
              <BulbIcon />
              {t('study.firstLetter')}
            </button>
            {sentence?.tr && (
              <button
                type="button"
                disabled={trShown}
                onClick={() => setTrShown(true)}
                className="flex min-h-11 items-center rounded-control px-2 text-sm text-accent-text disabled:opacity-50"
              >
                {t('study.cloze.showTr')}
              </button>
            )}
          </div>
          <LeechHint view={view} />
        </div>
        {!typingMode && choices && (
          <div
            role="group"
            aria-label={t('study.cloze.choices')}
            className="grid grid-cols-2 gap-2"
          >
            {choices.map((c, i) => (
              <button
                key={c.term}
                type="button"
                aria-pressed={picked === i}
                onClick={() => setPicked(i)}
                className={cn(
                  'flex min-h-14 items-center justify-center rounded-[14px] px-2 py-1 font-serif text-lg break-words',
                  picked === i
                    ? 'border-2 border-accent bg-accent-soft text-fg'
                    : 'border border-border bg-surface-raised text-fg hover:bg-surface-hover',
                )}
              >
                <span lang="en">{c.term}</span>
              </button>
            ))}
          </div>
        )}
        {choices !== null && (
          <button
            type="button"
            onClick={() => setTyping((v) => !v)}
            className="flex min-h-11 items-center gap-1.5 self-center rounded-control px-2 text-sm text-fg-muted hover:text-fg"
          >
            <Icon name={typing ? 'cards' : 'pencil'} size={18} />
            {typing ? t('study.cloze.chooseInstead') : t('study.cloze.typeInstead')}
          </button>
        )}
      </CardSurface>,
      typingMode ? (
        <AnswerInput
          value={typed}
          onChange={setTyped}
          onSubmit={submit}
          placeholder={t('study.cloze.typeAnswer')}
          autoFocus={typing}
        />
      ) : (
        <button
          type="button"
          disabled={picked === null}
          onClick={submit}
          className="h-14 w-full rounded-[14px] bg-accent text-[1.0625rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {t('study.check')}
        </button>
      ),
    );
  }

  const r = result ?? { check: checkAnswer('', cloze.answer), picked: null };
  const suggested = suggestRating(r.check.verdict, hintShown);
  const pickedWrong =
    r.picked !== null && choices && !choices[r.picked]!.correct ? choices[r.picked]! : null;
  const sense = view.sense;
  return frame(
    <div className="flex flex-col gap-3">
      <CardSurface className="gap-3.5" testId="study-back">
        <CardHeader view={view} label={label} />
        <VerdictLine check={r.check} />
        <div className="flex items-start gap-2">
          <p
            lang="en"
            className="min-w-0 flex-1 font-serif text-[1.375rem] leading-snug text-fg italic"
          >
            {cloze.before}
            <mark
              className={cn(
                'rounded-[4px] px-1 font-semibold not-italic',
                r.check.verdict === 'correct'
                  ? 'bg-success-soft text-success-text'
                  : 'bg-accent-soft text-fg',
              )}
            >
              {cloze.answer}
            </mark>
            {cloze.after}
          </p>
          {speech.speakText && sentence && (
            <SpeakButton
              available={speech.available}
              onSpeak={() => speech.speakText!(sentence.text)}
              label={t('review.speakSentence')}
              className="size-11 shrink-0 rounded-full border border-border bg-surface"
            />
          )}
        </div>
        {sentence?.tr && (
          <p lang="tr" className="-mt-1 text-[0.9375rem] text-fg-muted">
            {sentence.tr}
          </p>
        )}
        {r.picked !== null && choices ? (
          <div className="grid grid-cols-2 gap-2">
            {choices.map((c, i) => {
              const right = c.correct;
              const mine = i === r.picked;
              return (
                <div
                  key={c.term}
                  data-choice={right ? 'right' : mine ? 'picked' : 'other'}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-px rounded-[14px] px-2 py-1 font-serif text-lg',
                    right
                      ? 'border-2 border-success-text bg-success-soft text-success-text'
                      : mine
                        ? 'border-2 border-danger-text bg-danger-soft text-danger-text'
                        : 'border border-border bg-canvas text-fg-muted',
                  )}
                >
                  <span lang="en" className="flex items-center gap-1.5">
                    {(right || mine) && <Icon name={right ? 'check' : 'x'} size={16} />}
                    {c.term}
                  </span>
                  {(right || mine) && (
                    <span className="font-sans text-xs font-semibold">
                      {right ? t('study.cloze.correctTag') : t('study.cloze.yourPick')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          r.check.verdict !== 'correct' && <LetterDiff check={r.check} />
        )}
        <div className="h-px bg-surface-sunken" />
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span lang="en" className="font-serif text-[1.375rem] font-semibold text-fg">
                {view.note.term}
              </span>
              {sense?.pos && (
                <span className="text-[0.8125rem] text-fg-muted italic">
                  {posLabel(t, sense.pos)}
                </span>
              )}
            </span>
            {sense && <span className="text-[0.9375rem] text-fg">{meaningOf(sense)}</span>}
            <Ipa ipa={view.note.ipa} />
          </div>
          {view.note.term_type !== 'affix' && <PrimarySpeak speech={speech} />}
        </div>
      </CardSurface>
      {pickedWrong?.meaning && (
        <section className="flex flex-col gap-1 rounded-[18px] border border-border bg-surface px-4 py-3">
          <span className="text-[0.8125rem] font-semibold text-fg-muted">
            {t('study.cloze.pickedWord')}
          </span>
          <p className="text-[0.9375rem]">
            <span lang="en" className="font-serif font-semibold">
              {pickedWrong.term}
            </span>{' '}
            = {pickedWrong.meaning}
          </p>
        </section>
      )}
      <BackExtras view={view} speech={speech} />
    </div>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} />,
    t('study.scrollCard'),
  );
}
