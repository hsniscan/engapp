import { describe, expect, it } from 'vitest';
import { needsOnboarding, nextOnboardingStep, parseOnboardingStep } from './onboarding';

const base = { done: false, words: 0, interestsAsked: false, inProgress: false };

describe('first-run onboarding: who sees it', () => {
  it('a brand-new user does', () => {
    expect(needsOnboarding(base)).toBe(true);
  });

  it('an existing user never does: words, an answered interests question, or done', () => {
    expect(needsOnboarding({ ...base, words: 1 })).toBe(false);
    expect(needsOnboarding({ ...base, interestsAsked: true })).toBe(false);
    expect(needsOnboarding({ ...base, done: true })).toBe(false);
  });

  it('keeps going after its own interests step answered the question', () => {
    expect(needsOnboarding({ ...base, interestsAsked: true, inProgress: true })).toBe(true);
    // ...until the first deck brings words.
    expect(needsOnboarding({ ...base, interestsAsked: true, inProgress: true, words: 3 })).toBe(
      false,
    );
  });

  it('steps go welcome → level → interests → deck', () => {
    expect(nextOnboardingStep('welcome')).toBe('level');
    expect(nextOnboardingStep('level')).toBe('interests');
    expect(nextOnboardingStep('interests')).toBe('deck');
    expect(nextOnboardingStep('deck')).toBeNull();
    expect(parseOnboardingStep('deck')).toBe('deck');
    expect(parseOnboardingStep('nope')).toBeNull();
    expect(parseOnboardingStep(null)).toBeNull();
  });
});
