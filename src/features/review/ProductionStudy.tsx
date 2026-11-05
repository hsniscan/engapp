// Üretim (Türkçe → İngilizce; v0.5.2 "Çam" card, ADR 0066): the Turkish
// meaning (or the picture, for a picture card) and the sentence with a blank; the user types the
// English, or asks for the first letter, or gives up. The result shows a letter-by-letter diff
// and suggests a button; any button can still be chosen.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { type AnswerCheck, checkAnswer, diffLetters, suggestRating } from '@/domain/answerCheck';
import { cardFormat } from '@/domain/formatLadder';
import { Rating } from '@/domain/types';
import { posLabel } from '@/features/cards/labels';
import { CardPicture } from '@/features/images';
import { LeechHint } from '@/features/leech';
import { Button, cn, Eyebrow, Icon, type IconName } from '@/ui';
import { useProductionAnswerMode } from './answerMode';
import { Ipa } from './CardFaces';
import type { KindProps } from './kinds';
import { RatingBar } from './RatingBar';
import {
  BackExtras,
  BackPicture,
  BackRegion,
  CardHeader,
  CardSurface,
  MeaningBlock,
  SentencePanel,
} from './StudyCards';
import { blankSpan, useModeLabel } from './study';
import { checkTypedAnswer } from './typedCheck';

/** The typed-answer row pinned above the keyboard: field and "Kontrol et". */
export function AnswerInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        lang="en"
        inputMode="text"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid="answer-input"
        className="h-13 min-w-0 flex-1 rounded-control border border-border-strong bg-surface-raised px-4 font-serif text-lead text-fg transition-[border-color,box-shadow] duration-(--duration-micro) placeholder:font-sans placeholder:text-ui placeholder:text-fg-subtle focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <Button type="submit" size="lg" disabled={!value.trim()} className="shrink-0">
        {t('study.check')}
      </Button>
    </form>
  );
}

/** The sentence with the term blanked (the board's underline), or null without a usable span. */
export function BlankedSentence({
  view,
  fill,
  className,
}: {
  view: CardView;
  fill?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const s = view.sentence;
  const span = blankSpan(view);
  if (!s || !span) return null;
  const answer = s.text.slice(span[0], span[1]);
  const width = `${Math.max(3, Math.min(14, [...answer].length)) * 0.62}em`;
  return (
    <p
      lang="en"
      className={cn('font-serif text-lead text-fg italic', className)}
    >
      {s.text.slice(0, span[0])}
      {fill ? (
        <span
          className="mx-0.5 inline-block border-b-2 border-dashed border-accent-text px-1 text-center font-semibold text-accent-text not-italic"
          style={{ minWidth: width }}
        >
          {fill}
        </span>
      ) : (
        <span
          className="mx-0.5 inline-block translate-y-[0.15em] border-b-2 border-accent-text align-baseline"
          style={{ width }}
        >
          <span className="sr-only">{t('study.blank')}</span>
        </span>
      )}
      {s.text.slice(span[1])}
    </p>
  );
}

/** Letter diff of a typed answer: wrong letters struck through, right ones underlined. */
export function LetterDiff({ check }: { check: AnswerCheck }) {
  const { t } = useTranslation();
  const ops = diffLetters(check.typed, check.expected);
  // Letters are marked only when the answer was close; a wrong word is shown whole and struck
  // through, a synonym (or a right answer) whole and plain.
  const marked = check.verdict === 'close';
  const struck = check.verdict === 'wrong';
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
      {check.typed && (
        <>
          <span className="text-meta text-fg-muted">{t('study.result.yours')}</span>
          <span
            lang="en"
            className="font-serif text-title font-normal tracking-[0.02em] break-words text-fg"
          >
            <span className="sr-only">{check.typed}</span>
            <span aria-hidden="true">
              {!marked ? (
                <span className={struck ? 'text-danger-text line-through decoration-2' : undefined}>
                  {check.typed}
                </span>
              ) : (
                ops.map((o, i) =>
                  o.kind === 'same' ? (
                    <span key={i}>{o.ch}</span>
                  ) : o.kind === 'missing' ? null : (
                    <span
                      key={i}
                      data-diff="wrong"
                      className="rounded-xs bg-danger-soft px-px text-danger-text line-through decoration-2"
                    >
                      {o.typed}
                    </span>
                  ),
                )
              )}
            </span>
          </span>
        </>
      )}
      <span className="text-meta text-fg-muted">
        {check.verdict === 'synonym' ? t('modes.typed.synonymNote') : t('study.result.right')}
      </span>
      <span
        lang="en"
        data-testid="right-answer"
        data-answer={check.expected}
        className="font-serif text-heading font-semibold tracking-[0.02em] break-words text-fg"
      >
        <span className="sr-only">{check.expected}</span>
        <span aria-hidden="true">
          {!marked
            ? check.expected
            : ops.map((o, i) =>
                o.kind === 'same' ? (
                  <span key={i}>{o.ch}</span>
                ) : o.kind === 'extra' ? null : (
                  <span
                    key={i}
                    data-diff="right"
                    className="rounded-xs bg-success-soft px-px text-success-text underline underline-offset-4"
                  >
                    {o.expected}
                  </span>
                ),
              )}
        </span>
      </span>
    </div>
  );
}

