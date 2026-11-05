// First-run onboarding state (v0.5.1, ADR 0058): device-local flags in localStorage
// (features/settings/platform.ts `flags`, never throws) plus the synced facts the rule in
// domain/onboarding.ts reads. No schema change.
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { db } from '@/data';
import { needsOnboarding, type OnboardingStep, parseOnboardingStep } from '@/domain/onboarding';
import { flags } from '@/features/settings/platform';

export const ONBOARDING_DONE_KEY = 'onboarding';
export const ONBOARDING_STEP_KEY = 'onboarding.step';
/** Set while the deck step adds its deck (kept across a restart, so the add resumes there). */
export const ONBOARDING_ADDING_KEY = 'onboarding.adding';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const snapshot = () =>
  `${flags.get(ONBOARDING_DONE_KEY) ?? ''}|${parseOnboardingStep(flags.get(ONBOARDING_STEP_KEY)) ?? ''}|${flags.get(ONBOARDING_ADDING_KEY) ?? ''}`;

export function setOnboardingAdding(on: boolean): void {
  flags.set(ONBOARDING_ADDING_KEY, on ? '1' : '');
  emit();
}

/** The deck step is adding its deck: Bugün keeps the onboarding up although words exist. */
export function useOnboardingAdding(): boolean {
  const local = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [done, , adding] = local.split('|');
  return done !== 'done' && adding === '1';
}

export function setOnboardingStep(step: OnboardingStep): void {
  flags.set(ONBOARDING_STEP_KEY, step);
  emit();
}

/** The user finished or left the onboarding: never shown again on this device. */
export function finishOnboarding(): void {
  flags.set(ONBOARDING_DONE_KEY, 'done');
  flags.set(ONBOARDING_ADDING_KEY, '');
  emit();
}

/** { needed, step } for the home screen; undefined while loading. */
export function useOnboarding(): { needed: boolean; step: OnboardingStep } | undefined {
  const local = useSyncExternalStore(subscribe, snapshot, snapshot);
  const facts = useLiveQuery(async () => {
    const [words, settings] = await Promise.all([
      db.notes.filter((n) => n.deleted_at === null).count(),
      db.settings.get('settings'),
    ]);
    return { words, interestsAsked: settings?.interests != null };
  }, []);
  if (!facts) return undefined;
  const [done, rawStep, adding] = local.split('|');
  const step = parseOnboardingStep(rawStep);
  return {
    needed: needsOnboarding({
      done: done === 'done',
      words: facts.words,
      interestsAsked: facts.interestsAsked,
      inProgress: step !== null,
      adding: adding === '1',
    }),
    step: adding === '1' ? 'deck' : (step ?? 'welcome'),
  };
}
