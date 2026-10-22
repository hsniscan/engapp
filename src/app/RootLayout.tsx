import { useTranslation } from 'react-i18next';
import { useMatches, useOutlet } from 'react-router';
import { BackupReminder } from '@/features/settings/BackupReminder';
import { IosInstallGuide } from '@/features/settings/IosInstallGuide';
import { AppShell } from '@/ui';
import { SyncIndicator } from './SyncIndicator';

export interface RouteHandle {
  /** Hide navigation chrome (review session). */
  immersive?: boolean;
  /** Immersive pages: where the top bar's ✕ goes (default: home) and its i18n label key. */
  exitTo?: string;
  exitLabelKey?: 'review.endSession' | 'imageReview.close';
}

function isRouteHandle(h: unknown): h is RouteHandle {
  return typeof h === 'object' && h !== null;
}

export function RootLayout() {
  const matches = useMatches();
  const outlet = useOutlet();
  const { t } = useTranslation();
  const immersive = matches.some((m) => isRouteHandle(m.handle) && m.handle.immersive === true);
  const exitHandle = matches
    .map((m) => m.handle)
    .filter(isRouteHandle)
    .findLast((h) => h.exitTo !== undefined);
  const exit =
    exitHandle?.exitTo !== undefined
      ? { to: exitHandle.exitTo, label: t(exitHandle.exitLabelKey ?? 'review.endSession') }
      : undefined;
  return (
    <>
      <AppShell immersive={immersive} exit={exit} syncSlot={<SyncIndicator />}>
        {/* Guest backup reminder: renders only on the home screen ("/"). */}
        {!immersive && <BackupReminder />}
        {outlet}
      </AppShell>
      {!immersive && <IosInstallGuide />}
    </>
  );
}
