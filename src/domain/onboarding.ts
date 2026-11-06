// Who sees the first-run onboarding (v0.5.1, ADR 0058). Pure.
//
// A brand-new user: no word on the device, and the interests question never answered
// (settings.interests is null until asked, and it syncs). An existing user has words or an
// answered question, so they never see it, also on a new device once their data arrives.
// `done` is the device's own "finished or left" flag; `inProgress` keeps the flow going after
// its interests step has answered the question.

export const ONBOARDING_STEPS = ['welcome', 'level', 'interests', 'deck'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function needsOnboarding(input: {
  done: boolean;
  words: number;
  interestsAsked: boolean;
  inProgress: boolean;
  /**
   * The ready deck of the last step is being added (v0.5.3 A1): its first word must not end
   * the flow mid-add, so the "Ekleniyor… n/N" step stays until the add is done.
   */
  adding?: boolean;
}): boolean {
  if (input.done) return false;
  if (input.adding) return true;
  if (input.words > 0) return false;
  return !input.interestsAsked || input.inProgress;
}

export function parseOnboardingStep(raw: string | null | undefined): OnboardingStep | null {
  return (ONBOARDING_STEPS as readonly string[]).includes(raw ?? '')
    ? (raw as OnboardingStep)
    : null;
}

/** The step after `step`, or null at the end. */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[i + 1] ?? null;
}
