import type { TFunction } from 'i18next';
import type { Params } from 'react-router';
import type tr from '@/i18n/tr.json';

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
  /**
   * The (+) group this page belongs to (v0.5.1, decision 0056): the add and capture pages
   * (/add, /makale, /fotograf, /altyazi, /import/*, /metin-olustur). The tab bar highlights no
   * tab (or the (+)) on them instead of Desteler / Kelimelerim.
   */
  navSection?: 'add';
  /**
   * The browser tab / history / recent-apps title, "Bugün · Engapp": a key under pageTitle,
   * or a function of the route params for pages named by their content (a settings page).
   */
  title?: PageTitleKey | ((params: Params, t: TFunction) => string);
}

export type PageTitleKey = Exclude<keyof (typeof tr)['pageTitle'], 'app'>;

/** document.title for the matched routes: the deepest route that names itself, else "Engapp". */
export function pageTitleOf(
  matches: readonly { handle: unknown; params: Params }[],
  t: TFunction,
): string {
  const m = matches.findLast((x) => isRouteHandle(x.handle) && x.handle.title !== undefined);
  const title = m && (m.handle as RouteHandle).title;
  if (!m || !title) return 'Engapp';
  const name = typeof title === 'function' ? title(m.params, t) : t(`pageTitle.${title}`);
  return t('pageTitle.app', { title: name });
}

/** The nav section the matched routes ask for, if any. */
export function navSectionOf(handles: readonly unknown[]): RouteHandle['navSection'] | null {
  return (
    handles.filter(isRouteHandle).findLast((h) => h.navSection !== undefined)?.navSection ?? null
  );
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
