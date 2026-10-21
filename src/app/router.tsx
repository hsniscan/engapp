import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { AddPage } from './pages/AddPage';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { ImportPreviewPage } from './pages/ImportPreviewPage';
import { LibraryPage } from './pages/LibraryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';

/*
 * Placeholder pages live in src/app/pages. Feature agents replace each `element` with the
 * real screen from src/features/<feature>.
 */
const children: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: 'review', element: <ReviewPage />, handle: { immersive: true } satisfies RouteHandle },
  { path: 'add', element: <AddPage /> },
  { path: 'import/:jobId', element: <ImportPreviewPage /> },
  { path: 'library', element: <LibraryPage /> },
  { path: 'stats', element: <StatsPage /> },
  { path: 'settings', element: <SettingsPage /> },
  { path: 'auth', element: <AuthPage /> },
];

children.push({ path: '*', element: <NotFoundPage /> });

const routes: RouteObject[] = [{ path: '/', element: <RootLayout />, children }];

// Dev-only component gallery, outside the shell. Tree-shaken from production builds.
if (import.meta.env.DEV) {
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
