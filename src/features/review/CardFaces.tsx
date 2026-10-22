import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import type { CardSentence } from '@/domain/examples';
import { findSpan, isValidSpan } from '@/domain/recognition';
import type { Sense } from '@/domain/types';
import { posLabel } from '@/features/cards/labels';
import { LevelDialogButton } from '@/features/levels/LevelDetails';
import { useCardLevel } from '@/features/levels/useWordLevel';
import { CardExamples } from '@/features/examples/ExamplesPanel';
import { CardBackExtras } from '@/features/family/CardBackExtras';
import { ContrastBack, ContrastFront, LeechBadge, LeechHint } from '@/features/leech';
import { CardMnemonic } from '@/features/mnemonics';
import { Badge, cn, IconButton } from '@/ui';
import { usePronunciationBusy } from './pronunciation';

const meaningOf = (s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>) =>
  s.meaning_tr_override ?? s.meaning_tr;

/** The sentence with the term set apart. Falls back to a text search when no span is stored. */
export function Sentence({
  sentence,
  span,
  term,
  className,
}: {
  sentence: string;
  span: [number, number] | null;
  term: string;
  className?: string;
}) {
  const at = span && isValidSpan(sentence, span) ? span : findSpan(sentence, term);
  return (
    <p lang="en" className={cn('font-serif text-lg leading-relaxed text-fg italic', className)}>
      {at ? (
        <>
          {sentence.slice(0, at[0])}
          <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-fg not-italic [box-decoration-break:clone]">
            {sentence.slice(at[0], at[1])}
          </mark>
          {sentence.slice(at[1])}
        </>
      ) : (
        sentence
      )}
    </p>
  );
}

export interface SpeakProps {
  available: boolean;
  /** Speaks the term. */
  onSpeak: () => void;
  /** Speaks any English text (the example sentence on the back). */
  speakText?: (text: string) => void;
}

export function SpeakButton({
  available,
  onSpeak,
  label,
  className,
}: Pick<SpeakProps, 'available' | 'onSpeak'> & { label?: string; className?: string }) {
  const { t } = useTranslation();
  const { busy, run } = usePronunciationBusy();
  return (
    <IconButton
      icon="speaker"
      label={available ? (label ?? t('common.listen')) : t('review.noVoice')}
      aria-disabled={!available || undefined}
      aria-busy={busy || undefined}
      className={cn(
        className,
        !available && 'opacity-45 hover:bg-transparent hover:text-fg-muted',
        busy && 'animate-pulse',
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (available) run(onSpeak);
      }}
    />
  );
}

/**
 * The sentence on the back of a card (the one the front showed): a button that reads it
 * aloud, and its Turkish translation under it, when there is one. An example sentence's
 * translation waits for a tap unless the user turned that off.
 */
function BackSentence({
  sentence,
  term,
  speech,
  className,
}: {
  sentence: CardSentence;
  term: string;
  speech: SpeakProps;
  className?: string;
}) {
  const { t } = useTranslation();
  const [trShown, setTrShown] = useState(false);
  const { speakText } = speech;
  const text = sentence.text;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div className="flex items-start justify-center gap-1">
        <Sentence sentence={text} span={sentence.span} term={term} className={cn('min-w-0', className)} />
        {speakText && (
          <SpeakButton
            available={speech.available}
            onSpeak={() => speakText(text)}
            label={t('review.speakSentence')}
            className="shrink-0"
          />
        )}
      </div>
      {sentence.tr &&
        (sentence.trOnTap && !trShown ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTrShown(true);
            }}
            className="min-h-9 text-sm font-medium text-accent-text underline-offset-2 hover:underline"
          >
            {t('examples.showTr')}
          </button>
        ) : (
          <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg-muted">
            {sentence.tr}
          </p>
        ))}
    </div>
  );
}

