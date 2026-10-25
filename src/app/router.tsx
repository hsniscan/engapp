import { createBrowserRouter, redirect, type RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { AuthPage } from '@/features/auth/AuthPage';
import { HomeScreen } from '@/features/home/HomeScreen';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';

/** The review session is the most used screen: its chunk is fetched while the browser is idle. */
const loadReview = () => import('@/features/review/ReviewScreen');
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => void loadReview().catch(() => {}));
}

/*
 * Placeholder pages live in src/app/pages. Feature agents replace each `element` with the
 * real screen from src/features/<feature>.
 */
const children: RouteObject[] = [
  { index: true, element: <HomeScreen /> },
  {
    path: 'review',
    handle: { immersive: true } satisfies RouteHandle,
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await loadReview()).ReviewRoute }),
  },
  {
    path: 'more',
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
  {
    // Kelime Bankası (decision 0038): the leveled list words, ready to add.
    path: 'kelime-bankasi',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/wordbank/WordBankPage')).WordBankPage,
    }),
  },
  {
    path: 'library',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/cards/LibraryPage')).LibraryPage }),
  },
  {
    path: 'decks',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/decks/DecksPage')).DecksPage }),
  },
  {
    path: 'decks/themes',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/decks/ThemesPage')).ThemesPage }),
  },
  {
    // Old "İstatistik" address: the tabs (?tab=gelisim|rapor) carry over.
    path: 'stats',
    loader: ({ request }) => redirect(`/progress${new URL(request.url).search}`),
  },
  {
    path: 'progress',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/stats/ProgressPage')).ProgressPage,
    }),
  },
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
    // One settings sub-page; old slugs (/settings/profile) are redirected by the page itself.
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
    path: 'admin/images',
    // Entered from Ayarlar → Gelişmiş (/settings/gelismis): the top bar's ✕ goes back there (the page has no
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
