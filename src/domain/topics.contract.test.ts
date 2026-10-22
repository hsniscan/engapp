// The extract prompt's topic list (supabase/functions/_shared/topics-contract.ts) must be the
// app's list: the edge functions cannot import src/, so the keys are written twice.
import { describe, expect, it } from 'vitest';
import { cleanChunkTopics, EXTRACT_TOPIC_KEYS, MAX_CHUNK_TOPICS } from '../../supabase/functions/_shared/topics-contract';
import { parseTopics, TOPIC_KEYS } from './topics';

describe('topic keys of extract-v5', () => {
  it('are the app topic keys, in the same order', () => {
    expect([...EXTRACT_TOPIC_KEYS]).toEqual([...TOPIC_KEYS]);
  });

  it('are cleaned like parseTopics does', () => {
    const samples: unknown[] = [
      ['Technology', 'daily-life', 'law'],
      [' daily life ', 'sports', 'sports'],
      ['cooking', 7, null, 'film'],
      'technology',
      [],
    ];
    for (const s of samples) expect(cleanChunkTopics(s)).toEqual(parseTopics(s, MAX_CHUNK_TOPICS));
  });
});
