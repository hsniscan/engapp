/** What a route tells the shell about itself (route `handle`). */
export interface RouteHandle {
  /**
   * Hide navigation chrome (a study session). A function decides from the query string, for
   * routes that are a picker without it and a session with it (/study?mode=word).
   */
  immersive?: boolean | ((search: URLSearchParams) => boolean);
  /** Immersive pages that draw their own top bar (✕, progress): the shell draws none. */
  ownTopBar?: boolean;
  /** Immersive pages: where the top bar's ✕ goes (default: home) and its i18n label key. */
  exitTo?: string;
  exitLabelKey?: 'review.endSession' | 'imageReview.close';
}

export function isRouteHandle(h: unknown): h is RouteHandle {
  return typeof h === 'object' && h !== null;
}

/** Whether the matched routes ask for an immersive screen at this query string. */
export function isImmersive(handles: readonly unknown[], search: URLSearchParams): boolean {
  return handles.filter(isRouteHandle).some((h) => {
    const v = h.immersive;
    return typeof v === 'function' ? v(search) : v === true;
  });
}
