// Real StoryStore: story_consume() / story_refund() from migration 20261101000800_story.sql
// (service role). The only thing ai-story writes on the server is this counter.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryStore, StoryUsage } from './story.ts';

export class SupabaseStoryStore implements StoryStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async consume(userId: string, retry: boolean, limit: number): Promise<StoryUsage> {
    const r = await this.db.rpc('story_consume', { p_user: userId, p_retry: retry, p_limit: limit });
    if (r.error) throw new Error(`story_consume: ${r.error.message}`);
    return r.data as StoryUsage;
  }

  async refund(userId: string, retry: boolean): Promise<void> {
    const r = await this.db.rpc('story_refund', { p_user: userId, p_retry: retry });
    if (r.error) throw new Error(`story_refund: ${r.error.message}`);
  }
}

/** In-memory twin with the SQL functions' rules, for the tests. */
export class MemoryStoryStore implements StoryStore {
  readonly days = new Map<string, { stories: number; retries: number }>();
  private readonly today: () => string;
  constructor(today: () => string = () => new Date().toISOString().slice(0, 10)) {
    this.today = today;
  }

  private row(userId: string) {
    const key = `${userId}|${this.today()}`;
    let r = this.days.get(key);
    if (!r) {
      r = { stories: 0, retries: 0 };
      this.days.set(key, r);
    }
    return r;
  }

  async consume(userId: string, retry: boolean, limit: number): Promise<StoryUsage> {
    await Promise.resolve();
    const r = this.row(userId);
    if (retry) {
      if (r.retries + 1 > r.stories) return { allowed: false, used: r.stories, limit };
      r.retries++;
      return { allowed: true, used: r.stories, limit };
    }
    if (r.stories + 1 > limit) return { allowed: false, used: r.stories, limit };
    r.stories++;
    return { allowed: true, used: r.stories, limit };
  }

  async refund(userId: string, retry: boolean): Promise<void> {
    await Promise.resolve();
    const r = this.row(userId);
    if (retry) r.retries = Math.max(0, r.retries - 1);
    else {
      r.stories = Math.max(0, r.stories - 1);
      r.retries = Math.min(r.retries, r.stories);
    }
  }
}
