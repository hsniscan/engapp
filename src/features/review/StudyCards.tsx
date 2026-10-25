// Card content of the study session (redesign boards ReviewFront / ReviewBack and the shared
// pieces of the Üretim and Boşluk doldurma cards): a card with a header row (mode, stage chip,
// level), the word, its picture and pronunciation, and on the back the meaning, the sentence
// with its translation and audio, the mnemonic, more example sentences and the word family.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { posLabel } from '@/features/cards/labels';
import { CardExamples } from '@/features/examples/ExamplesPanel';
import { CardBackExtras } from '@/features/family/CardBackExtras';
import { CardPicture } from '@/features/images';
import { ContrastBack, ContrastFront, LeechBadge, LeechHint } from '@/features/leech';
import { LevelDialogButton } from '@/features/levels/LevelDetails';
import { useCardLevel } from '@/features/levels/useWordLevel';
import { useMnemonic } from '@/features/mnemonics';
import { cn } from '@/ui';
import { BackSentence, Ipa, SenseList, Sentence, SpeakButton, type SpeakProps } from './CardFaces';
import { meaningOf, useModeLabel } from './study';
import { StageChip } from './StageChip';

export interface StudyCardProps {
  view: CardView;
  speech: SpeakProps;
}

export function CardHeader({ view, label }: { view: CardView; label: string }) {
  const level = useCardLevel(view);
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span className="min-w-0 text-[0.8125rem] text-fg-muted">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <LeechBadge lapses={view.card.lapses} />
        <StageChip card={view.card} />
        {level && <LevelDialogButton level={level} term={view.note.term} />}
      </span>
    </div>
  );
}

/** The paper card all study faces sit on. */
export function CardSurface({
  children,
  className,
  onClick,
  testId,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex flex-col rounded-[20px] border border-border bg-surface px-[18px] pt-4 pb-[18px] shadow-[0_1px_2px_var(--shadow-color)]',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Mnemonic of a sense as its own small card (board: "Anımsatıcı"). */
export function MnemonicCard({ senseId }: { senseId: string | null | undefined }) {
  const { t } = useTranslation();
  const text = useMnemonic(senseId);
  if (!text) return null;
  return (
    <section
      data-testid="card-mnemonic"
      aria-label={t('mnemonic.cardLabel')}
      className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface px-4 py-3.5"
    >
      <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg-muted">
        <BulbIcon />
        {t('mnemonic.cardLabel')}
      </span>
      <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg">
        {text}
      </p>
    </section>
  );
}

export function BulbIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </svg>
  );
}

/** "Örnek cümleler" (collapsible, from the shared lexicon) as its own card. */
export function ExamplesCard({ view, speech }: StudyCardProps) {
  if (!view.senses.some((s) => s.lexicon_sense_id)) return null;
  return (
    <section className="rounded-[18px] border border-border bg-surface px-3 py-1.5">
      <CardExamples
        term={view.note.term}
        senses={view.senses}
        initialSenseId={view.sense?.id ?? null}
        speech={speech.speakText ? { available: speech.available, speak: speech.speakText } : undefined}
      />
    </section>
  );
}

/** The sentence block on the back: sentence, its audio and its translation, on a sunken panel. */
export function SentencePanel({ view, speech, large }: StudyCardProps & { large?: boolean }) {
  if (!view.sentence) return null;
  return (
    <div className="rounded-[14px] bg-canvas px-4 py-3.5">
      <BackSentence
        key={view.sentence.text}
        sentence={view.sentence}
        term={view.note.term}
        speech={speech}
        className={large ? 'text-xl' : 'text-[1.1875rem]'}
        align="start"
      />
    </div>
  );
}

