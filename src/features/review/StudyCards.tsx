// Card content of the study session (v0.5.2 "Çam", docs/design.md §4.3, ADR 0066): one raised
// card that fills the space between the top bar and the answer area on both faces (no jump on
// flip). Header: the stage pill (tap: what the stages mean) and, on the right, the leech marker,
// the word level and the speaker. Front: the term (Literata 40), IPA and part of speech. Back:
// the same head, a hairline, "Anlamı" and "Örnek" with its Turkish and audio, the picture.
// Mnemonic, more example sentences and the word family follow under the card.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { cardFormat } from '@/domain/formatLadder';
import { posLabel } from '@/features/cards/labels';
import { CardExamples } from '@/features/examples/ExamplesPanel';
import { CardBackExtras } from '@/features/family/CardBackExtras';
import { CardPicture } from '@/features/images';
import { ContrastBack, ContrastFront, LeechBadge, LeechHint } from '@/features/leech';
import { LevelDialogButton } from '@/features/levels/LevelDetails';
import { useCardLevel } from '@/features/levels/useWordLevel';
import { useMnemonic } from '@/features/mnemonics';
import { Badge, Card, cn, Eyebrow, Icon, Term } from '@/ui';
import { BackSentence, Ipa, SenseList, Sentence, SpeakButton, type SpeakProps } from './CardFaces';
import { meaningOf, useModeLabel } from './study';
import { StageChip } from './StageChip';

export interface StudyCardProps {
  view: CardView;
  speech: SpeakProps;
}

/**
 * The card's top row: stage (and leech marker) on the left; level and the speaker on the right.
 * `speak` false hides the speaker (affixes, or a face that has its own).
 */
export function CardHeader({
  view,
  speech,
  speak = true,
}: {
  view: CardView;
  speech?: SpeakProps;
  speak?: boolean;
}) {
  const level = useCardLevel(view);
  const canSpeak = speak && !!speech && view.note.term_type !== 'affix';
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StageChip card={view.card} />
        <LeechBadge lapses={view.card.lapses} />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {level && <LevelDialogButton level={level} term={view.note.term} />}
        {canSpeak && <PrimarySpeak speech={speech} />}
      </span>
    </div>
  );
}

/** The raised card every study face sits on (Card tone="raised", padding lg). */
export function CardSurface({
  children,
  className,
  onClick,
  testId,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: 'study-front' | 'study-back';
}) {
  const { t } = useTranslation();
  return (
    <Card
      as="section"
      tone="raised"
      padding="none"
      data-testid={testId}
      // The front is a region ("Ön yüz"); the answer side's wrapper is "Arka yüz" (BackRegion).
      aria-label={testId === 'study-front' ? t('review.front') : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col px-5 pt-4 pb-6 sm:px-8 sm:pt-6 sm:pb-8',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </Card>
  );
}

/** The answer side: the card and what follows it, one region ("Arka yüz"). */
export function BackRegion({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('review.back')} className="flex min-h-full flex-1 flex-col gap-3">
      {children}
    </section>
  );
}

/** A small titled card under the study card (mnemonic, the picked word of a cloze). */
export function ExtraCard({
  label,
  icon,
  children,
  testId,
}: {
  label: string;
  icon?: 'bulb' | 'info';
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card as="section" aria-label={label} data-testid={testId} className="flex flex-col gap-1.5">
      <Eyebrow className="flex items-center gap-1.5">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </Eyebrow>
      <div className="text-ui text-fg">{children}</div>
    </Card>
  );
}

/** Mnemonic of a sense as its own small card ("Anımsatıcı"). */
export function MnemonicCard({ senseId }: { senseId: string | null | undefined }) {
  const { t } = useTranslation();
  const text = useMnemonic(senseId);
  if (!text) return null;
  return (
    <ExtraCard label={t('mnemonic.cardLabel')} icon="bulb" testId="card-mnemonic">
      <p lang="tr">{text}</p>
    </ExtraCard>
  );
}

/** "Örnek cümleler" (collapsible, from the shared lexicon) as its own card. */
export function ExamplesCard({ view, speech }: StudyCardProps) {
  if (!view.senses.some((s) => s.lexicon_sense_id)) return null;
  return (
    <Card padding="sm" className="px-3">
      <CardExamples
        term={view.note.term}
        senses={view.senses}
        initialSenseId={view.sense?.id ?? null}
        speech={
          speech.speakText ? { available: speech.available, speak: speech.speakText } : undefined
        }
      />
    </Card>
  );
}