const verdictLook: Record<
  AnswerCheck['verdict'],
  { box: string; text: string; icon: IconName }
> = {
  correct: { box: 'bg-success-soft', text: 'text-success-text', icon: 'check' },
  synonym: { box: 'bg-success-soft', text: 'text-success-text', icon: 'check' },
  close: { box: 'bg-warn-soft', text: 'text-warn-text', icon: 'minus-circle' },
  wrong: { box: 'bg-danger-soft', text: 'text-danger-text', icon: 'x' },
  skipped: { box: 'bg-surface-sunken', text: 'text-fg', icon: 'info' },
};

export function VerdictLine({
  check,
}: {
  check: Pick<AnswerCheck, 'verdict' | 'distance'> & Partial<Pick<AnswerCheck, 'otherWord'>>;
}) {
  const { t } = useTranslation();
  const look = verdictLook[check.verdict];
  const text = check.otherWord
    ? t('study.result.otherWord', { word: check.otherWord })
    : check.verdict === 'close'
      ? t('study.result.close', { count: check.distance })
      : check.verdict === 'synonym'
        ? t('modes.typed.synonym')
        : t(`study.result.${check.verdict}`);
  return (
    <span
      role="status"
      data-verdict={check.verdict}
      className={cn('flex items-center gap-2 text-ui font-semibold', look.text)}
    >
      <Icon name={look.icon} size={18} strokeWidth={2} />
      {text}
    </span>
  );
}

/** The tinted well of a typed answer's result (verdict, letter diff, IPA). */
function verdictBox(verdict: AnswerCheck['verdict']): string {
  return cn('rounded-inner p-4', verdictLook[verdict].box);
}

