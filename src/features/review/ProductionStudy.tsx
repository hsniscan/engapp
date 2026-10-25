// Üretim (Türkçe → İngilizce, redesign boards ProductionCard / ProductionResult): the Turkish
// meaning (or the picture, for a picture card) and the sentence with a blank; the user types the
// English, or asks for the first letter, or gives up. The result shows a letter-by-letter diff
// and suggests a button; any button can still be chosen.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { type AnswerCheck, checkAnswer, diffLetters, suggestRating } from '@/domain/answerCheck';
import { posLabel } from '@/features/cards/labels';
import { CardPicture } from '@/features/images';
import { LeechHint } from '@/features/leech';
import { cn, Icon } from '@/ui';
import { Ipa } from './CardFaces';
import type { KindProps } from './kinds';
import { RatingBar } from './RatingBar';
import {
  BackExtras,
  BackRegion,
  BulbIcon,
  CardHeader,
  CardSurface,
  MeaningBlock,
  PrimarySpeak,
  SentencePanel,
} from './StudyCards';
import { blankSpan, useModeLabel } from './study';

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
      className="flex gap-2.5"
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
        className="h-[52px] min-w-0 flex-1 rounded-[14px] border-2 border-accent bg-surface-raised px-3.5 font-serif text-xl text-fg outline-none placeholder:font-sans placeholder:text-base placeholder:text-fg-muted focus:ring-4 focus:ring-accent-soft"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="h-[52px] shrink-0 rounded-[14px] bg-accent px-4 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {t('study.check')}
      </button>
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
      className={cn('font-serif text-[1.1875rem] leading-relaxed text-fg italic', className)}
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
  // Letters are marked only when the answer was close; a wrong word is shown whole.
  const marked = check.verdict === 'close';
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
      {check.typed && (
        <>
          <span className="text-[0.8125rem] text-fg-muted">{t('study.result.yours')}</span>
          <span
            lang="en"
            className="font-serif text-[1.375rem] tracking-[0.02em] break-words text-fg"
          >
            <span className="sr-only">{check.typed}</span>
            <span aria-hidden="true">
              {!marked ? (
                <span className="text-danger-text line-through decoration-2">{check.typed}</span>
              ) : (
                ops.map((o, i) =>
                  o.kind === 'same' ? (
                    <span key={i}>{o.ch}</span>
                  ) : o.kind === 'missing' ? null : (
                    <span
                      key={i}
                      data-diff="wrong"
                      className="rounded-[3px] bg-danger-soft px-px text-danger-text line-through decoration-2"
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
      <span className="text-[0.8125rem] text-fg-muted">{t('study.result.right')}</span>
      <span
        lang="en"
        data-testid="right-answer"
        data-answer={check.expected}
        className="font-serif text-[1.875rem] leading-tight font-semibold tracking-[0.02em] break-words text-fg"
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
                    className="rounded-[3px] bg-success-soft px-px text-success-text underline underline-offset-4"
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

const verdictLook = {
  correct: {
    box: 'border-[color-mix(in_oklab,var(--success-text)_30%,transparent)] bg-success-soft',
    text: 'text-success-text',
    icon: 'check',
  },
  close: {
    box: 'border-[color-mix(in_oklab,var(--warn-text)_30%,transparent)] bg-warn-soft',
    text: 'text-warn-text',
    icon: 'minus',
  },
  wrong: {
    box: 'border-[color-mix(in_oklab,var(--danger-text)_30%,transparent)] bg-danger-soft',
    text: 'text-danger-text',
    icon: 'x',
  },
  skipped: { box: 'border-border bg-canvas', text: 'text-fg', icon: 'info' },
} as const;

export function VerdictLine({ check }: { check: Pick<AnswerCheck, 'verdict' | 'distance'> }) {
  const { t } = useTranslation();
  const look = verdictLook[check.verdict];
  const text =
    check.verdict === 'close'
      ? t('study.result.close', { count: check.distance })
      : t(`study.result.${check.verdict}`);
  return (
    <span
      role="status"
      data-verdict={check.verdict}
      className={cn('flex items-center gap-2 text-sm font-semibold', look.text)}
    >
      {look.icon === 'minus' ? (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
        </svg>
      ) : (
        <Icon name={look.icon} size={18} />
      )}
      {text}
    </span>
  );
}

function verdictBox(verdict: AnswerCheck['verdict']): string {
  return verdictLook[verdict].box;
}

export function ProductionStudy({
  view,
  speech,
  revealed,
  onReveal,
  onAnswer,
  ratingRef,
  frame,
}: KindProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const label = useModeLabel(view, true);
  const { card, note, sense } = view;
  const picture = card.card_type === 'image' && view.image ? view.image : null;

  const submit = (answer: string) => {
    setCheck(checkAnswer(answer, note.term));
    onReveal(false);
  };

  if (!revealed) {
    return frame(
      <CardSurface className="min-h-full flex-1 gap-4" testId="study-front">
        <CardHeader view={view} label={label} />
        <div className="flex flex-1 flex-col justify-center gap-4">
          {picture ? (
            <div className="flex flex-col items-center gap-2">
              <CardPicture image={picture} showNew={false} className="size-44 sm:size-56" />
              <p className="text-[0.9375rem] text-fg-muted">{t('review.promptImage')}</p>
              {sense?.pos && (
                <p className="text-[0.9375rem] text-fg-muted">
                  <span className="sr-only">
                    {t('imageCard.pos', { pos: posLabel(t, sense.pos) })}
                  </span>
                  <span aria-hidden="true" className="font-serif italic">
                    {posLabel(t, sense.pos)}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <MeaningBlock view={view} />
          )}
          {!picture && view.sentence && <BlankedSentenceBox view={view} />}
          {hintShown && view.hint && (
            <p
              className="font-serif text-2xl tracking-[0.18em] text-fg-muted"
              data-testid="first-letter"
            >
              <span className="sr-only">{t('review.firstLetter')} </span>
              <span lang="en">{view.hint}</span>
            </p>
          )}
          <LeechHint view={view} />
        </div>
        <div className="-mx-2 flex items-center justify-between">
          <button
            type="button"
            disabled={hintShown || !view.hint}
            onClick={() => setHintShown(true)}
            className="flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-accent-text disabled:opacity-50"
          >
            <BulbIcon />
            {t('study.firstLetter')}
          </button>
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
        placeholder={t('study.typeAnswer')}
        autoFocus
      />,
    );
  }

  // Shown without a check (Space on a keyboard, undo): treat as "Bilmiyorum".
  const result = check ?? checkAnswer('', note.term);
  const suggested = suggestRating(result.verdict, hintShown);
  return frame(
    <BackRegion>
      <CardSurface className="gap-4" testId="study-back">
        <CardHeader view={view} label={label} />
        {view.image ? (
          <div data-testid="meaning-with-picture" className="flex items-center gap-4">
            <CardPicture
              image={view.image}
              showNew={!picture}
              className="size-[76px] overflow-hidden rounded-[12px] bg-surface-sunken"
            />
            <div className="min-w-0 flex-1">
              <MeaningBlock view={view} size="md" />
            </div>
          </div>
        ) : (
          <MeaningBlock view={view} size="md" />
        )}
        <div
          className={cn(
            'flex flex-col gap-3 rounded-[16px] border px-4 py-3.5',
            verdictBox(result.verdict),
          )}
        >
          <VerdictLine check={result} />
          <LetterDiff check={result} />
          <div className="flex items-center gap-2">
            <Ipa ipa={note.ipa} />
            {note.term_type !== 'affix' && <PrimarySpeak speech={speech} />}
          </div>
        </div>
        <SentencePanel view={view} speech={speech} />
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </BackRegion>,
    <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} suggested={suggested} />,
    t('study.scrollCard'),
  );
}

function BlankedSentenceBox({ view }: { view: CardView }) {
  const tr = view.sentence?.tr;
  if (!blankSpan(view)) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] bg-canvas px-3.5 py-3">
      <BlankedSentence view={view} />
      {tr && (
        <p lang="tr" className="text-[0.9375rem] text-fg-muted">
          {tr}
        </p>
      )}
    </div>
  );
}