/** "Örnek": the card's sentence with its Turkish translation and a speaker. */
export function SentencePanel({ view, speech }: StudyCardProps) {
  const { t } = useTranslation();
  if (!view.sentence) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>{t('study.example')}</Eyebrow>
      <BackSentence
        key={view.sentence.text}
        sentence={view.sentence}
        term={view.note.term}
        speech={speech}
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

/** The speaker of the card (tonal round IconButton, 44 px). */
export function PrimarySpeak({ speech, label }: { speech: SpeakProps; label?: string }) {
  return (
    <SpeakButton
      available={speech.available}
      onSpeak={speech.onSpeak}
      label={label}
      variant="tonal"
    />
  );
}

/** "isim" / "fiil": the part of speech of the sense asked, in the UI language. */
export function PosBadge({ view }: { view: CardView }) {
  const { t } = useTranslation();
  const pos = (view.sense ?? view.senses[0])?.pos;
  if (!pos) return null;
  return <Badge tone="outline">{posLabel(t, pos)}</Badge>;
}

/** Term (Literata), IPA and part of speech: the head of both faces. */
export function TermHead({
  view,
  size = 'display',
  align = 'center',
}: {
  view: CardView;
  size?: 'display' | 'title';
  align?: 'center' | 'start';
}) {
  const { note } = view;
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
      )}
    >
      <Term
        size={size}
        as="p"
        className="leading-[1.1] tracking-[-0.01em] text-balance break-words text-fg"
      >
        {note.term}
      </Term>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Ipa ipa={note.ipa} />
        <PosBadge view={view} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Kelime çalışma

export function RecognitionFront({
  view,
  speech,
  onFlip,
}: StudyCardProps & { onFlip: () => void }) {
  const { t } = useTranslation();
  const label = useModeLabel(view, true);
  const { note } = view;
  if (note.term_type === 'contrast') {
    return (
      <CardSurface onClick={onFlip} className="min-h-full flex-1" testId="study-front">
        <CardHeader view={view} speak={false} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <ContrastFront view={view} />
        </div>
      </CardSurface>
    );
  }
  const picture = view.image && view.imageOnFront ? view.image : null;
  return (
    <CardSurface onClick={onFlip} className="min-h-full flex-1" testId="study-front">
      <CardHeader view={view} speech={speech} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
        <Eyebrow>{label}</Eyebrow>
        {picture && (
          <CardPicture
            image={picture}
            showNew={false}
            className="aspect-[4/3] h-auto max-h-40 w-full max-w-xs overflow-hidden rounded-inner bg-surface-sunken"
          />
        )}
        <TermHead view={view} />
        {/* B2 format ladder (ADR 0071): from Öğrenildi the term alone; the sentence is on the back. */}
        {view.sentence && cardFormat(view.card).sentenceOnFront && (
          <Sentence
            sentence={view.sentence.text}
            span={view.sentence.span}
            term={note.term}
            className="max-w-md text-fg-muted"
          />
        )}
        <LeechHint view={view} />
      </div>
      <p className="text-center text-meta text-fg-muted">{t('study.recallHint')}</p>
    </CardSurface>
  );
}

export function RecognitionBack({ view, speech }: StudyCardProps) {
  const { t } = useTranslation();
  const { note } = view;
  if (note.term_type === 'contrast') {
    return (
      <CardSurface testId="study-back" className="min-h-full flex-1">
        <CardHeader view={view} speak={false} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
          <ContrastBack view={view} />
        </div>
      </CardSurface>
    );
  }
  return (
    <>
      <CardSurface className="min-h-full flex-1" testId="study-back">
        <CardHeader view={view} speech={speech} />
        <div
          className="flex flex-1 flex-col justify-center gap-6 pt-4"
          data-testid={view.image ? 'meaning-with-picture' : undefined}
        >
          <TermHead view={view} size="title" align="start" />
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-1.5">
            <Eyebrow>{t('study.meaning')}</Eyebrow>
            <SenseList view={view} align="start" />
          </div>
          <SentencePanel view={view} speech={speech} />
          <BackPicture view={view} />
        </div>
      </CardSurface>
      <BackExtras view={view} speech={speech} />
    </>
  );
}

/** The sense's picture under the example (pre-generated pictures only), at most 160 px tall. */
export function BackPicture({ view, showNew = true }: { view: CardView; showNew?: boolean }) {
  if (!view.image) return null;
  return (
    <CardPicture
      image={view.image}
      showNew={showNew}
      className="aspect-[4/3] h-auto max-h-40 w-auto max-w-full self-start overflow-hidden rounded-inner bg-surface-sunken"
    />
  );
}

/** Part of speech and the Turkish meaning (Üretim's question; the answer side of a cloze). */
export function MeaningBlock({ view, size = 'lg' }: { view: CardView; size?: 'lg' | 'md' }) {
  const { t } = useTranslation();
  const sense = view.sense;
  if (!sense) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {sense.pos && (
        <span>
          <Badge tone="outline">{posLabel(t, sense.pos)}</Badge>
        </span>
      )}
      <p
        className={cn(
          'font-semibold break-words text-fg',
          size === 'lg' ? 'text-page leading-tight' : 'text-heading',
        )}
      >
        {meaningOf(sense)}
      </p>
      {sense.gloss_en && (
        <p lang="en" className="font-serif text-ui text-fg-muted">
          {sense.gloss_en}
        </p>
      )}
    </div>
  );
}
