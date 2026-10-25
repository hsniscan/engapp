// What every card kind of the study session gets from the screen (redesign). Each kind draws
// its own card body and bottom bar inside the screen's frame.
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import type { RatingValue } from '@/domain/types';
import { Button } from '@/ui';
import type { SpeakProps } from './CardFaces';
import { RatingBar } from './RatingBar';
import { RecognitionBack, RecognitionFront } from './StudyCards';

export interface KindProps {
  view: CardView;
  speech: SpeakProps;
  /** The answer side is showing (session state "flipped"). */
  revealed: boolean;
  onReveal: (viaKeyboard: boolean) => void;
  onAnswer: (rating: RatingValue, viaKeyboard: boolean) => void;
  ratingRef: Ref<HTMLDivElement>;
  showRef: Ref<HTMLButtonElement>;
  /** Puts the body and the bottom bar into the session frame. */
  frame: (body: ReactNode, footer: ReactNode, scrollLabel?: string) => ReactNode;
}

/** Kelime çalışma: the word, then its meaning, then the four buttons. */
export function RecognitionStudy({ view, speech, revealed, onReveal, onAnswer, ratingRef, showRef, frame }: KindProps) {
  const { t } = useTranslation();
  if (revealed) {
    return frame(
      <div className="flex flex-col gap-3">
        <p className="sr-only" role="status">
          {t('study.answerShown')}
        </p>
        <RecognitionBack view={view} speech={speech} />
      </div>,
      <RatingBar ref={ratingRef} view={view} onAnswer={onAnswer} />,
      t('study.scrollCard'),
    );
  }
  return frame(
    <RecognitionFront view={view} speech={speech} onFlip={() => onReveal(false)} />,
    <div className="flex flex-col items-center gap-2">
      <Button ref={showRef} size="lg" fullWidth onClick={(e) => onReveal(e.detail === 0)}>
        {t('review.showAnswer')}
      </Button>
      <p className="text-[0.8125rem] text-fg-muted">
        <span className="pointer-fine:hidden">{t('study.tapCard')}</span>
        <span className="hidden pointer-fine:inline">{t('study.spaceKey')}</span>
      </p>
    </div>,
  );
}
