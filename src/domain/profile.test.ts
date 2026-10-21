import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decayFactor,
  type FeedbackSignal,
  keepProfileFields,
  orderContexts,
  type ProfileSource,
  rankedTopics,
  toggleInList,
  topicWeights,
} from './profile';
import { BASE_CONTEXTS, TOPIC_KEYS, type TopicKey } from './topics';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 12);

const src = (topics: string[], daysAgo = 0, deleted = false): ProfileSource => ({
  topics,
  created_at: NOW - daysAgo * DAY,
  deleted_at: deleted ? NOW : null,
});
const fb = (context: string, verdict: FeedbackSignal['verdict'], daysAgo = 0): FeedbackSignal => ({
  context,
  verdict,
  at: NOW - daysAgo * DAY,
});
const weightOf = (ws: ReturnType<typeof topicWeights>, t: TopicKey) =>
  ws.find((w) => w.topic === t)!;

describe('decayFactor', () => {
  it('halves every 60 days and treats the future as now', () => {
    expect(decayFactor(NOW, NOW)).toBe(1);
    expect(decayFactor(NOW - 60 * DAY, NOW)).toBeCloseTo(0.5, 10);
    expect(decayFactor(NOW - 120 * DAY, NOW)).toBeCloseTo(0.25, 10);
    expect(decayFactor(NOW + DAY, NOW)).toBe(1);
  });
});

