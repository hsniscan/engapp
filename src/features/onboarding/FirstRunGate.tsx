import type { ReactNode } from 'react';
import { Onboarding } from './Onboarding';
import { useOnboarding } from './state';

/**
 * Bugün for a user without words: the onboarding for a brand-new user, otherwise `children`
 * (the empty-state welcome). Renders nothing while the facts load.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const state = useOnboarding();
  if (!state) return null;
  return state.needed ? <Onboarding step={state.step} /> : <>{children}</>;
}
