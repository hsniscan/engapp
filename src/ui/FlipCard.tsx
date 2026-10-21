import { motion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { duration, ease } from './tokens/motion';

export interface FlipCardProps {
  front: ReactNode;
  back: ReactNode;
  flipped: boolean;
  /**
   * Pointer convenience: clicking the card calls this. It is NOT the accessible way to flip;
   * the review screen must also offer a real button ("Cevabı göster") and the Space key.
   */
  onFlip?: () => void;
  className?: string;
  /** Minimum face height. Default fits a 360 px phone with the answer bar below. */
  minHeight?: string;
}

/**
 * Two-sided review card. 3D flip in the medium motion tier (280 ms); under reduced motion a
 * short crossfade. The back face is a polite live region and only mounts once flipped, so its
 * content is announced when it appears.
 */
export function FlipCard({
  front,
  back,
  flipped,
  onFlip,
  className,
  minHeight = 'min(52dvh, 26rem)',
}: FlipCardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  // Keep the back mounted while the card turns back over, then drop it.
  const [backLingers, setBackLingers] = useState(flipped);

  const face =
    'rounded-card border border-border bg-surface-raised shadow-raised flex flex-col [grid-area:1/1] backface-hidden';

  const transition = reduce
    ? { duration: 0.15, ease: 'linear' as const }
    : { duration: duration.medium, ease: ease.standard };

  return (
    <div
      className={cn('relative w-full perspective-[1400px]', onFlip && 'cursor-pointer', className)}
      onClick={onFlip}
    >
      <motion.div
        className="grid transform-3d"
        initial={false}
        animate={reduce ? { rotateY: 0 } : { rotateY: flipped ? 180 : 0 }}
        transition={transition}
        onAnimationComplete={() => {
          setBackLingers(flipped);
        }}
      >
        <motion.section
          aria-label={t('review.front')}
          aria-hidden={flipped}
          inert={flipped}
          className={face}
          style={{ minHeight }}
          initial={false}
          animate={reduce ? { opacity: flipped ? 0 : 1 } : { opacity: 1 }}
          transition={transition}
        >
          {front}
        </motion.section>
        <motion.section
          aria-label={t('review.back')}
          aria-hidden={!flipped}
          inert={!flipped}
          aria-live="polite"
          aria-atomic="true"
          className={cn(face, !reduce && 'rotate-y-180')}
          style={{ minHeight }}
          initial={false}
          animate={reduce ? { opacity: flipped ? 1 : 0 } : { opacity: 1 }}
          transition={transition}
        >
          {flipped || backLingers ? back : null}
        </motion.section>
      </motion.div>
    </div>
  );
}

/** Standard padded, centred layout for a card face. */
export function CardFace({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      {children}
    </div>
  );
}
