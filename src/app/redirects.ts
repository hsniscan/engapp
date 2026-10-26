// Old addresses of the four-tab app and where they live after the redesign (five places:
// Bugün · Desteler · (+) · İlerleme · Profil). Bookmarks, shared links, notification taps
// (/review) and the installed PWA's start URLs keep working. Pure: the router turns the
// result into a redirect before anything renders.

function withParams(path: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Copy of `search` with `set` applied on top (the new place's own params win). */
function merge(search: string, set: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams(search);
  for (const [k, v] of Object.entries(set)) p.set(k, v);
  return p;
}

/**
 * Where an old path goes now, keeping its query string; null for a path that is not old.
 * `search` is location.search ("?a=b" or "").
 */
export function legacyRedirect(pathname: string, search = ''): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (path) {
    case '/review': {
      // The word study session. "?mode=ahead" (tomorrow's cards now) was the review screen's
      // own mode; /study uses `mode` for the study type, so it travels as `queue=ahead`.
      const p = new URLSearchParams(search);
      const ahead = p.get('mode') === 'ahead';
      p.delete('mode');
      const out = new URLSearchParams({ mode: 'word' });
      if (ahead) out.set('queue', 'ahead');
      for (const [k, v] of p) if (k !== 'queue' || !ahead) out.append(k, v);
      return withParams('/study', out);
    }
    case '/more':
      // "Biraz daha çalış" now lives on the study picker and the finished home screen.
      return withParams('/study', new URLSearchParams(search));
    case '/kelime-bankasi':
      return withParams('/decks', merge(search, { tab: 'bank' }));
    case '/decks/themes':
      return withParams('/decks', merge(search, { tab: 'mine' }));
    case '/stats':
      // ?tab=rapor (the weekly report) keeps working on İlerleme.
      return withParams('/progress', new URLSearchParams(search));
    case '/settings/profile':
      return withParams('/settings/profil', new URLSearchParams(search));
    default:
      return null;
  }
}

/** The old paths the router redirects now (each gets a redirecting route). */
export const LEGACY_PATHS = ['review', 'more', 'stats'] as const;

/**
 * Old paths whose new home is built by another redesign package: until it lands they keep
 * serving their old screen (src/app/router.tsx), so nothing breaks in between. At integration
 * move each into LEGACY_PATHS and delete its old route:
 *   kelime-bankasi, decks/themes → Desteler tabs; settings/profile → the Profil settings page.
 */
export const LEGACY_PATHS_PENDING = ['kelime-bankasi', 'decks/themes', 'settings/profile'] as const;
