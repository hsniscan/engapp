import { createBrowserRouter, type RouteObject } from 'react-router';
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
    path: 'import/:jobId',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/import/ImportPreviewPage')).ImportPreviewPage,
    }),
  },
  {
    path: 'library',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/cards/LibraryPage')).LibraryPage }),
  },
  {
    path: 'stats',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/stats/StatsScreen')).StatsScreen }),
  },
  {
    path: 'settings',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/settings/SettingsPage')).SettingsPage,
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
    path: 'settings/profile',
    HydrateFallback: () => null,
    lazy: async () => ({
      Component: (await import('@/features/profile/ProfilePage')).ProfilePage,
    }),
  },
  { path: 'auth', element: <AuthPage /> },
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
