// The study session's frame (redesign): a top row, the card content that scrolls on its own,
// and a bar fixed to the bottom (show answer / typed answer / the four rating buttons). The
// frame follows the visual viewport, so on a phone the typed-answer field and its button stay
// right above the on-screen keyboard.
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/ui';

/**
 * Height of the frame: from where it starts on the page (under the app header) to the bottom of
 * the visual viewport. When the keyboard opens, the visual viewport shrinks (and on iOS
 * scrolls), and the frame shrinks with it, so its bottom bar sits right above the keyboard.
 * The frame stays in the normal flow (no position: fixed, which a transformed ancestor such as
 * the page-enter animation would capture).
 */
function useViewportHeight(frame: RefObject<HTMLDivElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const el = frame.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottom = window.scrollY + (vv ? vv.offsetTop + vv.height : window.innerHeight);
      const h = Math.max(240, Math.round(bottom - top));
      setHeight((prev) => (prev === h ? prev : h));
    };
    update();
    window.addEventListener('resize', update);
    // The page-enter animation shifts the frame for a moment: measure again when it ends.
    document.addEventListener('animationend', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('animationend', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [frame]);
  return height;
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
  const ref = useRef<HTMLDivElement>(null);
  const height = useViewportHeight(ref);
  return (
    <>
      <div
        ref={ref}
        data-testid="study-frame"
        className="flex h-dvh flex-col overflow-hidden bg-canvas"
        style={height === null ? undefined : { height }}
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
