// The stage chip in the corner of a card (spec 5.2): a label and a thin 4-part bar. Tapping it
// explains when a word counts as learned.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cardStage, stageLevel } from '@/domain/stages';
import { stageChipLabel } from './study';
import type { Card } from '@/domain/types';
import { cn } from '@/ui';

export function StageChip({ card }: { card: Card }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const level = stageLevel(cardStage(card));
  const label = stageChipLabel(card, t);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        data-testid="stage-chip"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[0.8125rem] font-semibold text-accent-text"
      >
        <span aria-hidden="true" className="flex gap-0.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                'h-2.5 w-[5px] rounded-[2px]',
                i < level
                  ? 'bg-accent-text'
                  : 'bg-[color-mix(in_oklab,var(--accent-text)_35%,transparent)]',
              )}
            />
          ))}
        </span>
        {label}
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute top-full right-0 z-10 mt-1.5 w-64 rounded-[12px] border border-border bg-surface-raised p-3 text-left text-sm font-normal text-fg shadow-overlay"
        >
          {t('study.stage.explain')}
        </span>
      )}
    </span>
  );
}