function Face({
  prompt,
  isNew,
  aside,
  children,
  className,
}: {
  prompt: string;
  isNew: boolean;
  /** Extra items at the end of the header row (the level badge on the back). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col px-5 pt-4 pb-8 sm:px-8">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <span className="text-sm text-fg-muted">{prompt}</span>
        <span className="flex items-center gap-2">
          {isNew && <Badge tone="accent">{t('review.newCard')}</Badge>}
          {aside}
        </span>
      </div>
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-3 pt-6 text-center',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Term({ term, size = 'lg' }: { term: string; size?: 'lg' | 'md' }) {
  return (
    <p
      lang="en"
      className={cn(
        'font-serif leading-tight font-semibold tracking-[-0.01em] text-balance text-fg',
        size === 'lg' ? 'text-4xl sm:text-display' : 'text-3xl',
      )}
    >
      {term}
    </p>
  );
}

function Ipa({ ipa }: { ipa: string | null }) {
  if (!ipa) return null;
  return (
    <p lang="en" className="font-serif text-lg text-fg-muted">
      {ipa}
    </p>
  );
}

const promptKey = {
  recognition: 'review.promptRecognition',
  production: 'review.promptProduction',
  cloze: 'review.promptCloze',
} as const;

export interface FaceProps {
  view: CardView;
  isNew: boolean;
  speech: SpeakProps;
}

export const CardFront = memo(function CardFront({ view, isNew, speech }: FaceProps) {
  const { t } = useTranslation();
  const { card, note, sense, cloze, hint } = view;
  const prompt = t(promptKey[card.card_type]);
  // A card forgotten 6 times or more (v0.3 İP6): a small marker, and its mnemonic as a hint.
  const marker = <LeechBadge lapses={card.lapses} />;

  if (note.term_type === 'contrast') {
    return (
      <Face prompt={t('leech.contrast.prompt')} isNew={isNew} aside={marker}>
        <ContrastFront view={view} />
      </Face>
    );
  }

  if (card.card_type === 'production' && sense) {
    return (
      <Face prompt={prompt} isNew={isNew} aside={marker}>
        <p className="font-serif text-3xl leading-snug font-semibold text-fg sm:text-4xl">
          {meaningOf(sense)}
        </p>
        {sense.gloss_en && (
          <p lang="en" className="max-w-sm text-[0.9375rem] text-fg-muted">
            {sense.gloss_en}
          </p>
        )}
        {hint && (
          <p className="mt-4 font-serif text-2xl tracking-[0.18em] text-fg-muted">
            <span className="sr-only">{t('review.firstLetter')} </span>
            <span lang="en">{hint}</span>
          </p>
        )}
        <LeechHint view={view} />
      </Face>
    );
  }

  if (card.card_type === 'cloze' && cloze && sense) {
    const blankWidth = `${Math.max(3, Math.min(14, cloze.answer.length)) * 0.62}em`;
    return (
      <Face prompt={prompt} isNew={isNew} aside={marker} className="gap-6">
        <p
          lang="en"
          className="max-w-md font-serif text-xl leading-relaxed text-fg italic sm:text-2xl"
        >
          {cloze.before}
          <span
            className="mx-0.5 inline-block translate-y-[0.15em] border-b-2 border-fg-muted align-baseline"
            style={{ width: blankWidth }}
          >
            <span className="sr-only">{t('review.blank')}</span>
          </span>
          {cloze.after}
        </p>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium tracking-wide text-fg-muted">
            {t('review.hint')}
          </span>
          <p className="font-serif text-xl text-fg-muted">{meaningOf(sense)}</p>
        </div>
        <LeechHint view={view} />
      </Face>
    );
  }

  // Recognition (and the fallback for a card whose sense went missing).
  return (
    <Face prompt={prompt} isNew={isNew} aside={marker}>
      <Term term={note.term} />
      {note.term_type !== 'affix' && <SpeakButton {...speech} />}
      {view.sentence && (
        <Sentence
          sentence={view.sentence.text}
          span={view.sentence.span}
          term={note.term}
          className="mt-3 max-w-md"
        />
      )}
      <LeechHint view={view} />
    </Face>
  );
});

function SenseList({ view }: { view: CardView }) {
  const { t } = useTranslation();
  const { sense } = view;
  // A per-sense recognition card (split leech) covers only its own sense.
  const senses = view.card.sense_id && sense ? [sense] : view.senses;
  if (senses.length <= 1) {
    const only = senses[0];
    if (!only) return null;
    return (
      <div className="flex flex-col items-center gap-1.5">
        <p className="font-serif text-3xl leading-snug font-semibold text-fg">{meaningOf(only)}</p>
        {only.gloss_en && (
          <p className="text-[0.9375rem] text-fg-muted">
            {only.pos && <span className="italic">{posLabel(t, only.pos)} · </span>}
            <span lang="en">{only.gloss_en}</span>
          </p>
        )}
      </div>
    );
  }
  return (
    <ol className="flex w-full max-w-md flex-col gap-1 text-left">
      {senses.map((s, i) => {
        const shown = s.id === sense?.id;
        return (
          <li
            key={s.id}
            className={cn(
              'flex gap-3 rounded-control px-3 py-2.5',
              shown ? 'bg-accent-soft' : 'opacity-90',
            )}
          >
            <span className="tabular w-4 shrink-0 pt-1 font-serif text-lg text-fg-muted">
              {i + 1}.
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p
                className={cn(
                  'font-serif leading-snug text-fg',
                  shown ? 'text-2xl font-semibold' : 'text-xl',
                )}
              >
                {meaningOf(s)}
              </p>
              {(s.gloss_en || shown) && (
                <p className="text-sm text-fg-muted">
                  {s.gloss_en && (
                    <span>
                      {s.pos && <span className="italic">{posLabel(t, s.pos)} · </span>}
                      <span lang="en">{s.gloss_en}</span>
                    </span>
                  )}
                  {shown && (
                    <span className="font-medium text-accent-text">
                      {s.gloss_en ? ' · ' : ''}
                      {t('review.shownSense')}
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const CardBack = memo(function CardBack({ view, isNew, speech }: FaceProps) {
  const { t } = useTranslation();
  const { card, note, sense } = view;
  const prompt = t(promptKey[card.card_type]);
  const level = useCardLevel(view);
  const aside = level ? <LevelDialogButton level={level} term={note.term} /> : null;
  const sentence = view.sentence ? (
    <BackSentence
      // A new sentence starts with its translation hidden again.
      key={view.sentence.text}
      sentence={view.sentence}
      term={note.term}
      speech={speech}
      className="text-[1.0625rem] text-fg-muted"
    />
  ) : null;
  if (note.term_type === 'contrast') {
    return (
      <Face prompt={t('leech.contrast.prompt')} isNew={isNew}>
        <ContrastBack view={view} />
      </Face>
    );
  }
  const examples = view.senses.some((s) => s.lexicon_sense_id) ? (
    <div className="flex w-full max-w-md justify-center border-t border-border pt-2">
      <CardExamples
        term={note.term}
        senses={view.senses}
        initialSenseId={sense?.id ?? null}
        speech={speech.speakText ? { available: speech.available, speak: speech.speakText } : undefined}
      />
    </div>
  ) : null;

  if (card.card_type === 'recognition' || !sense) {
    return (
      <Face prompt={prompt} isNew={isNew} aside={aside} className="gap-5">
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1">
            <p lang="en" className="font-serif text-2xl font-semibold text-fg">
              {note.term}
            </p>
            {note.term_type !== 'affix' && <SpeakButton {...speech} />}
          </div>
          <Ipa ipa={note.ipa} />
        </div>
        <SenseList view={view} />
        {/* The mnemonic of the sense asked this time (a split card: always its own sense). */}
        {(sense ? [sense] : view.senses).map((s) => (
          <CardMnemonic key={s.id} senseId={s.id} className="text-center" />
        ))}
        {sentence && (
          <div className="flex w-full max-w-md justify-center border-t border-border pt-4">
            {sentence}
          </div>
        )}
        {examples}
        <CardBackExtras note={note} />
      </Face>
    );
  }

  return (
    <Face prompt={prompt} isNew={isNew} aside={aside} className="gap-4">
      {card.card_type === 'cloze' && view.cloze && view.sentence ? (
        <BackSentence
          key={view.sentence.text}
          sentence={view.sentence}
          term={note.term}
          speech={speech}
          className="text-xl sm:text-2xl"
        />
      ) : (
        <Term term={note.term} />
      )}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-1">
          {card.card_type === 'cloze' && (
            <p lang="en" className="font-serif text-xl font-semibold text-fg">
              {note.term}
            </p>
          )}
          <Ipa ipa={note.ipa} />
          <SpeakButton {...speech} />
        </div>
      </div>
      <div className="flex w-full max-w-md flex-col items-center gap-1 border-t border-border pt-4">
        <p className="font-serif text-xl text-fg">{meaningOf(sense)}</p>
        {sense.gloss_en && (
          <p lang="en" className="text-sm text-fg-muted">
            {sense.gloss_en}
          </p>
        )}
      </div>
      <CardMnemonic senseId={sense.id} className="text-center" />
      {card.card_type === 'production' && sentence}
      {examples}
      <CardBackExtras note={note} />
    </Face>
  );
});
