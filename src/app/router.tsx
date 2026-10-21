import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { AuthPage } from '@/features/auth/AuthPage';
import { HomeScreen } from '@/features/home/HomeScreen';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReviewScreen } from '@/features/review/ReviewScreen';
import { StatsScreen } from '@/features/stats/StatsScreen';

/*
 * Placeholder pages live in src/app/pages. Feature agents replace each `element` with the
 * real screen from src/features/<feature>.
 */
const children: RouteObject[] = [
  { index: true, element: <HomeScreen /> },
  { path: 'review', element: <ReviewScreen />, handle: { immersive: true } satisfies RouteHandle },
  { path: 'add', HydrateFallback: () => null, lazy: async () => ({ Component: (await import('@/features/cards/AddPage')).AddPage }) },
  { path: 'import/:jobId', HydrateFallback: () => null, lazy: async () => ({ Component: (await import('@/features/import/ImportPreviewPage')).ImportPreviewPage }) },
  { path: 'library', HydrateFallback: () => null, lazy: async () => ({ Component: (await import('@/features/cards/LibraryPage')).LibraryPage }) },
  { path: 'stats', element: <StatsScreen /> },
  { path: 'settings', HydrateFallback: () => null, lazy: async () => ({ Component: (await import('@/features/settings/SettingsPage')).SettingsPage }) },
  { path: 'auth', element: <AuthPage /> },
];

children.push({ path: '*', element: <NotFoundPage /> });

const routes: RouteObject[] = [{ path: '/', element: <RootLayout />, children }];

// Dev-only component gallery, outside the shell. Tree-shaken from production builds.
if (import.meta.env.DEV) {
  // Import panels outside the Add page (inside the shell), until the Add tabs mount them.
  children.unshift({
    path: 'dev/import',
    HydrateFallback: () => null,
    lazy: async () => ({ Component: (await import('@/features/import/DevImportPage')).DevImportPage }),
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
