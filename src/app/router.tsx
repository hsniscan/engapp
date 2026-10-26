import { createBrowserRouter, redirect, type RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { AuthPage } from '@/features/auth/AuthPage';
import { HomeScreen } from '@/features/home/HomeScreen';
import { loadLanguage } from '@/i18n';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { LEGACY_PATHS, legacyRedirect } from './redirects';

/** The study session is the most used screen: its chunk is fetched while the browser is idle. */
const loadStudy = () => import('@/features/review/StudyRoute');
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => void loadStudy().catch(() => {}));
}

/** A route that only sends an old address to its new home (src/app/redirects.ts). */
const legacy = (path: (typeof LEGACY_PATHS)[number]): RouteObject => ({
  path,
  loader: ({ request }) => {
    const url = new URL(request.url);
    return redirect(legacyRedirect(url.pathname, url.search) ?? '/');
  },
});

/** The (+) pages: no tab owns them (decision 0056; RootLayout reads it with navSectionOf). */
const ADD_SECTION = { navSection: 'add' } satisfies RouteHandle;

/*
 * Information architecture (v0.5.1, ADR 0057; five places): Bugün `/` · Kelimelerim `/decks` ·
 * (+) the Add sheet (a modal, not a route) · Keşfet `/kesfet` · Profil `/profile` (İlerleme
 * `/progress` is reached from the top of Profil and from Bugün's numbers).
 * Feature screens are lazy chunks; the names below are the agreed exports of each feature.
 */
const children: RouteObject[] = [
  { index: true, element: <HomeScreen /> },

  // ---- Study: /study?mode=word|production|cloze runs a session; /study alone is the picker.
  {
    path: 'study',
    handle: {
      immersive: (search) => search.has('mode'),
      // The session draws its own top row (× beside the progress, as on the boards).
      ownTopBar: true,
      exitTo: '/',
    } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await loadStudy()).StudyRoute }),
  },
  {
    // "Biraz daha çalış": extra new cards today, a practice round, tomorrow's cards now (old /more).
    path: 'study/more',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/extra/MoreStudyPage')).MoreStudyPage,
    }),
  },
  {
    path: 'practice',
    handle: { immersive: true } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/practice/PracticeScreen')).PracticeRoute,
    }),
  },

  // ---- Kelimelerim: ?tab=mine|bank; a deck; a suggested deck; all my words. The old
  // ?tab=discover|reading segments live in Keşfet now (redirect).
  {
    path: 'decks',
    loader: ({ request }) => {
      const url = new URL(request.url);
      const to = legacyRedirect(url.pathname, url.search);
      return to ? redirect(to) : null;
    },
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/decks/DecksPage')).DecksPage }),
  },
  {
    // AI theme grouping of the user's words (Destelerim → "AI ile temalara ayır").
    path: 'decks/themes',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/decks/ThemesPage')).ThemesPage }),
  },
  {
    path: 'decks/suggested/:key',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/decks/SuggestedDeckPage')).SuggestedDeckPage,
    }),
  },
  {
    path: 'decks/:id',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/decks/DeckDetailPage')).DeckDetailPage,
    }),
  },
  {
    // Keşfet (v0.5.1): a feed of texts, suggested decks and words, with ?f=okuma|desteler|
    // kelimeler filters. The graded library (old /kitaplik) is its "Okuma" filter.
    path: 'kesfet',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/discover/DiscoverPage')).DiscoverPage,
    }),
  },
  {
    // "Tüm kelimelerim" (reached from Kelimelerim and Profil).
    path: 'library',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/cards/LibraryPage')).LibraryPage }),
  },

  // ---- Reading (v0.5 İP1): every text opens here; the screen draws its own top bar.
  {
    path: 'oku/:textId',
    handle: {
      immersive: true,
      ownTopBar: true,
      exitTo: '/kesfet?f=okuma',
    } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/reader/ReaderPage')).ReaderPage }),
  },

  // ---- Adding: the (+) sheet leads into these flows (v0.5.1: they belong to the (+), not to
  // a tab, decision 0056).
  {
    path: 'add',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/cards/AddPage')).AddPage }),
  },
  {
    // v0.5 İP2 (decision 0044): an article from a link, a subtitle file.
    path: 'makale',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/article/ArticlePage')).ArticlePage,
    }),
  },
  {
    path: 'altyazi',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/article/SubtitlePage')).SubtitlePage,
    }),
  },
  {
    // "Fotoğraftan metin" (v0.5 İP3, decision 0045).
    path: 'fotograf',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/ocr/OcrPage')).OcrPage }),
  },
  {
    // "Kelimelerimle metin oluştur" (v0.5.1, decision 0056). Keşfet may link here too.
    path: 'metin-olustur',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/compose/ComposePage')).ComposePage,
    }),
  },
  {
    path: 'import/anki',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/anki/AnkiImportPage')).AnkiImportPage,
    }),
  },
  {
    // A CSV file or a typed word list (v0.5.1).
    path: 'import/csv',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/import/CsvImportPage')).CsvImportPage,
    }),
  },
  {
    path: 'import/:jobId',
    handle: ADD_SECTION,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/import/ImportPreviewPage')).ImportPreviewPage,
    }),
  },

  // ---- İlerleme (under Profil since v0.5.1)
  {
    path: 'progress',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/stats/ProgressPage')).ProgressPage,
    }),
  },

  // ---- Profil and its settings (gear on Profil → /settings, sub-pages /settings/:section).
  {
    path: 'profile',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/profile/ProfilePage')).ProfilePage,
    }),
  },
  {
    path: 'settings',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/settings/SettingsIndexPage')).SettingsIndexPage,
    }),
  },
  {
    path: 'settings/bilinen-kelimeler',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/leveltest/KnownWordsPage')).KnownWordsPage,
    }),
  },
  {
    path: 'settings/kaynaklar',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/settings/SourcesPage')).SourcesPage,
    }),
  },
  {
    path: 'settings/:section',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/settings/SettingsSectionPage')).SettingsSectionPage,
    }),
  },
  {
    path: 'level-test',
    handle: { immersive: true } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/leveltest/LevelTestScreen')).LevelTestRoute,
    }),
  },
  {
    path: 'admin/images',
    // Entered from Ayarlar → Gelişmiş: the top bar's ✕ goes back there (the page has no
    // back arrow of its own, like every other immersive screen).
    handle: {
      immersive: true,
      exitTo: '/settings/gelismis',
      exitLabelKey: 'imageReview.close',
    } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/imageReview/ImageReviewPage')).ImageReviewRoute,
    }),
  },
  { path: 'auth', element: <AuthPage /> },
  {
    // "Paylaş → Engapp": Android share sheet and the PWA's Web Share Target (decision 0034).
    path: 'share',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/share/SharePage')).SharePage }),
  },

  // ---- Old addresses (four-tab app): redirect to their new homes.
  ...LEGACY_PATHS.map(legacy),
];