/** What the back shows under the card: mnemonic, more sentences, word family / false friends. */
export function BackExtras({ view, speech }: StudyCardProps) {
  const senses = view.sense ? [view.sense] : view.senses;
  return (
    <>
      {senses.map((s) => (
        <MnemonicCard key={s.id} senseId={s.id} />
      ))}
      <ExamplesCard view={view} speech={speech} />
      <div className="empty:hidden">
        <CardBackExtras note={view.note} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Kelime çalışma

export function RecognitionFront({ view, speech, onFlip }: StudyCardProps & { onFlip: () => void }) {
  const { t } = useTranslation();
  const label = useModeLabel(view, true);
  const { note } = view;
  if (note.term_type === 'contrast') {
    return (
      <CardSurface onClick={onFlip} className="min-h-full flex-1" testId="study-front">
        <CardHeader view={view} label={label} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <ContrastFront view={view} />
        </div>
      </CardSurface>
    );
  }
  const picture = view.image && view.imageOnFront ? view.image : null;
  return (
    <CardSurface onClick={onFlip} className="min-h-full flex-1" testId="study-front">
      <CardHeader view={view} label={label} />
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        {picture && (
          <CardPicture
            image={picture}
            showNew={false}
            className="aspect-[4/3] h-auto max-h-[196px] w-full max-w-sm overflow-hidden rounded-[14px] bg-surface-sunken"
          />
        )}
        <div className="flex flex-col items-center gap-2">
          <p
            lang="en"
            className="font-serif text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.01em] text-balance break-words text-fg sm:text-[2.875rem]"
          >
            {note.term}
          </p>
          <div className="flex items-center gap-2">
            <Ipa ipa={note.ipa} />
            {note.term_type !== 'affix' && <PrimarySpeak speech={speech} />}
          </div>
        </div>
        {view.sentence && (
          <Sentence sentence={view.sentence.text} span={view.sentence.span} term={note.term} className="max-w-md" />
        )}
        <LeechHint view={view} />
      </div>
      <p className="text-center text-[0.8125rem] text-fg-muted">{t('study.recallHint')}</p>
    </CardSurface>
  );
}

/** The round, tinted speaker of the board (44 px). */
export function PrimarySpeak({ speech, label }: { speech: SpeakProps; label?: string }) {
  return (
    <SpeakButton
      available={speech.available}
      onSpeak={speech.onSpeak}
      label={label}
      className="size-11 rounded-full bg-accent-soft text-accent-text hover:bg-accent-soft"
    />
  );
}

export function RecognitionBack({ view, speech }: StudyCardProps) {
  const label = useModeLabel(view, false);
  const { note } = view;
  if (note.term_type === 'contrast') {
    return (
      <CardSurface testId="study-back">
        <CardHeader view={view} label={label} />
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <ContrastBack view={view} />
        </div>
      </CardSurface>
    );
  }
  return (
    <>
      <CardSurface className="gap-4" testId="study-back">
        <CardHeader view={view} label={label} />
        <TermRow view={view} speech={speech} />
        <div className="h-px bg-surface-sunken" />
        <SenseList view={view} align="start" />
        <SentencePanel view={view} speech={speech} />
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </>
  );
}

/** Term, IPA, speaker, and the picture as a thumbnail on the right. */
export function TermRow({ view, speech, size = 'lg' }: StudyCardProps & { size?: 'lg' | 'md' }) {
  const { note } = view;
  return (
    <div className="flex items-center gap-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          lang="en"
          className={cn(
            'font-serif leading-[1.05] font-semibold break-words text-fg',
            size === 'lg' ? 'text-[2.125rem]' : 'text-[1.375rem]',
          )}
        >
          {note.term}
        </p>
        <div className="flex items-center gap-1.5">
          <Ipa ipa={note.ipa} />
          {note.term_type !== 'affix' && <PrimarySpeak speech={speech} />}
        </div>
      </div>
      {view.image && (
        <CardPicture image={view.image} className="size-[76px] overflow-hidden rounded-[12px] bg-surface-sunken" />
      )}
    </div>
  );
}

/** Part of speech and the Turkish meaning (Üretim's question; the answer side of a cloze). */
export function MeaningBlock({ view, size = 'lg' }: { view: CardView; size?: 'lg' | 'md' }) {
  const { t } = useTranslation();
  const sense = view.sense;
  if (!sense) return null;
  return (
    <div className="flex flex-col gap-1">
      {sense.pos && <span className="text-[0.8125rem] text-fg-muted italic">{posLabel(t, sense.pos)}</span>}
      <p
        className={cn(
          'font-serif leading-tight font-semibold break-words text-fg',
          size === 'lg' ? 'text-[1.875rem]' : 'text-[1.375rem]',
        )}
      >
        {meaningOf(sense)}
      </p>
      {sense.gloss_en && (
        <p lang="en" className="text-sm text-fg-muted">
          {sense.gloss_en}
        </p>
      )}
    </div>
  );
}
