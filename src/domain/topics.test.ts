import { describe, expect, it } from 'vitest';
import tr from '../i18n/tr.json';
import en from '../i18n/en.json';
import {
  aggregateTopics,
  BASE_CONTEXTS,
  isTopicKey,
  parseTopics,
  TOPIC_CONTEXT,
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

  it('maps every topic to a base context', () => {
    for (const k of TOPIC_KEYS) expect(BASE_CONTEXTS).toContain(TOPIC_CONTEXT[k]);
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
    expect(topicsForContext('technical')).toEqual(['technology']);
    expect(topicsForContext('business')).toEqual(['business']);
    expect(topicsForContext('daily')).toEqual(['daily_life']);
    expect(topicsForContext('formal')).toEqual([]);
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