children.push({ path: '*', element: <NotFoundPage /> });

// The pathless child keeps the shell (navigation) around a screen that failed to render or load;
// the root errorElement is the last resort if the shell itself fails.
const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [{ errorElement: <RouteErrorPage />, children }],
  },
];

// Public pages outside the shell (v0.4 İP7, ADR 0035): readable without an account, linked
// from Google Play. Static paths rank above the shell's "*", so they win on any host.
const loadLegal = () => import('@/features/legal/pages');
routes.unshift(
  {
    path: '/gizlilik',
    errorElement: <RouteErrorPage />,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await loadLegal()).PrivacyTrRoute }),
  },
  {
    path: '/privacy',
    errorElement: <RouteErrorPage />,
    HydrateFallback: () => null,
    lazy: async () => {
      // English strings are not in the start-up bundle (src/i18n/index.ts).
      const [m] = await Promise.all([loadLegal(), loadLanguage('en')]);
      return { Component: m.PrivacyEnRoute };
    },
  },
  {
    path: '/hesap-sil',
    errorElement: <RouteErrorPage />,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await loadLegal()).DeleteAccountPage }),
  },
  {
    // "Engapp" in the text-selection menu: only the quick sheet, no shell (decision 0046).
    path: '/quick',
    errorElement: <RouteErrorPage />,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/quick/QuickPage')).QuickPage }),
  },
);

// Dev-only component gallery, outside the shell. Tree-shaken from production builds.
if (import.meta.env.DEV) {
  // Import panels outside the Add page (inside the shell), until the Add tabs mount them.
  children.unshift({
    path: 'dev/import',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/import/DevImportPage')).DevImportPage,
    }),
  });
  routes.unshift({
    path: '/dev/ui',
    HydrateFallback: () => null,
    lazy: async () => {
      const { UiGallery } = await import('./dev/UiGallery');
      return { Component: UiGallery };
    },
  });
}

export const router = createBrowserRouter(routes);
