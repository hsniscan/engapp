import { describe, expect, it } from 'vitest';
import tr from '../i18n/tr.json';
import en from '../i18n/en.json';
import { EXAMPLE_CONTEXT_KEYS } from './examples';
import {
  aggregateTopics,
  CONTEXT_TOPIC,
  isTopicKey,
  parseTopics,
  TOPIC_CONTEXTS,
  TOPIC_KEYS,
  topicsForContext,
} from './topics';

describe('topic list', () => {
  it('has unique snake_case keys, each with a Turkish and an English name', () => {
    expect(new Set(TOPIC_KEYS).size).toBe(TOPIC_KEYS.length);
    for (const k of TOPIC_KEYS) {
      expect(k).toMatch(/^[a-z][a-z_]{1,39}$/);
      expect((tr.topics as Record<string, string>)[k]).toBeTruthy();
      expect((en.topics as Record<string, string>)[k]).toBeTruthy();
    }
    expect(Object.keys(tr.topics).sort()).toEqual([...TOPIC_KEYS].sort());
  });

  it('keeps the keys that are already stored (keys are never renamed)', () => {
    for (const k of [
      'technology',
      'business',
      'science',
      'health',
      'sports',
      'travel',
      'arts',
      'politics',
      'law',
      'education',
      'nature',
      'food',
      'games',
      'film',
      'daily_life',
    ]) {
      expect(isTopicKey(k)).toBe(true);
    }
  });

  it('maps every topic to contexts of the İP5 catalogue', () => {
    for (const k of TOPIC_KEYS) {
      expect(TOPIC_CONTEXTS[k].length).toBeGreaterThan(0);
      for (const c of TOPIC_CONTEXTS[k]) expect(EXAMPLE_CONTEXT_KEYS).toContain(c);
    }
  });

  it('counts feedback on a context only for a topic that favours it', () => {
    for (const [context, topic] of Object.entries(CONTEXT_TOPIC)) {
      expect(TOPIC_CONTEXTS[topic!]).toContain(context);
    }
    // Every subject context of the catalogue stands for a topic; registers do not.
    const subjects = EXAMPLE_CONTEXT_KEYS.filter((c) => c !== 'conversation' && c !== 'formal');
    expect(Object.keys(CONTEXT_TOPIC).sort()).toEqual([...subjects].sort());
  });
});

describe('parseTopics', () => {
  it('drops unknown values, normalizes spelling, dedupes and caps', () => {
    expect(parseTopics(['Technology', 'daily-life', 'cooking', 'technology', 5, 'law'])).toEqual([
      'technology',
      'daily_life',
    ]);
    expect(parseTopics([' Daily life '], 3)).toEqual(['daily_life']);
    expect(parseTopics('technology')).toEqual([]);
    expect(parseTopics(null)).toEqual([]);
  });
});

describe('topicsForContext', () => {
  it('maps contexts to the topics they are about', () => {
    expect(topicsForContext('technology')).toEqual(['technology']);
    expect(topicsForContext('work')).toEqual(['business']);
    expect(topicsForContext('money')).toEqual(['business']);
    expect(topicsForContext('academic')).toEqual(['education']);
    expect(topicsForContext('culture')).toEqual(['arts']);
    expect(topicsForContext('daily')).toEqual(['daily_life']);
    expect(topicsForContext('formal')).toEqual([]);
    expect(topicsForContext('conversation')).toEqual([]);
    expect(topicsForContext('travel')).toEqual(['travel']);
    expect(topicsForContext('unknown')).toEqual([]);
  });
});

describe('aggregateTopics', () => {
  it('keeps every topic of a short text', () => {
    expect(aggregateTopics([['technology', 'business']])).toEqual(['technology', 'business']);
  });

  it('drops topics named by fewer than a quarter of the chunks, most frequent first', () => {
    const chunks = [
      ['technology'],
      ['technology', 'science'],
      ['science'],
      ['technology'],
      ['health'],
      ['technology'],
      ['science'],
      ['law'],
    ];
    expect(aggregateTopics(chunks)).toEqual(['technology', 'science']);
  });

  it('caps the result and ignores junk', () => {
    expect(
      aggregateTopics([['food', 'travel'], ['travel', 'x'], ['sports', 'food'], [42]], 2),
    ).toEqual(['travel', 'food']);
    expect(aggregateTopics([])).toEqual([]);
  });
});
