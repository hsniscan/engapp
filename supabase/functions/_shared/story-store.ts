// Real StoryStore: story_consume() / story_refund() from migration 20261101000800_story.sql and,
// for "Kelimelerimle metin oluştur", picked_story_consume() / picked_story_refund() from
// 20261102000300_picked_texts.sql (service role). The only thing ai-story writes on the server
// is these counters.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorySource } from './story-contract.ts';
import type { StoryStore, StoryUsage } from './story.ts';

export class SupabaseStoryStore implements StoryStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async consume(
    userId: string,
    retry: boolean,
    limit: number,
    source: StorySource = 'daily',
  ): Promise<StoryUsage> {
    const fn = source === 'picked' ? 'picked_story_consume' : 'story_consume';
    const r = await this.db.rpc(fn, { p_user: userId, p_retry: retry, p_limit: limit });
    if (r.error) throw new Error(`${fn}: ${r.error.message}`);
    return r.data as StoryUsage;
  }

  async refund(userId: string, retry: boolean, source: StorySource = 'daily'): Promise<void> {
    const fn = source === 'picked' ? 'picked_story_refund' : 'story_refund';
    const r = await this.db.rpc(fn, { p_user: userId, p_retry: retry });
    if (r.error) throw new Error(`${fn}: ${r.error.message}`);
  }
}

/** In-memory twin with the SQL functions' rules, for the tests. */
export class MemoryStoryStore implements StoryStore {
  readonly days = new Map<string, { stories: number; retries: number }>();
  private readonly today: () => string;
  constructor(today: () => string = () => new Date().toISOString().slice(0, 10)) {
    this.today = today;
  }

  private row(userId: string, source: StorySource = 'daily') {
    const key = source === 'picked' ? `${userId}|${this.today()}|picked` : `${userId}|${this.today()}`;
    let r = this.days.get(key);
    if (!r) {
      r = { stories: 0, retries: 0 };
      this.days.set(key, r);
    }
    return r;
  }

  async consume(
    userId: string,
    retry: boolean,
    limit: number,
    source: StorySource = 'daily',
  ): Promise<StoryUsage> {
    await Promise.resolve();
    const r = this.row(userId, source);
    if (retry) {
      if (r.retries + 1 > r.stories) return { allowed: false, used: r.stories, limit };
      r.retries++;
      return { allowed: true, used: r.stories, limit };
    }
    if (r.stories + 1 > limit) return { allowed: false, used: r.stories, limit };
    r.stories++;
    return { allowed: true, used: r.stories, limit };
  }

  async refund(userId: string, retry: boolean, source: StorySource = 'daily'): Promise<void> {
    await Promise.resolve();
    const r = this.row(userId, source);
    if (retry) r.retries = Math.max(0, r.retries - 1);
    else {
      r.stories = Math.max(0, r.stories - 1);
      r.retries = Math.min(r.retries, r.stories);
    }
  }
}
