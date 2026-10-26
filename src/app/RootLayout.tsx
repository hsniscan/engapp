import { useTranslation } from 'react-i18next';
import { useLocation, useMatches, useOutlet } from 'react-router';
import { AddSheet } from '@/features/add/AddSheet';
import { openAddSheet, useAddSheetOpen } from '@/features/add/addSheetStore';
import { BackupReminder } from '@/features/settings/BackupReminder';
import { IosInstallGuide } from '@/features/settings/IosInstallGuide';
import { AppShell } from '@/ui';
import { isImmersive, isRouteHandle } from './routeHandle';
import { SyncIndicator, SyncServices } from './SyncIndicator';

export type { RouteHandle } from './routeHandle';

export function RootLayout() {
  const matches = useMatches();
  const location = useLocation();
  const outlet = useOutlet();
  const addOpen = useAddSheetOpen();
  const { t } = useTranslation();
  const handles = matches.map((m) => m.handle);
  const immersive = isImmersive(handles, new URLSearchParams(location.search));
  const ownTopBar = handles.filter(isRouteHandle).some((h) => h.ownTopBar === true);
  const exitHandle = handles.filter(isRouteHandle).findLast((h) => h.exitTo !== undefined);
  const exit =
    exitHandle?.exitTo !== undefined
      ? { to: exitHandle.exitTo, label: t(exitHandle.exitLabelKey ?? 'review.endSession') }
      : undefined;
  return (
    <>
      <AppShell
        immersive={immersive}
        ownTopBar={ownTopBar}
        exit={exit}
        syncSlot={<SyncIndicator />}
        onAdd={openAddSheet}
        addOpen={addOpen}
      >
        {/* Guest backup reminder: renders only on the home screen ("/"). */}
        {!immersive && <BackupReminder />}
        {outlet}
      </AppShell>
      <SyncServices />
      {!immersive && <AddSheet />}
      {!immersive && <IosInstallGuide />}
    </>
  );
}
