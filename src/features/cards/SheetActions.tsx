import type { ReactNode } from 'react';

/**
 * The action row at the bottom of a long form inside a Dialog/Sheet (Kaydet stays in reach
 * while the form scrolls): sticks to the sheet's bottom edge, full-bleed over the dialog's
 * padding, a hairline on top. Two equal buttons on phones, right-aligned on wide screens.
 * The offsets mirror the Dialog's own padding (px-5/sm:px-6, bottom safe area).
 */
export function SheetActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] z-10 -mx-5 grid grid-cols-2 gap-2 border-t border-border bg-surface-raised px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:-bottom-6 sm:-mx-6 sm:flex sm:justify-end sm:px-6 sm:pb-6">
      {children}
    </div>
  );
}
