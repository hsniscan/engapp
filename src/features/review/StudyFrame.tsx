// The study session's frame (redesign): a top row, the card content that scrolls on its own,
// and a bar fixed to the bottom (show answer / typed answer / the four rating buttons). The
// frame follows the visual viewport, so on a phone the typed-answer field and its button stay
// right above the on-screen keyboard.
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/ui';

interface Box {
  top: number;
  height: number | null;
}

/**
 * Where the fixed frame goes: from the page position it would naturally start at (under the app
 * header) to the bottom of the visual viewport. When the keyboard opens, the visual viewport
 * shrinks (and on iOS scrolls), and the frame shrinks with it.
 */
function useViewportBox(anchor: RefObject<HTMLDivElement | null>): Box {
  const [box, setBox] = useState<Box>({ top: 0, height: null });
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    let anchorTop = 0;
    const measure = () => {
      const el = anchor.current;
      if (el) anchorTop = Math.max(0, el.getBoundingClientRect().top + window.scrollY);
    };
    const update = () => {
      if (!vv) {
        setBox((b) =>
          b.top === anchorTop && b.height === null ? b : { top: anchorTop, height: null },
        );
        return;
      }
      const top = Math.max(anchorTop, vv.offsetTop);
      const height = Math.max(0, Math.round(vv.offsetTop + vv.height - top));
      setBox((b) => (b.top === top && b.height === height ? b : { top, height }));
    };
    const onResize = () => {
      measure();
      update();
    };
    measure();
    update();
    window.addEventListener('resize', onResize);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', onResize);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [anchor]);
  return box;
}

export interface StudyFrameProps {
  /** Session row (progress, undo, menu). */
  top: ReactNode;
  /** The card and what goes under it; scrolls on its own. */
  children: ReactNode;
  /** The fixed bottom bar. */
  footer?: ReactNode;
  /** Label of the scrolling region (the back of a card can be long). */
  scrollLabel?: string;
}

export function StudyFrame({ top, children, footer, scrollLabel }: StudyFrameProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const box = useViewportBox(anchor);
  return (
    <>
      <div ref={anchor} aria-hidden="true" />
      <div
        data-testid="study-frame"
        className="fixed inset-x-0 z-10 flex flex-col bg-canvas"
        style={
          box.height === null ? { top: box.top, bottom: 0 } : { top: box.top, height: box.height }
        }
      >
        <div className="mx-auto w-full max-w-xl shrink-0 px-4 sm:px-6">{top}</div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          // A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable).
          tabIndex={scrollLabel ? 0 : undefined}
          role={scrollLabel ? 'region' : undefined}
          aria-label={scrollLabel}
        >
          <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pt-1 pb-6 sm:px-6">
            {children}
          </div>
        </div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-canvas">
            <div
              className={cn(
                'mx-auto w-full max-w-xl px-3 pt-2.5 sm:px-6',
                'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
              )}
            >
              {footer}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
