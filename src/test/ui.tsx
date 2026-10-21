// Helpers for component tests (testing-library + a memory router + jsdom polyfills).
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import '@/i18n';
import { afterEach } from 'vitest';
import { TooltipProvider } from '@/ui';

// Vitest runs without globals, so testing-library cannot register its own cleanup.
afterEach(cleanup);

/** jsdom lacks these; Radix (slider, popper) and the library pager use them. */
export function installDomPolyfills(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.ResizeObserver) {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!window.matchMedia) {
    window.matchMedia = (q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as unknown as MediaQueryList;
  }
}

/** Render `element` at `path` inside a memory router (so Link/useSearchParams work). */
export function renderRoute(element: ReactNode, { path = '/', url = path }: { path?: string; url?: string } = {}) {
  installDomPolyfills();
  const router = createMemoryRouter([{ path, element }, { path: '*', element: null }], { initialEntries: [url] });
  const utils = render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return { ...utils, router };
}
