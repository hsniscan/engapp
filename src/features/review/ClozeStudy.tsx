// Boşluk doldurma (v0.5.2 "Çam" card, ADR 0066): a sentence with a blank and four
// choices from the user's own words, or a typed answer. Hints: the first letter and the
// sentence's Turkish. The result marks the right choice and the user's pick, shows the word
// with its meaning and pronunciation, and suggests a button.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AnswerCheck, checkAnswer, suggestRating } from '@/domain/answerCheck';
import { type ClozeChoice, pickClozeChoices } from '@/domain/clozeChoices';
import { firstLetterHint } from '@/domain/recognition';
import { LeechHint } from '@/features/leech';
import { Button, cn, Eyebrow, Icon, Term } from '@/ui';
import { Ipa, SpeakButton } from './CardFaces';
import { useClozeAnswerMode } from './answerMode';
import type { KindProps } from './kinds';
import { AnswerInput, CardTextButton, LetterDiff, VerdictLine } from './ProductionStudy';
import { RatingBar } from './RatingBar';
import {
  BackExtras,
  BackPicture,
  BackRegion,
  CardHeader,
  CardSurface,
  ExtraCard,
  PosBadge,
} from './StudyCards';
import { loadChoiceCandidates, meaningOf, useModeLabel } from './study';
import { checkTypedAnswer } from './typedCheck';

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
  // "Yazarak cevapla" is remembered on this device (v0.5 İP9); choices are the default.
  const [answerMode, setAnswerMode] = useClozeAnswerMode();
  const typing = answerMode === 'type';
  const setTyping = (f: (v: boolean) => boolean) => setAnswerMode(f(typing) ? 'type' : 'choose');
  const checking = useRef(false);
  const [typed, setTyped] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [trShown, setTrShown] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const cloze = view.cloze!;
  const sentence = view.sentence;
  const typingMode = typing || choices === null;

  const checkTyped = async (answer: string): Promise<AnswerCheck> => {
    const a = await checkTypedAnswer(answer, view, cloze.answer);
    const b = checkAnswer(answer, view.note.term);
    // The base form ("reopen" where the sentence has "reopened") is almost right.
    return a.verdict !== 'correct' && a.verdict !== 'synonym' && b.verdict === 'correct'
      ? { ...a, verdict: 'close' }
      : a;
  };

  const submit = () => {
    if (typingMode) {
      if (!typed.trim() || checking.current) return;
      checking.current = true;
      void checkTyped(typed).then((check) => {
        setResult({ check, picked: null });
        onReveal(false);
      });
      return;
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
      <CardSurface className="min-h-full flex-1" testId="study-front">
        <CardHeader view={view} speak={false} />
        <div className="flex flex-1 flex-col justify-center gap-4 py-6">
          <Eyebrow>{label}</Eyebrow>
          <p lang="en" className="font-serif text-title font-normal text-fg italic">
            {cloze.before}
            {fill ? (
              <span className="mx-0.5 inline-block min-w-26 border-b-2 border-dashed border-accent-text px-1 text-center font-semibold text-accent-text not-italic">
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
            <p className="font-serif text-title tracking-[0.18em] text-fg-muted" data-testid="first-letter">
              <span className="sr-only">{t('review.firstLetter')} </span>
              <span lang="en">{firstLetterHint(cloze.answer)}</span>
            </p>
          )}
          {trShown && sentence?.tr && (
            <p lang="tr" className="text-ui text-fg-muted">
              {sentence.tr}
            </p>
          )}
          <div className="-mx-2 flex flex-wrap items-center justify-between gap-1">
            <CardTextButton icon="bulb" disabled={hintShown} onClick={() => setHintShown(true)}>
              {t('study.firstLetter')}
            </CardTextButton>
            {sentence?.tr && (
              <CardTextButton disabled={trShown} onClick={() => setTrShown(true)}>
                {t('study.cloze.showTr')}
              </CardTextButton>
            )}
          </div>
          <LeechHint view={view} />
        </div>
        {!typingMode && choices && (
          <div role="group" aria-label={t('study.cloze.choices')} className="grid grid-cols-2 gap-2">
            {choices.map((c, i) => (
              <button
                key={c.term}
                type="button"
                aria-pressed={picked === i}
                onClick={() => setPicked(i)}
                className={cn(
                  'flex min-h-14 items-center justify-center rounded-control border px-2 py-1 font-serif text-lead break-words',
                  'transition-[background-color,border-color] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.98]',
                  picked === i
                    ? 'border-accent bg-accent-soft font-semibold text-fg ring-1 ring-accent ring-inset'
                    : 'border-border bg-surface text-fg hover:border-border-strong/60 hover:bg-surface-hover',
                )}
              >
                <span lang="en">{c.term}</span>
              </button>
            ))}
          </div>
        )}
        {choices !== null && (
          <div className="mt-2 flex justify-center border-t border-border pt-2">
            <CardTextButton
              tone="muted"
              icon={typing ? 'cards' : 'pencil'}
              onClick={() => setTyping((v) => !v)}
            >
              {typing ? t('study.cloze.chooseInstead') : t('study.cloze.typeInstead')}
            </CardTextButton>
          </div>
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
        <Button size="lg" fullWidth disabled={picked === null} onClick={submit}>
          {t('study.check')}
        </Button>
      ),
    );
  }

  const r = result ?? { check: checkAnswer('', cloze.answer), picked: null };
  const suggested = suggestRating(r.check.verdict, hintShown);
  const pickedWrong =
    r.picked !== null && choices && !choices[r.picked]!.correct ? choices[r.picked]! : null;
  const sense = view.sense;
  const right = r.check.verdict === 'correct' || r.check.verdict === 'synonym';
  return frame(
    <BackRegion>
      <CardSurface className="min-h-full flex-1" testId="study-back">
        <CardHeader view={view} speech={speech} />
        <div className="flex flex-1 flex-col justify-center gap-4 pt-4">
          <VerdictLine check={r.check} />
          <div className="flex items-start gap-2">
            <p lang="en" className="min-w-0 flex-1 font-serif text-title font-normal text-fg italic">
              {cloze.before}
              <mark
                className={cn(
                  'rounded-xs px-1 font-semibold not-italic',
                  right ? 'bg-success-soft text-success-text' : 'bg-accent-soft text-fg',
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
                className="shrink-0"
              />
            )}
          </div>
          {sentence?.tr && (
            <p lang="tr" className="-mt-2 text-ui text-fg-muted">
              {sentence.tr}
            </p>
          )}
          {r.picked !== null && choices ? (
            <div className="grid grid-cols-2 gap-2">
              {choices.map((c, i) => {
                const isRight = c.correct;
                const mine = i === r.picked;
                return (
                  <div
                    key={c.term}
                    data-choice={isRight ? 'right' : mine ? 'picked' : 'other'}
                    className={cn(
                      'flex min-h-14 flex-col items-center justify-center gap-px rounded-control border px-2 py-1 font-serif text-lead',
                      isRight
                        ? 'border-success-text bg-success-soft text-success-text'
                        : mine
                          ? 'border-danger-text bg-danger-soft text-danger-text'
                          : 'border-border text-fg-muted',
                    )}
                  >
                    <span lang="en" className="flex items-center gap-1.5">
                      {(isRight || mine) && <Icon name={isRight ? 'check' : 'x'} size={16} />}
                      {c.term}
                    </span>
                    {(isRight || mine) && (
                      <span className="font-sans text-caption font-semibold">
                        {isRight ? t('study.cloze.correctTag') : t('study.cloze.yourPick')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            r.check.verdict !== 'correct' && <LetterDiff check={r.check} />
          )}
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-baseline gap-2">
              <Term size="title" className="text-fg">
                {view.note.term}
              </Term>
              <PosBadge view={view} />
            </span>
            {sense && <span className="text-lead font-medium text-fg">{meaningOf(sense)}</span>}
            <Ipa ipa={view.note.ipa} />
          </div>
          <BackPicture view={view} />
        </div>
      </CardSurface>
      {pickedWrong?.meaning && (
        <ExtraCard label={t('study.cloze.pickedWord')} icon="info">
          <p>
            <Term className="font-semibold">{pickedWrong.term}</Term> = {pickedWrong.meaning}
          </p>
        </ExtraCard>
      )}
      <BackExtras view={view} speech={speech} />
    </BackRegion>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} />,
    t('study.scrollCard'),
  );
}