/** "İlk harfi göster" / "Bilmiyorum" / "Türkçesini göster": a quiet text button on the card. */
export function CardTextButton({
  children,
  onClick,
  disabled,
  icon,
  tone = 'accent',
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: IconName;
  tone?: 'accent' | 'muted';
  testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex min-h-11 items-center gap-1.5 rounded-control px-2 text-meta font-semibold transition-colors duration-(--duration-micro) hover:bg-hover disabled:opacity-45',
        tone === 'accent' ? 'text-accent-text' : 'text-fg-muted hover:text-fg',
      )}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function ProductionStudy({
  view,
  speech,
  revealed,
  onReveal,
  onAnswer,
  ratingRef,
  showRef,
  frame,
  slow,
}: KindProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [hintShown, setHintShown] = useState(false);
  // B2 format ladder: from Öğrenildi the blanked sentence is a hint, not part of the question.
  const [sentenceShown, setSentenceShown] = useState(false);
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const [mode, setMode] = useProductionAnswerMode();
  const checking = useRef(false);
  const label = useModeLabel(view, true);
  const { card, note, sense } = view;
  const picture = card.card_type === 'image' && view.image ? view.image : null;
  // "Aklımdan" (no typing): the answer is shown and rated without a check.
  const flip = mode === 'flip';
  const sentenceAsHint = cardFormat(card).sentenceAsHint && !picture && !!view.sentence && !!blankSpan(view);
  const usedHint = hintShown || (sentenceAsHint && sentenceShown);

  const submit = (answer: string) => {
    if (checking.current) return;
    checking.current = true;
    void checkTypedAnswer(answer, view).then((c) => {
      setCheck(c);
      onReveal(false, 'typed');
    });
  };

  if (!revealed) {
    return frame(
      <CardSurface className="min-h-full flex-1" testId="study-front">
        <CardHeader view={view} speak={false} />
        <div className="flex flex-1 flex-col justify-center gap-5 py-6">
          <Eyebrow>{label}</Eyebrow>
          {picture ? (
            <div className="flex flex-col items-center gap-2">
              <CardPicture
                image={picture}
                showNew={false}
                className="size-44 overflow-hidden rounded-inner sm:size-56"
              />
              <p className="text-ui text-fg-muted">{t('review.promptImage')}</p>
              {sense?.pos && (
                <p className="text-ui text-fg-muted">
                  <span className="sr-only">
                    {t('imageCard.pos', { pos: posLabel(t, sense.pos) })}
                  </span>
                  <span aria-hidden="true">{posLabel(t, sense.pos)}</span>
                </p>
              )}
            </div>
          ) : (
            <MeaningBlock view={view} />
          )}
          {!picture && view.sentence && (!sentenceAsHint || sentenceShown) && <BlankedSentenceBox view={view} />}
          {hintShown && view.hint && (
            <p className="font-serif text-heading tracking-[0.18em] text-fg-muted" data-testid="first-letter">
              <span className="sr-only">{t('review.firstLetter')} </span>
              <span lang="en">{view.hint}</span>
            </p>
          )}
          <LeechHint view={view} />
        </div>
        <div className="-mx-2 flex flex-wrap items-center justify-between gap-1">
          <CardTextButton
            icon="bulb"
            disabled={hintShown || !view.hint}
            onClick={() => setHintShown(true)}
          >
            {t('study.firstLetter')}
          </CardTextButton>
          {sentenceAsHint && (
            <CardTextButton
              icon="book"
              disabled={sentenceShown}
              testId="sentence-hint"
              onClick={() => setSentenceShown(true)}
            >
              {t('study.showSentence')}
            </CardTextButton>
          )}
          {!flip && (
            <CardTextButton tone="muted" onClick={() => submit('')}>
              {t('study.dontKnow')}
            </CardTextButton>
          )}
        </div>
        <div className="flex justify-center border-t border-border pt-2">
          <CardTextButton
            tone="muted"
            icon={flip ? 'pencil' : 'cards'}
            testId="answer-mode-toggle"
            onClick={() => setMode(flip ? 'type' : 'flip')}
          >
            {flip ? t('modes.typed.typeInstead') : t('modes.typed.flipInstead')}
          </CardTextButton>
        </div>
      </CardSurface>,
      flip ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            ref={showRef}
            variant="secondary"
            size="lg"
            fullWidth
            onClick={(e) => onReveal(e.detail === 0, 'flip')}
          >
            {t('review.showAnswer')}
          </Button>
          <p className="text-meta text-fg-muted">{t('modes.typed.flipHint')}</p>
        </div>
      ) : (
        <AnswerInput
          value={typed}
          onChange={setTyped}
          onSubmit={() => submit(typed)}
          placeholder={t('study.typeAnswer')}
          autoFocus
        />
      ),
    );
  }

  // Shown without a check ("aklımdan", Space on a keyboard, undo): no verdict and no
  // suggestion in "aklımdan"; otherwise treated as "Bilmiyorum".
  const result = check ?? checkAnswer('', note.term);
  const unchecked = flip && !check;
  // A self-rated ("aklımdan") answer only gets the pace mark (B6); a checked one the full
  // suggestion and the "Devam" button (A3).
  const suggested = unchecked ? (slow ? Rating.Hard : null) : suggestRating(result.verdict, usedHint, { slow });
  return frame(
    <BackRegion>
      <CardSurface className="min-h-full flex-1" testId="study-back">
        <CardHeader view={view} speech={speech} />
        <div
          className="flex flex-1 flex-col justify-center gap-5 pt-4"
          data-testid={view.image ? 'meaning-with-picture' : undefined}
        >
          <MeaningBlock view={view} size="md" />
          <div className={cn('flex flex-col gap-3', unchecked ? 'rounded-inner bg-surface-sunken p-4' : verdictBox(result.verdict))}>
            {unchecked ? (
              <p
                lang="en"
                data-testid="right-answer"
                data-answer={result.expected}
                className="font-serif text-heading font-semibold tracking-[0.02em] break-words text-fg"
              >
                {result.expected}
              </p>
            ) : (
              <>
                <VerdictLine check={result} />
                <LetterDiff check={result} />
              </>
            )}
            <Ipa ipa={note.ipa} />
          </div>
          <SentencePanel view={view} speech={speech} />
          <BackPicture view={view} showNew={!picture} />
        </div>
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </BackRegion>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} primary={!unchecked} />,
    t('study.scrollCard'),
  );
}

function BlankedSentenceBox({ view }: { view: CardView }) {
  const tr = view.sentence?.tr;
  if (!blankSpan(view)) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-inner bg-surface-sunken px-4 py-3">
      <BlankedSentence view={view} />
      {tr && (
        <p lang="tr" className="text-ui text-fg-muted">
          {tr}
        </p>
      )}
    </div>
  );
}