describe('topicWeights (fixed scenarios)', () => {
  it('is all zero for an empty profile, in list order', () => {
    const ws = topicWeights({ now: NOW });
    expect(ws.map((w) => w.topic)).toEqual([...TOPIC_KEYS]);
    expect(ws.every((w) => w.weight === 0)).toBe(true);
  });

  it('gives a picked topic 3', () => {
    const w = weightOf(topicWeights({ now: NOW, interests: ['travel'] }), 'travel');
    expect(w).toMatchObject({ weight: 3, selected: true, texts: 0 });
  });

  it('adds 1 per text, halved every 60 days', () => {
    const ws = topicWeights({
      now: NOW,
      sources: [src(['technology']), src(['technology'], 60), src(['technology', 'business'], 120)],
    });
    expect(weightOf(ws, 'technology')).toMatchObject({ weight: 1.75, texts: 3, lastTextAt: NOW });
    expect(weightOf(ws, 'business')).toMatchObject({ weight: 0.25, texts: 1 });
  });

  it('ignores deleted texts, unknown keys and a topic listed twice on one text', () => {
    const ws = topicWeights({
      now: NOW,
      sources: [
        src(['science'], 0, true),
        src(['astrology', 'food', 'food']),
        { created_at: NOW, deleted_at: null },
      ],
    });
    expect(weightOf(ws, 'science').weight).toBe(0);
    expect(weightOf(ws, 'food')).toMatchObject({ weight: 1, texts: 1 });
  });

  it('adds 0.5 per liked and removes 0.25 per skipped sentence, never below 0', () => {
    const ws = topicWeights({
      now: NOW,
      interests: ['travel'],
      feedback: [
        fb('travel', 'like'),
        fb('travel', 'like'),
        fb('travel', 'skip'),
        fb('technical', 'skip'),
        fb('daily', 'reject'),
      ],
    });
    expect(weightOf(ws, 'travel')).toMatchObject({ weight: 3.75, likes: 2, skips: 1 });
    expect(weightOf(ws, 'technology')).toMatchObject({ weight: 0, skips: 1 });
    expect(weightOf(ws, 'daily_life')).toMatchObject({ weight: 0, likes: 0, skips: 0 });
  });

  it('decays feedback like texts', () => {
    const ws = topicWeights({ now: NOW, feedback: [fb('business', 'like', 60)] });
    expect(weightOf(ws, 'business').weight).toBe(0.25);
  });

  it('gives a turned-off topic 0 whatever else happened', () => {
    const ws = topicWeights({
      now: NOW,
      interests: ['sports'],
      muted: ['sports'],
      sources: [src(['sports']), src(['sports'])],
    });
    expect(weightOf(ws, 'sports')).toMatchObject({ weight: 0, muted: true, texts: 2 });
    expect(rankedTopics(ws)).toEqual([]);
  });

  it('sorts heaviest first, ties in list order', () => {
    const ws = topicWeights({
      now: NOW,
      interests: ['law', 'technology'],
      sources: [src(['food'])],
    });
    expect(rankedTopics(ws)).toEqual(['technology', 'law', 'food']);
  });

  it('property: weights are ≥ 0, muted are 0, and picking a topic never lowers it', () => {
    const topic = fc.constantFrom(...TOPIC_KEYS);
    fc.assert(
      fc.property(
        fc.array(topic),
        fc.array(topic),
        fc.array(fc.record({ topics: fc.array(topic, { maxLength: 3 }), days: fc.nat(400) })),
        fc.array(
          fc.record({
            context: fc.constantFrom(...BASE_CONTEXTS, ...TOPIC_KEYS),
            verdict: fc.constantFrom('like' as const, 'skip' as const, 'reject' as const),
            days: fc.nat(400),
          }),
        ),
        topic,
        (interests, muted, sources, feedback, extra) => {
          const input = {
            now: NOW,
            interests,
            muted,
            sources: sources.map((s) => src(s.topics, s.days)),
            feedback: feedback.map((f) => fb(f.context, f.verdict, f.days)),
          };
          const ws = topicWeights(input);
          for (const w of ws) {
            expect(w.weight).toBeGreaterThanOrEqual(0);
            if (w.muted) expect(w.weight).toBe(0);
          }
          const before = weightOf(ws, extra).weight;
          const after = weightOf(
            topicWeights({ ...input, interests: [...interests, extra] }),
            extra,
          ).weight;
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });
});

describe('orderContexts', () => {
  const contexts = ['daily', 'business', 'technical', 'formal'] as const;

  it('keeps the given order for an empty profile', () => {
    expect(orderContexts(contexts, topicWeights({ now: NOW }))).toEqual([...contexts]);
  });

  it('opens "technical" first for a user who imported 3 technology texts (plan acceptance)', () => {
    const ws = topicWeights({
      now: NOW,
      sources: [src(['technology']), src(['technology']), src(['technology'])],
    });
    expect(orderContexts(contexts, ws)[0]).toBe('technical');
  });

  it('sums the topics under a base context and puts an interest context by its own topic', () => {
    const ws = topicWeights({
      now: NOW,
      interests: ['law', 'politics', 'travel'],
      sources: [src(['business']), src(['business'])],
    });
    // formal = law 3 + politics 3 = 6; daily = travel 3; business = 2; travel = 3 (own key) + 0.
    expect(orderContexts([...contexts, 'travel'], ws)).toEqual([
      'formal',
      'daily',
      'travel',
      'business',
      'technical',
    ]);
  });
});

describe('keepProfileFields', () => {
  it('keeps local lists when the incoming row lacks them', () => {
    const local = { id: 'settings', interests: ['travel'], muted_topics: [] };
    expect(keepProfileFields('settings', { id: 'settings', interests: null }, local)).toEqual({
      id: 'settings',
      interests: ['travel'],
      muted_topics: [],
    });
    expect(keepProfileFields('sources', { id: 's' }, { id: 's', topics: ['law'] })).toEqual({
      id: 's',
      topics: ['law'],
    });
  });

  it('lets an empty list through and ignores other tables', () => {
    expect(keepProfileFields('settings', { interests: [] }, { interests: ['travel'] })).toEqual({
      interests: [],
    });
    expect(keepProfileFields('notes', { tags: null }, { tags: ['x'] })).toEqual({ tags: null });
    expect(keepProfileFields('sources', { topics: null }, undefined)).toEqual({ topics: null });
  });
});

describe('toggleInList', () => {
  it('adds once, removes, and keeps keys it does not know', () => {
    expect(toggleInList(['future_topic', 'law'], 'law', true)).toEqual(['future_topic', 'law']);
    expect(toggleInList(['future_topic', 'law'], 'law', false)).toEqual(['future_topic']);
    expect(toggleInList(null, 'food', true)).toEqual(['food']);
  });
});
