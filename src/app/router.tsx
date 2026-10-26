import { createBrowserRouter, redirect, type RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { AuthPage } from '@/features/auth/AuthPage';
import { HomeScreen } from '@/features/home/HomeScreen';
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

/*
 * Information architecture of the redesign (five places): Bugün `/` · Desteler `/decks` ·
 * (+) the Add sheet (a modal, not a route) · İlerleme `/progress` · Profil `/profile`.
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

  // ---- Desteler: ?tab=mine|discover|bank; a deck; a suggested deck; all my words.
  {
    path: 'decks',
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
    // "Tüm kelimelerim" (reached from Desteler and Profil).
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
      exitTo: '/decks?tab=reading',
    } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/reader/ReaderPage')).ReaderPage }),
  },

  // ---- Adding: the sheet leads into these flows.
  {
    path: 'add',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/cards/AddPage')).AddPage }),
  },
  {
    path: 'import/anki',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/anki/AnkiImportPage')).AnkiImportPage,
    }),
  },
  {
    path: 'import/:jobId',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/import/ImportPreviewPage')).ImportPreviewPage,
    }),
  },

  // ---- İlerleme
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
    lazy: async () => ({ Component: (await loadLegal()).PrivacyEnRoute }),
  },
  {
    path: '/hesap-sil',
    errorElement: <RouteErrorPage />,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await loadLegal()).DeleteAccountPage }),
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
