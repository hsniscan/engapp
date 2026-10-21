import { useMatches } from 'react-router';
import { AppShell } from '@/ui';
import { SyncIndicator } from './SyncIndicator';

export interface RouteHandle {
  /** Hide navigation chrome (review session). */
  immersive?: boolean;
}

function isRouteHandle(h: unknown): h is RouteHandle {
  return typeof h === 'object' && h !== null;
}

export function RootLayout() {
  const matches = useMatches();
  const immersive = matches.some((m) => isRouteHandle(m.handle) && m.handle.immersive === true);
  return <AppShell immersive={immersive} syncSlot={<SyncIndicator />} />;
}
