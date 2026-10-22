// Route components of the public pages (one lazy chunk; src/app/router.tsx).
import { PrivacyPage } from './PrivacyPage';

export { DeleteAccountPage } from './DeleteAccountPage';

export function PrivacyTrRoute() {
  return <PrivacyPage lang="tr" />;
}

export function PrivacyEnRoute() {
  return <PrivacyPage lang="en" />;
}
