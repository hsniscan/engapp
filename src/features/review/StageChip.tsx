// The stage pill in the corner of a study card (spec 5.2; v0.5.2 "Çam": the one stage scale,
// docs/design.md). The label carries the meaning ("Pekişiyor · 1/3", "Yeni kart"); tapping it
// explains when a word counts as learned.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cardStage } from '@/domain/stages';
import { stageChipLabel } from './study';
import type { Card } from '@/domain/types';
import { cn, stageBg } from '@/ui';

export function StageChip({ card }: { card: Card }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const stage = cardStage(card);
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
        className="hit-44 relative inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-sunken pr-3 pl-2.5 text-caption font-semibold whitespace-nowrap text-fg-muted transition-colors duration-(--duration-micro) hover:text-fg"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            stageBg[stage],
            stage === 'new' && 'ring-1 ring-border-strong ring-inset',
          )}
        />
        {label}
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute top-full left-0 z-10 mt-2 w-64 rounded-control border border-border bg-surface-raised p-3 text-left text-meta font-normal text-fg shadow-overlay"
        >
          {t('study.stage.explain')}
        </span>
      )}
    </span>
  );
}
