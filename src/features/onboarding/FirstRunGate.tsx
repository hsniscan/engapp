import { lazy, Suspense, type ReactNode } from 'react';
import { useOnboarding } from './state';

/**
 * The onboarding is only seen once, so it is a lazy chunk and stays out of the start-up
 * bundle (decision 0053 budget).
 */
const Onboarding = lazy(async () => ({ default: (await import('./Onboarding')).Onboarding }));

/**
 * Bugün for a user without words: the onboarding for a brand-new user, otherwise `children`
 * (the empty-state welcome). Renders nothing while the facts load.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const state = useOnboarding();
  if (!state) return null;
  return state.needed ? (
    <Suspense fallback={null}>
      <Onboarding step={state.step} />
    </Suspense>
  ) : (
    <>{children}</>
  );
}
